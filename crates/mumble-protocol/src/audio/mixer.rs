//! Per-speaker audio mixer.
//!
//! Manages one [`AudioDecoder`] per remote speaker (keyed by session
//! ID) so that each Opus stream is decoded independently.  Decoded
//! samples are written into a per-speaker [`SpeakerBuffer`] that the
//! platform playback callback drains, sums, and outputs.
//!
//! Each [`SpeakerBuffer`] is a small adaptive jitter buffer: playout of a
//! talkspurt starts once the buffer holds its target depth, the target grows
//! when a packet arrives too late to be played in time, relaxes back toward
//! the floor across talkspurts that went well, and any depth the buffer
//! accumulates above the target is taken back out while nobody is listening
//! to the seam.  See [`JitterConfig`] for the two numbers a user can set.
//!
//! This replaces the single-decoder [`InboundPipeline`] approach
//! which was fundamentally broken for multi-speaker scenarios because
//! Opus is a stateful codec.
//!
//! [`InboundPipeline`]: super::pipeline::InboundPipeline

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::audio::decoder::{AudioDecoder, OpusDecoder};
use crate::audio::encoder::EncodedPacket;
use crate::audio::sample::{AudioFormat, AudioFrame, SampleFormat};
use crate::error::Result;

/// Number of samples to crossfade at frame boundaries to smooth
/// discontinuities between decoded frames.  0.5 ms at 48 kHz.
const CROSSFADE_LEN: usize = 24;

/// Speakers that have not sent audio for this many seconds are
/// removed to free resources.
const SPEAKER_TIMEOUT_SECS: u64 = 30;

/// Maximum per-speaker sample buffer size.  Capped at 400 ms
/// (19 200 samples at 48 kHz mono) to prevent buffer bloat when
/// the playback callback falls behind (e.g. Android app
/// backgrounded).  Old samples are dropped from the front.
const MAX_SPEAKER_BUFFER_SAMPLES: usize = 19_200;

/// The rate every buffer runs at, in samples per second.
const SAMPLE_RATE: usize = 48_000;

/// Milliseconds to samples at [`SAMPLE_RATE`].
const fn ms_to_samples(ms: u32) -> usize {
    (ms as usize) * SAMPLE_RATE / 1000
}

// -- Jitter buffer ----------------------------------------------------

/// How deep a speaker's buffer runs before playout starts, and how far it
/// may grow when packets arrive late.
///
/// Two numbers, both in milliseconds. The floor is what every talkspurt
/// starts at and what the target relaxes back toward while a speaker is
/// behaving; the ceiling bounds what a bad network can push it to. The
/// stock Mumble client's equivalents are its "Jitter buffer" slider (a
/// nominal 10 ms that its speex buffer adapts around) and the fixed cap
/// in its adaptation code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JitterConfig {
    /// Depth a talkspurt starts playing at, and the target's floor.
    pub floor_ms: u32,
    /// The most a target may grow to under late arrivals.
    pub ceiling_ms: u32,
}

impl JitterConfig {
    /// Two frames: one in the buffer while the next is in flight.
    ///
    /// Enough for the arrival jitter of a client whose decode runs on its
    /// own task; the target grows on its own where the network needs more.
    pub const DEFAULT_FLOOR_MS: u32 = 40;
    /// Beyond this the network is the problem, not the buffer.
    pub const DEFAULT_CEILING_MS: u32 = 200;
    /// One frame. Below this every packet is late by definition.
    pub const MIN_FLOOR_MS: u32 = 20;

    /// Floor in samples, never below [`Self::MIN_FLOOR_MS`].
    #[must_use]
    pub const fn floor_samples(&self) -> usize {
        let floor = if self.floor_ms < Self::MIN_FLOOR_MS {
            Self::MIN_FLOOR_MS
        } else {
            self.floor_ms
        };
        ms_to_samples(floor)
    }

    /// Ceiling in samples, never below the floor and never above the
    /// buffer's hard capacity.
    #[must_use]
    pub const fn ceiling_samples(&self) -> usize {
        let floor = self.floor_samples();
        let ceiling = ms_to_samples(self.ceiling_ms);
        let ceiling = if ceiling < floor { floor } else { ceiling };
        if ceiling > MAX_SPEAKER_BUFFER_SAMPLES {
            MAX_SPEAKER_BUFFER_SAMPLES
        } else {
            ceiling
        }
    }
}

impl Default for JitterConfig {
    fn default() -> Self {
        Self {
            floor_ms: Self::DEFAULT_FLOOR_MS,
            ceiling_ms: Self::DEFAULT_CEILING_MS,
        }
    }
}

/// What one speaker's buffer has been through, for diagnostics.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct JitterStats {
    /// Times the buffer ran dry mid-talkspurt, each of which grew the target.
    pub underruns: u32,
    /// Times excess depth was skipped out of the buffer.
    pub shrinks: u32,
    /// Samples skipped by those shrinks.
    pub skipped_samples: usize,
    /// Samples dropped because the buffer hit its hard cap.
    pub overflow_dropped: usize,
}

/// A speaker whose last packet is older than this is between talkspurts,
/// so its buffer running dry is the end of a sentence, not a late packet.
const LIVE_WINDOW: Duration = Duration::from_millis(200);
/// How much the target grows on one mid-talkspurt underrun (20 ms).
const GROW_STEP: usize = 960;
/// How much the target relaxes at the end of a talkspurt that had no
/// underrun (10 ms).  Half the growth step, so recovery is slower than
/// reaction.
const RELAX_STEP: usize = 480;
/// Samples that have to be played from a primed buffer before its slack is
/// measured (2 s at 48 kHz).  Long enough that one deep moment does not
/// count; short enough that a burst-induced offset is gone within a
/// sentence.
const SHRINK_WINDOW_SAMPLES: usize = 96_000;
/// Slack below this is left alone (10 ms).
const SHRINK_MIN: usize = 480;
/// The most taken out in one skip (20 ms).
const SHRINK_MAX: usize = 960;
/// Crossfade across a skip seam (2.5 ms).
const SKIP_FADE: usize = 120;

/// One speaker's decoded audio, waiting to be played.
///
/// The playback callback calls [`drain_into`](Self::drain_into) once per
/// output buffer; the mixer calls [`push`](Self::push) once per decoded
/// frame. Everything adaptive happens inside those two calls, so a backend
/// only has to mix what it is handed.
///
/// Depth is latency: a sample waits in here for exactly as long as the
/// buffer is deep when it arrives. The buffer therefore starts each
/// talkspurt at the target and no deeper, and takes back anything above the
/// target that a burst of arrivals leaves behind.
#[derive(Debug)]
pub struct SpeakerBuffer {
    samples: VecDeque<f32>,
    floor: usize,
    ceiling: usize,
    /// Depth playout starts at.
    target: usize,
    /// Whether this talkspurt is being played out.
    primed: bool,
    /// The sender said this talkspurt is over (terminator frame).
    ended: bool,
    last_push: Instant,
    /// Samples played since the current shrink window began.
    window_played: usize,
    /// Shallowest the buffer has been in the current window.
    window_min_depth: usize,
    stats: JitterStats,
}

