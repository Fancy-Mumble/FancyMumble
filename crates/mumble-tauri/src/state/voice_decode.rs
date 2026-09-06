//! The inbound voice decoder, on a thread of its own.
//!
//! Decoding used to happen in [`on_udp_message`](super::event_handler), which
//! runs on the protocol event loop and takes the app-wide `SharedState` lock
//! to do it. Every Opus frame therefore queued behind whatever control message
//! or user command the loop was handling - the loop warns at 50 ms, and a busy
//! UI is exactly when it is slowest. This thread takes that off the loop: the
//! socket-reading task hands packets straight here (see
//! [`AudioSink`](mumble_protocol::work_queue::AudioSink)), and the only time
//! `SharedState` is touched is the two talking edges per utterance.
//!
//! Packets and control messages share one channel so they stay in order: an
//! `Install` cannot overtake the packets already queued for the mixer it
//! replaces.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};

use mumble_protocol::audio::encoder::EncodedPacket;
use mumble_protocol::audio::mixer::{AudioMixer, JitterConfig};
use mumble_protocol::message::UdpMessage;
use mumble_protocol::work_queue::AudioSink;
use tauri::{AppHandle, Emitter};
use tracing::{debug, warn};

use super::SharedState;

/// Packets allowed to pile up before the sink starts dropping them.
///
/// 64 packets is well over a second of speech. A decoder that far behind will
/// not catch up, and everything queued is already too late to be worth
/// playing, so the newest packet is dropped rather than queued behind them.
const MAX_QUEUED_PACKETS: usize = 64;

/// What the decoder thread is told to do.
enum DecodeMsg {
    /// One inbound audio packet, straight off the socket.
    Packet(UdpMessage),
    /// Decode into this mixer from now on.
    Install(Box<AudioMixer>),
    /// Voice stopped: drop the mixer and forget who was talking.
    Uninstall,
    /// A user left - free their decoder and their buffer.
    RemoveSpeaker(u32),
    /// Retune the jitter buffer of every speaker.
    SetJitter(JitterConfig),
    /// Exit the thread.
    Stop,
}

/// Control handle for the decoder thread, held in the audio pipeline state.
///
/// Dropping it stops the thread. Nothing here blocks: the channel is unbounded
/// so a control message never waits behind a backlog of audio, and the backlog
/// is bounded by [`MAX_QUEUED_PACKETS`] on the sink side instead.
pub(crate) struct DecodeHandle {
    tx: Sender<DecodeMsg>,
}

impl DecodeHandle {
    /// Decode into `mixer` from the next packet on.
    pub(crate) fn install(&self, mixer: AudioMixer) {
        self.send(DecodeMsg::Install(Box::new(mixer)));
    }

    /// Stop decoding and release the mixer.
    pub(crate) fn uninstall(&self) {
        self.send(DecodeMsg::Uninstall);
    }

    /// Free `session`'s decoder and sample buffer.
    pub(crate) fn remove_speaker(&self, session: u32) {
        self.send(DecodeMsg::RemoveSpeaker(session));
    }

    /// Retune every speaker's jitter buffer.
    pub(crate) fn set_jitter(&self, cfg: JitterConfig) {
        self.send(DecodeMsg::SetJitter(cfg));
    }

    fn send(&self, msg: DecodeMsg) {
        // A closed channel means the thread is already gone, which is what a
        // caller clearing up would have wanted anyway.
        let _ = self.tx.send(msg);
    }
}

impl Drop for DecodeHandle {
    fn drop(&mut self) {
        self.send(DecodeMsg::Stop);
    }
}

