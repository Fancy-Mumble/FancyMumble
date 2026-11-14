//! Sharing for real: the web client's capture, encoder and WebRTC peers
//! (`fancy-screenshare`), signalling over the engine's connection.
//!
//! `FANCY_GPUI_SHARE_PATTERN` (any value) offers the test pattern instead of
//! this computer's screens, windows and cameras, and shares it through the
//! same encoder and peer: nothing of the desktop is captured and nothing is
//! heard. Every run that is not the user's own sets it.

use std::collections::HashMap;
use std::sync::mpsc::{Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, PoisonError, Weak};
use std::time::{Duration, Instant};

use fancy_screenshare::encode::EncodeSettings;
use fancy_screenshare::viewer::{DeliveryMode, StreamViewer, ViewerFrame, ViewerSink, ViewerState};
use fancy_screenshare::{BroadcastSource, BroadcastState, FrameSource, ScreenBroadcaster, SignalSink};
use gpui::SharedString;
use mumble_tauri_lib::engine_api::EngineHandle;

use super::decode::{Counts, Decoding, Unit};
use super::pattern::{Order, Pattern};
use super::signal::{Answerable, Answers};
use super::{
    Broadcast, Feed, FeedStats, Heard, Media, SignalKind, Source, SourceKind, Standing, Start,
    Stroke, Uplink, Watch,
};
use crate::engine::{EngineEvent, Session};

/// Whether this run shares the test pattern instead of the desktop.
pub(crate) fn pattern_only() -> bool {
    std::env::var_os("FANCY_GPUI_SHARE_PATTERN").is_some()
}

/// Units waiting to be decoded, at most: past this the decoder is behind,
/// and what comes is dropped until it catches up at a keyframe.
const BACKLOG: usize = 240;

/// Sharing over the engine.
pub(crate) struct RealMedia {
    engine: EngineHandle,
    runtime: tokio::runtime::Handle,
    events: async_channel::Sender<EngineEvent>,
    answers: Arc<Answers>,
    pattern: bool,
}

impl std::fmt::Debug for RealMedia {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RealMedia")
            .field("pattern", &self.pattern)
            .finish_non_exhaustive()
    }
}

impl RealMedia {
    pub(crate) fn new(
        engine: EngineHandle,
        runtime: tokio::runtime::Handle,
        events: async_channel::Sender<EngineEvent>,
    ) -> Self {
        Self {
            engine,
            runtime,
            events,
            answers: Arc::default(),
            pattern: pattern_only(),
        }
    }

    /// What the view is to hear of a signal that came: a START or STOP. An
    /// answer of the SFU's is given to the peer waiting for it, here on the
    /// engine's receive thread, and never waits; the rest is not for this
    /// client (it shares through an SFU, never peer to peer).
    pub(crate) fn heard(
        &self,
        signal: mumble_tauri_lib::engine_api::media::SignalInfo,
    ) -> Option<Heard> {
        let kind = SignalKind::of(signal.kind)?;
        match kind {
            SignalKind::Answer => {
                if !self.answers.claim(signal.sender, &signal.payload) {
                    tracing::debug!(sender = ?signal.sender, "share: an answer nobody here waits for");
                }
                None
            }
            SignalKind::Start | SignalKind::Stop => Some(Heard::Signal(super::Signal {
                server: signal.server.map(Into::into),
                sender: signal.sender,
                kind,
                payload: signal.payload,
            })),
            SignalKind::Offer | SignalKind::Candidate => None,
        }
    }

    fn signaller(&self, server: Option<SharedString>, target: Session) -> Signaller {
        Signaller {
            engine: self.engine.clone(),
            runtime: self.runtime.clone(),
            events: self.events.clone(),
            server: server.map(|server| server.to_string()),
            target,
        }
    }
}

/// Sends a peer's offers, and tells the view how the peer stands.
#[derive(Clone)]
struct Signaller {
    engine: EngineHandle,
    runtime: tokio::runtime::Handle,
    events: async_channel::Sender<EngineEvent>,
    server: Option<String>,
    /// 0 for the broadcaster's own offer; the watched session for a viewer.
    target: Session,
}

impl Signaller {
    fn send(&self, kind: SignalKind, payload: String) {
        let (engine, server, target) = (self.engine.clone(), self.server.clone(), self.target);
        drop(self.runtime.spawn(async move {
            if let Err(error) = engine
                .send_webrtc_signal(target, kind.wire(), payload, server)
                .await
            {
                tracing::warn!(%error, ?kind, "share: a signal was not sent");
            }
        }));
    }

    fn tell(&self, heard: Heard) {
        let _ = self.events.try_send(EngineEvent::Share(heard));
    }
}

impl SignalSink for Signaller {
    fn send_offer(&self, sdp: String) {
        self.send(SignalKind::Offer, sdp);
    }

