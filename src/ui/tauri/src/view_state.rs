//! State that belongs to this application's windows, not to the engine.
//!
//! Pop-out windows, the drawing overlay and the in-game overlay are things the
//! Tauri view does: another view would draw them differently, or not at all.
//! Their bookkeeping lives here, registered with Tauri next to the engine's
//! `AppState`, so the engine carries nothing a second view would not use.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::commands::draw_overlay::DrawOverlayContext;
use crate::commands::game_overlay::GameOverlayState;
use crate::commands::popout::{PopoutDmPayload, PopoutImagePayload, PopoutStreamPayload};

/// Window bookkeeping shared by the commands that open, feed and close this
/// view's extra windows.
#[derive(Default)]
pub(crate) struct ViewState {
    /// Image sources pending pickup by freshly-opened image popout windows.
    /// Keyed by random id; each entry is consumed once by `take_popout_image`.
    pub(crate) popout_images: Mutex<HashMap<String, PopoutImagePayload>>,
    /// Stream-share contexts pending pickup by freshly-opened stream popout windows.
    /// Keyed by random id; each entry is consumed once by `take_popout_stream`.
    pub(crate) popout_streams: Mutex<HashMap<String, PopoutStreamPayload>>,
    /// DM popout payloads pending pickup by freshly-opened DM popout windows.
    /// Keyed by random id; each entry is consumed once by `take_popout_dm`.
    pub(crate) popout_dms: Mutex<HashMap<String, PopoutDmPayload>>,
    /// Live stream-popout windows, keyed by window label
    /// (`popout-stream-<id>`).  Value is the broadcaster session, used to
    /// emit `stream-popout-state opened:false` when the OS destroys the
    /// window (any close path - Alt+F4, X button, context menu, app exit).
    #[cfg(not(target_os = "android"))]
    pub(crate) popout_stream_sessions: Mutex<HashMap<String, u32>>,
    /// Channel/session context for the (single) drawing-overlay window.
    /// Read by the overlay via `take_drawing_overlay_context` once it
    /// has spawned. `None` while no overlay is open.
    pub(crate) draw_overlay_context: Mutex<Option<DrawOverlayContext>>,
    /// Background task that follows the shared window's screen rect
    /// (Windows only) and repositions the desktop overlay accordingly.
    /// Aborted when the overlay closes.
    #[cfg(not(target_os = "android"))]
    pub(crate) draw_overlay_tracker: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// Game-overlay configuration, detector task and last verdict. Inert
    /// until the user turns the overlay on.
    pub(crate) game_overlay: GameOverlayState,
}
