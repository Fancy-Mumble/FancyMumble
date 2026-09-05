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
//!   EncodePipeline (per-OS backend) ──► RTP packetise ──► track.write_rtp ──► SFU
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
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use bytes::Bytes;
use tokio::runtime::Runtime;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_H264, MIME_TYPE_OPUS};
use webrtc::api::setting_engine::SettingEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtcp::payload_feedbacks::full_intra_request::FullIntraRequest;
use webrtc::rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication;
use webrtc::rtcp::receiver_report::ReceiverReport;
use webrtc::rtcp::reception_report::ReceptionReport;
use webrtc::rtp::codecs::h264::H264Payloader;
use webrtc::rtp::header::Header;
use webrtc::rtp::packet::Packet;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::rtp::packetizer::Payloader;
use webrtc::rtp::sequence::{new_random_sequencer, Sequencer};
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::rtp_transceiver::rtp_sender::RTCRtpSender;
use webrtc::rtp_transceiver::rtp_transceiver_direction::RTCRtpTransceiverDirection;
use webrtc::rtp_transceiver::RTCRtpTransceiverInit;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;

use crate::congestion::{
    BitrateAllocator, CongestionController, CongestionSnapshot, FeedbackSample, TrackBudget,
};
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

/// RTP clock of the H.264 tracks we offer, in ticks per second.
const RTP_CLOCK_HZ: u64 = 90_000;

/// Payload bytes an RTP packet may carry. webrtc-rs paces its own
/// packetizer to a 1200-byte outbound MTU (`RTP_OUTBOUND_MTU`), of which the
/// fixed RTP header takes 12 - so the payloader gets what is left.
const RTP_PAYLOAD_MTU: usize = 1200 - 12;

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
    /// The compositor stopped delivering fresh frames while the broadcast is
    /// otherwise healthy (media still flowing as keep-alive repeats). On
    /// GNOME/NVIDIA a fullscreen surface on the shared MONITOR triggers this:
    /// direct scanout bypasses compositing and the monitor screencast goes to
    /// zero fresh frames until the surface leaves fullscreen (or the cursor
    /// moves). A window share is immune. Advisory only - the broadcast keeps
    /// running - and self-clears via [`Self::CaptureResumed`] when fresh
    /// frames return. Emitted only for Linux monitor shares.
    CaptureStalled,
    /// Fresh frames resumed after a [`Self::CaptureStalled`]; clears the hint.
    CaptureResumed,
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

/// Public STUN so a broadcaster behind NAT finds its reflexive address.
fn ice_config() -> RTCConfiguration {
    RTCConfiguration {
        ice_servers: vec![RTCIceServer {
            urls: vec![
                "stun:stun.l.google.com:19302".to_owned(),
                "stun:stun1.l.google.com:19302".to_owned(),
            ],
            ..Default::default()
        }],
        ..Default::default()
    }
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
    /// Uplink estimate, fed by the SFU's receiver reports.
    controller: Arc<Mutex<CongestionController>>,
    /// Splits that estimate across the tracks.
    allocator: Arc<BitrateAllocator>,
    /// m-sections our SDP offer carried: the video slots plus any audio
    /// track. Not the source count once desktop audio is on.
    offered_sections: usize,
}

impl std::fmt::Debug for ScreenBroadcaster {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ScreenBroadcaster")
            .field("sources", &self.sources)
            .field(
                "awaiting_answer",
                &self.awaiting_answer.load(Ordering::SeqCst),
            )
            .finish_non_exhaustive()
    }
}

