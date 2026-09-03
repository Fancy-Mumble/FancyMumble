//! Facts about the window the user is looking at.
//!
//! Every call here is a read-only query against the window manager or the
//! shell. The only process handle ever opened is
//! `PROCESS_QUERY_LIMITED_INFORMATION`, purely to turn a pid into an
//! executable path - the same handle the client already opens in
//! `fancy-audio-device` to name an audio endpoint. Nothing reads memory,
//! enumerates modules, or hooks anything, because that is the line between an
//! overlay and a cheat.

/// The shell's opinion of what the user is doing, which is also Windows' own
/// answer to "should anything pop up right now".
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShellState {
    /// Nothing special: the desktop is free to show things.
    Normal,
    /// A fullscreen application owns the screen. Windows returns this for
    /// games running under Fullscreen Optimizations, so it is evidence of a
    /// game rather than proof of one.
    Busy,
    /// A true exclusive-mode Direct3D application. No composited window can
    /// be shown over it by any means short of injecting into the game.
    ExclusiveFullscreen,
    /// A presentation is running. Never show anything.
    Presenting,
    /// The query failed or the platform has no equivalent.
    Unknown,
}

/// A rectangle in physical screen pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    /// Left edge, in physical pixels on the virtual desktop.
    pub x: i32,
    /// Top edge, in physical pixels on the virtual desktop.
    pub y: i32,
    /// Width in physical pixels.
    pub w: i32,
    /// Height in physical pixels.
    pub h: i32,
}

impl Rect {
    /// Does this rectangle cover `other` entirely?
    ///
    /// A few pixels of slack, because a borderless window is routinely a
    /// pixel or two off the monitor rect after DPI rounding.
    #[must_use]
    pub fn covers(&self, other: Self) -> bool {
        const SLACK: i32 = 2;
        self.x <= other.x + SLACK
            && self.y <= other.y + SLACK
            && self.x + self.w >= other.x + other.w - SLACK
            && self.y + self.h >= other.y + other.h - SLACK
    }
}

/// Everything the classifier is allowed to know about the foreground window.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundFacts {
    /// Native window handle, as an `isize` so the type is platform-neutral.
    pub hwnd: isize,
    /// Owning process id.
    pub pid: u32,
    /// Full path of the owning executable, lowercased.
    pub exe_path: String,
    /// File name without directory or extension, lowercased (`"eldenring"`).
    pub exe_stem: String,
    /// Win32 window class, verbatim (`"UnityWndClass"`).
    pub class: String,
    /// The window has a title bar - almost never true of a game in play.
    pub has_caption: bool,
    /// The window has a resize frame.
    pub has_thickframe: bool,
    /// Window rectangle in physical pixels.
    pub rect: Rect,
    /// The rectangle of the monitor the window is mostly on.
    pub monitor_rect: Rect,
    /// What the shell thinks is going on.
    pub shell: ShellState,
}

impl ForegroundFacts {
    /// Is the window covering its whole monitor with no chrome?
    ///
    /// This is what a borderless-fullscreen game looks like from the outside,
    /// and also what a fullscreen video looks like - which is why it is
    /// weighted rather than decisive.
    #[must_use]
    pub fn is_fullscreen_shaped(&self) -> bool {
        self.rect.covers(self.monitor_rect) && !self.has_caption && !self.has_thickframe
    }
}

#[cfg(windows)]
pub(crate) use self::windows_impl::{exe_path_of, foreground_window, shell_state};

#[cfg(not(windows))]
pub(crate) use self::stub::{exe_path_of, foreground_window, shell_state};

/// Raw window facts, before the executable path has been resolved.
///
/// Split out because resolving the path is the one step worth caching by pid.
#[derive(Debug, Clone)]
pub(crate) struct RawWindow {
    pub hwnd: isize,
    pub pid: u32,
    pub class: String,
    pub has_caption: bool,
    pub has_thickframe: bool,
    pub rect: Rect,
    pub monitor_rect: Rect,
}

