//! Native (Rust-side) SFU stream viewer - Linux only.
//!
//! Distro `WebKitGTK` builds compile `WebRTC` out, so on Linux the webview
//! cannot run the SFU viewer layer (remote streams and the broadcaster's own
//! loopback preview) that WebView2 provides on Windows. This module is the
//! native replacement for exactly that layer, and ONLY on Linux - the
//! Windows/webview route is untouched.
//!
//! One [`StreamViewer`] is the Rust analogue of the webview's per-broadcaster
//! `RTCPeerConnection`: it offers the same m-line shape (two recvonly video
//! transceivers + one recvonly audio, so the SFU answers identically and the
//! embedder's answer discrimination keeps working), receives the H.264 RTP
//! and reassembles access units. Signaling stays with the embedder via
//! [`ViewerSink`], mirroring [`crate::broadcast::SignalSink`].
//!
//! What leaves the viewer depends on [`DeliveryMode`]:
//!
//! * [`DeliveryMode::H264`] (preferred): the compressed access units,
//!   keyframe-tagged and timestamped - for UIs that can decode themselves
//!   (`WebCodecs` in the webview, GPU path). No Rust-side decode, no
//!   transcode; IPC carries exactly the stream bitrate. Samples are
//!   converted from the RTP's Annex-B to AVCC (length-prefixed NALs) with
//!   the SPS/PPS delivered via [`ViewerSink::on_decoder_config`] as an
//!   `avcC` record: `WebKit`'s `WebCodecs` advertises Annex-B support but
//!   actually decodes only with an AVCC `description` (probed empirically).
//! * [`DeliveryMode::Jpeg`] (fallback for webviews without `WebCodecs`):
//!   decoded (openh264) and JPEG-compressed frames, downscaled and
//!   rate-capped. Decode always runs per sample - H.264 reference chains
//!   break on gaps - only the JPEG emission is capped.
//!
//! Keyframe recovery: a decode failure requests an IDR from the SFU via PLI,
//! rate-limited. In JPEG mode the internal decoder triggers it; in H.264
//! mode the embedder forwards its decoder's errors via
//! [`StreamViewer::request_keyframe`].

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::setting_engine::SettingEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::media::io::sample_builder::SampleBuilder;
use webrtc::media::Sample;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication;
use webrtc::rtp::codecs::h264::H264Packet;
use webrtc::rtp_transceiver::rtp_codec::RTPCodecType;
use webrtc::rtp_transceiver::rtp_transceiver_direction::RTCRtpTransceiverDirection;
use webrtc::rtp_transceiver::RTCRtpTransceiverInit;
use webrtc::track::track_remote::TrackRemote;

/// Longest edge of emitted JPEG frames (JPEG mode only); decoded frames
/// above this are downscaled before encoding (IPC bandwidth, encode time).
const MAX_VIEW_DIM: u32 = 1600;

/// Minimum time between emitted JPEG frames per track (~15 fps; JPEG mode
/// only - H.264 mode forwards every access unit). Decode is never skipped.
const EMIT_INTERVAL: Duration = Duration::from_millis(66);

/// Minimum spacing between PLI keyframe requests per viewer.
const PLI_INTERVAL: Duration = Duration::from_secs(1);

/// JPEG quality of emitted fallback frames.
const JPEG_QUALITY: u8 = 70;

/// What [`ViewerFrame::data`] carries (see the module doc).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryMode {
    /// Compressed H.264 access units (AVCC); the embedder's UI decodes.
    H264,
    /// Rust-decoded, JPEG-compressed frames (no decoder in the UI).
    Jpeg,
}

/// One video payload of a broadcast track, in the viewer's [`DeliveryMode`].
pub struct ViewerFrame {
    /// SDP mid of the track ("0", "1", ...) - the embedder maps it to
    /// screen/camera content via the broadcast's START announcement.
    pub mid: String,
    /// Frame width in pixels. JPEG mode only; 0 in H.264 mode (the decoder
    /// reads dimensions from the in-band SPS).
    pub width: u32,
    /// Frame height in pixels (see `width`).
    pub height: u32,
    /// Whether the payload is (or contains) an IDR. Always true for JPEG
    /// frames, which are self-contained.
    pub keyframe: bool,
    /// Presentation timestamp in microseconds, monotonic from the RTP clock
    /// (baseline H.264 has no B-frames, so decode order = presentation order).
    pub timestamp_us: u64,
    /// The payload: an AVCC access unit (length-prefixed NALs; parameter
    /// sets travel via [`ViewerSink::on_decoder_config`]) or a baseline JPEG.
    pub data: Vec<u8>,
}

impl std::fmt::Debug for ViewerFrame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ViewerFrame")
            .field("mid", &self.mid)
            .field("width", &self.width)
            .field("height", &self.height)
            .field("keyframe", &self.keyframe)
            .field("timestamp_us", &self.timestamp_us)
            .field("data_len", &self.data.len())
            .finish()
    }
}