impl ScreenBroadcaster {
    /// Start broadcasting the given sources (one video track each, mids
    /// assigned in list order). Sends the SDP offer through `sink` before
    /// returning; the embedder must route the server's answer back via
    /// [`Self::accept_answer`].
    /// `share_audio` adds the desktop's audio (what the default output
    /// plays) as an Opus track. Unavailable capture is logged and the share
    /// goes on without it rather than failing.
    pub fn start(
        sources: Vec<BroadcastSource>,
        settings: EncodeSettings,
        share_audio: bool,
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
                // Existence check only: capturing a full frame here was a
                // redundant screenshot (a portal round-trip on Wayland) of a
                // source the pipeline is about to capture anyway.
                _ => {
                    // Advisory id from a portal-first flow (GNOME's native
                    // picker, or the synthetic Wayland picker entries): the
                    // compositor chooses the real source in its own dialog,
                    // so there is no OS handle to pre-check - resolving id 0
                    // through xcap would fail a share that is about to work.
                    #[cfg(all(target_os = "linux", feature = "gpu"))]
                    if source.id == 0 {
                        continue;
                    }
                    sources::ensure_present(source.kind, source.id)?;
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

        let (pc, tracks, audio_track) =
            runtime.block_on(Self::build_peer(&sink, &stop, sources.len(), share_audio))?;
        // What lets the embedder recognise the answer to THIS offer among
        // every answer the SFU sends this client (see `offered_sections`).
        let offered_sections = tracks.len() + usize::from(audio_track.is_some());

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

        // One estimator per broadcast: bandwidth is a property of the path,
        // not of a track, so screen and camera share it and the allocator
        // splits the result.
        let controller = Arc::new(Mutex::new(CongestionController::new(Instant::now())));
        let kinds: Vec<SourceKind> = sources.iter().map(|s| s.kind).collect();
        let allocator = Arc::new(BitrateAllocator::new(&kinds));

        // One RTCP keyframe flag per track: a viewer's PLI for the camera
        // track must not force IDRs on the (much more expensive) screen track.
        // The same listener folds receiver reports into the estimate.
        let keyframe_flags =
            Self::spawn_feedback_listener(&runtime, &pc, sources.len(), &controller);
        Self::spawn_budget_ticker(&runtime, &controller, &allocator, &stop);

        let mut capture_threads: Vec<std::thread::JoinHandle<()>> = sources
            .iter()
            .zip(tracks)
            .zip(keyframe_flags)
            .zip(allocator.budgets().iter().cloned())
            .map(|(((source, track), keyframe_flag), budget)| {
                // The user's stream settings are display-oriented; the
                // "screen share" text mode caps at 5 fps, which would turn a
                // CAMERA track into a slideshow. A webcam never benefits from
                // that trade (its content is motion, its resolution is small),
                // so floor camera tracks at 30 fps - a camera can't exceed its
                // own delivery rate anyway, and user-chosen HIGHER caps stay.
                let settings = if source.kind == SourceKind::Device {
                    EncodeSettings {
                        max_fps: settings.max_fps.max(30.0),
                        ..settings
                    }
                } else {
                    settings
                };
                Self::spawn_capture_thread(
                    CaptureTask {
                        source: *source,
                        settings,
                        track,
                        stop: Arc::clone(&stop),
                        sink: Arc::clone(&sink),
                        rt: runtime.handle().clone(),
                        keyframe_flag,
                        budget,
                    },
                    &sink,
                )
            })
            .collect();

        Self::attach_audio(audio_track, &runtime, &stop, &mut capture_threads);

        Ok(Self {
            runtime: Some(runtime),
            pc,
            stop,
            awaiting_answer,
            capture_threads,
            sink,
            sources,
            controller,
            allocator,
            offered_sections,
        })
    }

    /// What the uplink estimator currently believes, for the stats UI.
    ///
    /// Cheap enough to poll at 1 Hz: it copies a handful of scalars out from
    /// behind the controller's mutex. Returns the default snapshot if the
    /// mutex is poisoned - stats must never take a broadcast down.
    pub fn congestion(&self) -> CongestionSnapshot {
        self.controller
            .lock()
            .map(|c| c.snapshot())
            .unwrap_or_default()
    }

    /// Per-track send targets in bits per second, in track (mid) order.
    pub fn track_targets(&self) -> Vec<u32> {
        self.allocator
            .budgets()
            .iter()
            .map(|b| b.target_bps())
            .collect()
    }

    /// The capture sources this broadcast is streaming, in track (mid) order.
    pub fn sources(&self) -> &[BroadcastSource] {
        &self.sources
    }

    /// m-sections our SDP offer carried. Its answer has exactly this many,
    /// which is how the embedder tells it from a viewer's answer.
    pub fn offered_sections(&self) -> usize {
        self.offered_sections
    }

    /// Number of capture sources, one video track each.
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
                    sink.on_state(BroadcastState::Failed(format!(
                        "set_remote_description: {e}"
                    )));
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
    /// Start the desktop-audio thread for `track`, if there is one. Capture
    /// that cannot start is logged; the share goes on without audio.
    fn attach_audio(
        track: Option<Arc<TrackLocalStaticSample>>,
        runtime: &Runtime,
        stop: &Arc<AtomicBool>,
        threads: &mut Vec<std::thread::JoinHandle<()>>,
    ) {
        let Some(track) = track else { return };
        match crate::audio_share::spawn_audio_thread(track, runtime.handle().clone(), Arc::clone(stop))
        {
            Ok(thread) => threads.push(thread),
            Err(e) => {
                tracing::warn!("screenshare: desktop audio unavailable ({e}); sharing video only");
            }
        }
    }

    /// One sendonly Opus track on `pc`, for the desktop audio.
    async fn add_audio_track(pc: &RTCPeerConnection) -> Result<Arc<TrackLocalStaticSample>, String> {
        let track = Arc::new(TrackLocalStaticSample::new(
            RTCRtpCodecCapability {
                mime_type: MIME_TYPE_OPUS.to_owned(),
                clock_rate: crate::audio_share::SAMPLE_RATE,
                channels: 2,
                sdp_fmtp_line: "minptime=10;useinbandfec=1".to_owned(),
                ..Default::default()
            },
            "audio0".to_owned(),
            "fancy-screenshare".to_owned(),
        ));
        let _transceiver = pc
            .add_transceiver_from_track(
                Arc::clone(&track) as Arc<_>,
                Some(RTCRtpTransceiverInit {
                    direction: RTCRtpTransceiverDirection::Sendonly,
                    send_encodings: vec![],
                }),
            )
            .await
            .map_err(|e| format!("add_transceiver_from_track (audio): {e}"))?;
        Ok(track)
    }

    /// Offer `track_count` sendonly H.264 tracks and, with `share_audio`, one
    /// sendonly Opus track behind them.
    ///
    /// The SFU forwards by mid, and viewers offer video, video, audio - so
    /// the audio track must sit at mid 2 to land on a viewer's audio
    /// m-line. A single-source share with audio therefore offers a second,
    /// idle video track; nothing ever flows on it and nobody is told about
    /// it.
    async fn build_peer(
        sink: &Arc<dyn SignalSink>,
        stop: &Arc<AtomicBool>,
        track_count: usize,
        share_audio: bool,
    ) -> Result<
        (
            Arc<RTCPeerConnection>,
            Vec<Arc<TrackLocalStaticRTP>>,
            Option<Arc<TrackLocalStaticSample>>,
        ),
        String,
    > {
        const VIEWER_VIDEO_SLOTS: usize = 2;
        let video_slots = if share_audio {
            track_count.max(VIEWER_VIDEO_SLOTS)
        } else {
            track_count
        };
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
        let config = ice_config();
        let pc = Arc::new(
            api.new_peer_connection(config)
                .await
                .map_err(|e| format!("new_peer_connection: {e}"))?,
        );

        // One H.264 track per source. Transceivers are added in source order,
        // which is what assigns the SDP mids "0", "1", ... - the contract the
        // SFU's mid-based forwarding and the viewers' track labeling rely on.
        let mut tracks = Vec::with_capacity(video_slots);
        for i in 0..video_slots {
            let track = Arc::new(TrackLocalStaticRTP::new(
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
        let audio_track = if share_audio {
            Some(Self::add_audio_track(&pc).await?)
        } else {
            None
        };

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
                        state_sink.on_state(BroadcastState::Failed(format!("connection {state}")));
                    }
                    _ => {}
                }
            })
        }));

        Ok((pc, tracks, audio_track))
    }

    /// Listen for RTCP from the SFU: flag keyframe requests (PLI/FIR) and
    /// fold receiver reports into the congestion estimate.
    ///
    /// Returns one keyframe flag per track (sender order == transceiver add
    /// order == source order), each polled by its own capture loop.
    fn spawn_feedback_listener(
        runtime: &Runtime,
        pc: &Arc<RTCPeerConnection>,
        track_count: usize,
        controller: &Arc<Mutex<CongestionController>>,
    ) -> Vec<Arc<AtomicBool>> {
        let flags: Vec<Arc<AtomicBool>> = (0..track_count)
            .map(|_| Arc::new(AtomicBool::new(false)))
            .collect();
        let senders_pc = Arc::clone(pc);
        let listener_flags = flags.clone();
        let listener_controller = Arc::clone(controller);
        let _detached = runtime.spawn(async move {
            let paired = senders_pc
                .get_senders()
                .await
                .into_iter()
                .zip(listener_flags);
            for (sender, flag) in paired {
                let _detached = tokio::spawn(watch_sender_feedback(
                    sender,
                    flag,
                    Arc::clone(&listener_controller),
                ));
            }
        });
        flags
    }

    /// Re-split the uplink estimate across the tracks once a second, and log
    /// what the link is doing every five.
    ///
    /// Deliberately a slow tick rather than a recalculation per report: the
    /// controller already rate-limits itself to one move per RTT, and the
    /// capture loops only act on a change of more than a few percent, so a
    /// faster tick would just burn wake-ups.
    fn spawn_budget_ticker(
        runtime: &Runtime,
        controller: &Arc<Mutex<CongestionController>>,
        allocator: &Arc<BitrateAllocator>,
        stop: &Arc<AtomicBool>,
    ) {
        let controller = Arc::clone(controller);
        let allocator = Arc::clone(allocator);
        let stop = Arc::clone(stop);
        let _detached = runtime.spawn(async move {
            let mut ticks = 0u32;
            while !stop.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let Some(snapshot) = budget_tick(&controller, &allocator) else {
                    return;
                };
                ticks += 1;
                if ticks.is_multiple_of(5) {
                    log_uplink_estimate(&snapshot);
                }
            }
        });
    }

    /// The blocking capture -> encode -> write loop on its own OS thread.
    fn spawn_capture_thread(
        task: CaptureTask,
        sink: &Arc<dyn SignalSink>,
    ) -> std::thread::JoinHandle<()> {
        let sink = Arc::clone(sink);
        std::thread::Builder::new()
            .name("screenshare-capture".into())
            .spawn(move || {
                capture_loop(&task);
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

/// H.264 -> RTP packetiser for one track.
///
/// The whole point of doing this by hand instead of using
/// `TrackLocalStaticSample` is the TIMESTAMP. That helper takes a per-sample
/// `duration` and hands it to `rtp`'s packetizer, which stamps the packet with
/// the timestamp accumulated SO FAR and only then adds the duration - so the
/// duration passed with frame N becomes the increment of frame N+1. Feeding it
/// the measured gap (the only honest value available at write time, since the
/// next frame has not happened yet) therefore stamps every frame with its
/// PREDECESSOR's cadence. At a steady rate that is a harmless constant offset;
/// at the variable rate a screen share actually runs at, one 300 ms sender
/// stall makes that frame look ~270 ms late to the receiver and the next one
/// ~270 ms early. Libwebrtc reads the late one as network jitter and inflates
/// its playout delay to insure against it (decaying that back at only
/// ~100 ms per second of stream time), and holds the early one back - a second,
/// entirely self-inflicted freeze. Encoder hiccups thus turned directly into
/// permanent latency.
///
/// Stamping each access unit with the real, monotonic time it is handed to the
/// track removes the whole class: the receiver sees exactly the cadence we
/// sent, so its jitter estimate reflects the network alone and settles at the
/// minimum. The clock is deliberately the EMIT instant rather than a capture
/// timestamp - a pipeline stall then reads as "nothing to show yet", which is
/// the truth, instead of as media that arrived late and must be buffered for.
#[derive(Debug)]
struct RtpStamper {
    payloader: H264Payloader,
    sequencer: Box<dyn Sequencer + Send + Sync>,
    /// Emit instant of the first packetised frame; timestamps are offsets
    /// from it, so the stream starts at `ts_base` however long setup took.
    epoch: Option<Instant>,
    ts_base: u32,
}

impl RtpStamper {
    fn new() -> Self {
        Self {
            payloader: H264Payloader::default(),
            sequencer: Box::new(new_random_sequencer()),
            epoch: None,
            // RFC 3550 wants a random starting point. Nothing security-critical
            // rides on it (SRTP keys off SSRC + sequence number, and the header
            // travels in the clear either way) - it just keeps the stream from
            // being trivially correlated across restarts.
            ts_base: rand::random::<u32>(),
        }
    }

    /// Fragment one Annex-B access unit emitted at `at` into RTP packets.
    ///
    /// SSRC and payload type are left at 0: `TrackLocalStaticRTP` overwrites
    /// both per binding on write, from what the SDP actually negotiated.
    fn packetize(&mut self, data: Vec<u8>, at: Instant) -> Vec<Packet> {
        let epoch = *self.epoch.get_or_insert(at);
        // 1 us is 9/100 of a tick at 90 kHz - exact integer math, no drift.
        // Wrapping is the RTP contract: the field is 32 bits and rolls over
        // ~13 h into a stream, which receivers handle by design.
        let elapsed_us = at.saturating_duration_since(epoch).as_micros() as u64;
        let ticks = elapsed_us.wrapping_mul(RTP_CLOCK_HZ / 1000) / 1000;
        let timestamp = self.ts_base.wrapping_add(ticks as u32);

        let payloads = match self.payloader.payload(RTP_PAYLOAD_MTU, &Bytes::from(data)) {
            Ok(payloads) => payloads,
            Err(e) => {
                tracing::warn!("screenshare: H.264 payloading failed: {e}");
                return Vec::new();
            }
        };
        let last = payloads.len().saturating_sub(1);
        payloads
            .into_iter()
            .enumerate()
            .map(|(i, payload)| Packet {
                header: Header {
                    version: 2,
                    // The marker bit ends an access unit; the receiver uses it
                    // to know the frame is complete without waiting for the
                    // next one's timestamp change.
                    marker: i == last,
                    payload_type: 0,
                    sequence_number: self.sequencer.next_sequence_number(),
                    timestamp,
                    ssrc: 0,
                    ..Default::default()
                },
                payload,
            })
            .collect()
    }
}

/// Send-leg accounting for the capture loop: RTP packetisation and writes,
/// their timing distribution, and sender-gap detection - all rolled up into a
/// 5 s log. A gap between EMITTED frames past the receiver freeze threshold
/// (~150 ms) is a visible stutter, so each is logged with `produce_ms` (time
/// spent inside `next_frame`: capture+convert+encode+collect) and its keyframe
/// flag, which localises the stall (large `produce_ms` => pipeline stalled).
#[derive(Debug)]
struct SendLeg {
    stamper: RtpStamper,
    write_total: Duration,
    write_max: Duration,
    write_count: u32,
    write_window: Instant,
    gap_max: Duration,
    gap_over: u32,
    keyframes: u32,
}

impl SendLeg {
    fn new() -> Self {
        Self {
            stamper: RtpStamper::new(),
            write_total: Duration::ZERO,
            write_max: Duration::ZERO,
            write_count: 0,
            write_window: Instant::now(),
            gap_max: Duration::ZERO,
            gap_over: 0,
            keyframes: 0,
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
        track: &TrackLocalStaticRTP,
        rt: &tokio::runtime::Handle,
        stop: &AtomicBool,
    ) {
        self.note_gap(&frame, gap, produce_took);

        // No live binding (not negotiated yet, or the sender is paused) means
        // nothing would go on the wire - and packetising anyway would burn
        // sequence numbers, which SRTP's rollover counter cannot tolerate.
        // Skipping is safe for timestamps too: they come from the clock, not
        // from a running total, so the stream resumes correctly stamped.
        if rt.block_on(track.all_binding_paused()) {
            return;
        }

        let bytes = frame.data.len();
        let packets = self.stamper.packetize(frame.data, Instant::now());
        let write_start = Instant::now();
        let failed = rt.block_on(async {
            let mut failed = 0u32;
            // Pace large frames: a keyframe's few hundred RTP packets
            // written back-to-back leave as one wire-speed burst, and a
            // burst that overflows any queue on the path tail-drops the
            // very packets the frame needs to be complete - observed as
            // keyframes dying in transit while deltas survive. Spreading
            // the burst a few milliseconds wide is what real WebRTC
            // pacers do; the cost is ~2 ms per 32 packets, well under a
            // frame interval for anything but the largest IDRs.
            const PACE_CHUNK: usize = 32;
            for (i, chunk) in packets.chunks(PACE_CHUNK).enumerate() {
                if i > 0 {
                    tokio::time::sleep(Duration::from_millis(2)).await;
                }
                for packet in chunk {
                    let err = track.write_rtp_with_extensions(packet, &[]).await.is_err();
                    failed += u32::from(err);
                }
            }
            failed
        });
        if failed > 0 && !stop.load(Ordering::SeqCst) {
            tracing::warn!(packets = failed, "screenshare: write_rtp failed");
        }

        let took = write_start.elapsed();
        self.write_total += took;
        self.write_max = self.write_max.max(took);
        self.write_count += 1;
        if took > Duration::from_millis(100) {
            tracing::debug!(
                ms = took.as_millis() as u64,
                bytes,
                rtp_packets = packets.len(),
                "screenshare: track write stalled"
            );
        }
        self.roll_up_log();
    }

    /// Fold one frame's cadence into the window counters, logging the gaps
    /// long enough for a receiver to score as a freeze.
    fn note_gap(&mut self, frame: &EncodedFrame, gap: Duration, produce_took: Duration) {
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
    }

    /// Emit and reset the 5 s send-leg summary once the window is up.
    fn roll_up_log(&mut self) {
        if self.write_window.elapsed() < Duration::from_secs(5) {
            return;
        }
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

/// Body of a capture thread (see [`ScreenBroadcaster::spawn_capture_thread`]):
/// pure orchestration over the selected [`EncodePipeline`] backend - frame
/// pacing, keyframe scheduling, wall-clock RTP timestamping and the track
/// writes. Which backend runs (per-OS GPU, portable CPU, or camera) is
/// decided by [`create_pipeline`]. A failing source fails the WHOLE
/// broadcast (the embedder tears down and reports), keeping partial-share
/// states out of the UI.
/// One sender's RTCP read loop, until the sender closes. One task per track.
///
/// Two jobs: set `flag` whenever the SFU asks for a keyframe (PLI or FIR),
/// and fold every receiver report into the shared uplink estimate. Both
/// arrive on the same stream and nothing filters them - the reports were
/// always here, they were simply never read.
async fn watch_sender_feedback(
    sender: Arc<RTCRtpSender>,
    flag: Arc<AtomicBool>,
    controller: Arc<Mutex<CongestionController>>,
) {
    while let Ok((packets, _)) = sender.read_rtcp().await {
        for packet in packets {
            let any = packet.as_any();
            let is_keyframe_request = any.downcast_ref::<PictureLossIndication>().is_some()
                || any.downcast_ref::<FullIntraRequest>().is_some();
            if is_keyframe_request {
                flag.store(true, Ordering::SeqCst);
                continue;
            }
            if let Some(report) = any.downcast_ref::<ReceiverReport>() {
                note_receiver_report(&controller, report);
            }
        }
    }
}

/// Fold one receiver report into the estimate.
///
/// A report block per SSRC; we take the WORST loss among them. The blocks
/// describe one path, so the worst is the one that is actually hurting, and
/// averaging would let a healthy track mask a dying one.
fn note_receiver_report(controller: &Mutex<CongestionController>, report: &ReceiverReport) {
    let Some(worst) = report
        .reports
        .iter()
        .max_by_key(|block| block.fraction_lost)
    else {
        return;
    };
    let sample = FeedbackSample {
        // RFC 3550: fraction_lost is the loss fraction scaled by 256.
        fraction_lost: f32::from(worst.fraction_lost) / 256.0,
        rtt: rtt_from_report(worst),
    };
    if let Ok(mut ctrl) = controller.lock() {
        ctrl.on_feedback(sample, Instant::now());
    }
}

/// Round-trip time from a reception report block, per RFC 3550 section 6.4.1:
/// `RTT = now - last_sender_report - delay_since_last_sender_report`, all in
/// the middle 32 bits of an NTP timestamp (16.16 fixed-point seconds).
///
/// `None` when the receiver has not yet heard a sender report from us
/// (`last_sender_report == 0`), or when the arithmetic yields something
/// implausible - a stale or wrapped report must not poison the control
/// interval.
fn rtt_from_report(block: &ReceptionReport) -> Option<Duration> {
    if block.last_sender_report == 0 {
        return None;
    }
    let elapsed = ntp_middle_32(SystemTime::now())
        .wrapping_sub(block.last_sender_report)
        .wrapping_sub(block.delay);
    // 16.16 fixed point: 65536 units == 1 s. Anything past 10 s is nonsense.
    if elapsed == 0 || elapsed > 10 * 65_536 {
        return None;
    }
    Some(Duration::from_secs_f64(f64::from(elapsed) / 65_536.0))
}

/// The middle 32 bits of the NTP timestamp for `now` - the representation
/// RTCP reports carry, being the low 16 bits of the seconds and the high 16
/// of the fraction.
fn ntp_middle_32(now: SystemTime) -> u32 {
    /// Seconds between the NTP epoch (1900) and the Unix epoch (1970).
    const NTP_EPOCH_OFFSET_SECS: u64 = 2_208_988_800;
    let since = now
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = since.as_secs().wrapping_add(NTP_EPOCH_OFFSET_SECS);
    let frac = (u64::from(since.subsec_nanos()) << 32) / 1_000_000_000;
    ((secs.wrapping_shl(32) | frac) >> 16) as u32
}

/// One tick of the budget loop: refresh the ceiling from what the tracks
/// report their content can use, then split the estimate across them.
///
/// `None` means the controller's mutex is poisoned and the loop should end;
/// there is no useful estimate to distribute after that.
fn budget_tick(
    controller: &Mutex<CongestionController>,
    allocator: &BitrateAllocator,
) -> Option<CongestionSnapshot> {
    let ceiling = allocator.total_ceiling();
    let snapshot = {
        let mut ctrl = controller.lock().ok()?;
        if ceiling > 0 {
            ctrl.set_ceiling(ceiling);
        }
        ctrl.snapshot()
    };
    allocator.apply(snapshot.target_bps);
    Some(snapshot)
}

/// Periodic one-line summary of what the uplink is doing.
fn log_uplink_estimate(snapshot: &CongestionSnapshot) {
    tracing::debug!(
        target_kbps = snapshot.target_bps / 1000,
        ceiling_kbps = snapshot.ceiling_bps / 1000,
        loss_pct = snapshot.fraction_lost * 100.0,
        rtt_ms = snapshot.rtt_ms,
        reports = snapshot.reports,
        "screenshare: uplink estimate",
    );
}

/// Whether a new target differs enough from the applied one to be worth a
/// retune. Encoders re-plan rate control on every change, so chasing every
/// few-hundred-bit wobble costs more than it buys.
fn moved_materially(applied_bps: u32, target_bps: u32) -> bool {
    if applied_bps == 0 {
        return true;
    }
    let delta = applied_bps.abs_diff(target_bps);
    u64::from(delta) * 100 >= u64::from(applied_bps) * 5
}

/// Everything one capture thread needs, bundled: the positional list grew
/// past what a reader can hold, and every field is per-track state that
/// travels together anyway.
struct CaptureTask {
    source: BroadcastSource,
    settings: EncodeSettings,
    track: Arc<TrackLocalStaticRTP>,
    stop: Arc<AtomicBool>,
    sink: Arc<dyn SignalSink>,
    rt: tokio::runtime::Handle,
    /// Set by the RTCP listener when the SFU asks this track for an IDR.
    keyframe_flag: Arc<AtomicBool>,
    /// This track's slice of the uplink estimate.
    budget: Arc<TrackBudget>,
}

fn capture_loop(task: &CaptureTask) {
    let source = task.source;
    let settings = task.settings;
    let track = &task.track;
    let stop = &task.stop;
    let sink = &task.sink;
    let rt = &task.rt;
    let keyframe_flag = &task.keyframe_flag;
    let budget = &task.budget;

    let mut pipeline: Box<dyn EncodePipeline> =
        match create_pipeline(source.kind, source.id, settings) {
            Ok(p) => p,
            Err(e) => {
                sink.on_state(BroadcastState::Failed(format!(
                    "capture source vanished: {e}"
                )));
                return;
            }
        };
    tracing::info!(
        backend = pipeline.name(),
        "screenshare: capture pipeline selected"
    );

    let frame_interval = Duration::from_secs_f32(1.0 / settings.max_fps.max(1.0));
    let mut last_keyframe = Instant::now();
    let mut send_leg = SendLeg::new();

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
    // 30 repeats a second: the receiver's decoder shows a frame only once a
    // couple more have arrived behind it, so on a still screen the repeat
    // cadence IS the latency of the next real change. At 90 ms that hold was
    // ~180 ms; a repeat is a near-empty P-frame, so 33 ms costs nothing.
    const IDLE_REPEAT: Duration = Duration::from_millis(33);
    let mut last_emit = Instant::now();
    let mut stall = StallWatch::new(source.kind);
    // Bitrate currently programmed into the encoder; 0 = never set.
    let mut applied_bps = 0u32;

    while !stop.load(Ordering::SeqCst) {
        let tick_start = Instant::now();

        // Tell the allocator what this content can use, then take whatever
        // share of the uplink it granted us. Retuning the live encoder is
        // deliberately NOT a re-creation: that would force an IDR, and a
        // keyframe burst is the last thing a shrinking uplink needs.
        if let Some(ceiling) = pipeline.content_bitrate() {
            budget.set_ceiling(ceiling);
        }
        let target = budget.target_bps();
        if moved_materially(applied_bps, target) {
            pipeline.set_bitrate(target);
            applied_bps = target;
        }

        let force = keyframe_flag.swap(false, Ordering::SeqCst)
            || last_keyframe.elapsed() >= PERIODIC_KEYFRAME;
        let produce_start = Instant::now();
        // Distinguish a FRESH compositor frame from a keep-alive repeat: only
        // the former proves the screencast is still delivering. `fresh` gates
        // the stall detector below.
        let mut fresh = false;
        let produced = pipeline
            .next_frame(frame_interval.max(Duration::from_millis(100)), force)
            .and_then(|frame| match frame {
                Some(f) => {
                    fresh = true;
                    Ok(Some(f))
                }
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
        if fresh {
            stall.saw_fresh_frame(sink);
        } else {
            stall.tick(sink);
        }

        let elapsed = tick_start.elapsed();
        if elapsed < frame_interval {
            std::thread::sleep(frame_interval - elapsed);
        }
    }

    pipeline.shutdown();
}

/// Detects the GNOME/NVIDIA fullscreen direct-scanout stall (see
/// [`BroadcastState::CaptureStalled`]) and drives the advisory hint.
///
/// Known upstream Mutter bug (not ours): a fullscreen surface that gets
/// direct-scanned-out is no longer composited, so the monitor screencast
/// stops receiving fresh frames until it leaves fullscreen (or the cursor
/// forces a composite). Window shares record from the window actor and are
/// immune. Tracked upstream at
/// <https://gitlab.gnome.org/GNOME/mutter/-/issues/3074> ("Pipewire Screen
/// Capture Broken on Unredirected Windows [Wayland][Nvidia]") and
/// <https://gitlab.gnome.org/GNOME/mutter/-/work_items/3903> (same, fullscreen
/// apps stop after a few seconds on NVIDIA).
///
/// A monitor screencast that stops delivering fresh frames looks identical
/// whether the screen is genuinely static (fine - keep-alive shows the real,
/// unchanged picture) or scanout-starved (bad - the picture is moving but
/// viewers are stuck on a stale frame). The capture side cannot tell them
/// apart, so the hint is deliberately advisory ("if the shared content is
/// changing but looks frozen, share the window instead") and self-clearing.
///
/// Gated to Linux monitor shares: window shares are immune, cameras and the
/// Windows WGC path do not have this bug, so they never raise the hint.
struct StallWatch {
    /// True only for the case that can starve (Linux + monitor source).
    armed: bool,
    /// When the current run of no-fresh-frames began; `None` while fresh.
    dry_since: Option<Instant>,
    /// Whether the hint is currently shown (latched, so it fires once).
    stalled: bool,
}

impl StallWatch {
    /// No fresh frames for this long on an armed source raises the hint. Long
    /// enough that a brief pause (reading a static screen for a moment) does
    /// not flap the banner; short enough to catch a real freeze quickly.
    const STALL_AFTER: Duration = Duration::from_secs(5);

    fn new(kind: SourceKind) -> Self {
        Self {
            armed: cfg!(target_os = "linux") && kind == SourceKind::Screen,
            dry_since: None,
            stalled: false,
        }
    }

    /// A fresh compositor frame arrived: clear any raised hint.
    fn saw_fresh_frame(&mut self, sink: &Arc<dyn SignalSink>) {
        self.dry_since = None;
        if self.stalled {
            self.stalled = false;
            sink.on_state(BroadcastState::CaptureResumed);
        }
    }

    /// A tick produced no fresh frame: raise the hint once the dry spell
    /// passes [`Self::STALL_AFTER`].
    fn tick(&mut self, sink: &Arc<dyn SignalSink>) {
        if !self.armed || self.stalled {
            return;
        }
        let since = *self.dry_since.get_or_insert_with(Instant::now);
        if since.elapsed() >= Self::STALL_AFTER {
            self.stalled = true;
            tracing::info!(
                "screenshare: no fresh monitor frames for {}s; raising capture-stall hint \
                 (likely a fullscreen surface bypassing capture via direct scanout)",
                Self::STALL_AFTER.as_secs(),
            );
            sink.on_state(BroadcastState::CaptureStalled);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{moved_materially, ntp_middle_32, rtt_from_report, RtpStamper, RTP_PAYLOAD_MTU};
    use std::time::{Duration, Instant, SystemTime};
    use webrtc::rtcp::reception_report::ReceptionReport;

    /// A reception report block that claims we sent a sender report `ago`
    /// before now and the receiver sat on it for `held`.
    fn report_block(ago: Duration, held: Duration) -> ReceptionReport {
        let now = ntp_middle_32(SystemTime::now());
        let ago_units = (ago.as_secs_f64() * 65_536.0) as u32;
        let held_units = (held.as_secs_f64() * 65_536.0) as u32;
        ReceptionReport {
            last_sender_report: now.wrapping_sub(ago_units),
            delay: held_units,
            ..ReceptionReport::default()
        }
    }

    #[test]
    fn rtt_is_the_round_trip_minus_the_receivers_own_delay() {
        // 200 ms since our SR left, of which the receiver held it for 50 ms.
        let block = report_block(Duration::from_millis(200), Duration::from_millis(50));
        let rtt = rtt_from_report(&block).expect("a report with an LSR yields an RTT");
        let ms = rtt.as_millis();
        assert!((130..=170).contains(&ms), "expected ~150 ms, got {ms} ms");
    }

    #[test]
    fn no_rtt_before_the_receiver_has_heard_a_sender_report() {
        let block = ReceptionReport::default();
        assert!(rtt_from_report(&block).is_none());
    }

    #[test]
    fn an_implausible_rtt_is_discarded_rather_than_believed() {
        // A report referring to an SR from a minute ago is stale or wrapped;
        // believing it would freeze the control interval at its maximum.
        let block = report_block(Duration::from_secs(60), Duration::ZERO);
        assert!(rtt_from_report(&block).is_none());
    }

    #[test]
    fn ntp_middle_32_advances_by_one_unit_per_1_over_65536_second() {
        let base = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let a = ntp_middle_32(base);
        let b = ntp_middle_32(base + Duration::from_secs(1));
        assert_eq!(b.wrapping_sub(a), 65_536, "one second is 65536 units");
    }

    #[test]
    fn the_first_target_always_applies() {
        assert!(moved_materially(0, 1_000_000));
    }

    #[test]
    fn small_wobbles_do_not_retune_the_encoder() {
        assert!(!moved_materially(4_000_000, 4_100_000), "2.5 % is noise");
        assert!(moved_materially(4_000_000, 4_300_000), "7.5 % is real");
        assert!(moved_materially(4_000_000, 3_000_000), "a drop is real");
    }

    /// One Annex-B access unit of `len` payload bytes, NAL type 1 (non-IDR
    /// slice) so the payloader neither buffers it as a parameter set nor
    /// tries to aggregate it into a STAP-A.
    fn access_unit(len: usize) -> Vec<u8> {
        let mut au = vec![0, 0, 0, 1, 0x41];
        au.resize(len, 0xAB);
        au
    }

    /// Ticks the 90 kHz RTP clock advances over `ms` milliseconds.
    fn ticks(ms: u64) -> u32 {
        u32::try_from(ms * 90).expect("test offsets stay small")
    }

    /// The regression this whole packetiser exists for: a frame's timestamp
    /// must reflect WHEN THAT FRAME was emitted. The old
    /// `TrackLocalStaticSample` path passed the elapsed gap as the sample
    /// duration, which `rtp`'s packetizer applies to the FOLLOWING packet, so
    /// every frame carried its predecessor's cadence - fake jitter that
    /// libwebrtc answered with permanent playout delay.
    #[test]
    fn timestamps_track_real_emit_times_not_the_previous_gap() {
        let mut stamper = RtpStamper::new();
        let t0 = Instant::now();
        // Deliberately irregular: steady 33 ms, a 300 ms encoder stall, then
        // recovery. This is the shape that used to inflate the jitter buffer.
        let offsets_ms = [0u64, 33, 66, 366, 399, 489, 522];

        let stamps: Vec<u32> = offsets_ms
            .iter()
            .map(|&ms| {
                let packets = stamper.packetize(access_unit(64), t0 + Duration::from_millis(ms));
                assert_eq!(packets.len(), 1, "a 64-byte AU is one packet");
                packets[0].header.timestamp
            })
            .collect();

        let base = stamps[0];
        for (&ms, &stamp) in offsets_ms.iter().zip(&stamps) {
            assert_eq!(
                stamp.wrapping_sub(base),
                ticks(ms),
                "frame at {ms} ms carries the wrong RTP timestamp",
            );
        }
    }

    /// Sequence numbers must be gapless across frames AND across the
    /// fragments of one frame - a hole is indistinguishable from packet loss
    /// and costs the receiver a NACK round trip (or a freeze).
    #[test]
    fn sequence_numbers_are_contiguous_across_fragments_and_frames() {
        let mut stamper = RtpStamper::new();
        let t0 = Instant::now();
        let mut seqs = Vec::new();
        for i in 0..3u64 {
            // Larger than the MTU, so each frame fragments into several FU-A.
            let packets = stamper.packetize(
                access_unit(RTP_PAYLOAD_MTU * 3),
                t0 + Duration::from_millis(i * 33),
            );
            assert!(packets.len() > 1, "oversized AU must fragment");
            seqs.extend(packets.iter().map(|p| p.header.sequence_number));
        }
        for pair in seqs.windows(2) {
            assert_eq!(
                pair[1],
                pair[0].wrapping_add(1),
                "sequence numbers must not skip: {seqs:?}",
            );
        }
    }

    /// Every fragment of one access unit shares that frame's timestamp, and
    /// only the last one carries the marker bit (the end-of-frame signal the
    /// receiver decodes on).
    #[test]
    fn fragments_share_a_timestamp_and_only_the_last_is_marked() {
        let mut stamper = RtpStamper::new();
        let packets = stamper.packetize(access_unit(RTP_PAYLOAD_MTU * 3), Instant::now());
        assert!(packets.len() > 1, "oversized AU must fragment");

        let stamp = packets[0].header.timestamp;
        assert!(
            packets.iter().all(|p| p.header.timestamp == stamp),
            "one access unit is one instant",
        );
        let marked: Vec<bool> = packets.iter().map(|p| p.header.marker).collect();
        let expected: Vec<bool> = (0..packets.len()).map(|i| i == packets.len() - 1).collect();
        assert_eq!(marked, expected, "marker belongs on the last fragment only");
    }

    /// A screen share that sits idle for minutes and then moves must not
    /// jump its clock backwards, and must still be stamped in real time.
    #[test]
    fn long_idle_gaps_advance_the_clock_monotonically() {
        let mut stamper = RtpStamper::new();
        let t0 = Instant::now();
        let first = stamper.packetize(access_unit(64), t0)[0].header.timestamp;
        let after_idle = stamper.packetize(access_unit(64), t0 + Duration::from_secs(120))[0]
            .header
            .timestamp;
        assert_eq!(after_idle.wrapping_sub(first), ticks(120_000));
    }
}