impl SpeakerBuffer {
    /// An empty buffer that will start playing at `cfg`'s floor.
    #[must_use]
    pub fn new(cfg: JitterConfig) -> Self {
        let floor = cfg.floor_samples();
        Self {
            samples: VecDeque::with_capacity(MAX_SPEAKER_BUFFER_SAMPLES),
            floor,
            ceiling: cfg.ceiling_samples(),
            target: floor,
            primed: false,
            ended: false,
            last_push: Instant::now(),
            window_played: 0,
            window_min_depth: usize::MAX,
            stats: JitterStats::default(),
        }
    }

    /// A buffer pre-filled with `samples` and already playing.
    ///
    /// For tests and probes that want audio out immediately; a real stream
    /// arrives through [`push`](Self::push) and primes itself.
    #[must_use]
    pub fn with_samples(cfg: JitterConfig, samples: impl IntoIterator<Item = f32>) -> Self {
        let mut buf = Self::new(cfg);
        buf.samples.extend(samples);
        buf.start_playout();
        buf
    }

    /// Samples waiting to be played.
    #[must_use]
    pub fn len(&self) -> usize {
        self.samples.len()
    }

    /// Whether nothing is waiting.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    /// The waiting samples, oldest first, for readers that must not drain
    /// (the recorder, the e2e tap).
    #[must_use]
    pub const fn samples(&self) -> &VecDeque<f32> {
        &self.samples
    }

    /// Depth playout currently starts at, in samples.
    #[must_use]
    pub const fn target(&self) -> usize {
        self.target
    }

    /// Whether the current talkspurt is being played out.
    #[must_use]
    pub const fn is_primed(&self) -> bool {
        self.primed
    }

    /// What this buffer has been through.
    #[must_use]
    pub const fn stats(&self) -> JitterStats {
        self.stats
    }

    /// Drop everything waiting and stop playout.
    pub fn clear(&mut self) {
        self.samples.clear();
        self.primed = false;
    }

    /// Adopt new limits, keeping the learned target inside them.
    pub fn retune(&mut self, cfg: JitterConfig) {
        self.floor = cfg.floor_samples();
        self.ceiling = cfg.ceiling_samples();
        self.target = self.target.clamp(self.floor, self.ceiling);
    }

    /// Queue decoded samples.
    ///
    /// Returns how many of the oldest samples were dropped to stay under the
    /// hard cap, which is zero unless playback has stopped draining.
    pub fn push(&mut self, samples: &[f32]) -> usize {
        self.samples.extend(samples.iter().copied());
        let dropped = self.samples.len().saturating_sub(MAX_SPEAKER_BUFFER_SAMPLES);
        if dropped > 0 {
            let _ = self.samples.drain(..dropped);
            self.stats.overflow_dropped = self.stats.overflow_dropped.saturating_add(dropped);
        }
        self.last_push = Instant::now();
        self.ended = false;
        if !self.primed && self.samples.len() >= self.target {
            self.start_playout();
        }
        dropped
    }

    /// The sender has finished this talkspurt.
    ///
    /// A talkspurt shorter than the target ("yes") would otherwise never reach
    /// it and never play, so this also starts playout of whatever is waiting.
    pub fn mark_ended(&mut self) {
        self.ended = true;
        if !self.primed && !self.samples.is_empty() {
            self.start_playout();
        }
    }

    /// Mix up to `out.len()` samples into `out`, scaled by `gain`.
    ///
    /// Returns how many were mixed. Zero while the buffer is waiting to reach
    /// its target; fewer than asked when it ran dry, which is where the
    /// target adapts.
    pub fn drain_into(&mut self, out: &mut [f32], gain: f32) -> usize {
        let now = Instant::now();
        if !self.primed {
            // Samples nobody is adding to any more - a terminator that was
            // lost, or a stream that stopped short of the target - are played
            // rather than held forever.
            let stale =
                !self.samples.is_empty() && now.duration_since(self.last_push) > LIVE_WINDOW;
            if !stale {
                return 0;
            }
            self.start_playout();
        }

        self.take_out_slack();

        let n = self.samples.len().min(out.len());
        let (a, b) = self.samples.as_slices();
        let from_a = n.min(a.len());
        for (dst, src) in out[..from_a].iter_mut().zip(&a[..from_a]) {
            *dst += *src * gain;
        }
        if from_a < n {
            for (dst, src) in out[from_a..n].iter_mut().zip(&b[..n - from_a]) {
                *dst += *src * gain;
            }
        }
        let _ = self.samples.drain(..n);
        self.window_played = self.window_played.saturating_add(n);

        if n < out.len() {
            self.ran_dry(now);
        }
        n
    }

    fn start_playout(&mut self) {
        self.primed = true;
        self.window_played = 0;
        self.window_min_depth = usize::MAX;
    }

    /// Book the current depth and, once a window has played, skip out
    /// whatever the buffer never dipped below.
    ///
    /// The shallowest depth over a window is the part of the buffer that
    /// was never needed: had those samples not been there, no callback in
    /// the window would have run dry. That is what a burst of arrivals
    /// (a stalled event loop catching up, a bunched network) leaves behind,
    /// and without this it would stay as added latency until the speaker
    /// next fell silent.
    fn take_out_slack(&mut self) {
        self.window_min_depth = self.window_min_depth.min(self.samples.len());
        if self.window_played < SHRINK_WINDOW_SAMPLES {
            return;
        }
        let slack = self.window_min_depth.saturating_sub(self.target);
        if slack >= SHRINK_MIN {
            self.skip(slack.min(SHRINK_MAX));
        }
        self.window_played = 0;
        self.window_min_depth = usize::MAX;
    }

    /// Drop the oldest `n` samples and smooth the seam.
    fn skip(&mut self, n: usize) {
        let n = n.min(self.samples.len().saturating_sub(SKIP_FADE));
        if n == 0 {
            return;
        }
        let before = self.samples.get(n - 1).copied().unwrap_or(0.0);
        let _ = self.samples.drain(..n);
        // The two sides of the seam are 20 ms apart in the signal, so their
        // values are unrelated. Ramp the difference out over a few
        // milliseconds rather than letting it land as a click.
        if let Some(&first) = self.samples.front() {
            let correction = before - first;
            let len = SKIP_FADE.min(self.samples.len());
            for (i, s) in self.samples.iter_mut().take(len).enumerate() {
                let t = i as f32 / len as f32;
                let w = 0.5 * (1.0 + (std::f32::consts::PI * t).cos());
                *s += correction * w;
            }
        }
        self.stats.shrinks = self.stats.shrinks.saturating_add(1);
        self.stats.skipped_samples = self.stats.skipped_samples.saturating_add(n);
    }

    /// The buffer could not fill the output. Decide what that meant.
    fn ran_dry(&mut self, now: Instant) {
        self.primed = false;
        if self.ended || now.duration_since(self.last_push) > LIVE_WINDOW {
            // A talkspurt ended without an underrun: the target was enough,
            // and may have been more than enough. Relax it a step.
            self.target = self.target.saturating_sub(RELAX_STEP).max(self.floor);
        } else {
            // Mid-talkspurt, and the next frame is not here yet: it is late
            // by more than the buffer could cover. Wait longer next time.
            self.stats.underruns = self.stats.underruns.saturating_add(1);
            self.target = (self.target + GROW_STEP).min(self.ceiling);
        }
    }
}

