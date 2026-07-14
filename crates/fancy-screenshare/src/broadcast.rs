//! The broadcaster peer: capture -> encode -> WebRTC to the server SFU.
//!
//! [`ScreenBroadcaster`] owns the whole chain for one broadcast, which may
//! carry SEVERAL video tracks over the single peer connection (screen +
//! camera). Each source gets its own capture thread and H.264 track; the
//! SFU forwards tracks by their SDP mid, which is the source's index in the
//! order passed to [`ScreenBroadcaster::start`] ("0", "1", ...):
//!
//! ```text
//! capture thread (per source)               dedicated tokio runtime
//!   EncodePipeline (per-OS backend) ──► track.write_sample ──► RTP/SRTP ──► SFU
//!         ▲               RTCP PLI/FIR ──► per-track keyframe flag ──┘
//! ```
//!
//! The capture/encode work itself lives behind [`crate::pipeline`]'s
//! [`crate::pipeline::EncodePipeline`] trait (GPU backends per OS, CPU
//! fallback everywhere, cameras via [`crate::camera`]); this module only
//! orchestrates: frame pacing, RTP timestamping, keyframe scheduling and
//! the WebRTC peer.
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

use crate::encode::{EncodeSettings, EncodedFrame};
use crate::pipeline::{create_pipeline, EncodePipeline};
use crate::sources::{self, SourceKind};

/// Interval between unsolicited keyframes. This is ONLY a safety net against
/// a lost PLI: the SFU already requests an initial keyframe for every new
/// viewer and forwards rate-limited PLIs per track, so keyframes are
/// demand-driven. Keep this LONG - a desktop-resolution IDR is a
/// multi-hundred-KB burst, and at the old 4 s cadence those bursts caused a
/// receiver-visible stall (~250 ms "freeze") every 4 s on real uplinks.
const PERIODIC_KEYFRAME: Duration = Duration::from_secs(20);

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

/// One source in a broadcast (what to capture).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BroadcastSource {
    /// Screen, window or camera.
    pub kind: SourceKind,
    /// Backend-native source id (see [`crate::sources`]).
    pub id: u32,
}

/// One active broadcast (any number of tracks). Dropping it stops everything.
pub struct ScreenBroadcaster {
    runtime: Option<Runtime>,
    pc: Arc<RTCPeerConnection>,
    stop: Arc<AtomicBool>,
    awaiting_answer: Arc<AtomicBool>,
    capture_threads: Vec<std::thread::JoinHandle<()>>,
    sink: Arc<dyn SignalSink>,
    /// The sources being captured, in track (mid) order.
    sources: Vec<BroadcastSource>,
}

impl std::fmt::Debug for ScreenBroadcaster {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ScreenBroadcaster")
            .field("sources", &self.sources)
            .field("awaiting_answer", &self.awaiting_answer.load(Ordering::SeqCst))
            .finish_non_exhaustive()
    }
}

impl ScreenBroadcaster {
    /// Start broadcasting the given sources (one video track each, mids
    /// assigned in list order). Sends the SDP offer through `sink` before
    /// returning; the embedder must route the server's answer back via
    /// [`Self::accept_answer`].
    pub fn start(
        sources: Vec<BroadcastSource>,
        settings: EncodeSettings,
        sink: Arc<dyn SignalSink>,
    ) -> Result<Self, String> {
        if sources.is_empty() {
            return Err("no sources to broadcast".to_owned());
        }
        // Fail fast (and cheaply) when a source is already gone. The capture
        // threads resolve their own long-lived handles - xcap and camera
        // handles are not Send, so they cannot cross the thread boundary.
        // Cameras get an existence check only: a full open-grab-close probe
        // would add hundreds of ms and flash the LED before capture starts.
        for source in &sources {
            match source.kind {
                SourceKind::Device => crate::camera::device_exists(source.id)?,
                _ => {
                    let _probe = sources::capture_frame(source.kind, source.id)?;
                }
            }
        }

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .map_err(|e| format!("broadcast runtime: {e}"))?;

        let stop = Arc::new(AtomicBool::new(false));
        let awaiting_answer = Arc::new(AtomicBool::new(false));

        let (pc, tracks) = runtime.block_on(Self::build_peer(&sink, &stop, sources.len()))?;

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

        // One RTCP keyframe flag per track: a viewer's PLI for the camera
        // track must not force IDRs on the (much more expensive) screen track.
        let keyframe_flags = Self::spawn_keyframe_listener(&runtime, &pc, sources.len());

        let capture_threads = sources
            .iter()
            .zip(tracks)
            .zip(keyframe_flags)
            .map(|((source, track), keyframe_flag)| {
                // The user's stream settings are display-oriented; the
                // "screen share" text mode caps at 5 fps, which would turn a
                // CAMERA track into a slideshow. A webcam never benefits from
                // that trade (its content is motion, its resolution is small),
                // so floor camera tracks at 30 fps - a camera can't exceed its
                // own delivery rate anyway, and user-chosen HIGHER caps stay.
                let settings = if source.kind == SourceKind::Device {
                    EncodeSettings { max_fps: settings.max_fps.max(30.0), ..settings }
                } else {
                    settings
                };
                Self::spawn_capture_thread(
                    *source,
                    settings,
                    track,
                    Arc::clone(&stop),
                    &sink,
                    runtime.handle().clone(),
                    keyframe_flag,
                )
            })
            .collect();

        Ok(Self {
            runtime: Some(runtime),
            pc,
            stop,
            awaiting_answer,
            capture_threads,
            sink,
            sources,
        })
    }

