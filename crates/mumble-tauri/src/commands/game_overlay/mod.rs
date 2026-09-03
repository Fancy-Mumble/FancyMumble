//! The game overlay: a small always-on-top card showing who is talking and
//! the last message, over a game.
//!
//! The technique is deliberately the boring one - a separate, transparent,
//! click-through window that DWM composites over the game - because it is the
//! only one that satisfies "must not get the user banned". Nothing is injected
//! into any game, no game's memory is read, and no hook of any kind is
//! installed. See `docs/GAME-OVERLAY-RESEARCH.md` in the e2e repository for
//! why every other approach was rejected, and `window.rs` for the flags that
//! make this one safe.
//!
//! Three parts:
//! - [`window`] owns the window itself.
//! - [`watcher`] runs the detector and decides when the window is on screen.
//! - this file holds the configuration the frontend pushes down and the
//!   commands it calls.

#[cfg(not(target_os = "android"))]
mod watcher;
#[cfg(not(target_os = "android"))]
mod window;

use std::collections::HashMap;
use std::sync::Mutex;

use fancy_gamedetect::{Reason, Rule, Rules, ShellState, Verdict};
use serde::{Deserialize, Serialize};

use crate::state::types::OverlaySnapshot;
use crate::state::AppState;

#[cfg(not(target_os = "android"))]
pub(crate) use window::GAME_OVERLAY_LABEL;

/// Emitted whenever the detector's conclusion or the overlay's visibility
/// changes. Drives the settings page's diagnostics panel.
pub(crate) const STATE_EVENT: &str = "game-overlay-state";

/// Emitted once per executable that looks like a game but did not clear the
/// automatic bar, so the client can ask the user about it exactly once.
pub(crate) const ASK_EVENT: &str = "game-overlay-ask";

/// Starting size of the widget, in logical pixels. The page measures itself
/// and calls `game_overlay_resize` with the real height.
pub(crate) const DEFAULT_WIDTH: f64 = 320.0;
/// Starting height, replaced as soon as the page has rendered.
pub(crate) const DEFAULT_HEIGHT: f64 = 132.0;

/// When the overlay is allowed on screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OverlayMode {
    /// Never. No window is created at all.
    #[default]
    Off,
    /// While someone is talking or a message is fresh. The default, because a
    /// window that is not composited cannot cost the game its independent
    /// flip path or its variable refresh rate.
    WhileActive,
    /// Whenever a game is in the foreground.
    Always,
}

/// Which corner of the game's monitor the widget sits in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OverlayCorner {
    /// Top left.
    TopLeft,
    /// Top right - the default, where most overlays put themselves.
    #[default]
    TopRight,
    /// Bottom left.
    BottomLeft,
    /// Bottom right.
    BottomRight,
}

/// Everything the frontend gets to decide about the overlay.
#[derive(Debug, Clone)]
pub(crate) struct GameOverlayConfig {
    pub mode: OverlayMode,
    pub corner: OverlayCorner,
    /// Keep the overlay out of screen captures and streams.
    pub hide_from_capture: bool,
    /// Size the page has measured itself at, in logical pixels.
    pub logical_size: (f64, f64),
    /// Per-executable user decisions, keyed by lowercased full path.
    pub rules: Rules,
}

impl Default for GameOverlayConfig {
    fn default() -> Self {
        Self {
            mode: OverlayMode::Off,
            corner: OverlayCorner::default(),
            hide_from_capture: true,
            logical_size: (DEFAULT_WIDTH, DEFAULT_HEIGHT),
            rules: Rules::new(),
        }
    }
}

/// Everything the overlay keeps in [`AppState`].
#[derive(Debug, Default)]
pub(crate) struct GameOverlayState {
    config: Mutex<GameOverlayConfig>,
    /// The detector task, started when the mode first leaves `Off`.
    #[cfg(not(target_os = "android"))]
    watcher: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    /// A hotkey press waiting to be picked up by the next poll tick.
    manual_toggle: Mutex<Option<bool>>,
    /// Set once the overlay page has mounted, which is the only proof that the
    /// webview initialised. Hiding the window before that is what leaves a
    /// transparent `WebView2` window permanently blank.
    page_ready: std::sync::atomic::AtomicBool,
    /// The page's own account of what it last drew.
    page_status: Mutex<Option<PageStatus>>,
    /// The last thing emitted, so a settings page opened mid-session can ask
    /// for the current state instead of waiting for it to change.
    last_event: Mutex<Option<GameOverlayEvent>>,
}

