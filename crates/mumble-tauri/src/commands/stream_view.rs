//! Native stream-viewer commands - Linux and Windows.
//!
//! On Linux the webview cannot run the SFU viewer layer (distro `WebKitGTK`
//! ships without `WebRTC`), so the frontend drives a Rust-side
//! [`fancy_screenshare::viewer::StreamViewer`] per watched broadcaster
//! instead: same signaling contract as the webview viewer (recvonly offer
//! targeted at the broadcaster session, answer claimed from the
//! `WebRtcSignal` stream), with the video payloads streamed back over a
//! Tauri IPC [`Channel`]. On Windows the same commands back the "native"
//! viewer family as an OPT-IN alternative (the frontend's viewer-strategy
//! setting in Settings -> Advanced; the webview `RTCPeerConnection` route
//! stays the default, and nothing here runs unless that strategy is
//! selected). Elsewhere the commands exist only as stubs so a stray invoke
//! fails loudly.
//!
//! `mode` picks the payload ("h264" preferred): compressed Annex-B access
//! units for the webview's `WebCodecs` decoder (GStreamer, NVDEC/VA-API
//! hardware when present - no Rust-side pixel work at all), or the
//! Rust-decoded JPEG fallback for webviews without `WebCodecs`.
//!
//! Wire format on the channel (binary): each message is a BATCH of records,
//! each record being `[record_len u32 LE]` followed by a 14-byte header
//! `[mid_index u8, flags u8, width u16 LE, height u16 LE, timestamp_us u64 LE]`
//! and the payload (`record_len` covers header + payload). `flags` bit 0 =
//! keyframe, bit 1 = H.264 (else JPEG), bit 2 = decoder config (payload is
//! an `avcC` record for that track, not a frame; H.264 mode only, always
//! preceding the samples that need it). Width/height are 0 for H.264 (the
//! SPS carries them).
//!
//! Batching exists because every channel message costs a JS eval plus an
//! internal fetch round-trip on the GTK MAIN thread: at 30-60 fps the
//! per-frame messages episodically saturated the main loop (observed as
//! multi-second UI stalls and a frozen preview). Records are coalesced for
//! up to [`BATCH_FLUSH_AGE`] and the backlog is bounded - when the webview
//! stops draining, the batch is dropped wholesale and delivery resyncs on
//! the next keyframe instead of queueing unbounded lag.

#[cfg(native_stream_viewer)]
use std::collections::HashMap;
#[cfg(native_stream_viewer)]
use std::sync::{Mutex, OnceLock};

use tauri::ipc::{Channel, InvokeResponseBody};

#[cfg(native_stream_viewer)]
use fancy_screenshare::viewer::{DeliveryMode, StreamViewer, ViewerFrame, ViewerSink, ViewerState};
#[cfg(native_stream_viewer)]
use tauri::{AppHandle, Emitter, Manager};

#[cfg(native_stream_viewer)]
use crate::state::AppState;

/// `WebRtcSignal.signal_type` for an SDP offer (matches Mumble.proto).
#[cfg(native_stream_viewer)]
const SIGNAL_SDP_OFFER: i32 = 2;

/// Active native viewers, keyed by the watched broadcaster's session.
#[cfg(native_stream_viewer)]
static VIEWERS: OnceLock<Mutex<HashMap<u32, StreamViewer>>> = OnceLock::new();

#[cfg(native_stream_viewer)]
fn viewers() -> &'static Mutex<HashMap<u32, StreamViewer>> {
    VIEWERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Lifecycle event payload emitted as `native-stream-view-state`.
#[cfg(native_stream_viewer)]
#[derive(Debug, Clone, serde::Serialize)]
struct ViewerStateEvent {
    /// The watched broadcaster's session.
    session: u32,
    /// "connecting" | "connected" | "failed" | "stopped".
    state: &'static str,
    /// Human-readable detail for `failed`.
    message: Option<String>,
}

