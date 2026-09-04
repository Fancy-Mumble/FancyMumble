//! Per-speaker audio mixer.
//!
//! Manages one [`AudioDecoder`] per remote speaker (keyed by session
//! ID) so that each Opus stream is decoded independently.  Decoded
//! samples are written into per-speaker ring buffers that the
//! platform playback callback reads, sums, and outputs.
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
use crate::audio::sample::{AudioFormat, SampleFormat};
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

/// Shared per-speaker sample buffers.
///
/// The mixer writes decoded samples per session, and the platform
/// playback callback reads + mixes them in real time.
pub type SpeakerBuffers = Arc<Mutex<HashMap<u32, SpeakerBuffer>>>;

/// Tunables for the adaptive jitter buffer.
///
/// `floor_ms` is the depth playout starts at and relaxes back down to;
/// `ceiling_ms` is as deep as repeated underruns may push it. Two frames
/// (40 ms) is the floor because one frame leaves nothing to absorb the
/// inter-arrival spread the client generates for itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JitterConfig {
    /// Shallowest target depth, in milliseconds.
    pub floor_ms: u32,
    /// Deepest target depth, in milliseconds.
    pub ceiling_ms: u32,
}

impl Default for JitterConfig {
    fn default() -> Self {
        Self {
            floor_ms: 40,
            ceiling_ms: 200,
        }
    }
}

/// Grow the target by this much after an underrun mid-talkspurt.
const JITTER_GROW_MS: u32 = 20;
/// Relax the target by this much after a talkspurt that never ran dry.
/// Smaller than [`JITTER_GROW_MS`] so recovery is slower than reaction.
const JITTER_RELAX_MS: u32 = 10;
/// How long a depth has to go unused before it is skipped out.
const JITTER_SHRINK_WINDOW: Duration = Duration::from_secs(2);
/// Most that one shrink may remove.
const JITTER_SHRINK_MAX_MS: u32 = 20;
/// Crossfade across the seam a shrink leaves behind.
const JITTER_SHRINK_RAMP_MS: u32 = 2; // plus a half, see `ramp_samples`

/// One speaker's decoded audio, with the playout policy that decides when
/// it starts and how deep it runs.
///
/// The mixer writes into this; the playback callback drains it through
/// [`drain_into`](Self::drain_into). Every backend shares the policy rather
/// than reimplementing priming per callback, which is how the old fixed
/// 100 ms prime ended up in four places with three different constants.
#[derive(Debug)]
pub struct SpeakerBuffer {
    samples: VecDeque<f32>,
    cfg: JitterConfig,
    /// Samples per millisecond of buffered audio, from the mixer's format.
    per_ms: usize,
    /// Current target depth in samples.
    target: usize,
    /// Playout has started; `false` means still filling to `target`.
    playing: bool,
    /// The sender is mid-talkspurt. Cleared by the terminator, which is
    /// what lets a one-word utterance play without waiting for `target`.
    live: bool,
    /// This talkspurt has run dry at least once.
    underrun: bool,
    /// Shallowest depth seen since `window_start`.
    window_min: usize,
    window_start: Instant,
    /// Last sample handed to the output, for the shrink crossfade.
    last_out: f32,
}

impl SpeakerBuffer {
    /// Create a buffer for audio in `format`, tuned by `cfg`.
    pub fn new(format: AudioFormat, cfg: JitterConfig) -> Self {
        let per_ms =
            ((format.sample_rate as usize / 1000) * format.channels.max(1) as usize).max(1);
        let mut buf = Self {
            samples: VecDeque::with_capacity(MAX_SPEAKER_BUFFER_SAMPLES),
            cfg,
            per_ms,
            target: 0,
            playing: false,
            live: false,
            underrun: false,
            window_min: usize::MAX,
            window_start: Instant::now(),
            last_out: 0.0,
        };
        buf.target = buf.ms_to_samples(cfg.floor_ms);
        buf
    }

    fn ms_to_samples(&self, ms: u32) -> usize {
        ms as usize * self.per_ms
    }

    /// The 2.5 ms seam crossfade, in samples.
    fn ramp_samples(&self) -> usize {
        (self.ms_to_samples(JITTER_SHRINK_RAMP_MS) + self.per_ms / 2).max(1)
    }

    /// Retune an existing buffer, clamping the live target into the new range.
    pub fn set_config(&mut self, cfg: JitterConfig) {
        self.cfg = cfg;
        let floor = self.ms_to_samples(cfg.floor_ms);
        let ceiling = self.ms_to_samples(cfg.ceiling_ms.max(cfg.floor_ms));
        self.target = self.target.clamp(floor, ceiling);
    }

    /// Current target depth in milliseconds. Diagnostics and tests.
    pub fn target_ms(&self) -> u32 {
        (self.target / self.per_ms.max(1)) as u32
    }

    /// Buffered sample count.
    pub fn len(&self) -> usize {
        self.samples.len()
    }

    /// Whether anything is buffered.
    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    /// Read-only view of the buffered samples, for the recording tap.
    pub fn samples(&self) -> &VecDeque<f32> {
        &self.samples
    }

    /// The buffered samples as the deque's two contiguous halves.
    pub fn as_slices(&self) -> (&[f32], &[f32]) {
        self.samples.as_slices()
    }