/// Start the decoder thread for one connection.
///
/// Returns the handle to keep in the audio state and the sink to hand to
/// [`ClientConfig`](mumble_protocol::client::ClientConfig). `None` if the
/// thread cannot be spawned: the caller then runs without a sink, and audio is
/// decoded on the event loop exactly as it used to be.
pub(crate) fn start(
    shared: Arc<Mutex<SharedState>>,
    app: AppHandle,
    epoch: u64,
) -> Option<(DecodeHandle, AudioSink)> {
    let (tx, rx) = channel::<DecodeMsg>();
    let queued = Arc::new(AtomicUsize::new(0));

    let decoder = Decoder {
        shared,
        app,
        epoch,
        queued: Arc::clone(&queued),
        mixer: None,
        talking: HashSet::new(),
        packets: 0,
    };
    if let Err(e) = std::thread::Builder::new()
        .name("voice-decoder".into())
        .spawn(move || decoder.run(&rx))
    {
        warn!("voice decoder thread: {e}; decoding stays on the event loop");
        return None;
    }

    let sink_tx = tx.clone();
    let dropped = AtomicU64::new(0);
    let sink = AudioSink::new(move |msg| {
        if queued.load(Ordering::Relaxed) >= MAX_QUEUED_PACKETS {
            let n = dropped.fetch_add(1, Ordering::Relaxed) + 1;
            if n == 1 || n.is_multiple_of(100) {
                warn!("voice decoder is behind: {n} packets dropped");
            }
            return None;
        }
        let _ = queued.fetch_add(1, Ordering::Relaxed);
        match sink_tx.send(DecodeMsg::Packet(msg)) {
            Ok(()) => None,
            // The thread is gone. Undo the count and hand the packet back, so
            // the event loop's own decode path still gets it.
            Err(std::sync::mpsc::SendError(DecodeMsg::Packet(msg))) => {
                let _ = queued.fetch_sub(1, Ordering::Relaxed);
                Some(msg)
            }
            Err(_) => {
                let _ = queued.fetch_sub(1, Ordering::Relaxed);
                None
            }
        }
    });

    Some((DecodeHandle { tx }, sink))
}

/// Feed one packet to the mixer, reporting a talking edge worth publishing.
///
/// Free-standing so the decode path can be tested without a Tauri app handle:
/// everything above it is bookkeeping, and everything below is the UI.
fn feed(
    mixer: &mut Option<AudioMixer>,
    talking: &mut HashSet<u32>,
    audio: mumble_protocol::proto::mumble_udp::Audio,
) -> Option<bool> {
    let session = audio.sender_session;
    let is_terminator = audio.is_terminator;
    let mixer = mixer.as_mut()?;

    // The payload is moved rather than cloned: this thread owns the packet.
    let packet = EncodedPacket {
        data: audio.opus_data,
        sequence: audio.frame_number,
        frame_samples: 960,
    };
    if let Err(e) = mixer.feed(session, &packet) {
        warn!("inbound audio decode error: {e}");
    }

    if is_terminator {
        mixer.reset_speaker(session);
        // The end of an utterance is a natural, low-frequency moment to free
        // decoders with lost terminators and drained buffers of past streams
        // (~77 KB each).
        mixer.remove_inactive_speakers();
        talking.remove(&session).then_some(false)
    } else {
        talking.insert(session).then_some(true)
    }
}

/// The thread's own state. None of it is shared, which is the point.
struct Decoder {
    shared: Arc<Mutex<SharedState>>,
    app: AppHandle,
    /// The connection this decoder belongs to. A later `connect()` bumps the
    /// epoch, and an orphaned decoder must not write over the new session.
    epoch: u64,
    queued: Arc<AtomicUsize>,
    mixer: Option<AudioMixer>,
    talking: HashSet<u32>,
    packets: u64,
}

impl Decoder {
    fn run(mut self, rx: &Receiver<DecodeMsg>) {
        debug!(epoch = self.epoch, "voice decoder started");
        while let Ok(msg) = rx.recv() {
            match msg {
                DecodeMsg::Packet(packet) => {
                    let _ = self.queued.fetch_sub(1, Ordering::Relaxed);
                    self.decode(packet);
                }
                DecodeMsg::Install(mixer) => {
                    self.mixer = Some(*mixer);
                    self.talking.clear();
                }
                DecodeMsg::Uninstall => {
                    self.mixer = None;
                    self.talking.clear();
                }
                DecodeMsg::RemoveSpeaker(session) => {
                    if let Some(ref mut mixer) = self.mixer {
                        mixer.remove_speaker(session);
                    }
                    let _ = self.talking.remove(&session);
                }
                DecodeMsg::SetJitter(cfg) => {
                    if let Some(ref mut mixer) = self.mixer {
                        mixer.set_jitter(cfg);
                    }
                }
                DecodeMsg::Stop => break,
            }
        }
        debug!(epoch = self.epoch, "voice decoder stopped");
    }

