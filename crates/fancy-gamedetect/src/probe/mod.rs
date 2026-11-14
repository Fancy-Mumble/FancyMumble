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

/// What the platform's foreground probe could see on its last reading.
///
/// A detector that finds nothing looks identical to a machine with no games
/// on it, which is how "the overlay does not work on Linux" was invisible for
/// as long as it was. This is the difference, in one word, and the settings
/// panel says it out loud.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProbeNote {
    /// The foreground window was read normally. "The desktop is focused" is a
    /// reading, not a failure, and reports this too.
    #[default]
    Ok,
    /// This platform has no foreground probe at all, so only the hotkey can
    /// ever put the overlay on screen.
    Unsupported,
    /// There is no window system to ask. On a Wayland session that means even
    /// `XWayland` could not be reached.
    NoDisplay,
    /// Something is focused, but it is a native Wayland surface: no client may
    /// learn which one it is or which process owns it.
    WaylandSurface,
    /// The window system answered with an error; the log carries the detail.
    Failed,
}

#[cfg(windows)]
#[path = "windows.rs"]
mod platform;

#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod platform;

#[cfg(not(any(windows, target_os = "linux")))]
#[path = "stub.rs"]
mod platform;

pub(crate) use self::platform::{exe_path_of, foreground_window, note, shell_state};

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