/// Receive-side counters of one video track, for the embedder's stats UI.
/// webrtc-rs exposes no receive-side loss/jitter, so this is what exists:
/// packet/byte counters plus the recovery-request tallies.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerTrackStats {
    /// SDP mid of the track ("0", "1", ...).
    pub mid: String,
    /// RTP SSRC.
    pub ssrc: u32,
    /// Cumulative RTP packets received.
    pub packets_received: u64,
    /// Cumulative payload bytes received.
    pub bytes_received: u64,
    /// NACKs we sent (loss recovery).
    pub nack_count: u64,
    /// PLIs we sent (keyframe recovery).
    pub pli_count: u64,
}

/// Snapshot of the viewer peer for the embedder's stats UI.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerStats {
    /// Peer connection state ("connected", ...).
    pub connection_state: String,
    /// Current RTT of the selected ICE pair, milliseconds.
    pub rtt_ms: Option<f64>,
    /// Selected ICE candidate types, "local / remote" (e.g. "host / host").
    pub ice_path: Option<String>,
    /// One entry per inbound video track.
    pub videos: Vec<ViewerTrackStats>,
}

/// Viewer lifecycle, mirroring [`crate::BroadcastState`].
#[derive(Debug, Clone)]
pub enum ViewerState {
    /// Offer sent; waiting for the SFU's answer / ICE.
    Connecting,
    /// Media path established.
    Connected,
    /// The connection failed or the answer was unusable.
    Failed(String),
    /// The viewer was stopped by the embedder.
    Stopped,
}

/// Embedder callbacks: outbound signaling, media payloads, lifecycle.
/// Everything may be called from internal runtime/decode threads.
pub trait ViewerSink: Send + Sync {
    /// Deliver the SDP offer to the SFU (targeted at the broadcaster's
    /// session). Called again for unanswered-offer retries.
    fn send_offer(&self, sdp: String);
    /// H.264 mode only: a (new) `avcC` decoder-configuration record for one
    /// track, built from the stream's in-band SPS/PPS. Always delivered
    /// before the first [`Self::on_frame`] that needs it; delivered again
    /// whenever the parameter sets change (e.g. a resolution change).
    fn on_decoder_config(&self, mid: &str, avcc: Vec<u8>);
    /// A video payload of one track, ready to decode/display.
    fn on_frame(&self, frame: ViewerFrame);
    /// Lifecycle change.
    fn on_state(&self, state: ViewerState);
}

/// A native viewer peer for ONE broadcaster session.
pub struct StreamViewer {
    runtime: Option<tokio::runtime::Runtime>,
    pc: Arc<RTCPeerConnection>,
    stop: Arc<AtomicBool>,
    awaiting_answer: Arc<AtomicBool>,
    sink: Arc<dyn ViewerSink>,
    /// SSRCs of the video tracks seen so far, for embedder-driven PLIs.
    video_ssrcs: Arc<Mutex<Vec<u32>>>,
    /// Last embedder-driven PLI burst (rate limit across tracks).
    last_pli: Mutex<Instant>,
}

impl std::fmt::Debug for StreamViewer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamViewer")
            .field("awaiting_answer", &self.awaiting_answer.load(Ordering::SeqCst))
            .finish_non_exhaustive()
    }
}

impl StreamViewer {
    /// Build the peer, send the SDP offer through `sink` and return. Frames
    /// start flowing once the answer is fed back via [`Self::accept_answer`]
    /// and ICE connects.
    pub fn start(sink: Arc<dyn ViewerSink>, mode: DeliveryMode) -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .map_err(|e| format!("viewer runtime: {e}"))?;

        let stop = Arc::new(AtomicBool::new(false));
        let awaiting_answer = Arc::new(AtomicBool::new(false));
        let video_ssrcs = Arc::new(Mutex::new(Vec::new()));

        let pc = runtime.block_on(Self::build_peer(&sink, &stop, &video_ssrcs, mode))?;

        let offer_sdp = runtime.block_on(async {
            let offer = pc
                .create_offer(None)
                .await
                .map_err(|e| format!("create_offer: {e}"))?;
            let sdp = offer.sdp.clone();
            pc.set_local_description(offer)
                .await
                .map_err(|e| format!("set_local_description: {e}"))?;
            Ok::<String, String>(sdp)
        })?;
        awaiting_answer.store(true, Ordering::SeqCst);
        sink.on_state(ViewerState::Connecting);
        sink.send_offer(offer_sdp.clone());

        // Same leaky-bucket insurance as the broadcaster: the Mumble control
        // channel silently rate-drops bursts, so re-send the offer until the
        // answer clears `awaiting_answer` (the SFU just re-answers).
        let retry_sink = Arc::clone(&sink);
        let retry_awaiting = Arc::clone(&awaiting_answer);
        let _retry = runtime.spawn(async move {
            for attempt in 2..=5u32 {
                tokio::time::sleep(Duration::from_millis(1500)).await;
                if !retry_awaiting.load(Ordering::SeqCst) {
                    return;
                }
                tracing::info!(attempt, "screenshare: re-sending unanswered viewer offer");
                retry_sink.send_offer(offer_sdp.clone());
            }
        });

