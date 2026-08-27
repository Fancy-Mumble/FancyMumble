//! Screen-share commands: source picking and the Rust broadcaster.
//!
//! This is the thin *controller* between the frontend picker UI and the
//! frontend-agnostic [`fancy_screenshare`] core (capture, encode, WebRTC).
//! Outbound signaling from the broadcaster is adapted onto the Mumble
//! connection via [`MumbleSignalSink`]; the server's SDP answer is routed
//! back by [`try_intercept_answer`], called from the `WebRtcSignal` message
//! handler before signals are forwarded to the webview.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use fancy_screenshare::{
    BroadcastSource, BroadcastState, CaptureSource, ScreenBroadcaster, SignalSink, SourceKind,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

/// `WebRtcSignal.signal_type` for an SDP offer (matches Mumble.proto).
const SIGNAL_SDP_OFFER: i32 = 2;

/// The single active broadcaster (one broadcast per app, like the webview's
/// module-level singleton before it).
static BROADCASTER: OnceLock<Mutex<Option<ScreenBroadcaster>>> = OnceLock::new();

fn broadcaster_slot() -> &'static Mutex<Option<ScreenBroadcaster>> {
    BROADCASTER.get_or_init(|| Mutex::new(None))
}

/// Whether our own windows should hide from screen capture while a SCREEN
/// share runs (see `start_screen_broadcast` for why they do by default).
///
/// The user can lift it - a hidden window cannot be screenshotted or
/// recorded by anything, the Snipping Tool included, which is a surprise
/// when you only wanted your own capture of the app. Deliberately process
/// state and not a persisted setting: the feedback loop it guards against
/// is real, so every restart starts safe again.
static HIDE_SELF_FROM_CAPTURE: AtomicBool = AtomicBool::new(true);

/// Whether the running broadcast captures a screen, i.e. whether the
/// preference above currently has anything to apply to.
static BROADCASTING_SCREEN: AtomicBool = AtomicBool::new(false);

/// Re-apply the exclusion the current broadcast and preference call for.
fn sync_capture_exclusion(app: &AppHandle) {
    let hide = BROADCASTING_SCREEN.load(Ordering::Relaxed)
        && HIDE_SELF_FROM_CAPTURE.load(Ordering::Relaxed);
    set_own_windows_excluded_from_capture(app, hide);
}

/// Lifecycle event payload emitted to the webview as `screen-broadcast-state`.
#[derive(Debug, Clone, Serialize)]
struct BroadcastStateEvent {
    /// "connecting" | "connected" | "failed" | "stopped".
    state: &'static str,
    /// Human-readable detail for `failed`.
    message: Option<String>,
}

/// Routes broadcaster signaling onto the Mumble connection that owns the
/// broadcast, and lifecycle changes to the webview as a Tauri event.
struct MumbleSignalSink {
    app: AppHandle,
    /// Connection that owns this broadcast (see `send_webrtc_signal`).
    server_id: Option<String>,
}

impl MumbleSignalSink {
    fn send_signal(&self, signal_type: i32, payload: String) {
        let app = self.app.clone();
        let server_id = self.server_id.clone();
        let _detached = tauri::async_runtime::spawn(async move {
            let state = app.state::<AppState>();
            if let Err(e) = state
                .send_webrtc_signal(0, signal_type, payload, server_id)
                .await
            {
                tracing::warn!("screenshare: sending signal {signal_type} failed: {e}");
            }
        });
    }
}

impl SignalSink for MumbleSignalSink {
    fn send_offer(&self, sdp: String) {
        self.send_signal(SIGNAL_SDP_OFFER, sdp);
    }

    fn send_ice_candidate(&self, candidate_json: String) {
        // Deliberately NOT relayed. The server SFU is ICE-lite: it ignores
        // client candidates entirely (its AddIceCandidate is a no-op - it
        // learns our address from the incoming STUN binding requests) and
        // its own candidate rides in the SDP answer. Relaying them would
        // also burn murmur's per-user leaky bucket (1 msg/s, burst 5): one
        // candidate per local interface arrives as a burst that silently
        // drowns the loopback viewer's SDP offer sent right after ours.
        tracing::debug!(
            len = candidate_json.len(),
            "screenshare: dropping local ICE candidate (ICE-lite SFU)",
        );
    }

