//! Foreground-window facts on Linux, from EWMH and `/proc`.
//!
//! Everything here is a read-only X11 property fetch against the window
//! manager plus two `/proc` symlinks the kernel already lets any process of
//! the same user read. Nothing is injected, no memory is read, no hook is
//! installed - the same contract the Windows probe keeps, for the same reason.
//!
//! **What this can and cannot see.** X11 - and therefore `XWayland` - publishes
//! the focused window as `_NET_ACTIVE_WINDOW` on the root window, which is how
//! every taskbar and every screen reader has found it for thirty years. Native
//! Wayland deliberately publishes nothing: a client cannot learn which surface
//! has focus, let alone whose process it is. So on a Wayland session this sees
//! `XWayland` windows (which is what Proton, Wine and most native games still
//! are) and reports [`ProbeNote::WaylandSurface`] for anything else, rather
//! than quietly claiming there is no game.

use std::sync::{Mutex, OnceLock};

use x11rb::connection::Connection as _;
use x11rb::protocol::randr::ConnectionExt as _;
use x11rb::protocol::xproto::{Atom, AtomEnum, ConnectionExt as _, MapState, Window};
use x11rb::rust_connection::RustConnection;

use super::{ProbeNote, RawWindow, Rect, ShellState};

/// How many 32-bit words of a list-valued property are ever worth reading.
/// `_NET_WM_STATE` holds a handful of atoms; nothing here needs more.
const MAX_PROPERTY_WORDS: u32 = 64;

/// The connection, its atoms, and what the last reading found.
///
/// Kept for the life of the process because the detector polls twice a second
/// and an X connection costs a socket and a round trip to set up. A protocol
/// failure drops it, so the next tick reconnects - an X server that went away
/// and came back is a session the user restarted, not a permanent state.
static SESSION: OnceLock<Mutex<State>> = OnceLock::new();

#[derive(Debug, Default)]
struct State {
    session: Option<Session>,
    note: ProbeNote,
    /// Whether the window read by the last [`foreground_window`] call was
    /// fullscreen. [`shell_state`] takes no window and is always called
    /// immediately after, so it answers from here rather than re-reading.
    fullscreen: bool,
}

#[derive(Debug)]
struct Session {
    conn: RustConnection,
    root: Window,
    /// The whole virtual desktop, as the monitor of last resort.
    screen: Rect,
    atoms: Atoms,
}

/// The atoms this probe interns once per connection.
#[derive(Debug, Clone, Copy)]
struct Atoms {
    active_window: Atom,
    wm_pid: Atom,
    wm_state: Atom,
    fullscreen: Atom,
    frame_extents: Atom,
    gtk_frame_extents: Atom,
}

fn state() -> &'static Mutex<State> {
    SESSION.get_or_init(|| Mutex::new(State::default()))
}

/// Read the foreground window, or `None` when there is nothing to judge.
pub(crate) fn foreground_window(own_pid: u32) -> Option<RawWindow> {
    let mut state = state().lock().ok()?;
    state.fullscreen = false;

    if state.session.is_none() {
        match Session::open() {
            Ok(session) => state.session = Some(session),
            Err(e) => {
                if state.note != ProbeNote::NoDisplay {
                    tracing::info!("game-overlay: no X11 display to probe: {e}");
                }
                state.note = ProbeNote::NoDisplay;
                return None;
            }
        }
    }

    let session = state.session.as_ref()?;
    match session.foreground(own_pid) {
        Ok(Some((window, fullscreen))) => {
            state.note = ProbeNote::Ok;
            state.fullscreen = fullscreen;
            Some(window)
        }
        Ok(None) => {
            state.note = if is_wayland_session() {
                ProbeNote::WaylandSurface
            } else {
                ProbeNote::Ok
            };
            None
        }
        Err(e) => {
            if state.note != ProbeNote::Failed {
                tracing::warn!("game-overlay: X11 probe failed: {e}");
            }
            state.note = ProbeNote::Failed;
            // Drop the connection: a protocol error usually means it is gone.
            state.session = None;
            None
        }
    }
}

/// What the last reading could see, for the diagnostics panel.
pub(crate) fn note() -> ProbeNote {
    state().lock().map_or(ProbeNote::Failed, |s| s.note)
}