        Ok(Self {
            runtime: Some(runtime),
            pc,
            stop,
            awaiting_answer,
            sink,
            video_ssrcs,
            last_pli: Mutex::new(Instant::now() - PLI_INTERVAL),
        })
    }

    /// Whether the viewer has sent its offer and not yet received the answer
    /// (the embedder's signal router uses this to claim `SDP_ANSWER`s).
    pub fn awaiting_answer(&self) -> bool {
        self.awaiting_answer.load(Ordering::SeqCst)
    }

    /// Apply the SFU's SDP answer. Clears [`Self::awaiting_answer`].
    pub fn accept_answer(&self, sdp: String) {
        self.awaiting_answer.store(false, Ordering::SeqCst);
        let pc = Arc::clone(&self.pc);
        let sink = Arc::clone(&self.sink);
        if let Some(rt) = &self.runtime {
            let _detached = rt.spawn(async move {
                let answer = match RTCSessionDescription::answer(sdp) {
                    Ok(a) => a,
                    Err(e) => {
                        sink.on_state(ViewerState::Failed(format!("bad answer: {e}")));
                        return;
                    }
                };
                if let Err(e) = pc.set_remote_description(answer).await {
                    sink.on_state(ViewerState::Failed(format!("set_remote_description: {e}")));
                }
            });
        }
    }

    /// Request an IDR from the SFU for every video track (PLI), rate-limited
    /// to one burst per [`PLI_INTERVAL`]. H.264-mode embedders call this when
    /// THEIR decoder fails (join before a keyframe, reference loss).
    pub fn request_keyframe(&self) {
        {
            let Ok(mut last) = self.last_pli.lock() else {
                return;
            };
            if last.elapsed() < PLI_INTERVAL {
                return;
            }
            *last = Instant::now();
        }
        let ssrcs: Vec<u32> = self
            .video_ssrcs
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default();
        if ssrcs.is_empty() {
            return;
        }
        let pc = Arc::clone(&self.pc);
        if let Some(rt) = &self.runtime {
            let _detached = rt.spawn(send_plis(pc, ssrcs));
        }
    }

    /// Handle for collecting stats OUTSIDE any registry lock: collection
    /// blocks on the peer (bounded), and doing that while holding shared
    /// state once wedged the embedder's signal routing. `None` after
    /// [`Self::stop`].
    pub fn stats_probe(&self) -> Option<ViewerStatsProbe> {
        let rt = self.runtime.as_ref()?;
        Some(ViewerStatsProbe {
            handle: rt.handle().clone(),
            pc: Arc::clone(&self.pc),
        })
    }

    /// Close the peer and shut the runtime down. Idempotent. Track tasks and
    /// decode threads end on their own once the peer closes (their reads
    /// error out and the sample channels drop).
    pub fn stop(&mut self) {
        if self.stop.swap(true, Ordering::SeqCst) {
            return;
        }
        self.awaiting_answer.store(false, Ordering::SeqCst);
        if let Some(rt) = self.runtime.take() {
            let pc = Arc::clone(&self.pc);
            rt.block_on(async move {
                let _ = pc.close().await;
            });
            rt.shutdown_background();
        }
        self.sink.on_state(ViewerState::Stopped);
    }
}