    /// Iterate the buffered samples, oldest first.
    pub fn iter(&self) -> std::collections::vec_deque::Iter<'_, f32> {
        self.samples.iter()
    }

    /// Discard everything buffered and return to the un-primed state.
    pub fn clear(&mut self) {
        self.samples.clear();
        self.playing = false;
        self.live = false;
        self.underrun = false;
        self.window_min = usize::MAX;
        self.window_start = Instant::now();
        self.last_out = 0.0;
    }

    /// Queue audio that is already known to be complete - a replay, a test
    /// tone - and start it without waiting for the target depth.
    pub fn push_complete(&mut self, samples: &[f32]) {
        self.push(samples);
        self.end_talkspurt();
    }

    /// Append decoded audio. Marks the speaker live: playout will wait for
    /// `target` unless the terminator arrives first.
    pub fn push(&mut self, samples: &[f32]) {
        self.live = true;
        self.samples.extend(samples.iter().copied());
        self.trim_to_cap();
    }

    fn trim_to_cap(&mut self) {
        if self.samples.len() > MAX_SPEAKER_BUFFER_SAMPLES {
            let excess = self.samples.len() - MAX_SPEAKER_BUFFER_SAMPLES;
            let _ = self.samples.drain(..excess);
        }
    }

    /// The sender's talkspurt ended (terminator, or the decoder was reset).
    ///
    /// Two effects: what is already buffered plays out without waiting for
    /// `target`, and a talkspurt that never ran dry relaxes the target,
    /// so a good network walks the depth back down to the floor.
    pub fn end_talkspurt(&mut self) {
        self.live = false;
        if !self.underrun {
            let floor = self.ms_to_samples(self.cfg.floor_ms);
            self.target = self
                .target
                .saturating_sub(self.ms_to_samples(JITTER_RELAX_MS))
                .max(floor);
        }
        self.underrun = false;
    }

    /// Grow the target after running dry mid-talkspurt.
    fn grow_target(&mut self) {
        let ceiling = self.ms_to_samples(self.cfg.ceiling_ms.max(self.cfg.floor_ms));
        self.target = (self.target + self.ms_to_samples(JITTER_GROW_MS)).min(ceiling);
    }

    /// Mix up to `out.len()` samples into `out` at `vol`, returning how many
    /// were written. Zero while still filling to `target`.
    pub fn drain_into(&mut self, out: &mut [f32], vol: f32) -> usize {
        if !self.playing {
            // Start when the target is met, or when the talkspurt is already
            // over - a one-word "yes." never reaches 40 ms and would
            // otherwise sit here until the next thing the speaker said.
            let ready =
                self.samples.len() >= self.target || (!self.live && !self.samples.is_empty());
            if !ready {
                self.observe_depth();
                return 0;
            }
            self.playing = true;
        }

        let n = self.samples.len().min(out.len());
        let (a, b) = self.samples.as_slices();
        let from_a = n.min(a.len());
        for (dst, src) in out[..from_a].iter_mut().zip(&a[..from_a]) {
            *dst += *src * vol;
        }
        if from_a < n {
            for (dst, src) in out[from_a..n].iter_mut().zip(&b[..n - from_a]) {
                *dst += *src * vol;
            }
        }
        if n > 0 {
            self.last_out = self.samples[n - 1];
        }
        let _ = self.samples.drain(..n);

        if n < out.len() {
            // Either the talkspurt finished and drained, or it ran dry with
            // the sender still talking. The latter means the depth was not
            // enough for the arrival spread, so grow before refilling.
            if self.live {
                self.underrun = true;
                self.grow_target();
            }
            // Re-prime either way, rather than dribbling out every partial
            // chunk that follows.
            self.playing = false;
        }

        self.observe_depth();
        n
    }

    /// Track the shallowest depth over the window, and skip out depth that
    /// the window proved was never needed.
    fn observe_depth(&mut self) {
        self.window_min = self.window_min.min(self.samples.len());
        if self.window_start.elapsed() < JITTER_SHRINK_WINDOW {
            return;
        }
        let unused = self.window_min;
        self.window_min = usize::MAX;
        self.window_start = Instant::now();

        // Only shrink a stream that is actually playing: a buffer that spent
        // the window empty because nobody spoke has proved nothing.
        if !self.playing || unused == 0 || unused == usize::MAX {
            return;
        }
        let skip = unused.min(self.ms_to_samples(JITTER_SHRINK_MAX_MS));
        if skip == 0 {
            return;
        }
        let _ = self.samples.drain(..skip);
        // Ramp across the seam: the sample after the skip can be anywhere
        // in the waveform relative to the one before it, and a step there
        // is a click.
        let ramp = self.ramp_samples().min(self.samples.len());
        let from = self.last_out;
        for i in 0..ramp {
            let w = (i as f32 + 1.0) / ramp as f32;
            self.samples[i] = from * (1.0 - w) + self.samples[i] * w;
        }
    }
}

