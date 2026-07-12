//! The broadcaster peer: capture -> encode -> WebRTC to the server SFU.
//!
//! [`ScreenBroadcaster`] owns the whole chain for one broadcast:
//!
//! ```text
//! capture thread                            dedicated tokio runtime
//!   EncodePipeline (per-OS backend) ──► track.write_sample ──► RTP/SRTP ──► SFU
//!         ▲                   RTCP PLI/FIR ──► keyframe flag ──┘
//! ```
//!
//! The capture/encode work itself lives behind [`crate::pipeline`]'s
//! [`crate::pipeline::EncodePipeline`] trait (GPU backends per OS, CPU
//! fallback everywhere); this module only orchestrates: frame pacing, RTP
//! timestamping, keyframe scheduling and the WebRTC peer.
//!
//! Signaling is inverted: the embedder passes a [`SignalSink`] which receives
//! the SDP offer and trickled ICE candidates (to be delivered to the server
//! as Mumble `WebRtcSignal` messages), and feeds the server's SDP answer back
//! via [`ScreenBroadcaster::accept_answer`]. This keeps the crate free of any
//! protocol / frontend dependency so the Tauri and Qt clients share it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::runtime::Runtime;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_H264};
use webrtc::api::setting_engine::SettingEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::media::Sample;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtcp::payload_feedbacks::full_intra_request::FullIntraRequest;
use webrtc::rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::rtp_transceiver::rtp_transceiver_direction::RTCRtpTransceiverDirection;
use webrtc::rtp_transceiver::RTCRtpTransceiverInit;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

use crate::encode::EncodeSettings;
use crate::pipeline::{create_pipeline, EncodePipeline};
use crate::sources::{self, SourceKind};

/// Interval between unsolicited keyframes. Late-joining viewers trigger a
/// PLI through the SFU anyway; this is a safety net against a lost PLI.
const PERIODIC_KEYFRAME: Duration = Duration::from_secs(4);

/// Lifecycle notifications delivered to the embedder via [`SignalSink`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BroadcastState {
    /// Offer sent; waiting for the answer / ICE to complete.
    Connecting,
    /// Media is flowing to the SFU.
    Connected,
    /// The broadcast ended abnormally (capture lost, ICE failed, ...).
    Failed(String),
    /// The broadcast was stopped by the embedder.
    Stopped,
}

/// Outbound signaling + lifecycle events, implemented by the embedder.
///
/// Calls may arrive from the broadcaster's internal runtime or the capture
/// thread; implementations must be cheap and non-blocking.
pub trait SignalSink: Send + Sync + 'static {
    /// Deliver our SDP offer to the server (Mumble `SDP_OFFER`, target 0).
    fn send_offer(&self, sdp: String);
    /// Deliver one trickled ICE candidate as browser-compatible JSON
    /// (`{"candidate": ..., "sdpMid": ..., "sdpMLineIndex": ...}`).
    fn send_ice_candidate(&self, candidate_json: String);
    /// Lifecycle notification (connected, failed, ...).
    fn on_state(&self, state: BroadcastState);
}

/// One active screen broadcast. Dropping it stops everything.
pub struct ScreenBroadcaster {
    runtime: Option<Runtime>,
    pc: Arc<RTCPeerConnection>,
    stop: Arc<AtomicBool>,
    awaiting_answer: Arc<AtomicBool>,
    capture_thread: Option<std::thread::JoinHandle<()>>,
    sink: Arc<dyn SignalSink>,
    /// The source being captured, for embedders that need to locate it
    /// on screen (e.g. to pin an overlay window over the shared content).
    source: (SourceKind, u32),
}

impl std::fmt::Debug for ScreenBroadcaster {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ScreenBroadcaster")
            .field("awaiting_answer", &self.awaiting_answer.load(Ordering::SeqCst))
            .finish_non_exhaustive()
    }
}

