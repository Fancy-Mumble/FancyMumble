//! Following the shared source: keep the overlay pinned over a window that
//! the user drags, resizes, minimizes or closes while sharing it.
//!
//! Monitors do not move, so only window shares need this. The per-platform
//! part is just "where is that window now" ([`SourceFollower`]); the policy
//! that turns an answer into an overlay move is [`decide`], shared and
//! testable, and the loop that applies it polls at [`POLL_INTERVAL`].
//!
//! Polling rather than events on purpose: on Windows it is cheaper than
//! installing `WinEvent` hooks, and on X11 each query is a single
//! `GetGeometry` + `TranslateCoordinates` round trip.

use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::time::sleep;

use super::DRAW_OVERLAY_LABEL;

/// How often the source's position is checked. Fast enough that dragging a
/// shared window does not visibly detach the overlay, slow enough to be free.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Physical-pixel rectangle of the shared source on the virtual desktop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// Where the followed source is right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SourceState {
    /// On screen at this rect.
    At(Rect),
    /// Still exists but is not on screen (minimized). The share itself is
    /// unaffected - the compositor keeps streaming the last content - so the
    /// overlay waits for the window to come back instead of tearing down.
    Hidden,
    /// Destroyed. Nothing left to pin an overlay over.
    Gone,
}

/// What the loop should do about a [`SourceState`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Action {
    /// Leave the overlay exactly as it is.
    Idle,
    /// Move/resize the overlay to this rect (showing it if it was hidden).
    Place(Rect),
    /// Take the overlay off screen until the source comes back.
    Hide,
    /// Close the overlay for good.
    Close,
}

/// The tracking policy, as a pure function of what was observed.
///
/// `last` is the rect the overlay was last placed at and `overlay_hidden`
/// whether it is currently off screen; both are needed because an unchanged
/// rect still has to be re-applied after a restore.
pub(super) fn decide(state: SourceState, last: Option<Rect>, overlay_hidden: bool) -> Action {
    match state {
        SourceState::Gone => Action::Close,
        SourceState::Hidden if overlay_hidden => Action::Idle,
        SourceState::Hidden => Action::Hide,
        SourceState::At(rect) if overlay_hidden || last != Some(rect) => Action::Place(rect),
        SourceState::At(_) => Action::Idle,
    }
}

/// A handle on the shared window, per platform.
#[derive(Debug)]
pub(super) enum SourceFollower {
    /// Windows: the `HWND` of the shared top-level window.
    #[cfg(target_os = "windows")]
    Hwnd(isize),
    /// Linux/X11: the shared window resolved through the capture crate.
    /// Native Wayland windows cannot be followed at all - nothing reports
    /// where they are (xdg-desktop-portal#571) - so this is `XWayland` and
    /// plain X11 only.
    #[cfg(target_os = "linux")]
    X11(fancy_screenshare::sources::SharedWindow),
}

impl SourceFollower {
    /// Look up where the source is now.
    fn state(&self) -> SourceState {
        match self {
            #[cfg(target_os = "windows")]
            Self::Hwnd(hwnd) => {
                if !super::win_tracker::is_window(*hwnd) {
                    return SourceState::Gone;
                }
                // A minimized window still exists, but its client rect
                // degenerates - which is how it is told apart here.
                match super::win_tracker::screen_rect_of(*hwnd) {
                    Some(rect) => SourceState::At(Rect {
                        x: rect.x,
                        y: rect.y,
                        w: rect.w.max(1) as u32,
                        h: rect.h.max(1) as u32,
                    }),
                    None => SourceState::Hidden,
                }
            }
            #[cfg(target_os = "linux")]
            Self::X11(window) => {
                if window.is_minimized() {
                    return SourceState::Hidden;
                }
                match window.rect() {
                    Some((x, y, w, h)) => SourceState::At(Rect { x, y, w, h }),
                    None => SourceState::Gone,
                }
            }
        }
    }
}

/// Poll `follower` and keep the overlay window pinned over it.
///
/// The task ends when the overlay is closed (externally or by us) - it holds
/// no lock and touches nothing else, so aborting it at any point is safe.
pub(super) fn spawn(app: AppHandle, follower: SourceFollower) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut last: Option<Rect> = None;
        let mut hidden = false;
        loop {
            sleep(POLL_INTERVAL).await;
            let Some(window) = app.get_webview_window(DRAW_OVERLAY_LABEL) else {
                return;
            };
            match decide(follower.state(), last, hidden) {
                Action::Idle => {}
                Action::Place(rect) => {
                    let _ = window.set_position(tauri::PhysicalPosition::new(rect.x, rect.y));
                    let _ = window.set_size(tauri::PhysicalSize::new(rect.w, rect.h));
                    if hidden {
                        let _ = window.show();
                        hidden = false;
                    }
                    last = Some(rect);
                }
                Action::Hide => {
                    let _ = window.hide();
                    hidden = true;
                }
                Action::Close => {
                    let _ = window.close();
                    return;
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RECT: Rect = Rect {
        x: 10,
        y: 20,
        w: 800,
        h: 600,
    };
    const MOVED: Rect = Rect { x: 40, ..RECT };

    #[test]
    fn a_still_window_is_left_alone() {
        assert_eq!(
            decide(SourceState::At(RECT), Some(RECT), false),
            Action::Idle
        );
    }

    #[test]
    fn a_moved_window_is_followed() {
        assert_eq!(
            decide(SourceState::At(MOVED), Some(RECT), false),
            Action::Place(MOVED)
        );
    }

    #[test]
    fn the_first_observation_places_the_overlay() {
        assert_eq!(
            decide(SourceState::At(RECT), None, false),
            Action::Place(RECT)
        );
    }

    #[test]
    fn minimizing_hides_the_overlay_once_and_then_rests() {
        assert_eq!(decide(SourceState::Hidden, Some(RECT), false), Action::Hide);
        assert_eq!(decide(SourceState::Hidden, Some(RECT), true), Action::Idle);
    }

    #[test]
    fn restoring_re_places_the_overlay_even_at_the_same_rect() {
        // The rect is unchanged, so only `overlay_hidden` can distinguish
        // "nothing happened" from "it is back and must be shown again".
        assert_eq!(
            decide(SourceState::At(RECT), Some(RECT), true),
            Action::Place(RECT)
        );
    }

    #[test]
    fn closing_the_source_closes_the_overlay() {
        assert_eq!(decide(SourceState::Gone, Some(RECT), false), Action::Close);
        assert_eq!(decide(SourceState::Gone, None, true), Action::Close);
    }
}