impl Drop for StreamViewer {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Detached stats collector of one [`StreamViewer`] (see
/// [`StreamViewer::stats_probe`]): cloned out under the embedder's registry
/// lock, collected outside it, bounded so a wedged peer costs 2 s at most.
pub struct ViewerStatsProbe {
    handle: tokio::runtime::Handle,
    pc: Arc<RTCPeerConnection>,
}

impl std::fmt::Debug for ViewerStatsProbe {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ViewerStatsProbe").finish_non_exhaustive()
    }
}

impl ViewerStatsProbe {
    /// Snapshot the peer's receive-side stats; `None` when the peer does
    /// not answer within the bound (closing/wedged).
    pub fn collect(&self) -> Option<ViewerStats> {
        use webrtc::ice::candidate::CandidatePairState;
        use webrtc::stats::StatsReportType;

        let connection_state = self.pc.connection_state().to_string();
        let pc = Arc::clone(&self.pc);
        let report = self.handle.block_on(async move {
            tokio::time::timeout(Duration::from_secs(2), pc.get_stats())
                .await
                .ok()
        })?;

        let mut videos = Vec::new();
        let mut rtt_ms = None;
        let mut pair_ids: Option<(String, String)> = None;
        for entry in report.reports.values() {
            match entry {
                StatsReportType::InboundRTP(s) if s.kind == "video" => {
                    videos.push(ViewerTrackStats {
                        mid: s.mid.to_string(),
                        ssrc: s.ssrc,
                        packets_received: s.packets_received,
                        bytes_received: s.bytes_received,
                        nack_count: s.nack_count,
                        pli_count: s.pli_count.unwrap_or(0),
                    });
                }
                StatsReportType::CandidatePair(p)
                    if p.nominated && p.state == CandidatePairState::Succeeded =>
                {
                    rtt_ms = Some(p.current_round_trip_time * 1000.0);
                    pair_ids = Some((p.local_candidate_id.clone(), p.remote_candidate_id.clone()));
                }
                _ => {}
            }
        }
        videos.sort_by(|a, b| a.mid.cmp(&b.mid));

        // Resolve the selected pair's candidate types ("host / host", ...).
        let ice_path = pair_ids.and_then(|(local_id, remote_id)| {
            let mut local = None;
            let mut remote = None;
            for (id, entry) in &report.reports {
                match entry {
                    StatsReportType::LocalCandidate(c) if *id == local_id => {
                        local = Some(c.candidate_type.to_string());
                    }
                    StatsReportType::RemoteCandidate(c) if *id == remote_id => {
                        remote = Some(c.candidate_type.to_string());
                    }
                    _ => {}
                }
            }
            match (local, remote) {
                (None, None) => None,
                (l, r) => Some(format!(
                    "{} / {}",
                    l.unwrap_or_else(|| "?".to_owned()),
                    r.unwrap_or_else(|| "?".to_owned())
                )),
            }
        });

        Some(ViewerStats {
            connection_state,
            rtt_ms,
            ice_path,
            videos,
        })
    }
}

impl StreamViewer {
    /// Build the recvonly peer mirroring the webview viewer's shape: two
    /// video transceivers (screen + optional camera; against a single-track
    /// broadcast the second m-line stays silent, so a camera added mid-share
    /// needs no renegotiation) and one audio transceiver.
    async fn build_peer(
        sink: &Arc<dyn ViewerSink>,
        stop: &Arc<AtomicBool>,
        video_ssrcs: &Arc<Mutex<Vec<u32>>>,
        mode: DeliveryMode,
    ) -> Result<Arc<RTCPeerConnection>, String> {
        let mut media = MediaEngine::default();
        media
            .register_default_codecs()
            .map_err(|e| format!("register_default_codecs: {e}"))?;
        let registry = register_default_interceptors(Registry::new(), &mut media)
            .map_err(|e| format!("register_default_interceptors: {e}"))?;
        // Loopback candidates for localhost servers - same reasoning as the
        // broadcaster peer (see broadcast.rs).
        let mut settings = SettingEngine::default();
        settings.set_include_loopback_candidate(true);
        let api = APIBuilder::new()
            .with_media_engine(media)
            .with_interceptor_registry(registry)
            .with_setting_engine(settings)
            .build();

        let config = RTCConfiguration {
            ice_servers: vec![RTCIceServer {
                urls: vec![
                    "stun:stun.l.google.com:19302".to_owned(),
                    "stun:stun1.l.google.com:19302".to_owned(),
                ],
                ..Default::default()
            }],
            ..Default::default()
        };
        let pc = Arc::new(
            api.new_peer_connection(config)
                .await
                .map_err(|e| format!("new_peer_connection: {e}"))?,
        );

        let recvonly = || {
            Some(RTCRtpTransceiverInit {
                direction: RTCRtpTransceiverDirection::Recvonly,
                send_encodings: vec![],
            })
        };
        for kind in [RTPCodecType::Video, RTPCodecType::Video, RTPCodecType::Audio] {
            let _transceiver = pc
                .add_transceiver_from_kind(kind, recvonly())
                .await
                .map_err(|e| format!("add_transceiver_from_kind: {e}"))?;
        }

        let track_sink = Arc::clone(sink);
        let track_stop = Arc::clone(stop);
        let track_ssrcs = Arc::clone(video_ssrcs);
        let pc_weak = Arc::downgrade(&pc);
        pc.on_track(Box::new(move |track, _receiver, transceiver| {
            let sink = Arc::clone(&track_sink);
            let stop = Arc::clone(&track_stop);
            let ssrcs = Arc::clone(&track_ssrcs);
            let pc_weak = Weak::clone(&pc_weak);
            Box::pin(async move {
                let mid = transceiver
                    .mid()
                    .map(|m| m.to_string())
                    .unwrap_or_default();
                if track.kind() != RTPCodecType::Video {
                    // No broadcast carries audio today; drain defensively so
                    // an SFU that does send some never backs the session up.
                    let _detached = tokio::spawn(drain_track(track));
                    return;
                }
                if let Ok(mut list) = ssrcs.lock() {
                    list.push(track.ssrc());
                }
                tracing::info!(
                    %mid,
                    ssrc = track.ssrc(),
                    ?mode,
                    "screenshare: native viewer video track started"
                );
                let _detached =
                    tokio::spawn(consume_video_track(track, mid, pc_weak, sink, stop, mode));
            })
        }));

        let state_sink = Arc::clone(sink);
        let state_stop = Arc::clone(stop);
        pc.on_peer_connection_state_change(Box::new(move |state| {
            let state_sink = Arc::clone(&state_sink);
            let stopped = state_stop.load(Ordering::SeqCst);
            Box::pin(async move {
                match state {
                    RTCPeerConnectionState::Connected => {
                        state_sink.on_state(ViewerState::Connected);
                    }
                    RTCPeerConnectionState::Failed | RTCPeerConnectionState::Disconnected
                        if !stopped =>
                    {
                        state_sink.on_state(ViewerState::Failed(format!("connection {state}")));
                    }
                    _ => {}
                }
            })
        }));

        Ok(pc)
    }
}

/// Read-and-discard loop for tracks we never render (audio).
async fn drain_track(track: Arc<TrackRemote>) {
    let mut buf = vec![0u8; 1600];
    while track.read(&mut buf).await.is_ok() {}
}

/// Send one PLI per video SSRC (embedder-driven keyframe recovery).
async fn send_plis(pc: Arc<RTCPeerConnection>, ssrcs: Vec<u32>) {
    for media_ssrc in ssrcs {
        let pli = PictureLossIndication {
            sender_ssrc: 0,
            media_ssrc,
        };
        if let Err(e) = pc.write_rtcp(&[Box::new(pli)]).await {
            tracing::debug!("screenshare: viewer PLI failed: {e}");
        }
    }
}

/// Monotonic microsecond timestamps from the (wrapping, 90 kHz) RTP clock.
/// Samples pop from the `SampleBuilder` in order, so deltas are forward.
struct RtpClock {
    last: Option<u32>,
    total_90k: u64,
}

impl RtpClock {
    fn new() -> Self {
        Self {
            last: None,
            total_90k: 0,
        }
    }

