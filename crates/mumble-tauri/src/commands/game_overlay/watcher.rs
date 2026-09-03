//! The poll loop that decides whether the overlay is on screen.
//!
//! One Tokio task, one probe every [`POLL_INTERVAL`]. It owns the detector
//! (which is not `Sync`, and has no business being shared) and the visibility
//! bookkeeping, and it is the only thing that creates, shows, hides or
//! destroys the window.
//!
//! The policy it implements, in order:
//!
//! 1. Mode `Off` - no window at all.
//! 2. A manual toggle (the hotkey) wins until the foreground app changes.
//! 3. Otherwise the verdict decides eligibility, and in `WhileActive` mode
//!    voice or chat activity decides visibility within that.

use std::collections::HashSet;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use fancy_gamedetect::{Detector, Verdict};
use tauri::{AppHandle, Emitter, Manager};

use super::{window, GameOverlayEvent, HiddenReason, OverlayMode, WindowRect};
use crate::state::AppState;

/// How often the foreground window is probed. Fast enough that the overlay
/// appears within a couple of hundred milliseconds of someone speaking, slow
/// enough to be invisible in a profile.
const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// How long the overlay stays up after the last talking or message activity.
const LINGER: Duration = Duration::from_secs(4);

/// The shortest time the overlay is ever on screen, so a one-word "yep" does
/// not produce a flash.
const MINIMUM_SHOWN: Duration = Duration::from_secs(2);

/// How long the window survives with no game in the foreground before it is
/// destroyed and its webview process handed back.
const IDLE_TEARDOWN: Duration = Duration::from_secs(180);

/// Bookkeeping the loop carries between ticks.
#[derive(Debug, Default)]
struct Loop {
    shown: bool,
    shown_since: Option<Instant>,
    last_activity: Option<Instant>,
    no_game_since: Option<Instant>,
    /// Set by the hotkey; cleared when the foreground executable changes, so
    /// "show it now" means this game rather than every game from now on.
    manual: Option<bool>,
    manual_for: Option<String>,
    /// Executables the user has already been asked about, so the prompt is
    /// offered once and never again.
    asked: HashSet<String>,
    /// Last state payload sent to the frontend, to avoid re-emitting an
    /// unchanged verdict twenty times a minute.
    last_emitted: Option<String>,
    /// The most recent window-creation failure, so the diagnostics panel can
    /// say why nothing appeared instead of claiming everything is fine.
    window_error: Option<String>,
    /// Whether the last pass stopped at the "the page has not painted" gate.
    blocked_on_page: bool,
}

/// Run the detector loop until the app shuts down.
pub(super) async fn run(app: AppHandle) {
    // Building the index walks launcher manifests and the registry, so it does
    // not belong on a runtime worker.
    let Ok(mut detector) = tauri::async_runtime::spawn_blocking(Detector::new).await else {
        tracing::warn!("game-overlay: detector could not be built; watcher not started");
        return;
    };
    tracing::info!(
        games = detector.indexed_games(),
        "game-overlay: detector ready"
    );

    let own_pid = std::process::id();
    let mut state = Loop::default();

    loop {
        tokio::time::sleep(POLL_INTERVAL).await;
        if tick(&app, &mut detector, &mut state, own_pid)
            .await
            .is_none()
        {
            // The app is going away.
            return;
        }
    }
}