    fn decode(&mut self, msg: UdpMessage) {
        let UdpMessage::Audio(audio) = msg else {
            return;
        };
        if audio.opus_data.is_empty() {
            return;
        }
        let session = audio.sender_session;
        let is_terminator = audio.is_terminator;

        // e2e decoded-audio dump (no-op unless FANCY_E2E_AUDIO_DUMP_DIR is
        // set); idempotent, and this is the first point that is guaranteed to
        // run before any audio is decoded.
        crate::e2e_stats::start_audio_dump();
        // e2e timing assertions (no-op unless FANCY_E2E_AUDIO_STATS_FILE is
        // set): wire-level packet stats per sender.
        crate::e2e_stats::record_packet(
            session,
            audio.frame_number,
            &audio.opus_data,
            is_terminator,
        );

        self.packets += 1;
        if self.packets == 1 || self.packets.is_multiple_of(500) {
            debug!(
                "inbound audio #{} from session {} (opus {} bytes, seq {}, term={})",
                self.packets,
                session,
                audio.opus_data.len(),
                audio.frame_number,
                is_terminator,
            );
        }

        if let Some(talking) = feed(&mut self.mixer, &mut self.talking, audio) {
            self.publish_talking(session, talking);
        }
    }

    /// Mirror a talking edge into `SharedState` and tell the UI.
    ///
    /// Twice per utterance, so the lock is taken rarely and never held across
    /// the emit: the webview dispatches the JS event synchronously, JS may
    /// call a Tauri command that re-locks `SharedState`, and the two would
    /// wait on each other.
    fn publish_talking(&self, session: u32, talking: bool) {
        if let Ok(mut state) = self.shared.lock() {
            // Audio from an orphaned connection must not be attributed to the
            // session a newer connect() has claimed.
            if state.conn.epoch != self.epoch {
                return;
            }
            if talking {
                let _ = state.audio.talking_sessions.insert(session);
            } else {
                let _ = state.audio.talking_sessions.remove(&session);
            }
        }
        let _ = self.app.emit("user-talking", (session, talking));
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use mumble_protocol::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
    use mumble_protocol::audio::mixer::SpeakerBuffers;
    use mumble_protocol::audio::sample::{AudioFormat, AudioFrame};
    use mumble_protocol::proto::mumble_udp;

    use super::{AudioMixer, HashSet, feed};

    /// One 20 ms packet of real (silent) Opus from `session`.
    fn packet(session: u32, sequence: u64, is_terminator: bool) -> mumble_udp::Audio {
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).expect("encoder");
        let encoded = enc
            .encode(&AudioFrame {
                data: vec![0u8; frame_size * 4],
                format: AudioFormat::MONO_48KHZ_F32,
                sequence: 0,
                is_silent: false,
            })
            .expect("encode");
        mumble_udp::Audio {
            sender_session: session,
            frame_number: sequence,
            opus_data: encoded.data,
            is_terminator,
            ..mumble_udp::Audio::default()
        }
    }

    fn mixer() -> (Option<AudioMixer>, SpeakerBuffers) {
        let buffers: SpeakerBuffers = std::sync::Arc::new(std::sync::Mutex::new(HashMap::new()));
        (
            Some(AudioMixer::new(
                buffers.clone(),
                AudioFormat::MONO_48KHZ_F32,
            )),
            buffers,
        )
    }

    #[test]
    fn a_packet_arriving_before_voice_is_enabled_is_dropped() {
        let mut talking = HashSet::new();
        assert_eq!(feed(&mut None, &mut talking, packet(7, 0, false)), None);
        assert!(talking.is_empty(), "nobody is talking without a mixer");
    }

    #[test]
    fn a_packet_fills_the_speaker_buffer_and_reports_one_talking_edge() {
        let (mut mixer, buffers) = mixer();
        let mut talking = HashSet::new();

        assert_eq!(
            feed(&mut mixer, &mut talking, packet(7, 0, false)),
            Some(true),
            "the first packet of an utterance is a talking edge"
        );
        assert_eq!(
            feed(&mut mixer, &mut talking, packet(7, 2, false)),
            None,
            "the rest of the utterance is not"
        );

        let locked = buffers.lock().expect("buffers");
        assert!(
            locked.get(&7).is_some_and(|b| !b.is_empty()),
            "decoded samples should be queued for playout"
        );
    }

    #[test]
    fn a_terminator_ends_the_utterance() {
        let (mut mixer, _buffers) = mixer();
        let mut talking = HashSet::new();

        let _ = feed(&mut mixer, &mut talking, packet(7, 0, false));
        assert_eq!(
            feed(&mut mixer, &mut talking, packet(7, 2, true)),
            Some(false),
            "the terminator is the closing edge"
        );
        assert!(talking.is_empty());
        assert_eq!(
            feed(&mut mixer, &mut talking, packet(7, 4, true)),
            None,
            "a second terminator has no edge left to report"
        );
    }
}