    fn micros(&mut self, rtp_ts: u32) -> u64 {
        if let Some(last) = self.last {
            self.total_90k += u64::from(rtp_ts.wrapping_sub(last));
        }
        self.last = Some(rtp_ts);
        self.total_90k * 1000 / 90
    }
}

/// The NAL units of one Annex-B access unit (3- and 4-byte start codes).
fn annexb_nals(au: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 <= au.len() {
        if au[i] == 0 && au[i + 1] == 0 && au[i + 2] == 1 {
            starts.push(i + 3);
            i += 3;
        } else if au[i] == 0 && au[i + 1] == 0 && au[i + 2] == 0 && au.get(i + 3) == Some(&1) {
            starts.push(i + 4);
            i += 4;
        } else {
            i += 1;
        }
    }
    let mut nals = Vec::with_capacity(starts.len());
    for (idx, &start) in starts.iter().enumerate() {
        // A NAL runs to the next start code, minus that code's leading
        // zeros (2 or 3 of them, right before the following start index).
        let end = match starts.get(idx + 1) {
            Some(&next_start) => {
                let mut end = next_start - 3; // the "...0 0 1" itself
                if end > start && au[end - 1] == 0 {
                    end -= 1; // 4-byte start code: one more zero
                }
                end
            }
            None => au.len(),
        };
        if end > start {
            nals.push(&au[start..end]);
        }
    }
    nals
}

/// One converted access unit (see [`AvccStream::convert`]).
struct AvccSample {
    /// A new `avcC` record when the parameter sets (re)appeared changed -
    /// deliver it before `data`.
    config: Option<Vec<u8>>,
    /// Length-prefixed (4-byte BE) NALs; SPS/PPS/AUD stripped (parameter
    /// sets live in the config, delimiters mean nothing in AVCC).
    data: Vec<u8>,
    /// The unit contains an IDR slice.
    keyframe: bool,
}

/// Annex-B -> AVCC converter for one track. `WebKit`'s `WebCodecs` decoder
/// only works with an AVCC `description` (its Annex-B mode errors on every
/// chunk), so the in-band SPS/PPS become an out-of-band `avcC` record and
/// samples get length prefixes - pure byte reshuffling, no parsing beyond
/// NAL headers.
struct AvccStream {
    sps: Option<Vec<u8>>,
    pps: Option<Vec<u8>>,
    /// The (SPS, PPS) pair the last emitted config was built from.
    configured: Option<(Vec<u8>, Vec<u8>)>,
}

impl AvccStream {
    fn new() -> Self {
        Self {
            sps: None,
            pps: None,
            configured: None,
        }
    }