/// Linux has no shell-wide "is anything fullscreen" query, so the answer is
/// the focused window's own `_NET_WM_STATE_FULLSCREEN`, read during
/// [`foreground_window`]. There is no exclusive fullscreen to report: on X11
/// every window is composited or not at the compositor's discretion, and
/// nothing is ever undrawable-over the way a Direct3D exclusive swapchain is.
pub(crate) fn shell_state() -> ShellState {
    match state().lock() {
        Ok(state) if state.fullscreen => ShellState::Busy,
        Ok(_) => ShellState::Normal,
        Err(_) => ShellState::Unknown,
    }
}

/// Is this a Wayland session, where a window we cannot see is the norm rather
/// than a fault?
fn is_wayland_session() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some()
}

impl Session {
    fn open() -> Result<Self, String> {
        let (conn, screen_num) = x11rb::connect(None).map_err(|e| e.to_string())?;
        let screen = conn
            .setup()
            .roots
            .get(screen_num)
            .ok_or_else(|| "X server reported no screen".to_owned())?;
        let root = screen.root;
        let screen = Rect {
            x: 0,
            y: 0,
            w: i32::from(screen.width_in_pixels),
            h: i32::from(screen.height_in_pixels),
        };
        let atoms = Atoms::intern(&conn)?;
        Ok(Self {
            conn,
            root,
            screen,
            atoms,
        })
    }

    /// The focused window's facts, and whether it is fullscreen.
    ///
    /// `Ok(None)` is "nothing this probe may look at" - the desktop, our own
    /// window, or a Wayland surface mutter parks behind a placeholder X window.
    /// `Err` is the connection being broken, which is a different thing, and
    /// only the root-window read can tell us that: a request about the focused
    /// window fails when the window has closed since the last one, which
    /// happens every time somebody quits a game and is not worth a word.
    fn foreground(&self, own_pid: u32) -> Result<Option<(RawWindow, bool)>, String> {
        let Some(window) = self.active_window()? else {
            return Ok(None);
        };
        self.facts_of(window, own_pid).or_else(|e| {
            tracing::debug!("game-overlay: the focused window went away mid-read: {e}");
            Ok(None)
        })
    }

    fn facts_of(&self, window: Window, own_pid: u32) -> Result<Option<(RawWindow, bool)>, String> {
        if !self.is_viewable(window)? {
            return Ok(None);
        }
        // No `_NET_WM_PID` means either a window whose client never set it or,
        // on a Wayland session, the 1x1 placeholder mutter points
        // `_NET_ACTIVE_WINDOW` at while a native surface holds the focus.
        // Either way there is no process to classify.
        let Some(pid) = self.pid_of(window)? else {
            return Ok(None);
        };
        if pid == 0 || pid == own_pid {
            return Ok(None);
        }

        let geometry = self.geometry(window)?;
        let decorated = self.is_decorated(window)?;
        let fullscreen = self.is_fullscreen(window)?;
        Ok(Some((
            RawWindow {
                hwnd: isize::try_from(window).unwrap_or(0),
                pid,
                class: self.class_of(window)?,
                // X11 has no window styles, and the two the classifier asks
                // about are one question here: does this window have chrome?
                // A caption and a resize frame are drawn by the same decision,
                // by the window manager or by the client itself.
                has_caption: decorated,
                has_thickframe: decorated,
                rect: geometry,
                monitor_rect: self.monitor_rect(geometry),
            },
            fullscreen,
        )))
    }

    fn active_window(&self) -> Result<Option<Window>, String> {
        let words = self.property(self.root, self.atoms.active_window)?;
        Ok(words.first().copied().filter(|w| *w != 0))
    }

    fn is_viewable(&self, window: Window) -> Result<bool, String> {
        let attributes = self
            .conn
            .get_window_attributes(window)
            .map_err(|e| e.to_string())?
            .reply();
        // A window that vanished between the root property and this request is
        // a race, not a broken connection: report "nothing to see".
        Ok(attributes.is_ok_and(|a| a.map_state == MapState::VIEWABLE))
    }

    fn pid_of(&self, window: Window) -> Result<Option<u32>, String> {
        Ok(self.property(window, self.atoms.wm_pid)?.first().copied())
    }

    /// `WM_CLASS` is `instance\0class\0`; the class half is the one that names
    /// the toolkit or engine, so it is the analogue of the Win32 class.
    fn class_of(&self, window: Window) -> Result<String, String> {
        let reply = self
            .conn
            .get_property(
                false,
                window,
                AtomEnum::WM_CLASS,
                AtomEnum::STRING,
                0,
                MAX_PROPERTY_WORDS,
            )
            .map_err(|e| e.to_string())?
            .reply();
        let Ok(reply) = reply else {
            return Ok(String::new());
        };
        let text = String::from_utf8_lossy(&reply.value);
        let mut parts = text.split('\0').filter(|p| !p.is_empty());
        let instance = parts.next().unwrap_or_default();
        Ok(parts.next().unwrap_or(instance).to_owned())
    }

