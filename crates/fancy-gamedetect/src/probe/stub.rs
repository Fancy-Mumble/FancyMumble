//! The platforms with no foreground probe yet.
//!
//! macOS has the pieces - `NSWorkspace.frontmostApplication` and
//! `CGWindowListCopyWindowInfo` - but they need an `objc2` hop this crate does
//! not have yet (see the platform matrix in `docs/GAME-OVERLAY-RESEARCH.md`).
//! Until it lands the overlay there is hotkey-driven, which is what a detector
//! that never finds a game produces - and [`note`] says so out loud rather
//! than letting the settings panel imply the machine simply has no games on it.

use super::{ProbeNote, RawWindow, ShellState};

pub(crate) fn foreground_window(_own_pid: u32) -> Option<RawWindow> {
    None
}

pub(crate) fn exe_path_of(_pid: u32) -> Option<String> {
    None
}

pub(crate) fn shell_state() -> ShellState {
    ShellState::Unknown
}

pub(crate) fn note() -> ProbeNote {
    ProbeNote::Unsupported
}