    fn convert(&mut self, au: &[u8]) -> AvccSample {
        let mut data = Vec::with_capacity(au.len() + 8);
        let mut keyframe = false;
        for nal in annexb_nals(au) {
            match nal[0] & 0x1F {
                7 => self.sps = Some(nal.to_vec()),
                8 => self.pps = Some(nal.to_vec()),
                9 => {} // access-unit delimiter
                nal_type => {
                    keyframe |= nal_type == 5;
                    #[allow(
                        clippy::cast_possible_truncation,
                        reason = "a NAL cannot exceed u32 (bounded by the AU size)"
                    )]
                    data.extend_from_slice(&(nal.len() as u32).to_be_bytes());
                    data.extend_from_slice(nal);
                }
            }
        }
        let config = match (&self.sps, &self.pps) {
            (Some(sps), Some(pps))
                if self
                    .configured
                    .as_ref()
                    .is_none_or(|(s, p)| s != sps || p != pps) =>
            {
                self.configured = Some((sps.clone(), pps.clone()));
                Some(build_avcc(sps, pps))
            }
            _ => None,
        };
        AvccSample {
            config,
            data,
            keyframe,
        }
    }
}

/// Minimal `avcC` (`AVCDecoderConfigurationRecord`) from one SPS + PPS.
fn build_avcc(sps: &[u8], pps: &[u8]) -> Vec<u8> {
    #[allow(
        clippy::cast_possible_truncation,
        reason = "SPS/PPS sizes are far below u16"
    )]
    let (sps_len, pps_len) = (sps.len() as u16, pps.len() as u16);
    let mut avcc = Vec::with_capacity(11 + sps.len() + pps.len());
    avcc.push(1); // configurationVersion
    avcc.extend_from_slice(&sps[1..4]); // profile / compat / level
    avcc.push(0xFF); // 4-byte NAL length prefixes
    avcc.push(0xE1); // one SPS
    avcc.extend_from_slice(&sps_len.to_be_bytes());
    avcc.extend_from_slice(sps);
    avcc.push(1); // one PPS
    avcc.extend_from_slice(&pps_len.to_be_bytes());
    avcc.extend_from_slice(pps);
    avcc
}

/// Strategy: how one track's reassembled access units leave the viewer.
/// [`make_delivery`] is the factory selecting the concrete strategy from the
/// embedder's [`DeliveryMode`]; further modes (other codecs, other
/// transports) plug in here without touching the RTP consumption loop.
trait SampleDelivery: Send {
    /// Handle one access unit; `false` stops the track (sink gone).
    fn deliver(&mut self, sample: Sample) -> bool;
}

/// [`DeliveryMode::H264`]: Annex-B -> AVCC conversion, keyframe tagging,
/// `avcC` config emission - compressed pass-through, no pixel work.
struct H264PassThrough {
    mid: String,
    sink: Arc<dyn ViewerSink>,
    clock: RtpClock,
    avcc: AvccStream,
}

impl SampleDelivery for H264PassThrough {
    fn deliver(&mut self, sample: Sample) -> bool {
        let timestamp_us = self.clock.micros(sample.packet_timestamp);
        let converted = self.avcc.convert(&sample.data);
        if let Some(config) = converted.config {
            self.sink.on_decoder_config(&self.mid, config);
        }
        if converted.data.is_empty() {
            return true; // parameter sets only; nothing to decode
        }
        self.sink.on_frame(ViewerFrame {
            mid: self.mid.clone(),
            width: 0,
            height: 0,
            keyframe: converted.keyframe,
            timestamp_us,
            data: converted.data,
        });
        true
    }
}

/// [`DeliveryMode::Jpeg`]: hands samples to the dedicated openh264 + JPEG
/// thread (see [`decode_loop`]).
struct JpegTranscode {
    tx: std::sync::mpsc::Sender<Sample>,
}

impl SampleDelivery for JpegTranscode {
    fn deliver(&mut self, sample: Sample) -> bool {
        self.tx.send(sample).is_ok() // Err = the decode thread died
    }
}

/// Abstract factory for the per-track delivery strategy. The JPEG strategy
/// owns a decode thread, spawned here.
fn make_delivery(
    mode: DeliveryMode,
    mid: &str,
    sink: &Arc<dyn ViewerSink>,
    pli: &tokio::sync::mpsc::Sender<()>,
) -> Result<Box<dyn SampleDelivery>, String> {
    match mode {
        DeliveryMode::H264 => Ok(Box::new(H264PassThrough {
            mid: mid.to_owned(),
            sink: Arc::clone(sink),
            clock: RtpClock::new(),
            avcc: AvccStream::new(),
        })),
        DeliveryMode::Jpeg => {
            // Decode off the async runtime: openh264's decoder is a
            // thread-affine C object, and a 1080p decode+encode tick is
            // milliseconds of CPU that would stall the single-worker runtime.
            let (tx, rx) = std::sync::mpsc::channel::<Sample>();
            let sink = Arc::clone(sink);
            let mid = mid.to_owned();
            let pli = pli.clone();
            let _detached = std::thread::Builder::new()
                .name(format!("stream-view-decode-{mid}"))
                .spawn(move || decode_loop(&rx, &sink, &mid, &pli))
                .map_err(|e| format!("viewer decode thread: {e}"))?;
            Ok(Box::new(JpegTranscode { tx }))
        }
    }
}