    /// The capture sources this broadcast is streaming, in track (mid) order.
    pub fn sources(&self) -> &[BroadcastSource] {
        &self.sources
    }

    /// Number of video tracks (= SDP m-sections) this broadcast offers.
    pub fn track_count(&self) -> usize {
        self.sources.len()
    }

    /// The desktop source (screen or window) this broadcast captures, if
    /// any - for embedders that need to locate shared content on screen
    /// (e.g. to pin an overlay window over it). Cameras have no desktop
    /// location and are skipped.
    pub fn display_source(&self) -> Option<(SourceKind, u32)> {
        self.sources
            .iter()
            .find(|s| s.kind != SourceKind::Device)
            .map(|s| (s.kind, s.id))
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
            let _detached = rt.spawn(async move {
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
            let _detached = rt.spawn(async move {
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
        for t in self.capture_threads.drain(..) {
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

    /// Build the peer connection with `track_count` H.264 sample tracks and
    /// wire ICE / connection-state callbacks to the sink.
    async fn build_peer(
        sink: &Arc<dyn SignalSink>,
        stop: &Arc<AtomicBool>,
        track_count: usize,
    ) -> Result<(Arc<RTCPeerConnection>, Vec<Arc<TrackLocalStaticSample>>), String> {
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

        // One H.264 track per source. Transceivers are added in source order,
        // which is what assigns the SDP mids "0", "1", ... - the contract the
        // SFU's mid-based forwarding and the viewers' track labeling rely on.
        let mut tracks = Vec::with_capacity(track_count);
        for i in 0..track_count {
            let track = Arc::new(TrackLocalStaticSample::new(
                RTCRtpCodecCapability {
                    mime_type: MIME_TYPE_H264.to_owned(),
                    clock_rate: 90000,
                    // profile-level-id=42e0_34_: Constrained Baseline, LEVEL 5.2.
                    // The level MUST cover the largest frame/rate we actually
                    // send. The encoder emits a conformant SPS at the stream's
                    // true level (~5.0 for a 1200x1920 share, higher for a
                    // native 4K "Source" share); advertising the old level 3.1
                    // (0x1f, a 720p@30 ceiling) under-provisions the receiver's
                    // decoder, and a decoder sized for 3.1 that then meets a
                    // level-5 SPS commonly bails to a SOFTWARE fallback - which
                    // drops frames on high-res/fps content even on GPUs that
                    // decode 4K fine. 5.2 (0x34) covers up to 4K@60. With
                    // level-asymmetry-allowed=1 this is a pure capability
                    // ceiling and harmless for smaller streams.
                    sdp_fmtp_line:
                        "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e034"
                            .to_owned(),
                    ..Default::default()
                },
                format!("video{i}"),
                "fancy-screenshare".to_owned(),
            ));
            // Offer the track SENDONLY (add_track would offer sendrecv): we
            // never receive media on this peer, and the SFU (str0m) mirrors
            // the offered direction, so this is what makes its answer say
            // `a=recvonly` - the exact property the embedder's signal router
            // uses to tell the broadcaster's answer apart from viewer answers.
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
            tracks.push(track);
        }

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

        Ok((pc, tracks))
    }

    /// Listen for RTCP PLI/FIR from the SFU and flag keyframe requests.
    /// Returns one flag per track (sender order == transceiver add order ==
    /// source order), each polled by its own capture loop.
    #[allow(
        clippy::excessive_nesting,
        reason = "spawn -> per-sender task -> RTCP read loop -> packet demux is the natural shape"
    )]
    fn spawn_keyframe_listener(
        runtime: &Runtime,
        pc: &Arc<RTCPeerConnection>,
        track_count: usize,
    ) -> Vec<Arc<AtomicBool>> {
        let flags: Vec<Arc<AtomicBool>> =
            (0..track_count).map(|_| Arc::new(AtomicBool::new(false))).collect();
        let senders_pc = Arc::clone(pc);
        let listener_flags = flags.clone();
        let _detached = runtime.spawn(async move {
            for (sender, flag) in senders_pc.get_senders().await.into_iter().zip(listener_flags) {
                let _detached = tokio::spawn(async move {
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
        flags
    }

    /// The blocking capture -> encode -> write loop on its own OS thread.
    fn spawn_capture_thread(
        source: BroadcastSource,
        settings: EncodeSettings,
        track: Arc<TrackLocalStaticSample>,
        stop: Arc<AtomicBool>,
        sink: &Arc<dyn SignalSink>,
        rt: tokio::runtime::Handle,
        keyframe_flag: Arc<AtomicBool>,
    ) -> std::thread::JoinHandle<()> {
        let thread_sink = Arc::clone(sink);
        let sink = Arc::clone(sink);
        std::thread::Builder::new()
            .name("screenshare-capture".into())
            .spawn(move || {
                capture_loop(source, settings, &track, &stop, &thread_sink, &rt, &keyframe_flag);
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

/// Send-leg accounting for the capture loop: RTP-timestamped `write_sample`,
/// its timing distribution, and sender-gap detection - all rolled up into a
/// 5 s log. A gap between EMITTED frames past the receiver freeze threshold
/// (~150 ms) is a visible stutter, so each is logged with `produce_ms` (time
/// spent inside `next_frame`: capture+convert+encode+collect) and its keyframe
/// flag, which localises the stall (large `produce_ms` => pipeline stalled).
struct SendLeg {
    last_sample_at: Option<Instant>,
    write_total: Duration,
    write_max: Duration,
    write_count: u32,
    write_window: Instant,
    gap_max: Duration,
    gap_over: u32,
    keyframes: u32,
    frame_interval: Duration,
}

impl SendLeg {
    fn new(frame_interval: Duration) -> Self {
        Self {
            last_sample_at: None,
            write_total: Duration::ZERO,
            write_max: Duration::ZERO,
            write_count: 0,
            write_window: Instant::now(),
            gap_max: Duration::ZERO,
            gap_over: 0,
            keyframes: 0,
            frame_interval,
        }
    }

    /// Write one produced frame to the track, recording gap/timing stats and
    /// emitting the rolling 5 s log. `gap` is the interval since the previous
    /// emit; `produce_took` is how long `next_frame` ran for this frame.
    fn emit(
        &mut self,
        frame: EncodedFrame,
        gap: Duration,
        produce_took: Duration,
        track: &TrackLocalStaticSample,
        rt: &tokio::runtime::Handle,
        stop: &AtomicBool,
    ) {
        self.gap_max = self.gap_max.max(gap);
        if frame.keyframe {
            self.keyframes += 1;
        }
        if gap > Duration::from_millis(150) {
            self.gap_over += 1;
            tracing::debug!(
                gap_ms = gap.as_millis() as u64,
                produce_ms = produce_took.as_millis() as u64,
                keyframe = frame.keyframe,
                bytes = frame.data.len(),
                "screenshare: sender frame gap",
            );
        }
        // RTP timestamps must advance by the REAL elapsed time. Stamping the
        // nominal 1/max_fps duration while the pipeline runs slower makes frames
        // arrive later than their timestamps claim, so the receiver's jitter
        // buffer backs up without bound - playback crawls and delay grows.
        let now = Instant::now();
        let duration = match self.last_sample_at.replace(now) {
            Some(prev) => now.duration_since(prev).max(Duration::from_millis(1)),
            None => self.frame_interval,
        };
        let bytes = frame.data.len();
        let sample = Sample { data: frame.data.into(), duration, ..Default::default() };
        let write_start = Instant::now();
        if rt.block_on(track.write_sample(&sample)).is_err() && !stop.load(Ordering::SeqCst) {
            tracing::warn!("screenshare: write_sample failed");
        }
        let took = write_start.elapsed();
        self.write_total += took;
        self.write_max = self.write_max.max(took);
        self.write_count += 1;
        if took > Duration::from_millis(100) {
            tracing::debug!(ms = took.as_millis() as u64, bytes, "screenshare: write_sample stalled");
        }
        if self.write_window.elapsed() >= Duration::from_secs(5) {
            tracing::debug!(
                frames = self.write_count,
                avg_ms = (self.write_total.as_millis() as u64) / u64::from(self.write_count.max(1)),
                max_ms = self.write_max.as_millis() as u64,
                gap_max_ms = self.gap_max.as_millis() as u64,
                gaps_over_150 = self.gap_over,
                keyframes = self.keyframes,
                "screenshare: send-leg timings",
            );
            self.write_total = Duration::ZERO;
            self.write_max = Duration::ZERO;
            self.write_count = 0;
            self.gap_max = Duration::ZERO;
            self.gap_over = 0;
            self.keyframes = 0;
            self.write_window = Instant::now();
        }
    }
}

/// Body of a capture thread (see [`ScreenBroadcaster::spawn_capture_thread`]):
/// pure orchestration over the selected [`EncodePipeline`] backend - frame
/// pacing, keyframe scheduling, real-elapsed RTP timestamping and the track
/// writes. Which backend runs (per-OS GPU, portable CPU, or camera) is
/// decided by [`create_pipeline`]. A failing source fails the WHOLE
/// broadcast (the embedder tears down and reports), keeping partial-share
/// states out of the UI.
fn capture_loop(
    source: BroadcastSource,
    settings: EncodeSettings,
    track: &TrackLocalStaticSample,
    stop: &AtomicBool,
    sink: &Arc<dyn SignalSink>,
    rt: &tokio::runtime::Handle,
    keyframe_flag: &AtomicBool,
) {
    let mut pipeline: Box<dyn EncodePipeline> =
        match create_pipeline(source.kind, source.id, settings) {
            Ok(p) => p,
            Err(e) => {
                sink.on_state(BroadcastState::Failed(format!("capture source vanished: {e}")));
                return;
            }
        };
    tracing::info!(backend = pipeline.name(), "screenshare: capture pipeline selected");

    let frame_interval = Duration::from_secs_f32(1.0 / settings.max_fps.max(1.0));
    let mut last_keyframe = Instant::now();
    let mut send_leg = SendLeg::new(frame_interval);

    // Gap-fill keep-alive. Change-driven capture (WGC) emits nothing while the
    // screen is still, so a pause leaves a hole in the sent stream; a hole
    // past the receiver's freeze threshold (~max(3*interval, interval+150ms),
    // i.e. ~150-175 ms) is counted as a FREEZE even at 0% packet loss and fast
    // (hardware, ~0.5 ms/frame) decode - the actual cause of the stutter. So
    // when a frame interval yields nothing we re-encode the last picture as a
    // (tiny) P-frame to hold the cadence. This must be shorter than the freeze
    // threshold, hence ~90 ms.
    //
    // Only the REPEAT threshold is lowered - `next_frame`'s wait stays at the
    // 100 ms floor. A diagnostic proved that shortening the wait toward one
    // frame interval starves the async encoder (49 fps -> 15 fps, gaps p99
    // 25 ms -> 225 ms); the 100 ms wait keeps full throughput on active
    // content (where `next_frame` returns real frames well before it), and the
    // repeat only fires when it genuinely returns None (a true idle gap), so
    // there is no double-submit into a busy encoder.
    const IDLE_REPEAT: Duration = Duration::from_millis(90);
    let mut last_emit = Instant::now();

    while !stop.load(Ordering::SeqCst) {
        let tick_start = Instant::now();

        let force = keyframe_flag.swap(false, Ordering::SeqCst)
            || last_keyframe.elapsed() >= PERIODIC_KEYFRAME;
        let produce_start = Instant::now();
        let produced = pipeline
            .next_frame(frame_interval.max(Duration::from_millis(100)), force)
            .and_then(|frame| match frame {
                Some(f) => Ok(Some(f)),
                // Idle gap: hold cadence with a repeat so it is not a freeze.
                None if last_emit.elapsed() >= IDLE_REPEAT => pipeline.encode_repeat(),
                None => Ok(None),
            });
        let produce_took = produce_start.elapsed();
        match produced {
            Ok(Some(frame)) => {
                let gap = last_emit.elapsed();
                last_emit = Instant::now();
                if frame.keyframe {
                    last_keyframe = Instant::now();
                }
                send_leg.emit(frame, gap, produce_took, track, rt, stop);
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