/// One pass of the policy. `None` means the app state has gone.
async fn tick(app: &AppHandle, detector: &mut Detector, lp: &mut Loop, own_pid: u32) -> Option<()> {
    let app_state = app.try_state::<AppState>()?;
    let config = super::config_of(&app_state);

    if config.mode == OverlayMode::Off {
        if app.get_webview_window(window::GAME_OVERLAY_LABEL).is_some() {
            window::close(app);
            super::clear_page_ready(&app_state);
            lp.shown = false;
        }
        emit_state(
            app,
            &app_state,
            lp,
            None,
            HiddenReason::ModeOff,
            config.mode,
        );
        return Some(());
    }

    detector.set_presence_pids(app_state.presence.playing_pids().await);
    let assessment = detector.assess(own_pid, &config.rules);

    // A foreground change retires the manual override.
    let foreground_exe = assessment.as_ref().map(|a| a.exe_path.clone());
    if lp.manual_for != foreground_exe {
        lp.manual = None;
        lp.manual_for.clone_from(&foreground_exe);
    }
    if let Some(pending) = super::take_manual_toggle(&app_state) {
        lp.manual = Some(pending);
    }

    let eligible = match (&assessment, lp.manual) {
        (_, Some(manual)) => manual,
        (Some(a), None) => {
            a.verdict.is_eligible()
                || config.mode == OverlayMode::Always && a.verdict == Verdict::Probably
        }
        (None, None) => false,
    };

    // Ask once about anything that looks like a game but did not clear the bar.
    if let Some(a) = &assessment {
        if a.verdict == Verdict::Probably && !lp.asked.contains(&a.exe_path) {
            let _inserted = lp.asked.insert(a.exe_path.clone());
            let _ = app.emit(
                super::ASK_EVENT,
                super::GameOverlayAsk {
                    exe_path: a.exe_path.clone(),
                    name: a.title.clone().unwrap_or_else(|| a.exe_stem.clone()),
                    score: a.score,
                },
            );
        }
    }

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
    if app_state.overlay_has_activity(now_ms) {
        lp.last_activity = Some(Instant::now());
    }

    // A hotkey press is an instruction, not a hint: it shows the overlay even
    // in a silent channel, which is most of why someone reaches for it.
    let (want_visible, reason) = match lp.manual {
        Some(true) => (true, HiddenReason::Visible),
        Some(false) => (false, HiddenReason::ManuallyHidden),
        None if !eligible => (
            false,
            match assessment.as_ref().map(|a| a.verdict) {
                Some(Verdict::CannotShow) => HiddenReason::ExclusiveFullscreen,
                _ => HiddenReason::NoGame,
            },
        ),
        None if wants_showing(lp, config.mode) => (true, HiddenReason::Visible),
        None => (false, HiddenReason::WaitingForActivity),
    };

    apply(app, &app_state, lp, &assessment, &config, want_visible);
    let reason = if lp.blocked_on_page {
        HiddenReason::PageNotReady
    } else {
        reason
    };
    emit_state(
        app,
        &app_state,
        lp,
        assessment.as_ref(),
        reason,
        config.mode,
    );
    Some(())
}

/// Does the activity policy want the overlay on screen right now?
fn wants_showing(lp: &Loop, mode: OverlayMode) -> bool {
    if mode == OverlayMode::Always {
        return true;
    }
    let fresh = lp.last_activity.is_some_and(|at| at.elapsed() < LINGER);
    if fresh {
        return true;
    }
    // Keep it up for the minimum dwell even once the activity has passed.
    lp.shown
        && lp
            .shown_since
            .is_some_and(|at| at.elapsed() < MINIMUM_SHOWN)
}