/// Shared per-speaker sample buffers.
///
/// The mixer writes decoded samples per session, and the platform
/// playback callback reads + mixes them in real time.
pub type SpeakerBuffers = Arc<Mutex<HashMap<u32, SpeakerBuffer>>>;

/// An observer of decoded audio, in the order a listener would hear it.
///
/// Exists for one reason: the e2e suite needs to compare what arrived against
/// what was spoken, and there is no other place to read that. The speaker
/// buffers are a ring the playback callback drains concurrently, so polling
/// them both misses audio and repeats it - the only faithful tap is here,
/// where each sample passes exactly once.
///
/// Notified for **concealment as well as decoded frames**, because
/// concealment is part of what the listener hears. A dump that omitted it
/// would show a clean stream where the real one had a gap.
pub type DecodedTap = Box<dyn Fn(u32, &[f32]) + Send + Sync>;

static DECODED_TAP: std::sync::OnceLock<DecodedTap> = std::sync::OnceLock::new();

/// Install the observer. The first call wins; later ones are ignored.
///
/// Deliberately write-once and global. It is test instrumentation, it is set
/// before any audio flows, and making it removable would add a lock on the
/// decode path to support something nothing needs.
pub fn set_decoded_tap(tap: DecodedTap) {
    let _ = DECODED_TAP.set(tap);
}

/// Hand `samples` to the observer, if one was installed.
///
/// A single `OnceLock` read when it was not, which is every production build.
fn notify_decoded(session: u32, samples: &[f32]) {
    if let Some(tap) = DECODED_TAP.get() {
        tap(session, samples);
    }
}

/// Shared per-speaker volume overrides (0.0 - 2.0, default 1.0).
///
/// Set from the UI when the user adjusts a specific speaker's volume
/// slider.  The playback callback reads these values during mixing.
pub type SpeakerVolumes = Arc<Mutex<HashMap<u32, f32>>>;

/// Number of samples per 10 ms at 48 kHz - the unit of Mumble's
/// `frame_number` field.  A packet that decodes to N samples consumes
/// `N / SAMPLES_PER_SEQ_UNIT` sequence units.
const SAMPLES_PER_SEQ_UNIT: u64 = 480;

/// The longest gap concealed with the decoder's PLC, in 10 ms units.
///
/// Sixty milliseconds: up to three lost 20 ms packets. Opus's concealment
/// extrapolates the last frame and sounds right for about that long; past it
/// the extrapolation is noise, and a gap that size is a pause or a loss burst
/// the jitter target absorbs by itself.
const MAX_PLC_UNITS: u64 = 6;

/// Per-speaker decoder state.
struct SpeakerDecoder {
    decoder: Box<dyn AudioDecoder>,
    last_seq: Option<u64>,
    /// Sequence number we expect the next packet from this speaker to
    /// carry, computed as `packet.sequence + decoded_samples / 480`
    /// after every successful decode.  Used for sample-accurate gap
    /// detection that works regardless of how many Opus frames the
    /// sender packs into each network packet.
    expected_next_seq: Option<u64>,
    prev_last_sample: Option<f32>,
    /// The last sample this speaker queued, for smoothing a seam when a
    /// gap is too long to conceal.
    last_queued: Option<f32>,
    /// Set to true when the decoder is fresh (just created or reset)
    /// and the very next decoded frame must be faded in from silence.
    /// Without this fade, the first frame's first sample can start at
    /// near-full amplitude (Opus has no warm-up lookahead), producing
    /// an audible click/pop at the start of every utterance and after
    /// every stream restart.
    needs_fade_in: bool,
    last_activity: Instant,
}

impl SpeakerDecoder {
    fn new(format: AudioFormat) -> Result<Self> {
        let decoder = OpusDecoder::new(format)?;
        Ok(Self {
            decoder: Box::new(decoder),
            last_seq: None,
            expected_next_seq: None,
            prev_last_sample: None,
            last_queued: None,
            needs_fade_in: true,
            last_activity: Instant::now(),
        })
    }
}

/// Manages per-speaker audio decoders and writes decoded PCM into
/// shared per-speaker buffers that the platform playback callback
/// reads and mixes.
pub struct AudioMixer {
    speakers: HashMap<u32, SpeakerDecoder>,
    buffers: SpeakerBuffers,
    format: AudioFormat,
    jitter: JitterConfig,
}

impl std::fmt::Debug for AudioMixer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AudioMixer")
            .field("active_speakers", &self.speakers.len())
            .field("format", &self.format)
            .field("jitter", &self.jitter)
            .finish_non_exhaustive()
    }
}

impl AudioMixer {
    /// Create a new mixer that writes decoded audio into `buffers`.
    pub fn new(buffers: SpeakerBuffers, format: AudioFormat) -> Self {
        Self {
            speakers: HashMap::new(),
            buffers,
            format,
            jitter: JitterConfig::default(),
        }
    }

    /// The jitter limits every new speaker buffer starts with.
    #[must_use]
    pub fn with_jitter(mut self, jitter: JitterConfig) -> Self {
        self.jitter = jitter;
        self
    }

    /// Change the jitter limits, for new buffers and every live one.
    pub fn set_jitter(&mut self, jitter: JitterConfig) {
        self.jitter = jitter;
        if let Ok(mut bufs) = self.buffers.lock() {
            for buf in bufs.values_mut() {
                buf.retune(jitter);
            }
        }
    }

    /// The jitter limits in force.
    #[must_use]
    pub const fn jitter(&self) -> JitterConfig {
        self.jitter
    }

    /// Return a clone of the shared speaker buffers handle.
    pub fn buffers(&self) -> SpeakerBuffers {
        self.buffers.clone()
    }