    fn on_state(&self, state: BroadcastState) {
        tracing::info!(?state, "screenshare: broadcast state change");
        let (name, message) = match state {
            BroadcastState::Connecting => ("connecting", None),
            BroadcastState::Connected => ("connected", None),
            BroadcastState::Failed(m) => ("failed", Some(m)),
            BroadcastState::Stopped => ("stopped", None),
            // Advisory: the broadcast keeps running; the frontend shows a
            // dismissible hint about fullscreen/scanout capture on the shared
            // monitor. Cleared by `captureResumed`.
            BroadcastState::CaptureStalled => ("captureStalled", None),
            BroadcastState::CaptureResumed => ("captureResumed", None),
        };
        if let Err(e) = self.app.emit(
            "screen-broadcast-state",
            BroadcastStateEvent {
                state: name,
                message,
            },
        ) {
            tracing::warn!("screenshare: emitting broadcast state failed: {e}");
        }
    }
}

/// Route an incoming `SDP_ANSWER` to the Rust broadcaster when it is the one
/// waiting for it. Returns `true` when the signal was consumed.
///
/// The SFU's answers to the broadcaster and to a (loopback) viewer carry an
/// identical envelope (`sender = target = own session`), so the payload is
/// the discriminator: the answer to our *sendonly* offer is all-`recvonly`
/// (one m-section per broadcast track), while answers to viewers' recvonly
/// offers contain `sendonly` m-lines. Only claim the former, and only while
/// our offer is actually unanswered - everything else flows to the webview's
/// dispatcher untouched.
pub(crate) fn try_intercept_answer(signal_type: i32, payload: &str) -> bool {
    if signal_type != 3 {
        return false; // not an SDP_ANSWER
    }
    // try_lock, NEVER lock: this runs on the Mumble receive thread, and the
    // slot is held across broadcaster construction. Blocking here once froze
    // the entire receive path when a teardown wedged under the lock (leaked
    // portal capture threads). On contention the answer simply falls through
    // to the webview dispatcher unclaimed; the broadcaster's unanswered-offer
    // retry gets it re-answered within 1.5 s.
    let Ok(slot) = broadcaster_slot().try_lock() else {
        tracing::debug!("screenshare: answer not claimed (broadcaster slot busy)");
        return false;
    };
    let Some(broadcaster) = slot.as_ref() else {
        return false;
    };
    let m_sections = payload.matches("\nm=").count();
    if !broadcaster.awaiting_answer() {
        tracing::debug!(m_sections, "screenshare: answer not claimed (not awaiting)");
        return false;
    }
    // The broadcaster's offer carries one video m-section per shared source,
    // all sendonly, so its answer has exactly that many m-sections and no
    // sendonly at all - a viewer's answer (video+video+audio, sendonly from
    // the SFU's side) never matches, even while an audio m-line says
    // "recvonly".
    if m_sections != broadcaster.track_count()
        || !payload.contains("a=recvonly")
        || payload.contains("a=sendonly")
    {
        tracing::debug!(
            m_sections,
            has_recvonly = payload.contains("a=recvonly"),
            has_sendonly = payload.contains("a=sendonly"),
            "screenshare: answer not claimed (not the broadcaster's)",
        );
        return false;
    }
    tracing::debug!("screenshare: SDP answer claimed by the Rust broadcaster");
    broadcaster.accept_answer(payload.to_owned());
    true
}

/// Desktop capture source (screen or window) of the currently running Rust
/// broadcast, if any. Lets the drawing overlay pin itself over the exact
/// shared content instead of guessing a monitor from capture dimensions.
/// Camera tracks have no desktop location and are ignored here.
pub(crate) fn active_broadcast_source() -> Option<(SourceKind, u32)> {
    broadcaster_slot()
        .lock()
        .ok()?
        .as_ref()
        .and_then(ScreenBroadcaster::display_source)
}

/// List all capturable screens and windows for the source picker.
#[tauri::command]
pub(crate) async fn list_capture_sources() -> Result<Vec<CaptureSource>, String> {
    tauri::async_runtime::spawn_blocking(fancy_screenshare::sources::list_sources)
        .await
        .map_err(|e| e.to_string())?
}