impl ScreenBroadcaster {
    /// Start broadcasting the given source. Sends the SDP offer through
    /// `sink` before returning; the embedder must route the server's answer
    /// back via [`Self::accept_answer`].
    pub fn start(
        kind: SourceKind,
        source_id: u32,
        settings: EncodeSettings,
        sink: Arc<dyn SignalSink>,
    ) -> Result<Self, String> {
        // Fail fast (and cheaply) when the source is already gone. The
        // capture thread resolves its own long-lived handle - xcap handles
        // are not Send, so they cannot cross the thread boundary.
        let _probe = sources::capture_frame(kind, source_id)?;

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .map_err(|e| format!("broadcast runtime: {e}"))?;

        let stop = Arc::new(AtomicBool::new(false));
        let awaiting_answer = Arc::new(AtomicBool::new(false));

        let (pc, track) = runtime.block_on(Self::build_peer(&sink, &stop))?;

        // Trickle the offer out.
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
        sink.on_state(BroadcastState::Connecting);
        sink.send_offer(offer_sdp.clone());

        // The Mumble control channel silently rate-limits (per-user leaky
        // bucket shared with every other message the client sends), so the
        // offer can be dropped without any error. Re-send it until the
        // answer clears `awaiting_answer`; duplicates just make the SFU
        // re-answer the same offer.
        let retry_sink = Arc::clone(&sink);
        let retry_awaiting = Arc::clone(&awaiting_answer);
        let _retry = runtime.spawn(async move {
            for attempt in 2..=5u32 {
                tokio::time::sleep(Duration::from_millis(1500)).await;
                if !retry_awaiting.load(Ordering::SeqCst) {
                    return;
                }
                tracing::info!(attempt, "screenshare: re-sending unanswered SDP offer");
                retry_sink.send_offer(offer_sdp.clone());
            }
        });

        let capture_thread = Self::spawn_capture_thread(
            kind,
            source_id,
            settings,
            track,
            Arc::clone(&stop),
            Arc::clone(&sink),
            runtime.handle().clone(),
            Self::spawn_keyframe_listener(&runtime, &pc),
        );

        Ok(Self {
            runtime: Some(runtime),
            pc,
            stop,
            awaiting_answer,
            capture_thread: Some(capture_thread),
            sink,
            source: (kind, source_id),
        })
    }

    /// The capture source this broadcast is streaming.
    pub fn source(&self) -> (SourceKind, u32) {
        self.source
    }

    /// Whether the broadcaster has sent an offer and not yet received the
    /// answer. Used by the embedder's signal router to decide whether an
    /// incoming `SDP_ANSWER` belongs to this broadcaster.
    pub fn awaiting_answer(&self) -> bool {
        self.awaiting_answer.load(Ordering::SeqCst)
    }

    /// Apply the server's SDP answer. Clears [`Self::awaiting_answer`].
    pub fn accept_answer(&self, sdp: String) {
        self.awaiting_answer.store(false, Ordering::SeqCst);
        let pc = Arc::clone(&self.pc);
        let sink = Arc::clone(&self.sink);
        if let Some(rt) = &self.runtime {
            let _ = rt.spawn(async move {
                let answer = match RTCSessionDescription::answer(sdp) {
                    Ok(a) => a,
                    Err(e) => {
                        sink.on_state(BroadcastState::Failed(format!("bad answer: {e}")));
                        return;
                    }
                };
                if let Err(e) = pc.set_remote_description(answer).await {
                    sink.on_state(BroadcastState::Failed(format!("set_remote_description: {e}")));
                }
            });
        }
    }

    /// Apply a trickled remote ICE candidate (browser-compatible JSON).
    pub fn add_remote_ice(&self, candidate_json: &str) {
        let Ok(init) = serde_json::from_str::<RTCIceCandidateInit>(candidate_json) else {
            tracing::warn!("screenshare: ignoring malformed remote ICE candidate");
            return;
        };
        let pc = Arc::clone(&self.pc);
        if let Some(rt) = &self.runtime {
            let _ = rt.spawn(async move {
                if let Err(e) = pc.add_ice_candidate(init).await {
                    tracing::warn!("screenshare: add_ice_candidate failed: {e}");
                }
            });
        }
    }

    /// Stop the broadcast: halts capture, closes the peer connection and
    /// shuts the internal runtime down. Idempotent.
    pub fn stop(&mut self) {
        if self.stop.swap(true, Ordering::SeqCst) {
            return;
        }
        self.awaiting_answer.store(false, Ordering::SeqCst);
        if let Some(t) = self.capture_thread.take() {
            let _ = t.join();
        }
        if let Some(rt) = self.runtime.take() {
            let pc = Arc::clone(&self.pc);
            rt.block_on(async move {
                let _ = pc.close().await;
            });
            // Background shutdown: never block the caller on lingering tasks.
            rt.shutdown_background();
        }
        self.sink.on_state(BroadcastState::Stopped);
    }