    /// Decode an incoming audio packet from `session` and queue the
    /// decoded samples in the corresponding speaker buffer.
    pub fn feed(&mut self, session: u32, packet: &EncodedPacket) -> Result<()> {
        // Detect stream restart: if the incoming sequence is much lower
        // than the last seen, the sender started a new voice stream.
        // Drop the stale decoder so Opus state from the old stream does
        // not contaminate the new one (handles lost terminators).
        if let Some(speaker) = self.speakers.get(&session) {
            if let Some(prev) = speaker.last_seq {
                if prev > packet.sequence && prev - packet.sequence > 10 {
                    tracing::debug!(
                        "stream restart detected: session {session} seq {prev} -> {}, resetting decoder",
                        packet.sequence,
                    );
                    drop(self.speakers.remove(&session));
                }
            }
        }

        let speaker = match self.speakers.entry(session) {
            std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
            std::collections::hash_map::Entry::Vacant(e) => {
                e.insert(SpeakerDecoder::new(self.format)?)
            }
        };
        speaker.last_activity = Instant::now();
        speaker.last_seq = Some(packet.sequence);

        // Gap handling. The expected next sequence comes from the previous
        // packet's decoded sample count (in 10 ms units, the protocol's
        // sequence unit), so it is exact whatever the sender's packet
        // length. A short gap is a lost packet or two: conceal it with the
        // decoder's own PLC, which keeps the timeline and sounds like the
        // speaker rather than like a hole. A long gap is a pause or a loss
        // burst: nothing is inserted, the seam is smoothed, and the jitter
        // buffer's target takes care of the timing on its own. Filling a
        // long gap - as this once did, with up to 400 ms of zeros - put
        // that much silence ahead of the real audio and left it there as
        // latency for the rest of the talkspurt.
        let gap_units = detect_gap(speaker.expected_next_seq, packet.sequence);
        let mut discontinuity = false;
        if gap_units > 0 {
            if gap_units <= MAX_PLC_UNITS {
                conceal(speaker, session, gap_units, &self.buffers, self.jitter)?;
            } else {
                discontinuity = true;
            }
        }
        if discontinuity {
            // Arm the seam correction with the last sample actually queued,
            // so the new frame ramps from where the old audio left off.
            speaker.prev_last_sample = speaker.last_queued.or(Some(0.0));
        }

        let mut frame = speaker.decoder.decode(packet)?;
        let consumed_units = frame_seq_units(&frame, self.format);
        speaker.expected_next_seq = Some(packet.sequence + consumed_units);

        // Cold-start fade-in: a fresh decoder has no warm-up state,
        // and Opus's first decoded sample can be at full speech
        // amplitude.  Pushing that straight into the buffer creates
        // a step from silence to ~0.9 - audible as a pop at the
        // start of every utterance.  Apply a 5 ms cosine fade-in to
        // the first frame so the buffer ramps smoothly out of
        // silence.  Subsequent frames from the same decoder are
        // continuous (libopus is stateful) and need no further
        // intervention.
        if speaker.needs_fade_in {
            apply_cold_start_fade_in(&mut frame);
            speaker.needs_fade_in = false;
        } else if speaker.prev_last_sample.is_some() {
            // Only apply the boundary crossfade after a real
            // discontinuity event.  libopus's stateful decode is
            // naturally continuous between consecutive packets, so
            // applying a crossfade on every frame would distort the
            // first 24 samples of every 10 ms window - audible as a
            // constant 100 Hz buzz riding on top of loud audio.
            apply_boundary_crossfade(&mut frame, &mut speaker.prev_last_sample);
        }
        // For continuous decode, do NOT track prev_last_sample - we
        // want the crossfade dormant until the next discontinuity.
        speaker.prev_last_sample = None;
        speaker.last_queued = frame.as_f32_samples().last().copied();
        push_samples(&self.buffers, session, frame.as_f32_samples(), self.jitter);
        Ok(())
    }

    /// Reset the decoder for a speaker whose audio stream has ended
    /// (e.g. terminator received).  The sample buffer is kept so the
    /// playback callback can drain remaining audio, and told the
    /// talkspurt is over so a short one plays out rather than waiting
    /// for a depth it will never reach.  A fresh decoder will be
    /// created automatically when the next stream arrives.
    pub fn reset_speaker(&mut self, session: u32) {
        drop(self.speakers.remove(&session));
        if let Ok(mut bufs) = self.buffers.lock() {
            if let Some(buf) = bufs.get_mut(&session) {
                buf.mark_ended();
            }
        }
    }

    /// Remove all state for a speaker (decoder and sample buffer).
    ///
    /// Called when the user leaves the server.  Unlike
    /// [`reset_speaker`](Self::reset_speaker) this also drops the
    /// sample buffer - there is no further stream to drain.
    pub fn remove_speaker(&mut self, session: u32) {
        drop(self.speakers.remove(&session));
        if let Ok(mut bufs) = self.buffers.lock() {
            let _ = bufs.remove(&session);
        }
    }

    /// Free per-speaker memory that is no longer needed:
    ///
    /// * decoders idle longer than [`SPEAKER_TIMEOUT_SECS`] (their
    ///   terminator packet was lost), including their buffers, and
    /// * drained buffers whose decoder is already gone (stream ended
    ///   via terminator and playback finished draining).
    ///
    /// Each retained buffer holds its full
    /// [`MAX_SPEAKER_BUFFER_SAMPLES`] capacity (~77 KB), so this keeps
    /// long sessions from accumulating one per user who ever spoke.
    pub fn remove_inactive_speakers(&mut self) {
        let timeout = Duration::from_secs(SPEAKER_TIMEOUT_SECS);
        let now = Instant::now();
        let stale: Vec<u32> = self
            .speakers
            .iter()
            .filter(|(_, s)| now.duration_since(s.last_activity) > timeout)
            .map(|(&id, _)| id)
            .collect();
        for id in &stale {
            let _ = self.speakers.remove(id);
        }
        if let Ok(mut bufs) = self.buffers.lock() {
            for id in &stale {
                let _ = bufs.remove(id);
            }
            // Drop drained buffers of ended streams.  Non-empty buffers
            // are still being drained by the playback callback and stay.
            bufs.retain(|id, buf| !buf.is_empty() || self.speakers.contains_key(id));
        }
    }

    /// Reset all state (all speakers removed).
    pub fn reset(&mut self) {
        self.speakers.clear();
        if let Ok(mut bufs) = self.buffers.lock() {
            bufs.clear();
        }
    }
}

/// How many 10 ms units are missing between the packet we expected and the
/// one that arrived. Zero when nothing is, including when the incoming
/// packet is older than expected (reordering, which arrives too late to do
/// anything about and is decoded as it comes).
fn detect_gap(expected: Option<u64>, incoming: u64) -> u64 {
    let Some(expected) = expected else { return 0 };
    incoming.saturating_sub(expected)
}

/// Number of 10 ms sequence units the given decoded frame represents.
fn frame_seq_units(frame: &AudioFrame, format: AudioFormat) -> u64 {
    let bytes_per_sample = format.sample_format.byte_width().max(1) as u64;
    let channels = format.channels.max(1) as u64;
    let total_samples = frame.data.len() as u64 / bytes_per_sample / channels;
    (total_samples / SAMPLES_PER_SEQ_UNIT).max(1)
}

/// Cover `units * 10 ms` of missing audio with the decoder's concealment.
///
/// Opus's PLC extrapolates from the decoder's own state, so the frames come
/// out continuous with what preceded them and the decoder is left in the
/// right state for the packet that follows - which is why this is done
/// before that packet is decoded, not after.
fn conceal(
    speaker: &mut SpeakerDecoder,
    session: u32,
    units: u64,
    buffers: &SpeakerBuffers,
    jitter: JitterConfig,
) -> Result<()> {
    let mut remaining = (units as usize) * (SAMPLES_PER_SEQ_UNIT as usize);
    // A decoder that conceals in 10 ms frames needs six calls for the longest
    // gap; the bound is against one that returns nothing.
    for _ in 0..(MAX_PLC_UNITS as usize) {
        if remaining == 0 {
            break;
        }
        let frame = speaker.decoder.decode_lost()?;
        let samples = frame.as_f32_samples();
        if samples.is_empty() {
            break;
        }
        speaker.last_queued = samples.last().copied();
        push_samples(buffers, session, samples, jitter);
        remaining = remaining.saturating_sub(samples.len());
    }
    Ok(())
}