/// Coalesce records for at most this long before flushing one channel
/// message (a timer task enforces the bound, so latency never exceeds it
/// regardless of when - or whether - the next frame arrives).
#[cfg(native_stream_viewer)]
const BATCH_FLUSH_AGE: std::time::Duration = std::time::Duration::from_millis(50);

/// Flush early once a batch holds this many payload bytes (keyframes).
#[cfg(native_stream_viewer)]
const BATCH_FLUSH_BYTES: usize = 256 * 1024;

/// A batch growing past this means the webview stopped draining: drop it
/// and resync on the next keyframe instead of queueing unbounded lag.
#[cfg(native_stream_viewer)]
const BATCH_OVERFLOW_BYTES: usize = 1_500_000;

/// Pending coalesced records (see the module doc's wire format).
#[cfg(native_stream_viewer)]
#[derive(Default)]
struct FrameBatch {
    buf: Vec<u8>,
    records: u64,
    keyframes: u64,
    /// When the OLDEST buffered record was appended.
    started: Option<std::time::Instant>,
    /// Overflow recovery: drop everything until a keyframe record arrives.
    dropping_until_key: bool,
}

/// Routes one viewer's signaling onto the owning Mumble connection and its
/// frames onto the frontend IPC channel.
#[cfg(native_stream_viewer)]
struct NativeViewerSink {
    app: AppHandle,
    /// Connection that owns this view (multi-tab safety; see screenshare.rs).
    server_id: Option<String>,
    /// The broadcaster being watched; offers are targeted at this session.
    session: u32,
    /// Payload kind this view streams (drives the header's format flag).
    mode: DeliveryMode,
    on_frame: Channel<InvokeResponseBody>,
    batch: Mutex<FrameBatch>,
    /// Serializes take-batch + channel-send so the timer flusher and the
    /// append-path flushes (config/size) can never reorder records on the
    /// wire. Always acquired BEFORE `batch`.
    flush_lock: Mutex<()>,
    /// Delivery counters for the periodic throughput log below.
    sent: std::sync::atomic::AtomicU64,
    sent_key: std::sync::atomic::AtomicU64,
    last_log: Mutex<std::time::Instant>,
}

/// One length-prefixed wire record (see the module doc).
#[cfg(native_stream_viewer)]
fn encode_record(
    mid_index: u8,
    flags: u8,
    width: u16,
    height: u16,
    timestamp_us: u64,
    payload: &[u8],
) -> Vec<u8> {
    #[allow(
        clippy::cast_possible_truncation,
        reason = "records are single video frames, far below u32"
    )]
    let record_len = (14 + payload.len()) as u32;
    let mut record = Vec::with_capacity(4 + 14 + payload.len());
    record.extend_from_slice(&record_len.to_le_bytes());
    record.push(mid_index);
    record.push(flags);
    record.extend_from_slice(&width.to_le_bytes());
    record.extend_from_slice(&height.to_le_bytes());
    record.extend_from_slice(&timestamp_us.to_le_bytes());
    record.extend_from_slice(payload);
    record
}

#[cfg(native_stream_viewer)]
impl NativeViewerSink {
    /// Append one record to the batch; flush when it is old/large enough
    /// (or `force`, for decoder configs). Overflow drops the backlog and
    /// resyncs on the next keyframe - the webview then recovers exactly as
    /// for network loss (decode error -> keyframe request).
    fn append_record(&self, record: Vec<u8>, keyframe: bool, force: bool) {
        // Holding the Result keeps the guard alive even if poisoned.
        let _order = self.flush_lock.lock();
        let flushed = {
            let Ok(mut batch) = self.batch.lock() else {
                return;
            };
            if batch.dropping_until_key {
                if !(keyframe || force) {
                    return; // still resyncing; drop this delta
                }
                batch.dropping_until_key = false;
            }
            if batch.buf.len() + record.len() > BATCH_OVERFLOW_BYTES {
                tracing::warn!(
                    session = self.session,
                    backlog = batch.buf.len(),
                    "stream-view: webview not draining; dropping backlog until next keyframe"
                );
                batch.buf.clear();
                batch.records = 0;
                batch.keyframes = 0;
                batch.started = None;
                if !(keyframe || force) {
                    batch.dropping_until_key = true;
                    return;
                }
            }
            if batch.buf.is_empty() {
                batch.started = Some(std::time::Instant::now());
            }
            batch.buf.extend_from_slice(&record);
            batch.records += 1;
            batch.keyframes += u64::from(keyframe);
            let due = force || batch.buf.len() >= BATCH_FLUSH_BYTES;
            if !due {
                return;
            }
            take_batch(&mut batch)
        };
        self.deliver(flushed);
    }