    fn send_ice_candidate(&self, _candidate_json: String) {
        // Never: the SFU is ICE-lite, its own candidate rides in its answer,
        // and every message counts against the server's rate limit.
    }

    fn on_state(&self, state: BroadcastState) {
        let standing = match state {
            BroadcastState::Connecting => Standing::Connecting,
            BroadcastState::Connected => Standing::Connected,
            BroadcastState::Failed(why) => Standing::Failed(why),
            BroadcastState::Stopped => Standing::Stopped,
            BroadcastState::CaptureStalled | BroadcastState::CaptureResumed => return,
        };
        self.tell(Heard::Broadcast(standing));
    }
}

impl Answerable for ScreenBroadcaster {
    fn awaiting(&self) -> bool {
        self.awaiting_answer()
    }

    fn accept(&self, sdp: String) {
        self.accept_answer(sdp);
    }
}

impl Answerable for StreamViewer {
    fn awaiting(&self) -> bool {
        self.awaiting_answer()
    }

    fn accept(&self, sdp: String) {
        self.accept_answer(sdp);
    }
}

impl Media for RealMedia {
    fn sources(&self) -> Result<Vec<Source>, String> {
        if self.pattern {
            return Ok(super::made_up::pattern_sources());
        }
        let listed = fancy_screenshare::sources::list_sources()?;
        Ok(listed
            .into_iter()
            .map(|source| Source {
                kind: match source.kind {
                    fancy_screenshare::SourceKind::Screen => SourceKind::Screen,
                    fancy_screenshare::SourceKind::Window => SourceKind::Window,
                    fancy_screenshare::SourceKind::Device => SourceKind::Device,
                },
                id: source.id,
                title: source.title.into(),
                width: source.width,
                height: source.height,
            })
            .collect())
    }

    fn thumbnail(&self, source: &Source) -> Option<Arc<gpui::Image>> {
        if self.pattern {
            return super::made_up::pattern_thumbnail(source);
        }
        let url = fancy_screenshare::sources::capture_thumbnail(kind_of(source.kind), source.id, 320).ok()?;
        let encoded = url.strip_prefix("data:image/jpeg;base64,")?;
        let jpeg = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded).ok()?;
        Some(Arc::new(gpui::Image::from_bytes(gpui::ImageFormat::Jpeg, jpeg)))
    }

    fn broadcast(&self, start: Start) -> Result<Box<dyn Broadcast>, String> {
        let sink = Arc::new(self.signaller(start.server.clone(), 0));
        let quality = start.settings.quality;
        let settings = EncodeSettings {
            max_dimension: quality.longest,
            max_fps: quality.fps as f32,
            ..EncodeSettings::default()
        };
        let broadcaster = if self.pattern {
            let frames = start
                .sources
                .iter()
                .map(|source| Box::new(Patterned::new(source, quality.fps)) as Box<dyn FrameSource>)
                .collect();
            ScreenBroadcaster::start_frames(frames, settings, sink)?
        } else {
            let sources = start
                .sources
                .iter()
                .map(|source| BroadcastSource {
                    kind: kind_of(source.kind),
                    id: source.id,
                })
                .collect();
            ScreenBroadcaster::start(sources, settings, start.settings.audio, sink)?
        };
        let broadcaster = Arc::new(broadcaster);
        self.answers
            .broadcaster(broadcaster.offered_sections(), broadcaster.clone());
        Ok(Box::new(Sending {
            broadcaster,
            answers: Arc::clone(&self.answers),
        }))
    }

    fn watch(&self, watch: Watch) -> Result<Box<dyn Feed>, String> {
        tracing::debug!(session = watch.session, own = watch.own, "share: watching");
        let mut decodings = Vec::new();
        let mut units = HashMap::new();
        let counts = Arc::new(Counts::default());
        for track in &watch.tracks {
            let (to_decoder, waiting) = std::sync::mpsc::sync_channel(BACKLOG);
            let _ = units.insert(track.mid.clone(), Mutex::new(to_decoder));
            decodings.push((track.clone(), waiting));
        }
        let sink = Arc::new(Viewing {
            signaller: self.signaller(watch.server.clone(), watch.session),
            session: watch.session,
            own: watch.own,
            units,
            ear: Arc::clone(&watch.ear),
        });
        let viewer = Arc::new(StreamViewer::start(sink, DeliveryMode::H264)?);
        self.answers.viewer(watch.session, viewer.clone());
        for (track, waiting) in decodings {
            // The screen's counts are the share's; a camera beside it is
            // counted with it.
            let asks: Weak<StreamViewer> = Arc::downgrade(&viewer);
            let decoding = Decoding::new(
                track.slot,
                track.wanted,
                watch.wake.clone(),
                Box::new(move || {
                    if let Some(viewer) = asks.upgrade() {
                        viewer.request_keyframe();
                    }
                }),
                Arc::clone(&counts),
            )?;
            let _decoding = std::thread::Builder::new()
                .name(format!("share-decode-{}-{}", watch.session, track.mid))
                .spawn(move || decode_until_closed(decoding, &waiting))
                .map_err(|error| error.to_string())?;
        }
        Ok(Box::new(Watching {
            viewer,
            session: watch.session,
            answers: Arc::clone(&self.answers),
            counts,
            hearing: Arc::clone(&watch.ear.hearing),
        }))
    }

    fn announce(&self, server: Option<SharedString>, kind: SignalKind, payload: String) {
        self.signaller(server, 0).send(kind, payload);
    }

    fn stroke(&self, stroke: Stroke) {
        let engine = self.engine.clone();
        drop(self.runtime.spawn(async move {
            let sent = engine
                .send_draw_stroke(mumble_tauri_lib::engine_api::media::StrokeInfo {
                    sender: stroke.sender,
                    channel: stroke.channel,
                    id: stroke.id,
                    colour: stroke.colour,
                    width: stroke.width,
                    width_frac: stroke.width_frac,
                    points: stroke.points,
                    end: stroke.end,
                    clear: stroke.clear,
                    clear_all: stroke.clear_all,
                })
                .await;
            if let Err(error) = sent {
                tracing::warn!(%error, "share: a stroke was not sent");
            }
        }));
    }

    fn relays(&self) -> bool {
        self.engine.relays_media()
    }

    fn made_up(&self) -> bool {
        self.pattern
    }

    fn hearing(&self) -> Arc<dyn super::audio::Hearing> {
        if crate::silence::everything() {
            return Arc::new(super::audio::Unheard::default());
        }
        Arc::new(Played {
            engine: self.engine.clone(),
        })
    }

    fn whereabouts(&self) -> Arc<dyn super::whereabouts::Whereabouts> {
        // The pattern lies on no screen: only where the run says.
        if self.pattern {
            return Arc::new(super::whereabouts::StandIn::from_env());
        }
        Arc::new(super::whereabouts::System)
    }
}