/// Why the overlay is not on screen.
///
/// A policy that decides on its own when a window appears has to be able to
/// say what it decided and why; without this the only way to tell "waiting for
/// someone to speak" from "the window never opened" is to read the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum HiddenReason {
    /// It is on screen.
    Visible,
    /// The overlay is switched off entirely.
    ModeOff,
    /// The webview has not painted yet, so it is left alone.
    PageNotReady,
    /// Nothing in the foreground that the overlay may cover.
    NoGame,
    /// A game, but in exclusive fullscreen - nothing can be drawn over it.
    ExclusiveFullscreen,
    /// A game, but nobody has spoken and no message is fresh.
    WaitingForActivity,
    /// The toggle shortcut was used to hide it.
    ManuallyHidden,
}

/// What the overlay page says it is drawing.
///
/// A visible window that paints nothing is indistinguishable from a missing
/// one, so the page reports what it decided and the panel says it out loud.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageStatus {
    /// The page has a snapshot and a server is connected.
    pub connected: bool,
    /// How many people it drew.
    pub occupants: u32,
    /// It is drawing a message under them.
    pub has_message: bool,
    /// It failed to read its snapshot.
    pub failed: bool,
}

/// Where the overlay window actually sits, in physical pixels.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WindowRect {
    /// Left edge on the virtual desktop.
    pub x: i32,
    /// Top edge on the virtual desktop.
    pub y: i32,
    /// Width in physical pixels.
    pub w: u32,
    /// Height in physical pixels.
    pub h: u32,
}

/// The payload of [`STATE_EVENT`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameOverlayEvent {
    /// Whether the overlay window is on screen right now, as the window
    /// itself reports it - not what the policy asked for.
    pub visible: bool,
    /// Whether the overlay window exists at all.
    pub window_created: bool,
    /// Why the window could not be created, when that is what happened.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_error: Option<String>,
    /// Why it is not on screen.
    pub hidden_reason: HiddenReason,
    /// The mode currently in force, so the panel can say what the rule is.
    pub mode: OverlayMode,
    /// What the page reports it is drawing, once it has said.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_status: Option<PageStatus>,
    /// Where the window actually is, so "on screen" can be checked against a
    /// monitor rather than taken on trust.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placement: Option<WindowRect>,
    /// What the detector concluded, or `None` when there is no foreground
    /// window worth judging.
    pub verdict: Option<Verdict>,
    /// Total evidence weight.
    pub score: i32,
    /// Foreground executable, lowercased.
    pub exe_path: Option<String>,
    /// Its file name without directory or extension.
    pub exe_stem: Option<String>,
    /// Its Win32 window class.
    pub window_class: Option<String>,
    /// The game's name, when a store's records knew it.
    pub title: Option<String>,
    /// What the shell reported.
    pub shell: Option<ShellState>,
    /// Every piece of evidence, for the diagnostics panel.
    pub reasons: Vec<Reason>,
}

/// The payload of [`ASK_EVENT`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameOverlayAsk {
    /// The executable being asked about.
    pub exe_path: String,
    /// Its best available name.
    pub name: String,
    /// What it scored, shown so the answer is an informed one.
    pub score: i32,
}

/// What `game_overlay_configure` accepts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GameOverlaySettings {
    /// When the overlay may appear.
    pub mode: OverlayMode,
    /// Which corner it sits in.
    pub corner: OverlayCorner,
    /// Keep it out of captures.
    pub hide_from_capture: bool,
    /// Per-executable decisions.
    #[serde(default)]
    pub rules: HashMap<String, Rule>,
}

fn config_of(state: &AppState) -> GameOverlayConfig {
    state
        .game_overlay
        .config
        .lock()
        .map(|c| c.clone())
        .unwrap_or_default()
}

fn take_manual_toggle(state: &AppState) -> Option<bool> {
    state
        .game_overlay
        .manual_toggle
        .lock()
        .ok()
        .and_then(|mut slot| slot.take())
}

/// Push the user's overlay settings down and start or stop the detector.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub(crate) fn game_overlay_configure(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    settings: GameOverlaySettings,
) -> Result<(), String> {
    {
        let mut config = state
            .game_overlay
            .config
            .lock()
            .map_err(|_| "overlay config lock poisoned".to_string())?;
        config.mode = settings.mode;
        config.corner = settings.corner;
        config.hide_from_capture = settings.hide_from_capture;
        config.rules = settings
            .rules
            .into_iter()
            .map(|(path, rule)| (path.to_ascii_lowercase(), rule))
            .collect();
    }

    if settings.mode == OverlayMode::Off {
        // The watcher tears the window down on its next tick; stopping it here
        // would leave the window behind.
        return Ok(());
    }
    ensure_watcher(&app, &state);
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) fn game_overlay_configure(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, AppState>,
    _settings: GameOverlaySettings,
) -> Result<(), String> {
    Err("The game overlay is a desktop feature".to_string())
}