    /// The window's rectangle on the virtual desktop, in physical pixels.
    ///
    /// `get_geometry` reports coordinates relative to the parent, and a
    /// managed window's parent is the WM's frame, so the absolute position has
    /// to be asked for separately.
    fn geometry(&self, window: Window) -> Result<Rect, String> {
        let geometry = self
            .conn
            .get_geometry(window)
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?;
        let origin = self
            .conn
            .translate_coordinates(window, self.root, 0, 0)
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?;
        Ok(Rect {
            x: i32::from(origin.dst_x),
            y: i32::from(origin.dst_y),
            w: i32::from(geometry.width),
            h: i32::from(geometry.height),
        })
    }

    /// Does this window have chrome, drawn by anyone?
    ///
    /// `_NET_FRAME_EXTENTS` is the window manager's frame. GTK, Qt and every
    /// other toolkit that decorates itself never gets one, so client-side
    /// decorations are read from `_GTK_FRAME_EXTENTS` - which GTK zeroes the
    /// moment a window goes fullscreen or maximised, which is exactly the
    /// distinction wanted here. A game in play has neither.
    fn is_decorated(&self, window: Window) -> Result<bool, String> {
        for atom in [self.atoms.frame_extents, self.atoms.gtk_frame_extents] {
            if self.property(window, atom)?.iter().any(|edge| *edge > 0) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn is_fullscreen(&self, window: Window) -> Result<bool, String> {
        let states = self.property(window, self.atoms.wm_state)?;
        Ok(states.contains(&self.atoms.fullscreen))
    }

    /// The monitor `window` sits on, from `RandR`'s monitor list.
    ///
    /// Falls back to the whole virtual desktop, which is the right answer on a
    /// single-monitor machine and a harmless one on any other: it only decides
    /// where the overlay's corner is and whether the window is fullscreen-shaped.
    fn monitor_rect(&self, window: Rect) -> Rect {
        let centre = (window.x + window.w / 2, window.y + window.h / 2);
        let Ok(monitors) = self.conn.randr_get_monitors(self.root, true) else {
            return self.screen;
        };
        let Ok(monitors) = monitors.reply() else {
            return self.screen;
        };
        monitors
            .monitors
            .iter()
            .map(|monitor| Rect {
                x: i32::from(monitor.x),
                y: i32::from(monitor.y),
                w: i32::from(monitor.width),
                h: i32::from(monitor.height),
            })
            .find(|rect| {
                centre.0 >= rect.x
                    && centre.0 < rect.x + rect.w
                    && centre.1 >= rect.y
                    && centre.1 < rect.y + rect.h
            })
            .unwrap_or(self.screen)
    }

    /// A 32-bit property of any type, or an empty list when it is not set.
    fn property(&self, window: Window, property: Atom) -> Result<Vec<u32>, String> {
        self.property_typed(window, property, AtomEnum::ANY.into())
    }

    fn property_typed(
        &self,
        window: Window,
        property: Atom,
        kind: Atom,
    ) -> Result<Vec<u32>, String> {
        let reply = self
            .conn
            .get_property(false, window, property, kind, 0, MAX_PROPERTY_WORDS)
            .map_err(|e| e.to_string())?
            .reply();
        // An unset property replies with an empty value; only the connection
        // breaking is an error worth propagating.
        let Ok(reply) = reply else {
            return Ok(Vec::new());
        };
        Ok(reply.value32().map(Iterator::collect).unwrap_or_default())
    }
}

impl Atoms {
    fn intern(conn: &RustConnection) -> Result<Self, String> {
        let atom = |name: &str| -> Result<Atom, String> {
            Ok(conn
                .intern_atom(false, name.as_bytes())
                .map_err(|e| e.to_string())?
                .reply()
                .map_err(|e| e.to_string())?
                .atom)
        };
        Ok(Self {
            active_window: atom("_NET_ACTIVE_WINDOW")?,
            wm_pid: atom("_NET_WM_PID")?,
            wm_state: atom("_NET_WM_STATE")?,
            fullscreen: atom("_NET_WM_STATE_FULLSCREEN")?,
            frame_extents: atom("_NET_FRAME_EXTENTS")?,
            gtk_frame_extents: atom("_GTK_FRAME_EXTENTS")?,
        })
    }
}

/// Turn a pid into the executable path the classifier should judge.
///
/// `/proc/<pid>/exe` is the kernel's own answer and needs no capability beyond
/// owning the process. For a Wine or Proton game it names the loader rather
/// than the game, so [`wine_exe_path`] unwraps that one case - without it every
/// Proton title on the machine would look like the same `wine64-preloader`.
pub(crate) fn exe_path_of(pid: u32) -> Option<String> {
    let link = std::fs::read_link(format!("/proc/{pid}/exe")).ok()?;
    let path = link.to_string_lossy();
    // A running binary whose file was replaced keeps this suffix forever.
    let path = path.strip_suffix(" (deleted)").unwrap_or(&path).to_owned();
    if !is_wine_loader(&path) {
        return Some(path);
    }
    // Fall back to the loader when the command line says nothing useful: a
    // path the index cannot match still beats no assessment at all.
    Some(wine_exe_path(pid).unwrap_or(path))
}

/// Does this path name Wine's loader rather than a program?
///
/// Matched exactly rather than by prefix: a game called `winetasting` is a
/// game, and losing its real path would cost it its store match.
fn is_wine_loader(path: &str) -> bool {
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| {
            matches!(name, "wine" | "wine64")
                || name
                    .strip_suffix("-preloader")
                    .is_some_and(|stem| matches!(stem, "wine" | "wine64"))
        })
}

/// The Windows executable a Wine process is actually running.
///
/// Wine rewrites its own `/proc/<pid>/cmdline` to the Windows command line, so
/// argv[0] is the game - as a DOS path, which its prefix's `dosdevices`
/// symlinks map back onto the filesystem. Under Proton that resolves a game to
/// its `steamapps/common` directory, which is exactly what the index matches on.
fn wine_exe_path(pid: u32) -> Option<String> {
    let cmdline = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    let argv0 = cmdline.split(|byte| *byte == 0).next()?;
    let argv0 = String::from_utf8_lossy(argv0);
    if !argv0.to_ascii_lowercase().ends_with(".exe") {
        return None;
    }
    if argv0.starts_with('/') {
        return Some(argv0.into_owned());
    }
    dos_to_unix(&argv0, pid)
}

/// Map `C:\dir\game.exe` onto the filesystem through the prefix's `dosdevices`.
fn dos_to_unix(dos_path: &str, pid: u32) -> Option<String> {
    let (drive, rest) = dos_path.split_once(":\\")?;
    let letter = drive.chars().next()?.to_ascii_lowercase();
    let prefix = wine_prefix(pid)?;
    let root = std::fs::read_link(format!("{prefix}/dosdevices/{letter}:")).ok()?;
    let mut path = root.to_string_lossy().trim_end_matches('/').to_owned();
    path.push('/');
    path.push_str(&rest.replace('\\', "/"));
    Some(path)
}

/// The `WINEPREFIX` a process was started with.
///
/// Read from the process's own environment because Proton gives every game its
/// own prefix under `compatdata`, so the caller's is never the right one.
fn wine_prefix(pid: u32) -> Option<String> {
    let environ = std::fs::read(format!("/proc/{pid}/environ")).ok()?;
    environ
        .split(|byte| *byte == 0)
        .filter_map(|entry| std::str::from_utf8(entry).ok())
        .find_map(|entry| entry.strip_prefix("WINEPREFIX=").map(str::to_owned))
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|home| format!("{home}/.wine"))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wine_loader_is_recognised_by_name() {
        assert!(is_wine_loader("/usr/bin/wine64-preloader"));
        assert!(is_wine_loader(
            "/home/u/.steam/steamapps/common/Proton 9.0/files/bin/wine"
        ));
        assert!(!is_wine_loader("/usr/games/supertuxkart"));
        // A game that merely starts with the same letters is not the loader.
        assert!(!is_wine_loader("/opt/games/winetasting/winetasting"));
    }

    #[test]
    fn a_dos_path_needs_a_drive_and_a_separator() {
        // No prefix is read for these: they fail before `dosdevices`.
        assert_eq!(dos_to_unix("game.exe", 0), None);
        assert_eq!(dos_to_unix("/already/unix/game.exe", 0), None);
    }

    #[test]
    fn own_process_is_never_the_foreground_window() {
        // Whatever the session is - X11, Wayland or headless CI - the probe
        // must never hand back this test binary as something to overlay.
        let facts = foreground_window(std::process::id());
        assert!(facts.is_none_or(|facts| facts.pid != std::process::id()));
    }
}