/// A watched share's sound, played with voice by the engine.
#[derive(Debug)]
struct Played {
    engine: EngineHandle,
}

impl super::audio::Hearing for Played {
    fn hear(&self, session: Session, stereo: &[f32]) {
        self.engine.hear_shared(session, stereo);
    }

    fn set_volume(&self, session: Session, volume: f32) {
        self.engine.set_shared_volume(session, volume);
    }

    fn stop(&self, session: Session) {
        self.engine.stop_shared(session);
    }
}

/// What the view is to hear of a stroke that came.
pub(crate) fn heard_stroke(stroke: mumble_tauri_lib::engine_api::media::StrokeInfo) -> Heard {
    Heard::Stroke(Stroke {
        sender: stroke.sender,
        channel: stroke.channel,
        id: stroke.id,
        colour: stroke.colour,
        width: stroke.width,
        width_frac: stroke.width_frac,
        points: stroke.points,
        end: stroke.end,
        clear: stroke.clear,
        clear_all: stroke.clear_all,
    })
}

fn decode_until_closed(decoding: Decoding, waiting: &Receiver<Unit>) {
    decoding.run(waiting);
    tracing::debug!("share: decoding ended");
}

fn kind_of(kind: SourceKind) -> fancy_screenshare::SourceKind {
    match kind {
        SourceKind::Screen => fancy_screenshare::SourceKind::Screen,
        SourceKind::Window => fancy_screenshare::SourceKind::Window,
        SourceKind::Device => fancy_screenshare::SourceKind::Device,
    }
}

/// One's own share, going.
struct Sending {
    broadcaster: Arc<ScreenBroadcaster>,
    answers: Arc<Answers>,
}

impl Broadcast for Sending {
    fn uplink(&self) -> Option<Uplink> {
        let congestion = self.broadcaster.congestion();
        Some(Uplink {
            target_kbps: congestion.target_bps / 1000,
            ceiling_kbps: congestion.ceiling_bps / 1000,
            loss: congestion.fraction_lost,
            rtt_ms: congestion.rtt_ms,
        })
    }

    fn stop(self: Box<Self>) {
        self.answers.forget_broadcaster();
        // The last hold on it: dropping it stops it, here, off the window.
        drop(self.broadcaster);
    }
}

/// The viewer's side of one watched share: its offers go to the server, its
/// units to the decoder.
struct Viewing {
    signaller: Signaller,
    session: Session,
    /// One's own share's preview, or one's account's from another device.
    own: bool,
    /// Where each track shown is decoded, by its mid; the others are not.
    units: HashMap<String, Mutex<SyncSender<Unit>>>,
    /// Where what the share's computer plays goes.
    ear: Arc<super::audio::Ear>,
}