/// Capture a JPEG thumbnail (data URL) of one source for its picker card.
#[tauri::command]
pub(crate) async fn capture_source_thumbnail(
    kind: SourceKind,
    id: u32,
    max_dim: Option<u32>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fancy_screenshare::sources::capture_thumbnail(kind, id, max_dim.unwrap_or(320))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Build encoder settings from the picker's resolution/frame-rate choice.
/// `max_dimension` is the longest output edge in px (`0`/`None` = Source,
/// i.e. native); `max_fps` defaults to the encoder default when absent. The
/// encoder derives bitrate from the pixel rate, so it is not passed in.
fn encode_settings_for(
    max_dimension: Option<u32>,
    max_fps: Option<f32>,
) -> fancy_screenshare::encode::EncodeSettings {
    let mut settings = fancy_screenshare::encode::EncodeSettings::default();
    if let Some(dim) = max_dimension {
        settings.max_dimension = dim;
    }
    if let Some(fps) = max_fps {
        settings.max_fps = fps.clamp(1.0, 120.0);
    }
    settings
}

/// One source in a broadcast, as sent by the picker UI. Wire format of the
/// crate's [`BroadcastSource`] (kind uses the `SourceKind` serde form).
#[derive(Debug, Clone, Copy, Deserialize)]
pub(crate) struct SourceSpec {
    /// Screen, window or camera.
    kind: SourceKind,
    /// Backend-native source id.
    id: u32,
}

/// Start broadcasting the given sources (screen/window and/or camera; one
/// video track each, mids in list order) through the server SFU.
///
/// `server_id` pins all signaling to the connection that starts the
/// broadcast (multi-tab safety, mirroring the webview's `broadcasterServerId`).
/// `max_dimension` (longest edge, 0 = source) and `max_fps` set the encoder
/// resolution/frame-rate. `reuse_portal_source` marks a replace that keeps
/// the display source (quality change, camera toggled), letting the Linux
/// portal restore the previous pick instead of prompting again; ignored
/// elsewhere. Replaces any previous broadcast.
#[tauri::command]
pub(crate) async fn start_screen_broadcast(
    app: AppHandle,
    sources: Vec<SourceSpec>,
    server_id: Option<String>,
    max_dimension: Option<u32>,
    max_fps: Option<f32>,
    reuse_portal_source: Option<bool>,
) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    fancy_screenshare::set_restore_last_pick(reuse_portal_source.unwrap_or(false));
    #[cfg(not(target_os = "linux"))]
    let _ = reuse_portal_source;
    // SCREEN shares must not capture this app itself: the live own-preview
    // inside the captured screen forms a delayed video feedback loop that
    // self-oscillates (delivery stall -> static screen -> capture pause ->
    // catch-up burst -> stall...), measured as constant receiver "freezes".
    // Excluding our windows (Discord does the same - their app is black in
    // captures) kills the loop and stops chats leaking into shares. Window
    // shares are unaffected: picking THIS app's window still works because
    // exclusion is only applied while a screen share runs.
    // ...unless the user asked for their app back (see HIDE_SELF_FROM_CAPTURE).
    let excludes_screen = sources.iter().any(|s| s.kind == SourceKind::Screen);
    BROADCASTING_SCREEN.store(excludes_screen, Ordering::Relaxed);
    sync_capture_exclusion(&app);

    let sink = std::sync::Arc::new(MumbleSignalSink { app, server_id });
    let settings = encode_settings_for(max_dimension, max_fps);
    let broadcast_sources: Vec<BroadcastSource> = sources
        .iter()
        .map(|s| BroadcastSource {
            kind: s.kind,
            id: s.id,
        })
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        // Take the OLD broadcaster out of the slot and stop it BEFORE the new
        // one opens its sources. Both halves outside the lock, for the reason
        // recorded below; but the order between them is not free either. This
        // used to construct the new broadcaster first and stop the old one
        // after, and the two then raced for the same devices: a camera share
        // extended with the screen re-opens the camera while the old capture
        // thread still holds it, the open lands but every frame read fails
        // (V4L2: EINVAL) for as long as the old handle lives, and the new
        // broadcast declares "camera lost" on a device that is fine.
        //
        // Stopping the old one first also does not reopen the intercept race
        // it looks like it might: the SFU's answer is to the *new* offer,
        // which cannot exist until `start` below has run, so nothing can
        // arrive for a slot that is briefly empty.
        let old = broadcaster_slot()
            .lock()
            .map_err(|_| "broadcaster mutex poisoned")?
            .take();
        if let Some(mut old) = old {
            // Joins the capture threads, which is what releases the devices.
            // Held OUTSIDE the lock: a capture teardown wedged in the portal
            // once held this lock forever - freezing the receive thread and
            // every later share.
            old.stop();
        }
        // Hold the slot lock across construction so the answer racing back
        // from the SFU finds the broadcaster registered (the intercept uses
        // try_lock and a missed race is healed by the offer retry).
        {
            let mut slot = broadcaster_slot()
                .lock()
                .map_err(|_| "broadcaster mutex poisoned")?;
            let broadcaster = ScreenBroadcaster::start(broadcast_sources, settings, sink)?;
            let _ = slot.replace(broadcaster);
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(())
}

/// Apply (or lift) capture exclusion on every window of this app. Best
/// effort: a window that cannot be excluded logs and stays visible in the
/// share rather than failing the broadcast.
///
/// The drawing overlay is left alone: it excludes itself on creation and
/// must stay excluded whatever the share does, or the annotations drawn for
/// the broadcaster get recorded back into their own stream.
#[cfg(not(target_os = "android"))]
fn set_own_windows_excluded_from_capture(app: &AppHandle, excluded: bool) {
    use crate::commands::draw_overlay::DRAW_OVERLAY_LABEL;
    use crate::platform::window::WindowExt;
    use tauri::Manager;
    for (label, window) in app.webview_windows() {
        if label == DRAW_OVERLAY_LABEL {
            continue;
        }
        if let Err(e) = window.set_excluded_from_capture(excluded) {
            tracing::warn!(%label, excluded, "screenshare: capture exclusion failed: {e}");
        }
    }
}

#[cfg(target_os = "android")]
fn set_own_windows_excluded_from_capture(_app: &AppHandle, _excluded: bool) {}

/// Whether this app's windows hide from screen capture while screen-sharing.
#[tauri::command]
pub(crate) fn self_capture_exclusion() -> bool {
    HIDE_SELF_FROM_CAPTURE.load(Ordering::Relaxed)
}

/// Hide this app's windows from screen capture while screen-sharing, or stop
/// doing so - the toggle behind the config menu's "hide from capture" item.
///
/// Takes effect on the running share immediately, so a user who wants to
/// screenshot or record the client does not have to restart their share.
#[tauri::command]
pub(crate) fn set_self_capture_exclusion(app: AppHandle, hidden: bool) {
    HIDE_SELF_FROM_CAPTURE.store(hidden, Ordering::Relaxed);
    sync_capture_exclusion(&app);
}

/// Platform traits of the share flow, queried once by the frontend to shape
/// its UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenShareCapabilities {
    /// The compositor's portal dialog replaces the in-app source picker
    /// (GNOME): the share button starts the portal flow directly, cameras
    /// get their own header button, and every custom screen/window
    /// selection UI stays hidden.
    portal_picker: bool,
}