    /// Flush a batch that has aged past [`BATCH_FLUSH_AGE`]. Driven by a
    /// timer task: flushing only from [`Self::append_record`] would leave
    /// each batch waiting for the NEXT record to arrive, adding a whole
    /// frame interval of latency (~100 ms at the keep-alive rate) on top
    /// of the coalescing window - felt as preview lag.
    fn flush_due(&self) {
        let _order = self.flush_lock.lock();
        let flushed = {
            let Ok(mut batch) = self.batch.lock() else {
                return;
            };
            let due = !batch.buf.is_empty()
                && batch.started.is_some_and(|s| s.elapsed() >= BATCH_FLUSH_AGE);
            if !due {
                return;
            }
            take_batch(&mut batch)
        };
        self.deliver(flushed);
    }

    /// Send one flushed batch over the channel and keep the heartbeat log
    /// (so a silent webview is distinguishable from a dead feed).
    fn deliver(&self, (buf, records, keyframes): (Vec<u8>, u64, u64)) {
        use std::sync::atomic::Ordering;

        if let Err(e) = self.on_frame.send(InvokeResponseBody::Raw(buf)) {
            tracing::debug!("stream-view: channel send failed: {e}");
        }
        let sent = self.sent.fetch_add(records, Ordering::Relaxed) + records;
        let sent_key = self.sent_key.fetch_add(keyframes, Ordering::Relaxed) + keyframes;
        if let Ok(mut last) = self.last_log.lock() {
            if last.elapsed() >= std::time::Duration::from_secs(5) {
                *last = std::time::Instant::now();
                tracing::info!(
                    session = self.session,
                    sent,
                    keyframes = sent_key,
                    "stream-view: payloads delivered to webview channel"
                );
            }
        }
    }
}

/// Drain the pending batch, resetting it for the next window.
#[cfg(native_stream_viewer)]
fn take_batch(batch: &mut FrameBatch) -> (Vec<u8>, u64, u64) {
    let buf = std::mem::take(&mut batch.buf);
    let records = std::mem::take(&mut batch.records);
    let keyframes = std::mem::take(&mut batch.keyframes);
    batch.started = None;
    (buf, records, keyframes)
}

#[cfg(native_stream_viewer)]
impl ViewerSink for NativeViewerSink {
    fn send_offer(&self, sdp: String) {
        let app = self.app.clone();
        let server_id = self.server_id.clone();
        let target = self.session;
        let _detached = tauri::async_runtime::spawn(async move {
            let state = app.state::<AppState>();
            if let Err(e) = state
                .send_webrtc_signal(target, SIGNAL_SDP_OFFER, sdp, server_id)
                .await
            {
                tracing::warn!("stream-view: sending viewer offer failed: {e}");
            }
        });
    }

    fn on_decoder_config(&self, mid: &str, avcc: Vec<u8>) {
        let mid_index: u8 = mid.parse().unwrap_or(u8::MAX);
        tracing::info!(session = self.session, %mid, "stream-view: decoder config (avcC) delivered");
        // Rides the same batch as the frames (ordering!), flushed at once so
        // the decoder is configured before its samples land.
        self.append_record(encode_record(mid_index, 0b100, 0, 0, 0, &avcc), false, true);
    }