/// Create, place, show, hide or destroy the window to match the decision.
fn apply(
    app: &AppHandle,
    app_state: &AppState,
    lp: &mut Loop,
    assessment: &Option<fancy_gamedetect::Assessment>,
    config: &super::GameOverlayConfig,
    want_visible: bool,
) {
    let has_game =
        assessment.as_ref().is_some_and(|a| a.verdict.is_eligible()) || lp.manual == Some(true);

    // Hiding a webview that has never rendered stops it rendering, so it can
    // never report that it is ready, so it is never shown again: a window that
    // is hidden before its first paint is hidden for good. Every hide below is
    // therefore gated on this, and only on this.
    let ready = super::page_ready(app_state);
    lp.blocked_on_page = !ready;

    if !has_game && lp.manual != Some(true) {
        // Nothing to sit over. Hide it, and give the webview process back if it
        // stays that way.
        if lp.shown && ready {
            if let Some(win) = app.get_webview_window(window::GAME_OVERLAY_LABEL) {
                window::hide(&win);
            }
            lp.shown = false;
        }
        let since = *lp.no_game_since.get_or_insert_with(Instant::now);
        if since.elapsed() > IDLE_TEARDOWN
            && app.get_webview_window(window::GAME_OVERLAY_LABEL).is_some()
        {
            window::close(app);
            super::clear_page_ready(app_state);
            lp.no_game_since = None;
        }
        return;
    }
    lp.no_game_since = None;

    let win = match window::ensure(app, config.hide_from_capture) {
        Ok(win) => {
            lp.window_error = None;
            win
        }
        Err(e) => {
            // Once, not every tick: a failure here repeats at 2 Hz forever.
            if lp.window_error.as_deref() != Some(e.as_str()) {
                tracing::error!("game-overlay: window could not be created: {e}");
            }
            lp.window_error = Some(e);
            return;
        }
    };

    // Where it should be, checked against where it actually is. The previous
    // version placed it once, on the tick that created it - which is the one
    // moment a freshly-built window is least likely to accept a move - and a
    // "have we placed it yet" flag then suppressed every retry. Comparing
    // against the window each tick is self-correcting and costs two queries.
    //
    // With no assessment - the hotkey opened it over something the detector
    // does not call a game - it still has to land somewhere, so fall back to
    // the monitor it is already on.
    if let Some(monitor) = assessment
        .as_ref()
        .map(|a| a.monitor_rect)
        .or_else(|| current_monitor_rect(&win))
    {
        window::place(&win, config.corner, monitor, config.logical_size);
    }

    // The window is born visible so the webview initialises; until the page
    // says it has painted, leave it alone. It shows nothing in the meantime -
    // the page renders an empty tree when there is nothing to report - so a
    // window that is technically visible is still invisible.
    // Ask the window what it is rather than trusting our own record of it: a
    // desync here is invisible and strands the overlay in the wrong state.
    lp.shown = win.is_visible().unwrap_or(lp.shown);

    if want_visible && !lp.shown {
        window::show(&win);
        lp.shown = true;
        lp.shown_since = Some(Instant::now());
    } else if !want_visible && lp.shown && ready {
        window::hide(&win);
        lp.shown = false;
    }
}

/// Where the overlay window actually is, straight from the window manager.
fn placement_of(app: &AppHandle) -> Option<WindowRect> {
    let win = app.get_webview_window(window::GAME_OVERLAY_LABEL)?;
    let position = win.outer_position().ok()?;
    let size = win.outer_size().ok()?;
    Some(WindowRect {
        x: position.x,
        y: position.y,
        w: size.width,
        h: size.height,
    })
}

/// The rect of whichever monitor the overlay window currently sits on.
fn current_monitor_rect(win: &tauri::WebviewWindow) -> Option<fancy_gamedetect::Rect> {
    let monitor = win.current_monitor().ok().flatten()?;
    let (position, size) = (monitor.position(), monitor.size());
    Some(fancy_gamedetect::Rect {
        x: position.x,
        y: position.y,
        w: i32::try_from(size.width).unwrap_or(i32::MAX),
        h: i32::try_from(size.height).unwrap_or(i32::MAX),
    })
}

/// Tell the frontend what the detector concluded, when it has changed.
fn emit_state(
    app: &AppHandle,
    app_state: &AppState,
    lp: &mut Loop,
    assessment: Option<&fancy_gamedetect::Assessment>,
    hidden_reason: HiddenReason,
    mode: OverlayMode,
) {
    // Asked of the window, not of the policy: the whole point of the panel is
    // to distinguish "showing" from "meant to be showing".
    let (window_created, visible) = window::actual_state(app);
    let event = GameOverlayEvent {
        visible,
        window_created,
        window_error: lp.window_error.clone(),
        hidden_reason: if visible {
            HiddenReason::Visible
        } else {
            hidden_reason
        },
        mode,
        page_status: super::page_status(app_state),
        placement: placement_of(app),
        verdict: assessment.map(|a| a.verdict),
        score: assessment.map_or(0, |a| a.score),
        exe_path: assessment.map(|a| a.exe_path.clone()),
        exe_stem: assessment.map(|a| a.exe_stem.clone()),
        window_class: assessment.map(|a| a.class.clone()),
        title: assessment.and_then(|a| a.title.clone()),
        shell: assessment.map(|a| a.shell),
        reasons: assessment.map(|a| a.reasons.clone()).unwrap_or_default(),
    };
    let Ok(encoded) = serde_json::to_string(&event) else {
        return;
    };
    if lp.last_emitted.as_deref() == Some(encoded.as_str()) {
        return;
    }
    lp.last_emitted = Some(encoded);
    super::remember_event(app_state, &event);
    let _ = app.emit(super::STATE_EVENT, event);
}