/// Start the detector task if it is not already running.
#[cfg(not(target_os = "android"))]
fn ensure_watcher(app: &tauri::AppHandle, state: &AppState) {
    let Ok(mut slot) = state.game_overlay.watcher.lock() else {
        return;
    };
    if slot.is_some() {
        return;
    }
    let app = app.clone();
    *slot = Some(tauri::async_runtime::spawn(watcher::run(app)));
}

/// Show or hide the overlay for the current game, until the foreground app
/// changes. This is what the toggle hotkey calls.
#[tauri::command]
pub(crate) fn game_overlay_toggle(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let currently_visible = state
        .game_overlay
        .last_event
        .lock()
        .ok()
        .and_then(|e| e.as_ref().map(|e| e.visible))
        .unwrap_or(false);
    let next = !currently_visible;
    if let Ok(mut slot) = state.game_overlay.manual_toggle.lock() {
        *slot = Some(next);
    }
    Ok(next)
}

/// Record what the user decided about one executable.
///
/// `rule` of `None` forgets the decision, so a mis-click can be undone.
#[tauri::command]
pub(crate) fn game_overlay_set_rule(
    state: tauri::State<'_, AppState>,
    exe_path: String,
    rule: Option<Rule>,
) -> Result<(), String> {
    let mut config = state
        .game_overlay
        .config
        .lock()
        .map_err(|_| "overlay config lock poisoned".to_string())?;
    let key = exe_path.to_ascii_lowercase();
    match rule {
        Some(rule) => {
            let _previous = config.rules.insert(key, rule);
        }
        None => {
            let _removed = config.rules.remove(&key);
        }
    }
    Ok(())
}

/// Everything the overlay window draws. Called once when it opens.
#[tauri::command]
pub(crate) fn game_overlay_snapshot(state: tauri::State<'_, AppState>) -> OverlaySnapshot {
    state.overlay_snapshot()
}

/// The overlay page reporting that it has mounted and painted.
///
/// Until this arrives the window is left alone: a transparent `WebView2` window
/// that is hidden before it has rendered comes back blank when shown again.
#[tauri::command]
pub(crate) fn game_overlay_ready(state: tauri::State<'_, AppState>) {
    state
        .game_overlay
        .page_ready
        .store(true, std::sync::atomic::Ordering::Relaxed);
}

/// Has the overlay page mounted at least once this window's lifetime?
#[cfg(not(target_os = "android"))]
fn page_ready(state: &AppState) -> bool {
    state
        .game_overlay
        .page_ready
        .load(std::sync::atomic::Ordering::Relaxed)
}

/// Forget that the page was ready, when the window it belonged to is gone.
#[cfg(not(target_os = "android"))]
fn clear_page_ready(state: &AppState) {
    state
        .game_overlay
        .page_ready
        .store(false, std::sync::atomic::Ordering::Relaxed);
}

/// The page reporting what it drew, so a blank overlay can say why it is blank.
#[tauri::command]
pub(crate) fn game_overlay_page_status(state: tauri::State<'_, AppState>, status: PageStatus) {
    if let Ok(mut slot) = state.game_overlay.page_status.lock() {
        *slot = Some(status);
    }
}

/// The page's last account of itself.
#[cfg(not(target_os = "android"))]
fn page_status(state: &AppState) -> Option<PageStatus> {
    state.game_overlay.page_status.lock().ok().and_then(|s| *s)
}

/// The page reporting how big it actually is, so the window can be sized onto
/// the card rather than leaving transparent slack over the game.
#[tauri::command]
pub(crate) fn game_overlay_resize(
    state: tauri::State<'_, AppState>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let mut config = state
        .game_overlay
        .config
        .lock()
        .map_err(|_| "overlay config lock poisoned".to_string())?;
    config.logical_size = (width.max(1.0), height.max(1.0));
    Ok(())
}

/// The detector's current conclusion, for a diagnostics panel that has just
/// opened and has not seen an event yet.
#[tauri::command]
pub(crate) fn game_overlay_diagnostics(
    state: tauri::State<'_, AppState>,
) -> Option<GameOverlayEvent> {
    state
        .game_overlay
        .last_event
        .lock()
        .ok()
        .and_then(|e| e.clone())
}

/// Remember the last event so `game_overlay_diagnostics` can answer.
#[cfg(not(target_os = "android"))]
fn remember_event(state: &AppState, event: &GameOverlayEvent) {
    if let Ok(mut slot) = state.game_overlay.last_event.lock() {
        *slot = Some(event.clone());
    }
}