/// How this platform wants sources picked (see [`ScreenShareCapabilities`]).
#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) fn screen_share_capabilities() -> ScreenShareCapabilities {
    ScreenShareCapabilities {
        portal_picker: fancy_screenshare::native_portal_picker(),
    }
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub(crate) fn screen_share_capabilities() -> ScreenShareCapabilities {
    ScreenShareCapabilities {
        portal_picker: false,
    }
}

/// Run the `org.freedesktop.portal.Camera` consent flow (GNOME's native
/// camera dialog) before a camera share. Blocks until the user answers when
/// no grant is stored yet; `Ok(false)` only on an explicit denial.
#[cfg(target_os = "linux")]
#[tauri::command]
pub(crate) async fn request_camera_access() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(fancy_screenshare::camera_portal::request_access)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub(crate) async fn request_camera_access() -> Result<bool, String> {
    // No consent portal outside Linux; the OS prompts on device open where
    // it cares (macOS TCC).
    Ok(true)
}

/// Stop the active broadcast (no-op when none is running).
#[tauri::command]
pub(crate) async fn stop_screen_broadcast(app: AppHandle) -> Result<(), String> {
    BROADCASTING_SCREEN.store(false, Ordering::Relaxed);
    sync_capture_exclusion(&app);
    let old = {
        let mut slot = broadcaster_slot()
            .lock()
            .map_err(|_| "broadcaster mutex poisoned")?;
        slot.take()
    };
    if let Some(mut broadcaster) = old {
        // stop() joins the capture thread and closes the peer - keep it off
        // the async runtime.
        tauri::async_runtime::spawn_blocking(move || broadcaster.stop())
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