impl Viewing {
    fn hand_over(&self, mid: &str, unit: Unit) {
        let Some(units) = self.units.get(mid) else {
            return;
        };
        let units = units.lock().unwrap_or_else(PoisonError::into_inner);
        if let Err(TrySendError::Full(_)) = units.try_send(unit) {
            // The decoder is behind: what it misses breaks what follows, and
            // it asks for a keyframe when it notices.
            tracing::debug!(session = self.session, "share: decoder behind, a unit dropped");
        }
    }
}

impl ViewerSink for Viewing {
    fn send_offer(&self, sdp: String) {
        self.signaller.send(SignalKind::Offer, sdp);
    }

    fn on_decoder_config(&self, mid: &str, avcc: Vec<u8>) {
        self.hand_over(mid, Unit::Config(avcc));
    }

    fn on_frame(&self, frame: ViewerFrame) {
        let mid = frame.mid;
        self.hand_over(
            &mid,
            Unit::Sample {
                data: frame.data,
                keyframe: frame.keyframe,
            },
        );
    }

    fn on_audio(&self, _mid: &str, pcm: &[f32]) {
        self.ear.hear(self.session, self.own, pcm);
    }

    fn on_state(&self, state: ViewerState) {
        let standing = match state {
            ViewerState::Connecting => Standing::Connecting,
            ViewerState::Connected => Standing::Connected,
            ViewerState::Failed(why) => Standing::Failed(why),
            ViewerState::Stopped => Standing::Stopped,
        };
        self.signaller.tell(Heard::Watch {
            session: self.session,
            standing,
        });
    }
}

/// A share being watched.
struct Watching {
    viewer: Arc<StreamViewer>,
    session: Session,
    answers: Arc<Answers>,
    counts: Arc<Counts>,
    hearing: Arc<dyn super::audio::Hearing>,
}

impl Feed for Watching {
    fn stats(&self) -> FeedStats {
        use std::sync::atomic::Ordering;
        let peer = self
            .viewer
            .stats_probe()
            .as_ref()
            .and_then(fancy_screenshare::viewer::ViewerStatsProbe::collect);
        let decoded = self.counts.decoded.load(Ordering::Relaxed);
        let busy_us = self.counts.busy_us.load(Ordering::Relaxed);
        let video = peer.as_ref().and_then(|peer| peer.videos.first().cloned());
        FeedStats {
            connection: peer
                .as_ref()
                .map_or_else(String::new, |peer| peer.connection_state.clone()),
            rtt_ms: peer.as_ref().and_then(|peer| peer.rtt_ms),
            ice: peer.as_ref().and_then(|peer| peer.ice_path.clone()),
            sent: self.counts.sent(),
            decoded,
            skipped: self.counts.skipped.load(Ordering::Relaxed),
            failed: self.counts.failed.load(Ordering::Relaxed),
            busy_ms: (decoded > 0).then(|| busy_us as f64 / decoded as f64 / 1000.0),
            packets: video.as_ref().map_or(0, |video| video.packets_received),
            bytes: video.as_ref().map_or(0, |video| video.bytes_received),
            lost: video.as_ref().map_or(0, |video| video.packets_lost),
            jitter_ms: video.and_then(|video| video.jitter_ms),
            audio: peer.is_some_and(|peer| peer.audio.is_some()),
        }
    }

    fn stop(self: Box<Self>) {
        self.answers.forget_viewer(self.session);
        self.hearing.stop(self.session);
        // The last hold on the viewer: dropping it closes the peer.
        drop(self.viewer);
    }
}

/// The test pattern as a broadcast's frames: as large as its source says,
/// at the share's rate (thirty at most).
struct Patterned {
    pattern: Pattern,
    every: Duration,
    next: Instant,
    number: u32,
}

impl Patterned {
    fn new(source: &Source, fps: u32) -> Self {
        Self {
            pattern: Pattern::new(source.width, source.height),
            every: Duration::from_secs(1) / fps.clamp(1, 30),
            next: Instant::now(),
            number: 0,
        }
    }
}

impl FrameSource for Patterned {
    fn next_frame(&mut self, wait: Duration) -> Option<image::RgbaImage> {
        let now = Instant::now();
        if self.next > now {
            let rest = self.next - now;
            if rest > wait {
                std::thread::sleep(wait);
                return None;
            }
            std::thread::sleep(rest);
        }
        self.next = self.next.max(now) + self.every;
        let frame = self.pattern.frame(self.number, Order::Rgba);
        self.number += 1;
        image::RgbaImage::from_raw(self.pattern.width(), self.pattern.height(), frame)
    }
}