    // -- internals --------------------------------------------------------

    /// Build the peer connection with an H.264 sample track and wire ICE /
    /// connection-state callbacks to the sink.
    async fn build_peer(
        sink: &Arc<dyn SignalSink>,
        stop: &Arc<AtomicBool>,
    ) -> Result<(Arc<RTCPeerConnection>, Arc<TrackLocalStaticSample>), String> {
        let mut media = MediaEngine::default();
        media
            .register_default_codecs()
            .map_err(|e| format!("register_default_codecs: {e}"))?;
        let registry = register_default_interceptors(Registry::new(), &mut media)
            .map_err(|e| format!("register_default_interceptors: {e}"))?;
        // webrtc-ice skips loopback interfaces when gathering by default, so
        // against a server on localhost (whose ICE-lite answer carries a
        // 127.0.0.1 host candidate) it forms no pair that can reach it and
        // never sends a single connectivity check. Loopback candidates are
        // never signalled anywhere (we send no trickle at all) and never win
        // pairing against a remote server, so enabling them is free there
        // and essential locally.
        let mut settings = SettingEngine::default();
        settings.set_include_loopback_candidate(true);
        let api = APIBuilder::new()
            .with_media_engine(media)
            .with_interceptor_registry(registry)
            .with_setting_engine(settings)
            .build();

        // Same STUN set the web frontend used; the SFU itself is ICE-lite.
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

        let track = Arc::new(TrackLocalStaticSample::new(
            RTCRtpCodecCapability {
                mime_type: MIME_TYPE_H264.to_owned(),
                clock_rate: 90000,
                sdp_fmtp_line:
                    "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"
                        .to_owned(),
                ..Default::default()
            },
            "video".to_owned(),
            "fancy-screenshare".to_owned(),
        ));
        // Offer the track SENDONLY (add_track would offer sendrecv): we never
        // receive media on this peer, and the SFU (str0m) mirrors the offered
        // direction, so this is what makes its answer say `a=recvonly` - the
        // exact property the embedder's signal router uses to tell the
        // broadcaster's answer apart from viewer answers.
        let _transceiver = pc
            .add_transceiver_from_track(
                Arc::clone(&track) as Arc<_>,
                Some(RTCRtpTransceiverInit {
                    direction: RTCRtpTransceiverDirection::Sendonly,
                    send_encodings: vec![],
                }),
            )
            .await
            .map_err(|e| format!("add_transceiver_from_track: {e}"))?;

        let ice_sink = Arc::clone(sink);
        pc.on_ice_candidate(Box::new(move |candidate| {
            let ice_sink = Arc::clone(&ice_sink);
            Box::pin(async move {
                let Some(candidate) = candidate else { return };
                match candidate.to_json() {
                    Ok(init) => match serde_json::to_string(&init) {
                        Ok(json) => ice_sink.send_ice_candidate(json),
                        Err(e) => tracing::warn!("screenshare: ICE serialize failed: {e}"),
                    },
                    Err(e) => tracing::warn!("screenshare: candidate.to_json failed: {e}"),
                }
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
                        state_sink.on_state(BroadcastState::Connected);
                    }
                    RTCPeerConnectionState::Failed | RTCPeerConnectionState::Disconnected
                        if !stopped =>
                    {
                        state_sink
                            .on_state(BroadcastState::Failed(format!("connection {state}")));
                    }
                    _ => {}
                }
            })
        }));

        Ok((pc, track))
    }

    /// Listen for RTCP PLI/FIR from the SFU and flag a keyframe request.
    /// Returns the shared flag the capture loop polls.
    fn spawn_keyframe_listener(runtime: &Runtime, pc: &Arc<RTCPeerConnection>) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        let senders_pc = Arc::clone(pc);
        let listener_flag = Arc::clone(&flag);
        let _ = runtime.spawn(async move {
            for sender in senders_pc.get_senders().await {
                let flag = Arc::clone(&listener_flag);
                let _ = tokio::spawn(async move {
                    while let Ok((packets, _)) = sender.read_rtcp().await {
                        for packet in packets {
                            let any = packet.as_any();
                            if any.downcast_ref::<PictureLossIndication>().is_some()
                                || any.downcast_ref::<FullIntraRequest>().is_some()
                            {
                                flag.store(true, Ordering::SeqCst);
                            }
                        }
                    }
                });
            }
        });
        flag
    }

    /// The blocking capture -> encode -> write loop on its own OS thread.
    #[allow(clippy::too_many_arguments, reason = "pipeline wiring; grouping would add a one-use struct")]
    fn spawn_capture_thread(
        kind: SourceKind,
        source_id: u32,
        settings: EncodeSettings,
        track: Arc<TrackLocalStaticSample>,
        stop: Arc<AtomicBool>,
        sink: Arc<dyn SignalSink>,
        rt: tokio::runtime::Handle,
        keyframe_flag: Arc<AtomicBool>,
    ) -> std::thread::JoinHandle<()> {
        let thread_sink = Arc::clone(&sink);
        std::thread::Builder::new()
            .name("screenshare-capture".into())
            .spawn(move || {
                capture_loop(
                    kind, source_id, settings, &track, &stop, &thread_sink, &rt, &keyframe_flag,
                );
            })
            .unwrap_or_else(|e| {
                // Spawning a thread only fails under resource exhaustion; the
                // broadcast cannot work, report and return a dummy handle.
                sink.on_state(BroadcastState::Failed(format!("capture thread: {e}")));
                std::thread::spawn(|| {})
            })
    }
}