    fn on_frame(&self, frame: ViewerFrame) {
        #[allow(
            clippy::cast_possible_truncation,
            reason = "JPEG frames are downscaled to <= 1600 px per edge; 0 for H.264"
        )]
        let (w, h) = (frame.width as u16, frame.height as u16);
        let mid_index: u8 = frame.mid.parse().unwrap_or(u8::MAX);
        let flags = u8::from(frame.keyframe) | (u8::from(self.mode == DeliveryMode::H264) << 1);
        let record = encode_record(mid_index, flags, w, h, frame.timestamp_us, &frame.data);
        self.append_record(record, frame.keyframe, false);
    }

    fn on_state(&self, state: ViewerState) {
        let (name, message) = match state {
            ViewerState::Connecting => ("connecting", None),
            ViewerState::Connected => ("connected", None),
            ViewerState::Failed(m) => ("failed", Some(m)),
            ViewerState::Stopped => ("stopped", None),
        };
        tracing::info!(session = self.session, state = name, "stream-view: state change");
        if let Err(e) = self.app.emit(
            "native-stream-view-state",
            ViewerStateEvent {
                session: self.session,
                state: name,
                message,
            },
        ) {
            tracing::warn!("stream-view: emitting state failed: {e}");
        }
    }
}

/// Route an incoming `SDP_ANSWER` to the native viewer that is waiting for
/// it; returns `true` when consumed. Called AFTER the broadcaster's
/// [`super::screenshare::try_intercept_answer`], which claims the (all
/// `recvonly`) answer to our sendonly broadcast offer - a viewer's answer
/// always carries `a=sendonly` m-lines (the SFU sends to us), which is the
/// shape required here so the two can never steal each other's answer.
#[cfg(native_stream_viewer)]
pub(crate) fn try_intercept_viewer_answer(
    sender_session: Option<u32>,
    signal_type: i32,
    payload: &str,
) -> bool {
    if signal_type != 3 {
        return false; // not an SDP_ANSWER
    }
    let Some(sender) = sender_session else {
        return false;
    };
    // try_lock, NEVER lock: this runs on the Mumble receive thread (see
    // `screenshare::try_intercept_answer`). An unclaimed answer is re-sent
    // by the viewer's unanswered-offer retry.
    let Ok(map) = viewers().try_lock() else {
        tracing::debug!("stream-view: answer not claimed (viewer registry busy)");
        return false;
    };
    let Some(viewer) = map.get(&sender) else {
        return false;
    };
    if !viewer.awaiting_answer() || !payload.contains("a=sendonly") {
        return false;
    }
    tracing::debug!(session = sender, "stream-view: SDP answer claimed by native viewer");
    viewer.accept_answer(payload.to_owned());
    true
}