/// Queue decoded (or concealed) samples for `session`, telling the tap.
fn push_samples(buffers: &SpeakerBuffers, session: u32, samples: &[f32], jitter: JitterConfig) {
    notify_decoded(session, samples);
    if let Ok(mut bufs) = buffers.lock() {
        let buf = bufs
            .entry(session)
            .or_insert_with(|| SpeakerBuffer::new(jitter));
        let dropped = buf.push(samples);
        // The hard cap is the last resort for live audio arriving faster
        // than playback drains it (an Android app in the background); on
        // the desktop the jitter buffer keeps depth far below it.
        if dropped > 0 {
            tracing::debug!(
                "push_samples: dropped {dropped} oldest samples for session {session} (buffer overflow, playback falling behind)"
            );
        }
    }
}

/// Apply a short correction ramp at the start of a decoded frame to
/// smooth sample-level discontinuities at the boundary (same algorithm
/// as `InboundPipeline::apply_boundary_crossfade`).
fn apply_boundary_crossfade(frame: &mut AudioFrame, prev_last_sample: &mut Option<f32>) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static FRAME_COUNT: AtomicU64 = AtomicU64::new(0);
    static CORRECTED_COUNT: AtomicU64 = AtomicU64::new(0);

    if frame.format.sample_format != SampleFormat::F32 {
        return;
    }

    let count = FRAME_COUNT.fetch_add(1, Ordering::Relaxed) + 1;

    if let Some(prev_val) = *prev_last_sample {
        let samples = frame.as_f32_samples_mut();
        if !samples.is_empty() {
            let correction = prev_val - samples[0];
            if correction.abs() > 0.002 {
                let corrected = CORRECTED_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
                let cf_len = CROSSFADE_LEN.min(samples.len());
                if count.is_multiple_of(100) {
                    tracing::debug!(
                        "crossfade: frame={count}, corrected={corrected}/{count} ({:.0}%), delta={correction:.4}, cf_len={cf_len}",
                        corrected as f64 / count as f64 * 100.0,
                    );
                }
                for (i, sample) in samples.iter_mut().take(cf_len).enumerate() {
                    let t = i as f32 / cf_len as f32;
                    let decay = 0.5 * (1.0 + (std::f32::consts::PI * t).cos());
                    *sample += correction * decay;
                }
            }
        }
    }

    let samples = frame.as_f32_samples();
    *prev_last_sample = samples.last().copied();
}

