//! Screen-share commands: source picking and the Rust broadcaster.
//!
//! This is the thin *controller* between the frontend picker UI and the
//! frontend-agnostic [`fancy_screenshare`] core (capture, encode, WebRTC).
//! Outbound signaling from the broadcaster is adapted onto the Mumble
//! connection via [`MumbleSignalSink`]; the server's SDP answer is routed
//! back by [`try_intercept_answer`], called from the `WebRtcSignal` message
//! handler before signals are forwarded to the webview.

use std::sync::{Mutex, OnceLock};

use fancy_screenshare::{BroadcastState, CaptureSource, ScreenBroadcaster, SignalSink, SourceKind};
use serde::Serialize;
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
        let _ = tauri::async_runtime::spawn(async move {
            let state = app.state::<AppState>();
            if let Err(e) = state.send_webrtc_signal(0, signal_type, payload, server_id).await {
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
        };
        if let Err(e) = self
            .app
            .emit("screen-broadcast-state", BroadcastStateEvent { state: name, message })
        {
            tracing::warn!("screenshare: emitting broadcast state failed: {e}");
        }
    }
}

/// Route an incoming `SDP_ANSWER` to the Rust broadcaster when it is the one
/// waiting for it. Returns `true` when the signal was consumed.
///
/// The SFU's answers to the broadcaster and to a (loopback) viewer carry an
/// identical envelope (`sender = target = own session`), so the payload is
/// the discriminator: the answer to our *sendonly* offer is `recvonly`,
/// answers to viewers' recvonly offers are `sendonly`. Only claim the former,
/// and only while our offer is actually unanswered - everything else flows to
/// the webview's dispatcher untouched.
pub(crate) fn try_intercept_answer(signal_type: i32, payload: &str) -> bool {
    if signal_type != 3 {
        return false; // not an SDP_ANSWER
    }
    // This lock is held by `start_screen_broadcast` for the whole broadcaster
    // construction, which sends the SDP offer before returning: blocking here
    // for those few milliseconds is what guarantees an answer racing back
    // from the SFU finds the broadcaster already registered.
    let Ok(slot) = broadcaster_slot().lock() else { return false };
    let Some(broadcaster) = slot.as_ref() else { return false };
    let m_sections = payload.matches("\nm=").count();
    if !broadcaster.awaiting_answer() {
        tracing::debug!(m_sections, "screenshare: answer not claimed (not awaiting)");
        return false;
    }
    // The broadcaster's offer carries exactly ONE (video) m-section, so its
    // answer must too - a multi-section answer belongs to a webview viewer
    // (they offer video+audio) even if an audio m-line says "recvonly".
    if m_sections != 1 || !payload.contains("a=recvonly") {
        tracing::debug!(
            m_sections,
            has_recvonly = payload.contains("a=recvonly"),
            "screenshare: answer not claimed (not the broadcaster's)",
        );
        return false;
    }
    tracing::debug!("screenshare: SDP answer claimed by the Rust broadcaster");
    broadcaster.accept_answer(payload.to_owned());
    true
}

/// Capture source of the currently running Rust broadcast, if any.
/// Lets the drawing overlay pin itself over the exact shared content
/// instead of guessing a monitor from capture dimensions.
pub(crate) fn active_broadcast_source() -> Option<(SourceKind, u32)> {
    broadcaster_slot().lock().ok()?.as_ref().map(ScreenBroadcaster::source)
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

/// Start broadcasting the given source through the server SFU.
///
/// `server_id` pins all signaling to the connection that starts the
/// broadcast (multi-tab safety, mirroring the webview's `broadcasterServerId`).
/// `max_dimension` (longest edge, 0 = source) and `max_fps` set the encoder
/// resolution/frame-rate. Replaces any previous broadcast.
#[tauri::command]
pub(crate) async fn start_screen_broadcast(
    app: AppHandle,
    kind: SourceKind,
    id: u32,
    server_id: Option<String>,
    max_dimension: Option<u32>,
    max_fps: Option<f32>,
) -> Result<(), String> {
    let indicator_app = app.clone();
    let sink = std::sync::Arc::new(MumbleSignalSink { app, server_id });
    let settings = encode_settings_for(max_dimension, max_fps);
    tauri::async_runtime::spawn_blocking(move || {
        // Hold the slot lock across construction: `ScreenBroadcaster::start`
        // sends the SDP offer before returning and the SFU answers within
        // milliseconds. `try_intercept_answer` blocks on this lock, so the
        // racing answer waits until the broadcaster is registered - without
        // this it leaks to the webview and poisons the loopback viewer's
        // peer connection ("m-line order doesn't match").
        let mut slot = broadcaster_slot().lock().map_err(|_| "broadcaster mutex poisoned")?;
        let broadcaster = ScreenBroadcaster::start(kind, id, settings, sink)?;
        if let Some(mut old) = slot.replace(broadcaster) {
            old.stop();
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;

    // Pin the red "you are sharing" bar to the shared source (replaces the
    // OS's yellow capture border). Best-effort - never fails the broadcast.
    super::share_indicator::open(&indicator_app, kind, id);
    Ok(())
}

/// Stop the active broadcast (no-op when none is running).
#[tauri::command]
pub(crate) async fn stop_screen_broadcast(app: AppHandle) -> Result<(), String> {
    super::share_indicator::close(&app);
    let old = {
        let mut slot = broadcaster_slot().lock().map_err(|_| "broadcaster mutex poisoned")?;
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