impl Drop for ScreenBroadcaster {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Body of the capture thread (see [`ScreenBroadcaster::spawn_capture_thread`]):
/// pure orchestration over the selected [`EncodePipeline`] backend - frame
/// pacing, keyframe scheduling, real-elapsed RTP timestamping and the track
/// writes. Which backend runs (per-OS GPU or portable CPU) is decided by
/// [`create_pipeline`].
fn capture_loop(
    kind: SourceKind,
    source_id: u32,
    settings: EncodeSettings,
    track: &TrackLocalStaticSample,
    stop: &AtomicBool,
    sink: &Arc<dyn SignalSink>,
    rt: &tokio::runtime::Handle,
    keyframe_flag: &AtomicBool,
) {
    let mut pipeline: Box<dyn EncodePipeline> = match create_pipeline(kind, source_id, settings) {
        Ok(p) => p,
        Err(e) => {
            sink.on_state(BroadcastState::Failed(format!("capture source vanished: {e}")));
            return;
        }
    };
    tracing::info!(backend = pipeline.name(), "screenshare: capture pipeline selected");

    let frame_interval = Duration::from_secs_f32(1.0 / settings.max_fps.max(1.0));
    let mut last_keyframe = Instant::now();
    let mut last_sample_at: Option<Instant> = None;

    while !stop.load(Ordering::SeqCst) {
        let tick_start = Instant::now();

        let force = keyframe_flag.swap(false, Ordering::SeqCst)
            || last_keyframe.elapsed() >= PERIODIC_KEYFRAME;
        match pipeline.next_frame(frame_interval.max(Duration::from_millis(100)), force) {
            Ok(Some(frame)) => {
                if frame.keyframe {
                    last_keyframe = Instant::now();
                }
                // RTP timestamps must advance by the REAL elapsed time.
                // Stamping the nominal 1/max_fps duration while the pipeline
                // runs slower makes frames arrive later than their timestamps
                // claim, so the receiver's jitter buffer backs up without
                // bound - playback crawls and the delay grows by the minute.
                let now = Instant::now();
                let duration = match last_sample_at.replace(now) {
                    Some(prev) => now.duration_since(prev).max(Duration::from_millis(1)),
                    None => frame_interval,
                };
                let sample = Sample {
                    data: frame.data.into(),
                    duration,
                    ..Default::default()
                };
                if rt.block_on(track.write_sample(&sample)).is_err()
                    && !stop.load(Ordering::SeqCst)
                {
                    tracing::warn!("screenshare: write_sample failed");
                }
            }
            Ok(None) => {}
            Err(e) => {
                tracing::warn!("screenshare: pipeline failed ({e}); ending broadcast");
                sink.on_state(BroadcastState::Failed(e));
                break;
            }
        }

        let elapsed = tick_start.elapsed();
        if elapsed < frame_interval {
            std::thread::sleep(frame_interval - elapsed);
        }
    }

    pipeline.shutdown();
}