/// Apply a cosine fade-in to the start of a frame produced by a fresh
/// decoder.  Opus has no warm-up lookahead, so the very first decoded
/// sample after creating a new decoder can be at full speech amplitude
/// (e.g. ~0.9).  Pushing that straight into the speaker buffer creates
/// a step from silence to ~0.9 - audible as a pop at the start of every
/// utterance and after every stream restart.  A 5 ms cosine fade-in is
/// short enough to be inaudible to the listener (1/4 of a phoneme) but
/// long enough to remove the broadband click.
fn apply_cold_start_fade_in(frame: &mut AudioFrame) {
    if frame.format.sample_format != SampleFormat::F32 {
        return;
    }
    /// 5 ms at 48 kHz - short enough to be inaudible perceptually
    /// but long enough to spread the spectral energy of the onset
    /// below the click range.
    const FADE_LEN: usize = 240;

    let samples = frame.as_f32_samples_mut();
    let n = FADE_LEN.min(samples.len());
    for (i, sample) in samples.iter_mut().take(n).enumerate() {
        let t = i as f32 / n as f32;
        // Equal-power cosine fade: 0.5 - 0.5*cos(pi*t) goes 0 -> 1
        // with zero derivative at both endpoints.
        let w = 0.5 - 0.5 * (std::f32::consts::PI * t).cos();
        *sample *= w;
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;
    use crate::audio::sample::AudioFormat;

    fn make_buffers() -> SpeakerBuffers {
        Arc::new(Mutex::new(HashMap::new()))
    }

    /// A silent 20 ms Opus packet and the encoder that made it.
    #[cfg(feature = "opus-codec")]
    fn silent_packet() -> EncodedPacket {
        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        enc.encode(&silent).unwrap()
    }

    /// The same payload at another sequence number.
    #[cfg(feature = "opus-codec")]
    fn at_seq(template: &EncodedPacket, sequence: u64) -> EncodedPacket {
        EncodedPacket {
            data: template.data.clone(),
            sequence,
            frame_samples: template.frame_samples,
        }
    }

    // -- SpeakerBuffer -------------------------------------------------

    #[test]
    fn a_talkspurt_starts_playing_at_the_target_and_not_before() {
        // Depth is latency: the first frame waits for the second, and no
        // longer. The 100 ms prime this replaces made it wait for the fifth.
        let mut buf = SpeakerBuffer::new(JitterConfig::default());
        assert_eq!(buf.target(), 1920, "40 ms floor at 48 kHz");

        let mut out = [0.0_f32; 480];
        let _ = buf.push(&[0.5; 960]);
        assert!(!buf.is_primed());
        assert_eq!(buf.drain_into(&mut out, 1.0), 0, "one frame is not enough");

        let _ = buf.push(&[0.5; 960]);
        assert!(buf.is_primed(), "two frames reach the target");
        assert_eq!(buf.drain_into(&mut out, 1.0), 480);
        assert!(out.iter().all(|&s| (s - 0.5).abs() < 1e-6));
    }

    #[test]
    fn a_short_utterance_plays_once_the_sender_says_it_is_over() {
        // "Yes." can be one frame long. Without the terminator starting
        // playout it would sit below the target until it went stale.
        let mut buf = SpeakerBuffer::new(JitterConfig::default());
        let _ = buf.push(&[0.3; 960]);
        let mut out = [0.0_f32; 480];
        assert_eq!(buf.drain_into(&mut out, 1.0), 0);

        buf.mark_ended();
        assert!(buf.is_primed());
        assert_eq!(buf.drain_into(&mut out, 1.0), 480);
    }

    #[test]
    fn running_dry_mid_talkspurt_grows_the_target_and_reprimes() {
        // A late packet is the one thing a jitter buffer learns from.
        let mut buf = SpeakerBuffer::new(JitterConfig::default());
        let _ = buf.push(&[0.5; 1920]);
        let mut out = [0.0_f32; 480];
        for _ in 0..4 {
            assert_eq!(buf.drain_into(&mut out, 1.0), 480);
        }
        // Empty, sender still live (just pushed): this is an underrun.
        assert_eq!(buf.drain_into(&mut out, 1.0), 0);
        assert_eq!(buf.stats().underruns, 1);
        assert_eq!(buf.target(), 1920 + GROW_STEP);
        assert!(!buf.is_primed(), "waits for the new target");

        // The old target no longer primes; the new one does.
        let _ = buf.push(&[0.5; 1920]);
        assert!(!buf.is_primed());
        let _ = buf.push(&[0.5; GROW_STEP]);
        assert!(buf.is_primed());
    }

    #[test]
    fn running_dry_after_the_end_relaxes_the_target_toward_the_floor() {
        let mut buf = SpeakerBuffer::new(JitterConfig::default());
        // Pretend an earlier underrun raised the target.
        buf.target = 1920 + 2 * GROW_STEP;
        let _ = buf.push(&[0.5; 4000]);
        buf.mark_ended();
        let mut out = [0.0_f32; 480];
        while buf.drain_into(&mut out, 1.0) == 480 {}
        assert_eq!(buf.stats().underruns, 0, "the end of a sentence is not an underrun");
        assert_eq!(buf.target(), 1920 + 2 * GROW_STEP - RELAX_STEP);
    }

    #[test]
    fn the_target_never_leaves_its_limits() {
        let cfg = JitterConfig {
            floor_ms: 20,
            ceiling_ms: 60,
        };
        let mut buf = SpeakerBuffer::new(cfg);
        let mut out = [0.0_f32; 480];
        for _ in 0..10 {
            let _ = buf.push(&[0.5; 2880]);
            while buf.drain_into(&mut out, 1.0) == 480 {}
        }
        assert_eq!(buf.target(), cfg.ceiling_samples(), "capped at the ceiling");

        buf.target = cfg.floor_samples();
        let _ = buf.push(&[0.5; 960]);
        buf.mark_ended();
        while buf.drain_into(&mut out, 1.0) == 480 {}
        assert_eq!(buf.target(), cfg.floor_samples(), "never below the floor");
    }

    #[test]
    fn depth_the_buffer_never_needed_is_skipped_out() {
        // A burst left the buffer 40 ms deeper than its target. Over a
        // window of steady playout that slack is never touched, so it is
        // pure latency - and it comes back out, a frame at a time.
        let mut buf = SpeakerBuffer::new(JitterConfig::default());
        let _ = buf.push(&[0.5; 1920 + 1920]);
        let mut out = [0.0_f32; 480];
        // Steady state: every 480 played, 480 arrive.
        let callbacks = SHRINK_WINDOW_SAMPLES / 480 + 2;
        for _ in 0..callbacks {
            assert_eq!(buf.drain_into(&mut out, 1.0), 480);
            let _ = buf.push(&[0.5; 480]);
        }
        assert_eq!(buf.stats().shrinks, 1);
        assert_eq!(buf.stats().skipped_samples, SHRINK_MAX);
        assert_eq!(buf.len(), 1920 + 1920 - SHRINK_MAX);
    }

    #[test]
    fn a_skip_seam_is_ramped_not_stepped() {
        let mut buf = SpeakerBuffer::with_samples(JitterConfig::default(), std::iter::empty());
        // 960 samples at +0.8 then 960 at -0.8: skipping the first 960
        // would put -0.8 right after nothing.
        buf.samples.extend(std::iter::repeat_n(0.8_f32, 960));
        buf.samples.extend(std::iter::repeat_n(-0.8_f32, 960));
        buf.skip(960);
        assert_eq!(buf.len(), 960);
        let first = buf.samples()[0];
        assert!(
            (first - 0.8).abs() < 1e-3,
            "the seam starts where the old audio was: {first}"
        );
        let settled = buf.samples()[SKIP_FADE];
        assert!((settled + 0.8).abs() < 1e-6, "and reaches the new audio: {settled}");
    }

    #[test]
    fn overflow_drops_the_oldest_and_counts_it() {
        let mut buf = SpeakerBuffer::new(JitterConfig::default());
        let count = MAX_SPEAKER_BUFFER_SAMPLES + 5_000;
        let data: Vec<f32> = (0..count).map(|i| i as f32 * 0.001).collect();
        let dropped = buf.push(&data);
        assert_eq!(dropped, 5_000);
        assert_eq!(buf.len(), MAX_SPEAKER_BUFFER_SAMPLES);
        assert_eq!(buf.stats().overflow_dropped, 5_000);
        let first_kept = buf.samples()[0];
        let expected = 5_000_f32 * 0.001;
        assert!((first_kept - expected).abs() < 1e-4, "oldest kept: {first_kept}");
    }

    #[test]
    fn with_samples_is_ready_to_play() {
        let mut buf = SpeakerBuffer::with_samples(JitterConfig::default(), vec![0.25; 10]);
        let mut out = [0.0_f32; 10];
        assert_eq!(buf.drain_into(&mut out, 2.0), 10);
        assert!(out.iter().all(|&s| (s - 0.5).abs() < 1e-6), "gain applied");
    }

    #[test]
    fn retune_keeps_the_learned_target_inside_the_new_limits() {
        let mut buf = SpeakerBuffer::new(JitterConfig::default());
        buf.target = ms_to_samples(150);
        buf.retune(JitterConfig {
            floor_ms: 20,
            ceiling_ms: 100,
        });
        assert_eq!(buf.target(), ms_to_samples(100));
        buf.retune(JitterConfig {
            floor_ms: 120,
            ceiling_ms: 200,
        });
        assert_eq!(buf.target(), ms_to_samples(120));
    }

    #[test]
    fn the_config_floors_and_caps_itself() {
        let silly = JitterConfig {
            floor_ms: 0,
            ceiling_ms: 5_000,
        };
        assert_eq!(silly.floor_samples(), ms_to_samples(JitterConfig::MIN_FLOOR_MS));
        assert_eq!(silly.ceiling_samples(), MAX_SPEAKER_BUFFER_SAMPLES);
        let inverted = JitterConfig {
            floor_ms: 100,
            ceiling_ms: 50,
        };
        assert_eq!(inverted.ceiling_samples(), inverted.floor_samples());
    }

    // -- AudioMixer ----------------------------------------------------

    #[cfg(feature = "opus-codec")]
    #[test]
    fn the_decoded_tap_sees_audio_and_concealment_in_order() {
        // The tap exists so a test can compare what a listener heard against
        // what was spoken, and both halves of "heard" matter: decoded frames
        // *and* the concealment that covers a gap. A tap that saw only the
        // first would show a clean stream where the real one had a hole,
        // which is the failure it is meant to detect.
        //
        // `set_decoded_tap` is write-once and global, so this is the only test
        // that may install one - a second would be silently ignored and would
        // then assert against the first one's channel.
        //
        // It is also global across the *whole binary*, and the test harness runs
        // these in parallel, so every other test that decodes audio arrives on
        // this channel too. Hence the private session id below and the filter:
        // asserting on the first event to turn up passes or fails depending on
        // which test happened to run alongside.
        const SESSION: u32 = 909_090;
        let (tx, rx) = std::sync::mpsc::channel::<(u32, usize)>();
        let tx = Mutex::new(tx);
        set_decoded_tap(Box::new(move |session, samples| {
            if let Ok(tx) = tx.lock() {
                let _ = tx.send((session, samples.len()));
            }
        }));

        /// The next event for our own session, ignoring other tests' traffic.
        fn ours(rx: &std::sync::mpsc::Receiver<(u32, usize)>, session: u32) -> Option<usize> {
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok((got, len)) if got == session => return Some(len),
                    Ok(_) | Err(_) => continue,
                }
            }
            None
        }

        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs, AudioFormat::MONO_48KHZ_F32);
        let template = silent_packet();
        mixer.feed(SESSION, &template).unwrap();
        // seq 0 covered units 0-1; seq 4 leaves units 2-3 missing: one
        // 20 ms hole, concealed before the frame is decoded.
        mixer.feed(SESSION, &at_seq(&template, 4)).unwrap();

        assert_eq!(ours(&rx, SESSION), Some(960), "the first frame");

        // The concealment arrives in whatever frames the decoder conceals in
        // (10 ms each, for Opus), so what matters is not how many events it
        // takes but that they restore exactly the missing 20 ms - a listener
        // whose timeline drifts by a frame per loss is the failure here.
        let mut concealed = 0_usize;
        let mut events = 0_u32;
        while concealed < 960 {
            let len = ours(&rx, SESSION).expect("the concealment was not observed");
            assert!(len > 0, "an empty concealment frame is not concealment");
            concealed += len;
            events += 1;
            assert!(events < 10, "concealment did not terminate");
        }
        assert_eq!(concealed, 960, "concealment must restore the gap exactly");
        assert_eq!(ours(&rx, SESSION), Some(960), "the frame after the gap");
    }

    #[test]
    fn new_mixer_has_no_speakers() {
        let bufs = make_buffers();
        let mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        assert_eq!(mixer.speakers.len(), 0);
        assert!(bufs.lock().unwrap().is_empty());
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn feed_creates_speaker_and_buffers_samples() {
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        mixer.feed(42, &silent_packet()).unwrap();
        assert_eq!(mixer.speakers.len(), 1);
        let locked = bufs.lock().unwrap();
        assert!(locked.contains_key(&42));
        assert!(!locked[&42].is_empty());
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn new_speaker_buffers_carry_the_mixers_jitter_limits() {
        let bufs = make_buffers();
        let cfg = JitterConfig {
            floor_ms: 60,
            ceiling_ms: 120,
        };
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32).with_jitter(cfg);
        mixer.feed(42, &silent_packet()).unwrap();
        assert_eq!(bufs.lock().unwrap()[&42].target(), cfg.floor_samples());

        let tighter = JitterConfig {
            floor_ms: 20,
            ceiling_ms: 40,
        };
        mixer.set_jitter(tighter);
        assert_eq!(mixer.jitter(), tighter);
        assert_eq!(
            bufs.lock().unwrap()[&42].target(),
            tighter.ceiling_samples(),
            "a live buffer is retuned in place"
        );
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn two_speakers_have_independent_buffers() {
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        let pkt1 = silent_packet();
        let pkt2 = at_seq(&pkt1, 0);

        mixer.feed(10, &pkt1).unwrap();
        mixer.feed(20, &pkt2).unwrap();

        assert_eq!(mixer.speakers.len(), 2);
        let locked = bufs.lock().unwrap();
        assert!(locked.contains_key(&10));
        assert!(locked.contains_key(&20));
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn remove_speaker_drops_decoder_and_buffer() {
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        mixer.feed(42, &silent_packet()).unwrap();
        assert!(bufs.lock().unwrap().contains_key(&42));

        mixer.remove_speaker(42);
        assert_eq!(mixer.speakers.len(), 0);
        assert!(
            !bufs.lock().unwrap().contains_key(&42),
            "buffer must be freed with the speaker"
        );
    }

    #[test]
    fn remove_inactive_speakers_prunes_drained_orphan_buffers() {
        // A buffer whose decoder is gone (terminator received) and that
        // playback has fully drained must be removed; a still-draining
        // buffer must be kept.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);

        {
            let mut locked = bufs.lock().unwrap();
            // Drained orphan: stream ended, playback consumed everything.
            let _ = locked.insert(7, SpeakerBuffer::new(JitterConfig::default()));
            // Still-draining orphan: terminator received but samples remain.
            let _ = locked.insert(
                8,
                SpeakerBuffer::with_samples(JitterConfig::default(), [0.5]),
            );
        }

        mixer.remove_inactive_speakers();

        let locked = bufs.lock().unwrap();
        assert!(
            !locked.contains_key(&7),
            "drained orphan buffer must be pruned"
        );
        assert!(
            locked.contains_key(&8),
            "non-empty buffer must keep draining"
        );
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn remove_inactive_speakers_keeps_active_speaker_buffers() {
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        mixer.feed(42, &silent_packet()).unwrap();

        // Drain the buffer: even empty, it must survive while the
        // speaker's decoder is live (mid-utterance).
        bufs.lock().unwrap().get_mut(&42).unwrap().clear();

        mixer.remove_inactive_speakers();

        assert_eq!(mixer.speakers.len(), 1, "recently active decoder kept");
        assert!(
            bufs.lock().unwrap().contains_key(&42),
            "active speaker's buffer must not be pruned"
        );
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn reset_clears_everything() {
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        mixer.feed(42, &silent_packet()).unwrap();

        mixer.reset();
        assert_eq!(mixer.speakers.len(), 0);
        assert!(bufs.lock().unwrap().is_empty());
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn a_short_gap_is_concealed_with_plc() {
        // One lost 20 ms packet: the decoder fills it, so the playback
        // timeline keeps its alignment and the listener hears the speaker's
        // own voice extrapolated rather than a hole.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        let template = silent_packet();

        mixer.feed(1, &template).unwrap();
        let after_first = bufs.lock().unwrap()[&1].len();
        mixer.feed(1, &at_seq(&template, 2)).unwrap();
        let after_second = bufs.lock().unwrap()[&1].len();
        let per_frame = after_second - after_first;
        assert_eq!(per_frame, 960);

        // seq 6 where 4 was expected: 2 units = one 20 ms packet lost.
        mixer.feed(1, &at_seq(&template, 6)).unwrap();
        let after_gap = bufs.lock().unwrap()[&1].len();
        assert_eq!(
            after_gap - after_second,
            2 * per_frame,
            "one concealed frame plus the real one"
        );
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn a_long_gap_is_a_discontinuity_not_a_fill() {
        // 160 ms missing is a pause or a loss burst. The 400 ms of zeros
        // this used to insert were played ahead of the real audio and
        // stayed in the buffer as latency until the speaker next fell
        // silent - the ratchet the jitter buffer exists to remove.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        let template = silent_packet();

        mixer.feed(1, &template).unwrap();
        let after_first = bufs.lock().unwrap()[&1].len();
        // seq 20 where 2 was expected: 18 units.
        mixer.feed(1, &at_seq(&template, 20)).unwrap();
        let after_gap = bufs.lock().unwrap()[&1].len();
        assert_eq!(after_gap - after_first, 960, "only the real frame was queued");
        // The seam was smoothed and the crossfade is dormant again.
        assert!(mixer.speakers[&1].prev_last_sample.is_none());
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn concealment_never_exceeds_its_cap() {
        // Whatever the gap, PLC adds at most MAX_PLC_UNITS worth of audio,
        // so a gap can never push a buffer toward its hard cap and evict
        // real audio the way a 400 ms fill once did.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        let template = silent_packet();
        mixer.feed(1, &template).unwrap();
        let before = bufs.lock().unwrap()[&1].len();
        // Exactly the cap: 6 units missing (expected 2, got 8).
        mixer.feed(1, &at_seq(&template, 8)).unwrap();
        let added = bufs.lock().unwrap()[&1].len() - before;
        assert!(
            added <= 960 + (MAX_PLC_UNITS as usize) * (SAMPLES_PER_SEQ_UNIT as usize),
            "added {added}"
        );
        assert!(added > 960, "the gap was concealed at all");
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn multi_frame_per_packet_does_not_inject_anything() {
        // Regression: senders that pack multiple Opus frames per
        // network packet make the sequence number jump by more than 1
        // per packet.  The previous heuristic learned step=1 from the
        // first pair and then injected fake PLC frames at every
        // multi-frame packet, causing audible clicks.  The
        // sample-accurate detector must absorb this without concealing
        // anything.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        let template = silent_packet();

        // First packet: seq = 0 (1 packet = 20 ms = 2 protocol units).
        mixer.feed(7, &template).unwrap();
        let after_first = bufs.lock().unwrap()[&7].len();
        // 20 ms decoded = 960 samples.
        assert_eq!(after_first, 960);

        // Subsequent packets: seq advances by 2 per packet (matching
        // the 20 ms frame size).  Nothing extra should ever be queued.
        let mut prev_len = after_first;
        for i in 1..10_u64 {
            mixer.feed(7, &at_seq(&template, i * 2)).unwrap();
            let len = bufs.lock().unwrap()[&7].len();
            let added = len - prev_len;
            assert_eq!(
                added, 960,
                "iteration {i}: each packet must decode to exactly 960 samples \
                 with no concealment (added={added})"
            );
            prev_len = len;
        }
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn continuous_decode_does_not_arm_crossfade() {
        // Regression: applying a boundary crossfade on every successful
        // decode produces a 100 Hz buzz on top of loud audio because
        // the first 24 samples of each 10 ms frame are warped toward
        // the previous frame's last sample.  Continuous decode flow
        // must leave `prev_last_sample` cleared so the crossfade stays
        // dormant until a real discontinuity.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs, AudioFormat::MONO_48KHZ_F32);
        let template = silent_packet();

        for i in 0..5_u64 {
            mixer.feed(11, &at_seq(&template, i * 2)).unwrap();
            let speaker = mixer.speakers.get(&11).unwrap();
            assert!(
                speaker.prev_last_sample.is_none(),
                "iteration {i}: continuous decode must leave prev_last_sample = None, \
                 found {:?}",
                speaker.prev_last_sample
            );
        }
    }

    #[test]
    fn cold_start_fade_in_attenuates_first_240_samples() {
        // Regression: a fresh decoder's first frame can begin at full
        // speech amplitude (Opus has no warm-up lookahead).  Feeding
        // that straight into the buffer creates a silence -> ~0.9 step,
        // audible as a pop at the start of every utterance.  The
        // cold-start fade-in must attenuate the first 5 ms of the very
        // first frame.
        let mut frame = AudioFrame {
            data: vec![0u8; 960 * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        // Fill with constant 0.8 amplitude (worst case onset).
        for chunk in frame.data.chunks_exact_mut(4) {
            chunk.copy_from_slice(&0.8_f32.to_le_bytes());
        }

        apply_cold_start_fade_in(&mut frame);

        let samples = frame.as_f32_samples();
        // First sample must be exactly zero (fade starts at w=0).
        assert!(
            samples[0].abs() < 1e-6,
            "first sample after cold-start fade must be 0, got {}",
            samples[0]
        );
        // Sample at the 240-sample fade endpoint should be near 0.8
        // (cosine fade reaches w=1 at t=1).
        assert!(
            (samples[239] - 0.8).abs() < 0.05,
            "sample at end of fade should be ~0.8, got {}",
            samples[239]
        );
        // Samples after the fade must be untouched.
        for &s in &samples[240..480] {
            assert!(
                (s - 0.8).abs() < 1e-6,
                "samples past fade window must be unchanged, got {s}"
            );
        }
        // Monotonically non-decreasing through the fade window so we
        // know there is no overshoot or wobble.
        for i in 1..240 {
            assert!(
                samples[i] + 1e-6 >= samples[i - 1],
                "fade must be monotonic non-decreasing at {i}"
            );
        }
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn fresh_speaker_decoder_marks_needs_fade_in() {
        // The needs_fade_in flag must be true on creation and false
        // after the first feed, so subsequent frames are continuous
        // and never re-faded in mid-utterance.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs, AudioFormat::MONO_48KHZ_F32);
        let template = silent_packet();

        mixer.feed(17, &template).unwrap();
        assert!(
            !mixer.speakers.get(&17).unwrap().needs_fade_in,
            "needs_fade_in must be cleared after the first decode"
        );

        // Subsequent feeds keep the flag false.
        for i in 1..3_u64 {
            mixer.feed(17, &at_seq(&template, i * 2)).unwrap();
            assert!(
                !mixer.speakers.get(&17).unwrap().needs_fade_in,
                "needs_fade_in must stay false on iteration {i}"
            );
        }
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn interleaved_speakers_produce_independent_outputs() {
        // Regression: the old single-decoder design would corrupt
        // decoder state when packets from different speakers were
        // interleaved. This test verifies that interleaving is safe.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        let pkt = silent_packet();

        // Interleave packets from 3 speakers.
        for i in 0..5_u64 {
            let p = at_seq(&pkt, i * 2);
            mixer.feed(100, &p).unwrap();
            mixer.feed(200, &p).unwrap();
            mixer.feed(300, &p).unwrap();
        }

        assert_eq!(mixer.speakers.len(), 3);
        let locked = bufs.lock().unwrap();
        // All three speakers should have the same number of samples
        // since they received the same number of packets.
        let len_100 = locked[&100].len();
        let len_200 = locked[&200].len();
        let len_300 = locked[&300].len();
        assert_eq!(len_100, len_200);
        assert_eq!(len_200, len_300);
        assert!(len_100 > 0);
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn backward_sequence_jump_resets_decoder() {
        // When the sequence number jumps backwards (new voice stream),
        // the decoder must be reset so stale Opus state does not
        // contaminate the new stream.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        let encoded = silent_packet();

        // Feed packet at seq=100 to establish the speaker.
        mixer.feed(42, &at_seq(&encoded, 100)).unwrap();
        let after_first = bufs.lock().unwrap()[&42].len();

        // Feed packet at seq=0 - large backward jump triggers reset.
        mixer.feed(42, &at_seq(&encoded, 0)).unwrap();

        // Speaker still exists and both frames produced samples.
        assert_eq!(mixer.speakers.len(), 1);
        let total = bufs.lock().unwrap()[&42].len();
        assert!(
            total >= after_first + 960,
            "both frames should produce samples: total={total}, after_first={after_first}"
        );
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn reset_speaker_clears_decoder_but_keeps_buffer() {
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        mixer.feed(42, &silent_packet()).unwrap();
        assert_eq!(mixer.speakers.len(), 1);

        // Reset simulates a terminator being received.
        mixer.reset_speaker(42);
        assert_eq!(mixer.speakers.len(), 0);

        // Sample buffer is preserved for the playback callback to drain,
        // and told the talkspurt is over so that one frame plays out.
        let locked = bufs.lock().unwrap();
        assert!(
            locked.contains_key(&42),
            "sample buffer should survive reset_speaker"
        );
        assert!(
            !locked[&42].is_empty(),
            "previously buffered samples should still be available"
        );
        assert!(locked[&42].is_primed(), "a one-frame utterance still plays");
    }

    #[test]
    fn detect_gap_ignores_reordering_and_counts_holes() {
        assert_eq!(detect_gap(None, 10), 0, "nothing expected yet");
        assert_eq!(detect_gap(Some(4), 4), 0, "on time");
        assert_eq!(detect_gap(Some(4), 2), 0, "older than expected: reordering");
        assert_eq!(detect_gap(Some(4), 6), 2, "one 20 ms packet missing");
    }
}