/// RTP -> access units for one video track, handed to the track's
/// [`SampleDelivery`] strategy. Runs until the peer closes (read errors)
/// or the viewer stops.
async fn consume_video_track(
    track: Arc<TrackRemote>,
    mid: String,
    pc: Weak<RTCPeerConnection>,
    sink: Arc<dyn ViewerSink>,
    stop: Arc<AtomicBool>,
    mode: DeliveryMode,
) {
    // Rate-limited keyframe requests back to the SFU: the initial "we joined
    // mid-stream" request, plus decode failures in JPEG mode. (H.264-mode
    // decode failures arrive from the embedder via `request_keyframe`.)
    let (pli_tx, mut pli_rx) = tokio::sync::mpsc::channel::<()>(1);
    let media_ssrc = track.ssrc();
    let pli_pc = Weak::clone(&pc);
    let _pli_task = tokio::spawn(async move {
        let mut last = Instant::now() - PLI_INTERVAL;
        while pli_rx.recv().await.is_some() {
            if last.elapsed() < PLI_INTERVAL {
                continue;
            }
            let Some(pc) = pli_pc.upgrade() else { return };
            let pli = PictureLossIndication {
                sender_ssrc: 0,
                media_ssrc,
            };
            if let Err(e) = pc.write_rtcp(&[Box::new(pli)]).await {
                tracing::debug!("screenshare: viewer PLI failed: {e}");
            }
            last = Instant::now();
        }
    });
    // The SFU requests an initial keyframe per new viewer on its own, but a
    // PLI costs nothing and covers that one getting lost.
    let _ = pli_tx.try_send(());

    let mut delivery = match make_delivery(mode, &mid, &sink, &pli_tx) {
        Ok(delivery) => delivery,
        Err(e) => {
            tracing::warn!("screenshare: viewer delivery unavailable: {e}");
            return;
        }
    };

    // The SampleBuilder window must hold an ENTIRE access unit: a
    // 1920x1200 NVENC IDR is easily 100-300 KB = a few hundred RTP packets
    // (a 4K "Source" one, more), and a window smaller than one AU silently
    // drops every keyframe as "incomplete" - observed as `keyframes=1`
    // forever and an undecodable delta-only feed. 2048 packets (~2.4 MB)
    // covers 4K keyframes with room for genuine reordering on top.
    let mut samples = SampleBuilder::new(2048, H264Packet::default(), 90000);
    let mut buf = vec![0u8; 1600];
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let Ok((packet, _)) = track.read(&mut buf).await else {
            break; // peer closed or track ended
        };
        samples.push(packet);
        while let Some(sample) = samples.pop() {
            if !delivery.deliver(sample) {
                return; // delivery sink gone (decode thread died)
            }
        }
    }
    // Dropping the delivery (and any sample sender in it) ends the JPEG
    // strategy's decode thread.
}

/// JPEG fallback: decode every access unit (H.264 reference chains tolerate
/// no gaps), emit JPEG frames at most every [`EMIT_INTERVAL`], and ask for a
/// keyframe when decoding fails.
fn decode_loop(
    samples: &std::sync::mpsc::Receiver<Sample>,
    sink: &Arc<dyn ViewerSink>,
    mid: &str,
    pli: &tokio::sync::mpsc::Sender<()>,
) {
    use openh264::formats::YUVSource;

    let mut decoder = match openh264::decoder::Decoder::new() {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("screenshare: viewer H.264 decoder unavailable: {e}");
            return;
        }
    };
    let mut resizer = fast_image_resize::Resizer::new();
    let mut clock = RtpClock::new();
    let mut rgb: Vec<u8> = Vec::new();
    let mut last_emit = Instant::now() - EMIT_INTERVAL;

    for sample in samples.iter() {
        let timestamp_us = clock.micros(sample.packet_timestamp);
        let yuv = match decoder.decode(&sample.data) {
            Ok(Some(yuv)) => yuv,
            Ok(None) => continue, // decoder needs more input
            Err(e) => {
                tracing::debug!(%mid, "screenshare: viewer decode error ({e}); requesting keyframe");
                let _ = pli.try_send(());
                continue;
            }
        };
        if last_emit.elapsed() < EMIT_INTERVAL {
            continue;
        }
        let (w, h) = yuv.dimensions();
        #[allow(
            clippy::cast_possible_truncation,
            reason = "frame dimensions are bounded far below u32"
        )]
        let (w, h) = (w as u32, h as u32);
        if w == 0 || h == 0 {
            continue;
        }
        rgb.resize(w as usize * h as usize * 3, 0);
        yuv.write_rgb8(&mut rgb);

        let (out_w, out_h, out_rgb) = downscale_rgb(&mut resizer, &rgb, w, h);
        let mut jpeg = Vec::new();
        let encoder =
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY);
        if let Err(e) = image::ImageEncoder::write_image(
            encoder,
            &out_rgb,
            out_w,
            out_h,
            image::ExtendedColorType::Rgb8,
        ) {
            tracing::debug!("screenshare: viewer JPEG encode failed: {e}");
            continue;
        }
        last_emit = Instant::now();
        sink.on_frame(ViewerFrame {
            mid: mid.to_owned(),
            width: out_w,
            height: out_h,
            keyframe: true,
            timestamp_us,
            data: jpeg,
        });
    }
    tracing::debug!(%mid, "screenshare: viewer decode loop ended");
}