#[cfg(windows)]
mod windows_impl {
    #![allow(
        unsafe_code,
        reason = "Win32 window and shell queries need raw FFI; every unsafe \
                  block carries a SAFETY note and only calls read-only APIs."
    )]

    use super::{RawWindow, Rect, ShellState};
    use windows_sys::Win32::Foundation::{CloseHandle, HWND, MAX_PATH, RECT};
    use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
        QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect,
        GetWindowThreadProcessId, IsWindowVisible, GWL_STYLE, WS_CAPTION, WS_THICKFRAME,
    };

    /// Read the foreground window, or `None` when there is nothing to judge.
    pub(crate) fn foreground_window(own_pid: u32) -> Option<RawWindow> {
        // SAFETY: GetForegroundWindow takes no arguments and returns null when
        // no window is in the foreground.
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_null() {
            return None;
        }
        // SAFETY: IsWindowVisible accepts any HWND and validates it.
        if unsafe { IsWindowVisible(hwnd) } == 0 {
            return None;
        }
        if is_cloaked(hwnd) {
            return None;
        }

        let mut pid: u32 = 0;
        // SAFETY: pid is a writable u32; the OS fills it in.
        let _thread = unsafe { GetWindowThreadProcessId(hwnd, &raw mut pid) };
        if pid == 0 || pid == own_pid {
            return None;
        }

        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        // SAFETY: rect is a writable RECT; failure leaves it untouched and we bail.
        if unsafe { GetWindowRect(hwnd, &raw mut rect) } == 0 {
            return None;
        }

        // SAFETY: GWL_STYLE is a documented index; the call cannot fail
        // meaningfully for a valid HWND.
        let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } as u32;

        Some(RawWindow {
            hwnd: hwnd as isize,
            pid,
            class: class_name(hwnd),
            has_caption: style & WS_CAPTION == WS_CAPTION,
            has_thickframe: style & WS_THICKFRAME == WS_THICKFRAME,
            rect: Rect {
                x: rect.left,
                y: rect.top,
                w: rect.right - rect.left,
                h: rect.bottom - rect.top,
            },
            monitor_rect: monitor_rect(hwnd),
        })
    }

    /// A cloaked window is one DWM is not drawing - a background UWP app, or
    /// a window on another virtual desktop. It is not what the user sees.
    fn is_cloaked(hwnd: HWND) -> bool {
        let mut cloaked: u32 = 0;
        // SAFETY: the out-buffer matches the DWORD size DWMWA_CLOAKED writes.
        let hr = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED as u32,
                (&raw mut cloaked).cast(),
                u32::try_from(size_of::<u32>()).unwrap_or(4),
            )
        };
        hr == 0 && cloaked != 0
    }

    fn class_name(hwnd: HWND) -> String {
        let mut buf = [0u16; 256];
        // SAFETY: buf is a writable u16 array and we pass its true length.
        let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if len <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..len as usize])
    }

    fn monitor_rect(hwnd: HWND) -> Rect {
        // SAFETY: MONITOR_DEFAULTTONEAREST always yields a valid monitor.
        let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
        info.cbSize = u32::try_from(size_of::<MONITORINFO>()).unwrap_or(40);
        // SAFETY: info is a correctly sized, writable MONITORINFO.
        if unsafe { GetMonitorInfoW(monitor, &raw mut info) } == 0 {
            return Rect::default();
        }
        Rect {
            x: info.rcMonitor.left,
            y: info.rcMonitor.top,
            w: info.rcMonitor.right - info.rcMonitor.left,
            h: info.rcMonitor.bottom - info.rcMonitor.top,
        }
    }

    /// Turn a pid into a full executable path.
    ///
    /// `PROCESS_QUERY_LIMITED_INFORMATION` is the weakest access right that
    /// answers this question, and the only one anti-cheat-protected processes
    /// grant. Asking for more is exactly the tell we must not give.
    pub(crate) fn exe_path_of(pid: u32) -> Option<String> {
        // SAFETY: OpenProcess returns null on failure, which we check.
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return None;
        }
        let mut buf = [0u16; MAX_PATH as usize];
        let mut len = u32::try_from(buf.len()).unwrap_or(260);
        // SAFETY: buf is writable and len is its true capacity; the OS writes
        // the used length back into len.
        let ok = unsafe { QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &raw mut len) };
        // SAFETY: handle came from OpenProcess and is not used again.
        let _closed = unsafe { CloseHandle(handle) };
        if ok == 0 || len == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }

    /// Ask the shell whether anything should be popping up right now.
    pub(crate) fn shell_state() -> ShellState {
        let mut state = 0i32;
        // SAFETY: state is a writable i32; the call fills it on success.
        let hr = unsafe { SHQueryUserNotificationState(&raw mut state) };
        if hr != 0 {
            return ShellState::Unknown;
        }
        match state {
            s if s == QUNS_RUNNING_D3D_FULL_SCREEN => ShellState::ExclusiveFullscreen,
            s if s == QUNS_PRESENTATION_MODE => ShellState::Presenting,
            s if s == QUNS_BUSY => ShellState::Busy,
            _ => ShellState::Normal,
        }
    }
}

#[cfg(not(windows))]
mod stub {
    //! macOS and Linux probes are out of scope for the proof of concept (see
    //! the platform matrix in `docs/GAME-OVERLAY-RESEARCH.md`): AppKit and
    //! EWMH have equivalents, and Wayland exposes no foreground window at all.
    //! Until those land the overlay there is hotkey-driven, which is what a
    //! detector that never finds a game produces.

    use super::{RawWindow, ShellState};

    pub(crate) fn foreground_window(_own_pid: u32) -> Option<RawWindow> {
        None
    }

    pub(crate) fn exe_path_of(_pid: u32) -> Option<String> {
        None
    }

    pub(crate) fn shell_state() -> ShellState {
        ShellState::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn covers_allows_two_pixels_of_dpi_slack() {
        let monitor = Rect {
            x: 0,
            y: 0,
            w: 2560,
            h: 1440,
        };
        let borderless = Rect {
            x: 1,
            y: 1,
            w: 2558,
            h: 1438,
        };
        assert!(borderless.covers(monitor));
    }

    #[test]
    fn covers_rejects_a_merely_large_window() {
        let monitor = Rect {
            x: 0,
            y: 0,
            w: 2560,
            h: 1440,
        };
        let maximised_ish = Rect {
            x: 0,
            y: 0,
            w: 2560,
            h: 1360,
        };
        assert!(!maximised_ish.covers(monitor));
    }
}