/// Start (or replace) the native viewer for one broadcaster session. Frames
/// arrive on `on_frame` (see the module doc for the wire format); lifecycle
/// changes are emitted as `native-stream-view-state` events. `mode`
/// deserializes into [`DeliveryMode`] ("h264" - webview decodes via
/// `WebCodecs`, preferred - or "jpeg"; absent defaults to jpeg, anything
/// else is an invoke error rather than a silent fallback).
#[cfg(native_stream_viewer)]
#[tauri::command]
pub(crate) async fn start_native_stream_view(
    app: AppHandle,
    session: u32,
    server_id: Option<String>,
    mode: Option<DeliveryMode>,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let mode = mode.unwrap_or(DeliveryMode::Jpeg);
    let sink = std::sync::Arc::new(NativeViewerSink {
        app,
        server_id,
        session,
        mode,
        on_frame,
        batch: Mutex::new(FrameBatch::default()),
        flush_lock: Mutex::new(()),
        sent: std::sync::atomic::AtomicU64::new(0),
        sent_key: std::sync::atomic::AtomicU64::new(0),
        last_log: Mutex::new(std::time::Instant::now()),
    });
    // Timed batch flusher (see `flush_due`). Holds only a Weak: the task
    // ends by itself once the viewer (sole Arc owner) is stopped.
    let weak_sink = std::sync::Arc::downgrade(&sink);
    let _detached = tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(BATCH_FLUSH_AGE / 2).await;
            let Some(sink) = weak_sink.upgrade() else {
                break;
            };
            sink.flush_due();
        }
    });
    tauri::async_runtime::spawn_blocking(move || {
        // Hold the registry lock across construction so the racing answer
        // finds the viewer registered (the intercept uses try_lock; a missed
        // race is healed by the offer retry). The OLD viewer stops OUTSIDE
        // the lock - teardown must never wedge the registry (see the
        // broadcaster slot for the incident this guards against).
        let old = {
            let mut map = viewers().lock().map_err(|_| "viewer registry poisoned")?;
            let viewer = StreamViewer::start(sink, mode)?;
            map.insert(session, viewer)
        };
        if let Some(mut old) = old {
            old.stop();
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(not(native_stream_viewer))]
#[tauri::command]
pub(crate) async fn start_native_stream_view(
    _session: u32,
    _server_id: Option<String>,
    _mode: Option<String>,
    _on_frame: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    Err("the native stream viewer is Linux-only; this platform uses the webview viewer".to_owned())
}

/// Receive-side stats of one viewed session's native peer (RTP counters per
/// track, RTT, ICE path) for the "Stats for Nerds" panel. `Ok(None)` when no
/// viewer runs for that session.
#[cfg(native_stream_viewer)]
#[tauri::command]
pub(crate) async fn native_stream_view_stats(
    session: u32,
) -> Result<Option<fancy_screenshare::viewer::ViewerStats>, String> {
    // The probe is cloned out UNDER the lock; the (bounded) collection runs
    // OUTSIDE it - holding the registry across peer I/O once wedged the
    // receive thread's answer interception.
    tauri::async_runtime::spawn_blocking(move || {
        let probe = {
            let map = viewers().lock().map_err(|_| "viewer registry poisoned")?;
            map.get(&session).and_then(StreamViewer::stats_probe)
        };
        Ok(probe.as_ref().and_then(fancy_screenshare::viewer::ViewerStatsProbe::collect))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(not(native_stream_viewer))]
#[tauri::command]
pub(crate) async fn native_stream_view_stats(
    _session: u32,
) -> Result<Option<serde_json::Value>, String> {
    Ok(None)
}

/// Ask the SFU for a fresh keyframe on every video track of one viewed
/// session (rate-limited in the viewer). The webview's `WebCodecs` decoder
/// calls this when it needs an IDR (joined before one, decode error).
#[cfg(native_stream_viewer)]
#[tauri::command]
pub(crate) async fn request_stream_keyframe(session: u32) -> Result<(), String> {
    let map = viewers().lock().map_err(|_| "viewer registry poisoned")?;
    if let Some(viewer) = map.get(&session) {
        viewer.request_keyframe();
    }
    Ok(())
}

#[cfg(not(native_stream_viewer))]
#[tauri::command]
pub(crate) async fn request_stream_keyframe(_session: u32) -> Result<(), String> {
    Ok(())
}

/// Stop and drop the native viewer for one broadcaster session (no-op when
/// none is running).
#[cfg(native_stream_viewer)]
#[tauri::command]
pub(crate) async fn stop_native_stream_view(session: u32) -> Result<(), String> {
    let old = {
        let mut map = viewers().lock().map_err(|_| "viewer registry poisoned")?;
        map.remove(&session)
    };
    if let Some(mut viewer) = old {
        // stop() closes the peer and blocks on the runtime - keep it off
        // the shared async runtime.
        tauri::async_runtime::spawn_blocking(move || viewer.stop())
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(native_stream_viewer))]
#[tauri::command]
pub(crate) async fn stop_native_stream_view(_session: u32) -> Result<(), String> {
    Ok(())
}