/// An observer of decoded audio, in the order a listener would hear it.
///
/// Exists for one reason: the e2e suite needs to compare what arrived against
/// what was spoken, and there is no other place to read that. The speaker
/// buffers are a ring the playback callback drains concurrently, so polling
/// them both misses audio and repeats it - the only faithful tap is here,
/// where each sample passes exactly once.
///
/// Notified for **inserted silence as well as decoded frames**, because
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

    /// Retune the jitter buffer, on every live speaker as well as future ones.
    ///
    /// The two numbers are the only knobs the policy has; nothing in the UI
    /// sets them yet, so this exists for a settings row to call.
    pub fn set_jitter(&mut self, cfg: JitterConfig) {
        self.jitter = cfg;
        if let Ok(mut bufs) = self.buffers.lock() {
            for buf in bufs.values_mut() {
                buf.set_config(cfg);
            }
        }
    }

    /// The jitter buffer's current tuning.
    pub fn jitter(&self) -> JitterConfig {
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

        // Gap handling. The expected next seq is computed from the previous
        // packet's decoded sample count (in 10 ms units, the protocol's
        // sequence unit), so it is sample-accurate regardless of how many
        // Opus frames the sender packs per packet. Small discrepancies are
        // absorbed; libopus handles those on the next decode.
        let gap_units = detect_certain_gap(speaker.expected_next_seq, packet.sequence);
        let mut discontinuity = false;

        if gap_units > 0 {
            if gap_units <= MAX_CONCEAL_UNITS {
                // Short loss: conceal it with the decoder's own PLC, which
                // keeps the timeline and sounds like the speaker rather than
                // punching a hole in them.
                conceal_gap(
                    &mut self.speakers,
                    &self.buffers,
                    session,
                    gap_units,
                    self.format,
                    self.jitter,
                )?;
            } else {
                // Long gap: a discontinuity, not something to paper over.
                // This used to write up to 400 ms of zeros, which were played
                // *ahead* of the real audio behind them and stayed in the
                // buffer as latency until the speaker next fell silent.
                // Insert nothing and fade the next frame in from silence.
                tracing::debug!(
                    "session {session}: {gap_units} unit gap treated as a discontinuity, inserting nothing"
                );
                discontinuity = true;
            }
        }

        let speaker = self.speakers.get_mut(&session).ok_or_else(|| {
            crate::error::Error::InvalidState("speaker removed during gap fill".into())
        })?;
        if discontinuity {
            speaker.needs_fade_in = true;
        }
        speaker.last_seq = Some(packet.sequence);

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
            // discontinuity event (silence padding).  libopus's
            // stateful decode is naturally continuous between
            // consecutive packets, so applying a crossfade on every
            // frame would distort the first 24 samples of every
            // 10 ms window - audible as a constant 100 Hz buzz
            // riding on top of loud audio.
            apply_boundary_crossfade(&mut frame, &mut speaker.prev_last_sample);
        }
        // For continuous decode, do NOT track prev_last_sample - we
        // want the crossfade dormant until the next discontinuity.
        speaker.prev_last_sample = None;
        push_samples(&self.buffers, session, &frame, self.format, self.jitter);
        Ok(())
    }

    /// Generate one PLC (packet-loss concealment) frame for `session` and
    /// queue it, returning how many 10 ms units it covered.
    pub fn feed_lost(&mut self, session: u32) -> Result<u64> {
        let format = self.format;
        let jitter = self.jitter;
        let speaker = self
            .speakers
            .get_mut(&session)
            .ok_or_else(|| crate::error::Error::InvalidState("unknown speaker".into()))?;

        let mut frame = speaker.decoder.decode_lost()?;
        apply_boundary_crossfade(&mut frame, &mut speaker.prev_last_sample);
        let units = frame_seq_units(&frame, format);
        push_samples(&self.buffers, session, &frame, format, jitter);
        Ok(units)
    }

    /// Reset the decoder for a speaker whose audio stream has ended
    /// (e.g. terminator received).  The sample buffer is kept so the
    /// playback callback can drain remaining audio.  A fresh decoder
    /// will be created automatically when the next stream arrives.
    pub fn reset_speaker(&mut self, session: u32) {
        drop(self.speakers.remove(&session));
        // The terminator is what tells the jitter buffer this talkspurt is
        // over: what is already queued plays out without waiting for the
        // target depth, and a clean talkspurt relaxes the target.
        if let Ok(mut bufs) = self.buffers.lock() {
            if let Some(buf) = bufs.get_mut(&session) {
                buf.end_talkspurt();
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

/// Push decoded F32 samples into the shared per-speaker buffer.
/// Detect a *certain* loss gap between the expected next sequence and
/// the incoming packet's sequence.
///
/// Returns the number of 10 ms units of silence to insert before the
/// new packet.  The threshold is intentionally generous so that normal
/// jitter, frames-per-packet variation, and packet reordering do NOT
/// cause spurious gap fills (which were the source of the
/// crackle/click artifacts heard on multi-frame-per-packet senders).
///
/// Capped at [`MAX_SILENCE_FILL_UNITS`] (matches the per-speaker
/// buffer capacity) so that an inserted gap never displaces real
/// decoded audio that has not been played yet.
fn detect_certain_gap(expected: Option<u64>, incoming: u64) -> u64 {
    /// Tolerance in 10 ms units. Up to this much drift is absorbed; beyond
    /// it the gap is real loss.
    ///
    /// This used to be 8 (80 ms), because the response was to insert
    /// silence and a spurious fill was destructive. The response is now the
    /// decoder's own concealment, which costs nothing when it turns out the
    /// audio was merely reordered, so the tolerance no longer has to hide
    /// every gap worth concealing.
    const GAP_TOLERANCE: u64 = 1;

    let Some(expected) = expected else { return 0 };
    if incoming <= expected + GAP_TOLERANCE {
        return 0;
    }
    (incoming - expected).min(MAX_SILENCE_FILL_UNITS)
}

/// Longest gap concealed with PLC, in 10 ms units. Past this the loss is
/// treated as a discontinuity: Opus concealment is only convincing for a few
/// frames, and stretching it further sounds worse than a clean cut.
const MAX_CONCEAL_UNITS: u64 = 6;

/// Cover a short gap with the decoder's own concealment.
///
/// Generates PLC frames until `units` of 10 ms are covered. Each frame keeps
/// the timeline (so playout stays aligned) and sounds like the speaker, which
/// zero-fill did not.
fn conceal_gap(
    speakers: &mut HashMap<u32, SpeakerDecoder>,
    buffers: &SpeakerBuffers,
    session: u32,
    units: u64,
    format: AudioFormat,
    jitter: JitterConfig,
) -> Result<()> {
    let Some(speaker) = speakers.get_mut(&session) else {
        return Ok(());
    };
    let mut covered = 0u64;
    while covered < units {
        let mut frame = speaker.decoder.decode_lost()?;
        apply_boundary_crossfade(&mut frame, &mut speaker.prev_last_sample);
        let produced = frame_seq_units(&frame, format);
        push_samples(buffers, session, &frame, format, jitter);
        covered += produced;
        // A decoder that returns nothing measurable would spin here.
        if produced == 0 {
            break;
        }
    }
    Ok(())
}

/// Maximum silence-padding insertion in 10 ms units.  Matches the
/// per-speaker buffer cap so that a gap fill cannot displace real
/// already-decoded audio waiting to be played.
const MAX_SILENCE_FILL_UNITS: u64 = (MAX_SPEAKER_BUFFER_SAMPLES as u64) / SAMPLES_PER_SEQ_UNIT;

/// Number of 10 ms sequence units the given decoded frame represents.
fn frame_seq_units(frame: &crate::audio::sample::AudioFrame, format: AudioFormat) -> u64 {
    let bytes_per_sample = format.sample_format.byte_width().max(1) as u64;
    let channels = format.channels.max(1) as u64;
    let total_samples = frame.data.len() as u64 / bytes_per_sample / channels;
    (total_samples / SAMPLES_PER_SEQ_UNIT).max(1)
}

/// Append `units * 10 ms` of silence to the speaker buffer to keep
/// real-time alignment after a confirmed packet-loss gap.
///
/// Inserts at most [`MAX_SPEAKER_BUFFER_SAMPLES`] minus the current
/// buffer length so that the cap-eviction at the end of `push_*`
/// helpers never has to discard already-decoded real audio that has
/// not been played yet.  Discarding real audio in favour of silence
/// caused 100 - 400 ms perceptible dropouts every time a moderate
/// gap was detected, sustained underrun in the playback mixer, and
/// repeated re-prime cycles in the rodio source.
fn push_samples(
    buffers: &SpeakerBuffers,
    session: u32,
    frame: &crate::audio::sample::AudioFrame,
    format: AudioFormat,
    jitter: JitterConfig,
) {
    let samples = frame.as_f32_samples();
    notify_decoded(session, samples);
    if let Ok(mut bufs) = buffers.lock() {
        let before = bufs.get(&session).map_or(0, SpeakerBuffer::len);
        let buf = bufs
            .entry(session)
            .or_insert_with(|| SpeakerBuffer::new(format, jitter));
        buf.push(samples);
        // The cap is last-resort overflow behaviour for decoded audio
        // arriving faster than playback drains it (e.g. Android backgrounded);
        // it should not happen in steady state on desktop.
        if before + samples.len() > MAX_SPEAKER_BUFFER_SAMPLES {
            tracing::debug!(
                "push_samples: buffer for session {session} hit the cap, dropped oldest samples (playback falling behind)"
            );
        }
    }
}

/// Apply a short correction ramp at the start of a decoded frame to
/// smooth sample-level discontinuities at the boundary (same algorithm
/// as `InboundPipeline::apply_boundary_crossfade`).
fn apply_boundary_crossfade(
    frame: &mut crate::audio::sample::AudioFrame,
    prev_last_sample: &mut Option<f32>,
) {
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
fn apply_cold_start_fade_in(frame: &mut crate::audio::sample::AudioFrame) {
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

    /// A buffer holding `samples`, as a finished talkspurt so tests that
    /// drain it are not gated on the target depth.
    fn filled_buffer(samples: &[f32]) -> SpeakerBuffer {
        let mut buf = SpeakerBuffer::new(AudioFormat::MONO_48KHZ_F32, JitterConfig::default());
        buf.push_complete(samples);
        buf
    }

    fn make_buffers() -> SpeakerBuffers {
        Arc::new(Mutex::new(HashMap::new()))
    }

    #[test]
    fn the_decoded_tap_sees_audio_and_concealment_in_order() {
        // The tap exists so a test can compare what a listener heard against
        // what was spoken, and both halves of "heard" matter: decoded frames
        // *and* the silence inserted to cover a gap. A tap that saw only the
        // first would show a clean stream where the real one had a hole, which
        // is the failure it is meant to detect.
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
        let (tx, rx) = std::sync::mpsc::channel::<(u32, usize, bool)>();
        let tx = Mutex::new(tx);
        set_decoded_tap(Box::new(move |session, samples| {
            let silent = samples.iter().all(|s| *s == 0.0);
            if let Ok(tx) = tx.lock() {
                let _ = tx.send((session, samples.len(), silent));
            }
        }));

        /// The next event for our own session, ignoring other tests' traffic.
        fn ours(
            rx: &std::sync::mpsc::Receiver<(u32, usize, bool)>,
            session: u32,
        ) -> Option<(usize, bool)> {
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok((got, len, silent)) if got == session => return Some((len, silent)),
                    Ok(_) => continue,
                    Err(_) => continue,
                }
            }
            None
        }

        let bufs = make_buffers();
        let frame = crate::audio::sample::AudioFrame {
            data: vec![0u8; 4 * 480]
                .into_iter()
                .enumerate()
                .map(|(i, _)| if i % 4 == 0 { 64 } else { 0 })
                .collect(),
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 1,
            is_silent: false,
        };
        let silence = crate::audio::sample::AudioFrame {
            data: vec![0u8; 4 * 480],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 2,
            is_silent: true,
        };
        push_samples(
            &bufs,
            SESSION,
            &frame,
            AudioFormat::MONO_48KHZ_F32,
            JitterConfig::default(),
        );
        push_samples(
            &bufs,
            SESSION,
            &silence,
            AudioFormat::MONO_48KHZ_F32,
            JitterConfig::default(),
        );

        let (len, silent) = ours(&rx, SESSION).expect("the decoded frame was not observed");
        assert_eq!(len, 480, "the whole frame must be observed, once");
        assert!(!silent, "a decoded frame is not concealment");

        let (len, silent) = ours(&rx, SESSION).expect("the concealment was not observed");
        assert!(
            len > 0 && silent,
            "concealment must be observed as it sounds"
        );
    }

    // -- the jitter buffer's policy ---------------------------------

    /// 48 kHz mono: one millisecond is 48 samples, one 20 ms frame is 960.
    fn jitter_buffer(cfg: JitterConfig) -> SpeakerBuffer {
        SpeakerBuffer::new(AudioFormat::MONO_48KHZ_F32, cfg)
    }

    #[test]
    fn playout_waits_for_the_target_then_starts() {
        let mut buf = jitter_buffer(JitterConfig::default());
        let mut out = vec![0.0; 960];

        // One 20 ms frame is half the 40 ms target: not yet.
        buf.push(&vec![0.5; 960]);
        assert_eq!(buf.drain_into(&mut out, 1.0), 0, "must wait for the target");
        assert_eq!(
            buf.len(),
            960,
            "and must not consume anything while waiting"
        );

        // The second frame meets it.
        buf.push(&vec![0.5; 960]);
        assert_eq!(
            buf.drain_into(&mut out, 1.0),
            960,
            "target met, playout starts"
        );
    }

    #[test]
    fn a_one_word_utterance_plays_without_reaching_the_target() {
        // "yes." is one frame and then a terminator. Waiting for 40 ms of it
        // would mean waiting for the speaker's next sentence.
        let mut buf = jitter_buffer(JitterConfig::default());
        let mut out = vec![0.0; 960];
        buf.push(&vec![0.5; 480]);
        assert_eq!(
            buf.drain_into(&mut out, 1.0),
            0,
            "still live, still waiting"
        );

        buf.end_talkspurt();
        assert_eq!(
            buf.drain_into(&mut out, 1.0),
            480,
            "the terminator releases what is buffered"
        );
    }

    #[test]
    fn running_dry_mid_talkspurt_grows_the_target() {
        let mut buf = jitter_buffer(JitterConfig::default());
        let mut out = vec![0.0; 960];
        assert_eq!(buf.target_ms(), 40);

        buf.push(&vec![0.5; 1920]);
        // Drain it dry with the sender still live: the last call cannot fill
        // the request, which is the underrun.
        for _ in 0..3 {
            let _ = buf.drain_into(&mut out, 1.0);
        }
        assert_eq!(buf.target_ms(), 60, "an underrun adds 20 ms");
    }

    #[test]
    fn the_target_never_passes_the_ceiling() {
        let cfg = JitterConfig {
            floor_ms: 40,
            ceiling_ms: 80,
        };
        let mut buf = jitter_buffer(cfg);
        let mut out = vec![0.0; 960];
        for _ in 0..10 {
            buf.push(&vec![0.5; 960]);
            while buf.drain_into(&mut out, 1.0) > 0 {}
        }
        assert!(
            buf.target_ms() <= cfg.ceiling_ms,
            "target {} passed the ceiling {}",
            buf.target_ms(),
            cfg.ceiling_ms
        );
    }

    #[test]
    fn a_clean_talkspurt_relaxes_the_target_but_not_below_the_floor() {
        let mut buf = jitter_buffer(JitterConfig::default());
        let mut out = vec![0.0; 960];

        // Push it up first.
        buf.push(&vec![0.5; 1920]);
        for _ in 0..3 {
            let _ = buf.drain_into(&mut out, 1.0);
        }
        assert_eq!(buf.target_ms(), 60);

        // Ending the talkspurt that ran dry earns nothing back - the depth
        // was needed during it.
        buf.push(&vec![0.5; 1920]);
        buf.end_talkspurt();
        assert_eq!(
            buf.target_ms(),
            60,
            "the talkspurt that underran does not relax"
        );

        // The next one, which never ran dry, gives 10 ms back - slower than
        // it was taken, so a lossy network does not oscillate.
        buf.push(&vec![0.5; 1920]);
        buf.end_talkspurt();
        assert_eq!(buf.target_ms(), 50, "a clean talkspurt relaxes by 10 ms");

        for _ in 0..10 {
            buf.push(&vec![0.5; 1920]);
            buf.end_talkspurt();
        }
        assert_eq!(buf.target_ms(), 40, "and never goes below the floor");
    }

    #[test]
    fn retuning_clamps_a_live_target_into_the_new_range() {
        let mut buf = jitter_buffer(JitterConfig::default());
        let mut out = vec![0.0; 960];
        buf.push(&vec![0.5; 1920]);
        for _ in 0..3 {
            let _ = buf.drain_into(&mut out, 1.0);
        }
        assert_eq!(buf.target_ms(), 60);

        buf.set_config(JitterConfig {
            floor_ms: 20,
            ceiling_ms: 40,
        });
        assert_eq!(
            buf.target_ms(),
            40,
            "an existing target is pulled under the new ceiling"
        );
    }

    #[test]
    fn set_jitter_retunes_every_live_speaker() {
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);
        {
            let mut locked = bufs.lock().unwrap();
            let _ = locked.insert(1, jitter_buffer(JitterConfig::default()));
            let _ = locked.insert(2, jitter_buffer(JitterConfig::default()));
        }
        mixer.set_jitter(JitterConfig {
            floor_ms: 100,
            ceiling_ms: 200,
        });
        let locked = bufs.lock().unwrap();
        for session in [1, 2] {
            assert_eq!(
                locked[&session].target_ms(),
                100,
                "session {session} was not retuned"
            );
        }
    }

    #[test]
    fn one_speaker_priming_does_not_hold_up_another() {
        // The old global pre-buffer made everyone wait for the shallowest
        // buffer; a second speaker starting mid-sentence used to stall the
        // first one's playout.
        let mut talking = jitter_buffer(JitterConfig::default());
        let mut starting = jitter_buffer(JitterConfig::default());
        let mut out = vec![0.0; 960];

        talking.push(&vec![0.5; 1920]);
        starting.push(&vec![0.5; 240]);

        assert_eq!(
            talking.drain_into(&mut out, 1.0),
            960,
            "the ready speaker plays"
        );
        assert_eq!(
            starting.drain_into(&mut out, 1.0),
            0,
            "the new one fills up"
        );
    }

    #[test]
    fn draining_mixes_at_the_speakers_volume() {
        let mut buf = jitter_buffer(JitterConfig::default());
        let mut out = vec![0.0; 4];
        buf.push(&[1.0; 4]);
        buf.end_talkspurt();
        assert_eq!(buf.drain_into(&mut out, 0.5), 4);
        assert!(
            out.iter().all(|s| (*s - 0.5).abs() < f32::EPSILON),
            "got {out:?}"
        );
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

        // Encode a silent frame to get valid Opus data.
        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        let packet = enc.encode(&silent).unwrap();

        mixer.feed(42, &packet).unwrap();
        assert_eq!(mixer.speakers.len(), 1);
        let locked = bufs.lock().unwrap();
        assert!(locked.contains_key(&42));
        assert!(!locked[&42].is_empty());
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn two_speakers_have_independent_buffers() {
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);

        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        let pkt1 = enc.encode(&silent).unwrap();
        let pkt2 = EncodedPacket {
            data: pkt1.data.clone(),
            sequence: 0,
            frame_samples: pkt1.frame_samples,
        };

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

        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        let pkt = enc.encode(&silent).unwrap();
        mixer.feed(42, &pkt).unwrap();
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
            let _ = locked.insert(7, filled_buffer(&[]));
            // Still-draining orphan: terminator received but samples remain.
            let _ = locked.insert(8, filled_buffer(&[0.5]));
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

        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        let pkt = enc.encode(&silent).unwrap();
        mixer.feed(42, &pkt).unwrap();

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

        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        let pkt = enc.encode(&silent).unwrap();
        mixer.feed(42, &pkt).unwrap();

        mixer.reset();
        assert_eq!(mixer.speakers.len(), 0);
        assert!(bufs.lock().unwrap().is_empty());
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn a_short_gap_is_concealed_with_plc_a_long_one_with_nothing() {
        // Short loss is covered by the decoder's own concealment, which keeps
        // the timeline. Loss beyond MAX_CONCEAL_UNITS is a discontinuity and
        // adds nothing at all - it used to add up to 400 ms of zeros, played
        // ahead of the real audio behind them.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);

        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };

        // 20 ms frames -> seq increments by 2 per packet in protocol units.
        let pkt1 = enc.encode(&silent).unwrap();
        mixer.feed(1, &pkt1).unwrap();
        let after_first = bufs.lock().unwrap()[&1].len();

        // Contiguous (seq = 2): one frame's worth.
        let pkt2 = EncodedPacket {
            data: pkt1.data.clone(),
            sequence: 2,
            frame_samples: pkt1.frame_samples,
        };
        mixer.feed(1, &pkt2).unwrap();
        let after_second = bufs.lock().unwrap()[&1].len();
        let contiguous_added = after_second - after_first;

        // Short gap (seq = 8, expected = 4): 4 units of loss, concealable.
        let pkt3 = EncodedPacket {
            data: pkt1.data.clone(),
            sequence: 8,
            frame_samples: pkt1.frame_samples,
        };
        mixer.feed(1, &pkt3).unwrap();
        let concealed_added = bufs.lock().unwrap()[&1].len() - after_second;
        assert!(
            concealed_added > contiguous_added,
            "a short gap must be concealed: added {concealed_added}, a plain frame adds {contiguous_added}"
        );

        // Long gap (seq = 40, expected = 10): 30 units, a discontinuity.
        let before_long = bufs.lock().unwrap()[&1].len();
        let pkt4 = EncodedPacket {
            data: pkt1.data.clone(),
            sequence: 40,
            frame_samples: pkt1.frame_samples,
        };
        mixer.feed(1, &pkt4).unwrap();
        let long_added = bufs.lock().unwrap()[&1].len() - before_long;
        assert_eq!(
            long_added, contiguous_added,
            "a discontinuity must add the new frame and nothing else"
        );
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn multi_frame_per_packet_does_not_inject_silence() {
        // Regression: senders that pack multiple Opus frames per
        // network packet make the sequence number jump by more than 1
        // per packet.  The previous heuristic learned step=1 from the
        // first pair and then injected fake PLC frames at every
        // multi-frame packet, causing audible clicks.  The new
        // sample-accurate detector must absorb this without inserting
        // any silence.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);

        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        let template = enc.encode(&silent).unwrap();

        // First packet: seq = 0 (1 packet = 20 ms = 2 protocol units).
        mixer.feed(7, &template).unwrap();
        let after_first = bufs.lock().unwrap()[&7].len();
        // 20 ms decoded = 960 samples.
        assert_eq!(after_first, 960);

        // Subsequent packets: seq advances by 2 per packet (matching
        // the 20 ms frame size).  No silence should ever be inserted.
        let mut prev_len = after_first;
        for i in 1..10_u64 {
            let pkt = EncodedPacket {
                data: template.data.clone(),
                sequence: i * 2,
                frame_samples: template.frame_samples,
            };
            mixer.feed(7, &pkt).unwrap();
            let len = bufs.lock().unwrap()[&7].len();
            let added = len - prev_len;
            assert_eq!(
                added, 960,
                "iteration {i}: each packet must decode to exactly 960 samples \
                 with no silence padding (added={added})"
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
        // dormant until a real discontinuity (silence padding).
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);

        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        let template = enc.encode(&silent).unwrap();

        for i in 0..5_u64 {
            let pkt = EncodedPacket {
                data: template.data.clone(),
                sequence: i * 2,
                frame_samples: template.frame_samples,
            };
            mixer.feed(11, &pkt).unwrap();
            let speaker = mixer.speakers.get(&11).unwrap();
            assert!(
                speaker.prev_last_sample.is_none(),
                "iteration {i}: continuous decode must leave prev_last_sample = None, \
                 found {:?}",
                speaker.prev_last_sample
            );
        }
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn a_discontinuity_fades_the_next_frame_in() {
        // Nothing is written across a discontinuity, so the next real frame
        // starts from silence and must be faded in rather than jumped to.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);

        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        let template = enc.encode(&silent).unwrap();

        // Prime: one normal packet (seq = 0). The first frame consumed the
        // cold-start fade.
        mixer.feed(13, &template).unwrap();
        assert!(!mixer.speakers.get(&13).unwrap().needs_fade_in);
        let after_first = bufs.lock().unwrap()[&13].len();

        // Large gap: seq jumps 50 protocol units, far past MAX_CONCEAL_UNITS.
        let pkt2 = EncodedPacket {
            data: template.data.clone(),
            sequence: 50,
            frame_samples: template.frame_samples,
        };
        mixer.feed(13, &pkt2).unwrap();

        // The fade was armed by the discontinuity and consumed by that frame.
        assert!(!mixer.speakers.get(&13).unwrap().needs_fade_in);
        assert_eq!(
            bufs.lock().unwrap()[&13].len(),
            after_first * 2,
            "a discontinuity adds the frame only - no padding"
        );
    }

    #[test]
    fn cold_start_fade_in_attenuates_first_240_samples() {
        // Regression: a fresh decoder's first frame can begin at full
        // speech amplitude (Opus has no warm-up lookahead).  Feeding
        // that straight into the buffer creates a silence -> ~0.9 step,
        // audible as a pop at the start of every utterance.  The
        // cold-start fade-in must attenuate the first 5 ms of the very
        // first frame.
        use crate::audio::sample::AudioFrame;
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
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);

        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        let template = enc.encode(&silent).unwrap();

        mixer.feed(17, &template).unwrap();
        assert!(
            !mixer.speakers.get(&17).unwrap().needs_fade_in,
            "needs_fade_in must be cleared after the first decode"
        );

        // Subsequent feeds keep the flag false.
        for i in 1..3_u64 {
            let pkt = EncodedPacket {
                data: template.data.clone(),
                sequence: i * 2,
                frame_samples: template.frame_samples,
            };
            mixer.feed(17, &pkt).unwrap();
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

        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        let pkt = enc.encode(&silent).unwrap();

        // Interleave packets from 3 speakers.
        for i in 0..5_u64 {
            let p = EncodedPacket {
                data: pkt.data.clone(),
                sequence: i * 960,
                frame_samples: pkt.frame_samples,
            };
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

    #[test]
    fn speaker_buffer_caps_at_max_samples() {
        // Regression: the speaker buffer must not grow beyond
        // MAX_SPEAKER_BUFFER_SAMPLES. Excess old samples are
        // dropped from the front (oldest-first).
        let bufs = make_buffers();
        let count = MAX_SPEAKER_BUFFER_SAMPLES + 5_000;
        let data: Vec<u8> = (0..count)
            .flat_map(|i| (i as f32 * 0.001).to_ne_bytes())
            .collect();
        let frame = crate::audio::sample::AudioFrame {
            data,
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        push_samples(
            &bufs,
            1,
            &frame,
            AudioFormat::MONO_48KHZ_F32,
            JitterConfig::default(),
        );

        let locked = bufs.lock().unwrap();
        assert_eq!(
            locked[&1].len(),
            MAX_SPEAKER_BUFFER_SAMPLES,
            "buffer should be capped at MAX_SPEAKER_BUFFER_SAMPLES"
        );
        // The kept samples are the newest; verify the first kept
        // sample corresponds to the expected index.
        let first_kept_idx = count - MAX_SPEAKER_BUFFER_SAMPLES;
        let expected = first_kept_idx as f32 * 0.001;
        let actual = locked[&1].samples()[0];
        assert!(
            (actual - expected).abs() < 1e-4,
            "oldest kept sample should be index {first_kept_idx}: expected ~{expected}, got {actual}"
        );
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn backward_sequence_jump_resets_decoder() {
        // When the sequence number jumps backwards (new voice stream),
        // the decoder must be reset so stale Opus state does not
        // contaminate the new stream.
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);

        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        let encoded = enc.encode(&silent).unwrap();

        // Feed packet at seq=100 to establish the speaker.
        let pkt1 = EncodedPacket {
            data: encoded.data.clone(),
            sequence: 100,
            frame_samples: 960,
        };
        mixer.feed(42, &pkt1).unwrap();
        let after_first = bufs.lock().unwrap()[&42].len();

        // Feed packet at seq=0 - large backward jump triggers reset.
        let pkt2 = EncodedPacket {
            data: encoded.data.clone(),
            sequence: 0,
            frame_samples: 960,
        };
        mixer.feed(42, &pkt2).unwrap();

        // Speaker still exists and both frames produced samples.
        assert_eq!(mixer.speakers.len(), 1);
        let total = bufs.lock().unwrap()[&42].len();
        assert!(
            total >= after_first + frame_size,
            "both frames should produce samples: total={total}, after_first={after_first}"
        );
    }

    #[cfg(feature = "opus-codec")]
    #[test]
    fn reset_speaker_clears_decoder_but_keeps_buffer() {
        let bufs = make_buffers();
        let mut mixer = AudioMixer::new(bufs.clone(), AudioFormat::MONO_48KHZ_F32);

        use crate::audio::encoder::{AudioEncoder, OpusEncoder, OpusEncoderConfig};
        let config = OpusEncoderConfig::default();
        let frame_size = config.frame_size;
        let mut enc = OpusEncoder::new(config, AudioFormat::MONO_48KHZ_F32).unwrap();
        let silent = crate::audio::sample::AudioFrame {
            data: vec![0u8; frame_size * 4],
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        let pkt = enc.encode(&silent).unwrap();
        mixer.feed(42, &pkt).unwrap();
        assert_eq!(mixer.speakers.len(), 1);

        // Reset simulates a terminator being received.
        mixer.reset_speaker(42);
        assert_eq!(mixer.speakers.len(), 0);

        // Sample buffer is preserved for the playback callback to drain.
        let locked = bufs.lock().unwrap();
        assert!(
            locked.contains_key(&42),
            "sample buffer should survive reset_speaker"
        );
        assert!(
            !locked[&42].is_empty(),
            "previously buffered samples should still be available"
        );
    }

    #[test]
    fn a_long_gap_inserts_nothing() {
        // Regression, the other way round: a gap beyond MAX_CONCEAL_UNITS
        // used to write up to 400 ms of zeros into the buffer. Those zeros
        // were played *ahead* of the real audio behind them and stayed in
        // the buffer as latency until the speaker next fell silent. A
        // discontinuity now inserts nothing at all.
        let bufs = make_buffers();
        let real: Vec<f32> = vec![1.0; 960];
        let frame = crate::audio::sample::AudioFrame {
            data: real.iter().flat_map(|s| s.to_ne_bytes()).collect(),
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        push_samples(
            &bufs,
            1,
            &frame,
            AudioFormat::MONO_48KHZ_F32,
            JitterConfig::default(),
        );
        let before = bufs.lock().unwrap()[&1].len();

        // 40 units = 400 ms, far beyond MAX_CONCEAL_UNITS.
        let gap = detect_certain_gap(Some(2), 42);
        assert!(
            gap > MAX_CONCEAL_UNITS,
            "test needs a discontinuity-sized gap"
        );

        // Nothing in the mixer writes silence any more, so the buffer is
        // untouched by the gap itself.
        assert_eq!(
            bufs.lock().unwrap()[&1].len(),
            before,
            "a discontinuity must not add samples to the buffer"
        );
    }

    #[test]
    fn a_short_gap_is_concealed_not_cut() {
        // Up to MAX_CONCEAL_UNITS the response is PLC, which keeps the
        // timeline; beyond it the gap is a discontinuity.
        assert_eq!(
            detect_certain_gap(Some(10), 11),
            0,
            "10 ms of drift is absorbed"
        );
        let short = detect_certain_gap(Some(10), 14);
        assert!(
            short > 0 && short <= MAX_CONCEAL_UNITS,
            "a 40 ms gap is concealable, got {short}"
        );
        assert!(
            detect_certain_gap(Some(10), 30) > MAX_CONCEAL_UNITS,
            "a 200 ms gap is a discontinuity"
        );
    }

    #[test]
    fn detect_certain_gap_capped_at_buffer_capacity() {
        // The maximum gap fill must not exceed the buffer capacity in
        // 10 ms units, so that a single gap fill can never displace
        // real already-decoded audio.
        let huge_jump = detect_certain_gap(Some(0), 100_000);
        assert!(
            huge_jump <= MAX_SILENCE_FILL_UNITS,
            "gap fill {huge_jump} exceeds buffer capacity {MAX_SILENCE_FILL_UNITS} units",
        );
        // Ensure samples produced by the cap fit in the buffer.
        let max_samples = (huge_jump as usize) * (SAMPLES_PER_SEQ_UNIT as usize);
        assert!(max_samples <= MAX_SPEAKER_BUFFER_SAMPLES);
    }
}