/// Downscale an RGB8 frame so its longest edge is at most [`MAX_VIEW_DIM`];
/// returns the input untouched when already small enough (or on failure).
fn downscale_rgb<'a>(
    resizer: &mut fast_image_resize::Resizer,
    rgb: &'a [u8],
    w: u32,
    h: u32,
) -> (u32, u32, std::borrow::Cow<'a, [u8]>) {
    let longest = w.max(h);
    if longest <= MAX_VIEW_DIM {
        return (w, h, std::borrow::Cow::Borrowed(rgb));
    }
    let scale = f64::from(MAX_VIEW_DIM) / f64::from(longest);
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "scaled dimensions stay positive and far below u32"
    )]
    let (nw, nh) = (
        (((f64::from(w) * scale) as u32).max(2)) & !1,
        (((f64::from(h) * scale) as u32).max(2)) & !1,
    );
    let Ok(src) = fast_image_resize::images::Image::from_vec_u8(
        w,
        h,
        rgb.to_vec(),
        fast_image_resize::PixelType::U8x3,
    ) else {
        return (w, h, std::borrow::Cow::Borrowed(rgb));
    };
    let mut dst = fast_image_resize::images::Image::new(nw, nh, fast_image_resize::PixelType::U8x3);
    let options = fast_image_resize::ResizeOptions::new().resize_alg(
        fast_image_resize::ResizeAlg::Convolution(fast_image_resize::FilterType::Box),
    );
    if let Err(e) = resizer.resize(&src, &mut dst, &options) {
        tracing::debug!("screenshare: viewer downscale failed: {e}");
        return (w, h, std::borrow::Cow::Borrowed(rgb));
    }
    (nw, nh, std::borrow::Cow::Owned(dst.into_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A keyframe AU (SPS + PPS + IDR, mixed start-code lengths) must yield
    /// an avcC config, a keyframe-flagged sample with ONLY the slice
    /// (length-prefixed), and no repeat config for an identical next AU.
    #[test]
    fn avcc_conversion() {
        let sps = [0x67, 0x42, 0xE0, 0x34, 0xAA];
        let idr_au = [
            0, 0, 0, 1, 0x67, 0x42, 0xE0, 0x34, 0xAA, // SPS
            0, 0, 1, 0x68, 0xBB, // PPS
            0, 0, 0, 1, 0x09, 0xF0, // AUD (stripped)
            0, 0, 0, 1, 0x65, 0xCC, 0xDD, // IDR slice
        ];
        let mut stream = AvccStream::new();
        let converted = stream.convert(&idr_au);
        assert!(converted.keyframe);
        assert_eq!(converted.data, [0, 0, 0, 3, 0x65, 0xCC, 0xDD]);
        let config = converted.config.expect("first keyframe must yield avcC");
        assert_eq!(config[0], 1);
        assert_eq!(&config[1..4], &sps[1..4]); // profile/compat/level
        assert_eq!(&config[8..13], &sps); // embedded SPS

        // Same parameter sets again: no config repeat, delta stays delta.
        let delta_au = [0, 0, 0, 1, 0x41, 0x11];
        let converted = stream.convert(&delta_au);
        assert!(converted.config.is_none());
        assert!(!converted.keyframe);
        assert_eq!(converted.data, [0, 0, 0, 2, 0x41, 0x11]);

        // Changed SPS: a fresh config is emitted.
        let new_sps_au = [
            0, 0, 0, 1, 0x67, 0x42, 0xE0, 0x1F, 0xAB, // different SPS
            0, 0, 1, 0x68, 0xBB, // PPS
            0, 0, 0, 1, 0x65, 0xEE, // IDR
        ];
        let converted = stream.convert(&new_sps_au);
        assert!(converted.config.is_some());
        assert!(converted.keyframe);
    }

    /// The RTP clock must survive u32 wraparound with monotonic output.
    #[test]
    fn rtp_clock_unwraps() {
        let mut clock = RtpClock::new();
        let start = u32::MAX - 45_000; // half a second before wrap
        let t0 = clock.micros(start);
        let t1 = clock.micros(start.wrapping_add(90_000)); // +1 s, wraps
        assert_eq!(t0, 0);
        assert_eq!(t1, 1_000_000);
    }
}
