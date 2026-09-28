//! Voice-activation auto-calibration.
//!
//! Implements a robust noise-floor estimator that avoids two opposite
//! traps.  The first is "user is silent": traditional EMA-based
//! calibrators drag the noise floor down toward digital silence
//! whenever the speaker pauses, producing a useless near-zero
//! threshold.  The second is "user is *talking*": an estimator that
//! reads the floor off a low percentile of a few seconds of recent
//! audio has no floor left to read once those seconds are all speech,
//! and reports a speech valley as the room.  The threshold then lands
//! inside the speaker's own syllabic envelope and the gate cuts them
//! off mid-sentence.
//!
//! The estimator here follows Martin's *Minimum Statistics*
//! (R. Martin, "Noise Power Spectral Density Estimation Based on
//! Optimal Smoothing and Minimum Statistics", IEEE TSAP 2001) and the
//! IMCRA refinement (Cohen 2003).  Frames below a *digital-silence
//! floor* are discarded as "no input" rather than "quiet ambient
//! noise".  The noise floor is then the **minimum over a long horizon**
//! of per-sub-window minima - the quietest moment of the last half
//! minute - which continuous speech cannot raise, because speech only
//! ever adds energy on top of the room.  A shorter sliding window of
//! recent energies supplies the speech statistics that cap the
//! threshold from above, and the spread of the frames sitting near the
//! floor gives the hysteresis budget for the close-threshold.
//!
//! Working in dB throughout keeps the math invariant under the AGC
//! gain stage and matches the user-facing VU meter.
//!
//! # References
//! - R. Martin (2001).  *IEEE Trans. Speech Audio Process.* 9(5).
//! - I. Cohen (2003).  *IEEE Trans. Speech Audio Process.* 11(5).

use std::collections::VecDeque;

use mumble_protocol::audio::sample::AudioFrame;

/// Floor below which we treat a frame as "no input present" rather
/// than "ambient noise we can sample".  -55 dB corresponds to ~0.00178
/// linear RMS - quieter than any realistic room.
pub(super) const DIGITAL_SILENCE_DB: f32 = -55.0;

/// Lower clamp for the auto-tuned open threshold (-50 dB linear).
pub(super) const AUTO_CALIBRATION_THRESHOLD_MIN: f32 = 0.003_162_3;

/// Upper clamp for the auto-tuned open threshold (-3 dB linear).
/// Sized to accommodate high `max_gain_db` settings without saturating.
pub(super) const AUTO_CALIBRATION_THRESHOLD_MAX: f32 = 0.707_945_8;

/// Minimum margin (in dB) between noise floor and open threshold.
/// 12 dB is the classic VAD comfort margin: clearly above ambient,
/// well below speech RMS.
const AUTO_CALIBRATION_MIN_OPEN_MARGIN_DB: f32 = 12.0;

/// Minimum margin (in dB) for the close threshold hysteresis.
/// 6 dB hysteresis prevents chatter while keeping the gate responsive.
const AUTO_CALIBRATION_MIN_CLOSE_MARGIN_DB: f32 = 6.0;

/// Tail the gate is held open for after speech drops below the close
/// threshold.  Empirically wide enough to cover natural intra-word and
/// inter-word pauses without dragging breath noise over the wire.  See
/// ITU-T P.56, which shows pause distributions in conversational speech
/// centred around 250-400 ms.
const AUTO_CALIBRATION_HOLD_MS: u32 = 400;

/// [`AUTO_CALIBRATION_HOLD_MS`] expressed in frames of the pipeline's
/// configured size.
///
/// The noise gate counts frames, not milliseconds, so a fixed frame
/// count is a different amount of time at each of the frame sizes the
/// encoder offers: 20 frames is the intended 400 ms at the 20 ms
/// default, but only 200 ms for a user who picked 10 ms frames for
/// latency - short enough that the gate closes inside their own pauses
/// and clips the next word.
pub(super) fn hold_frames_for(frame_size_ms: u32) -> u32 {
    AUTO_CALIBRATION_HOLD_MS.div_ceil(frame_size_ms.max(1))
}

/// Hard floor for the close ratio when the noise floor is volatile.
const AUTO_CALIBRATION_CLOSE_RATIO_MIN: f32 = 0.4;

/// Hard ceiling for the close ratio: the gate never closes within
/// 2.5 dB of where it opens, whatever the margins work out to.  It
/// binds only when the speech cap has squeezed the open threshold down
/// toward the floor; an ordinary room is set by the 12 dB / 6 dB
/// comfort margins and lands near 0.5.
const AUTO_CALIBRATION_CLOSE_RATIO_MAX: f32 = 0.75;

/// Minimum number of usable (non-silence) frames needed before the
/// calibrator will emit a result.  At ~30 frames/s this is ~1 s of
/// audio - long enough to be statistically meaningful.
const AUTO_CALIBRATION_MIN_FRAMES: usize = 30;

/// Standard sliding-window length (~5 s at 30 frames/s) used by the
/// live mic-test calibrator.  Long enough to span typical pause
/// patterns; short enough to react when the user switches mic.
pub(super) const AUTO_CALIBRATION_WINDOW: usize = 150;

/// Frames per minimum-statistics sub-window (~0.5 s at 30 frames/s).
/// Martin's estimator takes the minimum within each sub-window; half a
/// second is short enough that an ordinary inter-word gap lands inside
/// one, and long enough that the minimum is not just sampling noise.
const FLOOR_SUBWINDOW_FRAMES: usize = 15;

/// Sub-window minima retained for the noise floor (~30 s of history).
///
/// This is the horizon over which the room is allowed to be quiet.  It
/// is deliberately much longer than [`AUTO_CALIBRATION_WINDOW`]: the
/// speech statistics must follow the speaker, but the floor must not,
/// or a speaker who talks without a break for longer than the window
/// walks their own threshold up into their sentences.  A room that
/// genuinely gets noisier (a fan starts) takes one horizon to be
/// believed, which errs toward a gate that opens too easily rather
/// than one that clips speech.
const FLOOR_SUBWINDOWS: usize = 60;

/// Syllabic envelope of conversational speech, in dB (ITU-T P.56 puts
/// it at 10-15 dB).  The open threshold is capped this far below the
/// speech peaks so it stays clear of the speaker's own dips even when
/// the recording contains no ambient stretch to measure a floor from.
const AUTO_CALIBRATION_SPEECH_ENVELOPE_DB: f32 = 15.0;

/// Frames needed near the floor before their spread is trusted as the
/// ambient sigma.  Fewer than this and the window holds no ambient
/// stretch at all, so the fixed minimum margins are used instead.
const AMBIENT_SIGMA_MIN_FRAMES: usize = 8;

/// Target post-AGC speech RMS (dB) used when picking `max_gain_db`.
/// -9 dB RMS gives a loud, present voice that sits well above typical
/// chat ambience.  Peaks at +8 dB above RMS still leave ~1 dB
/// headroom below clip, which is tight but acceptable for voice.
const AUTO_CALIBRATION_TARGET_SPEECH_RMS_DB: f32 = -9.0;

/// Extra headroom added to the desired max gain so the AGC can climb
/// a little above the median speech level when the speaker drops in
/// volume mid-sentence.
const AUTO_CALIBRATION_GAIN_HEADROOM_DB: f32 = 4.0;

/// Lower clamp for the auto-tuned max gain (dB).  Zero would disable
/// the AGC entirely; 1 dB keeps it active but barely-touching for hot
/// mics.
const AUTO_CALIBRATION_MAX_GAIN_MIN_DB: f32 = 1.0;

/// Upper clamp for the auto-tuned max gain (dB).  Matches the practical
/// upper bound of the slider in the UI and prevents the AGC from
/// amplifying the room itself into speech-like levels.
const AUTO_CALIBRATION_MAX_GAIN_MAX_DB: f32 = 30.0;

/// Result of one calibration pass.
#[derive(Debug, Clone, Copy)]
pub(super) struct CalibrationResult {
    /// Open threshold in linear RMS (clamped).
    pub vad_threshold: f32,
    /// Close threshold expressed as a fraction of the open threshold.
    pub noise_gate_close_ratio: f32,
    /// Frames to keep the gate open after audio drops below the close threshold.
    pub hold_frames: u32,
    /// Auto-tuned AGC max gain in dB so speech reaches a target
    /// loudness without amplifying ambient noise into speech levels.
    pub max_gain_db: f32,
}

/// RMS of an F32 audio frame, clamped to [0, 1].  Returns 0 for an empty frame.
pub(super) fn frame_rms(frame: &AudioFrame) -> f32 {
    let samples = frame.as_f32_samples();
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|&s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt().min(1.0)
}

/// Peak (max |sample|) of an F32 audio frame, clamped to [0, 1].
pub(super) fn frame_peak(frame: &AudioFrame) -> f32 {
    let samples = frame.as_f32_samples();
    samples
        .iter()
        .map(|s| s.abs())
        .fold(0.0_f32, f32::max)
        .min(1.0)
}

fn linear_to_db(linear: f32) -> f32 {
    20.0 * linear.max(1e-6).log10()
}

fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// Sliding-window calibrator that tracks recent frame energies and can
/// produce a robust `(open, close, hold)` tuple on demand.
///
/// Frames below `DIGITAL_SILENCE_DB` are discarded - they reflect "no
/// input" rather than "ambient noise" and would otherwise pull the
/// estimated noise floor toward zero (the bug this estimator exists
/// to solve).
pub(super) struct Calibrator {
    /// Post-chain samples (AGC and denoiser applied, exactly what the
    /// noise gate measures) drive the threshold derivation.
    samples_db: VecDeque<f32>,
    /// Raw microphone samples drive the max-gain derivation - we need to
    /// know how loud the mic is *before* AGC compresses it.
    pre_agc_samples_db: VecDeque<f32>,
    capacity: usize,
    /// Minimum post-chain dB seen in the sub-window currently filling.
    subwindow_min_db: f32,
    /// Frames accumulated into that sub-window so far.
    subwindow_len: usize,
    /// Completed sub-window minima, oldest first.  Their minimum is the
    /// noise floor and is what makes the estimate immune to a speaker
    /// who never pauses long enough to refill the sliding window.
    floor_minima_db: VecDeque<f32>,
}

impl Calibrator {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            samples_db: VecDeque::with_capacity(capacity),
            pre_agc_samples_db: VecDeque::with_capacity(capacity),
            capacity,
            subwindow_min_db: f32::INFINITY,
            subwindow_len: 0,
            floor_minima_db: VecDeque::with_capacity(FLOOR_SUBWINDOWS),
        }
    }

    /// Push a frame's post-chain and raw RMS into the sliding window.
    ///
    /// Whether a frame carried any input at all is decided on the *raw*
    /// level: a frame below the digital-silence floor there is a pause
    /// or an unplugged mic and is dropped from both windows so it does
    /// not contaminate the noise estimate.  A frame that had input is
    /// kept on the post-chain side whatever the chain made of it - a
    /// denoiser routinely takes a room's ambience 20 dB or more below
    /// the silence floor, and judging those frames by their output
    /// would discard exactly the frames that define the floor the gate
    /// sits on, leaving the quietest *speech* to stand in for it.
    ///
    /// When neither AGC nor denoiser is active, callers pass the same
    /// value twice and both estimators agree by construction.
    pub(super) fn push(&mut self, post_chain_rms: f32, raw_rms: f32) {
        let raw_db = linear_to_db(raw_rms);
        if raw_db <= DIGITAL_SILENCE_DB {
            return;
        }

        let post_db = linear_to_db(post_chain_rms);

        if self.samples_db.len() == self.capacity {
            let _ = self.samples_db.pop_front();
        }
        self.samples_db.push_back(post_db);

        if self.pre_agc_samples_db.len() == self.capacity {
            let _ = self.pre_agc_samples_db.pop_front();
        }
        self.pre_agc_samples_db.push_back(raw_db);

        self.track_floor(post_db);
    }

    /// Feed one post-chain level into the minimum-statistics tracker.
    fn track_floor(&mut self, post_db: f32) {
        self.subwindow_min_db = self.subwindow_min_db.min(post_db);
        self.subwindow_len += 1;
        if self.subwindow_len < FLOOR_SUBWINDOW_FRAMES {
            return;
        }
        if self.floor_minima_db.len() == FLOOR_SUBWINDOWS {
            let _ = self.floor_minima_db.pop_front();
        }
        self.floor_minima_db.push_back(self.subwindow_min_db);
        self.subwindow_min_db = f32::INFINITY;
        self.subwindow_len = 0;
    }

    /// Noise floor in dB: the quietest moment over the retained horizon.
    ///
    /// The sub-window still filling counts once it is at least half
    /// full, so a short one-shot calibration is not left waiting for a
    /// sub-window boundary it may never reach.
    fn noise_floor_db(&self) -> Option<f32> {
        let completed = self
            .floor_minima_db
            .iter()
            .copied()
            .fold(f32::INFINITY, f32::min);
        let partial = if self.subwindow_len >= FLOOR_SUBWINDOW_FRAMES / 2 {
            self.subwindow_min_db
        } else {
            f32::INFINITY
        };
        let floor = completed.min(partial);
        floor.is_finite().then_some(floor)
    }

    pub(super) fn ready(&self) -> bool {
        self.samples_db.len() >= AUTO_CALIBRATION_MIN_FRAMES
    }

    /// Compute open/close thresholds, hold time and max gain from the
    /// buffered frame energies.  Returns `None` if fewer than
    /// `AUTO_CALIBRATION_MIN_FRAMES` non-silent frames have been seen.
    pub(super) fn compute(&self, frame_size_ms: u32) -> Option<CalibrationResult> {
        if !self.ready() {
            return None;
        }
        let mut post_sorted: Vec<f32> = self.samples_db.iter().copied().collect();
        post_sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        let mut pre_sorted: Vec<f32> = self.pre_agc_samples_db.iter().copied().collect();
        pre_sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        // `ready()` guarantees enough frames for a sub-window to have
        // closed, so the fallback is unreachable in practice; it keeps
        // the function total rather than panicking on a future caller.
        let floor_db = self
            .noise_floor_db()
            .unwrap_or_else(|| percentile(&post_sorted, 15.0));

        Some(compute_from_sorted_db(
            &post_sorted,
            &pre_sorted,
            floor_db,
            frame_size_ms,
        ))
    }
}

/// Pick the percentile-th value from a sorted-ascending slice.
fn percentile(sorted: &[f32], pct: f32) -> f32 {
    let idx = ((sorted.len() - 1) as f32 * (pct / 100.0)).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

/// Core calibration math operating on sorted (ascending) dB slices.
///
/// `post_sorted` is used for the noise-gate thresholds (what the gate
/// actually compares against).  `pre_sorted` drives the max-gain
/// estimator since AGC needs to know how loud the mic is *before* it
/// compresses.  If `pre_sorted` is empty the previous max-gain value
/// is preserved by returning [`AUTO_CALIBRATION_MAX_GAIN_MIN_DB`] as
/// the safe default.  `floor_db` is the minimum-statistics noise floor
/// from [`Calibrator::noise_floor_db`] - deliberately *not* derived
/// from `post_sorted`, which holds only the last few seconds and is
/// nothing but speech while somebody is talking.
///
/// Splits into a separate function so unit tests can exercise the
/// algorithm directly without setting up a `Calibrator`.
fn compute_from_sorted_db(
    post_sorted: &[f32],
    pre_sorted: &[f32],
    floor_db: f32,
    frame_size_ms: u32,
) -> CalibrationResult {
    // Ceiling on the open threshold from the speech in the window, so
    // it cannot land inside the speaker's own syllabic envelope.
    // Infinite when the window holds no speech to measure.
    let speech_cap_db = speech_cap_db(post_sorted, floor_db);

    // Spread of the frames sitting near the floor sets dynamic
    // hysteresis.  Quiet, steady rooms get a tight gate; noisy rooms
    // get a wider one so the gate does not chatter.  Measured on the
    // ambient band rather than "the lower half of the window": half of
    // a window recorded mid-sentence is still speech, and its spread
    // is the syllabic envelope, not the room.
    let ambient_end =
        post_sorted.partition_point(|v| *v <= floor_db + SPEECH_VALLEY_FLOOR_HEADROOM_DB);
    let sigma_db = ambient_sigma_db(&post_sorted[..ambient_end]);

    let open_margin_db = (3.0 * sigma_db).max(AUTO_CALIBRATION_MIN_OPEN_MARGIN_DB);
    let close_margin_db = (2.0 * sigma_db).max(AUTO_CALIBRATION_MIN_CLOSE_MARGIN_DB);

    let open_db = (floor_db + open_margin_db).min(speech_cap_db);
    let close_db = (floor_db + close_margin_db).min(open_db - 3.0);

    let open_linear = db_to_linear(open_db).clamp(
        AUTO_CALIBRATION_THRESHOLD_MIN,
        AUTO_CALIBRATION_THRESHOLD_MAX,
    );
    // Express close as a ratio of open: the noise gate reconstructs
    // the absolute close threshold as `open * ratio`.  Clamping the
    // ratio (instead of the absolute close) avoids degenerate cases
    // when open hits its own clamp.
    let close_linear = db_to_linear(close_db).max(AUTO_CALIBRATION_THRESHOLD_MIN);
    let close_ratio = (close_linear / open_linear.max(f32::EPSILON)).clamp(
        AUTO_CALIBRATION_CLOSE_RATIO_MIN,
        AUTO_CALIBRATION_CLOSE_RATIO_MAX,
    );

    let max_gain_db = derive_max_gain_db(pre_sorted);

    CalibrationResult {
        vad_threshold: open_linear,
        noise_gate_close_ratio: close_ratio,
        hold_frames: hold_frames_for(frame_size_ms),
        max_gain_db,
    }
}

/// Pick a max gain that nudges median speech up to the broadcast-style
/// target RMS without amplifying ambient noise into speech-like
/// territory.
///
/// Operates purely on the *pre-AGC* sample distribution because that is
/// where the AGC sees its input.  The 85th percentile tracks speech
/// peaks robustly even if there are loud bursts; the noise-floor cap
/// keeps the AGC from boosting a quiet room into a noisy one.
fn derive_max_gain_db(pre_sorted: &[f32]) -> f32 {
    if pre_sorted.is_empty() {
        return AUTO_CALIBRATION_MAX_GAIN_MIN_DB;
    }
    let speech_pre_db = percentile(pre_sorted, 85.0);
    let noise_pre_db = percentile(pre_sorted, 15.0);

    // What the AGC needs to lift median speech to the broadcast target.
    let gain_for_speech_db =
        AUTO_CALIBRATION_TARGET_SPEECH_RMS_DB - speech_pre_db + AUTO_CALIBRATION_GAIN_HEADROOM_DB;

    // Cap so amplified ambient noise never crosses -36 dB.  This is
    // still comfortably below the auto-tuned open threshold while
    // giving the AGC room to amplify quieter mics to a useful level.
    let max_amplified_noise_db = -36.0_f32;
    let gain_for_noise_db = max_amplified_noise_db - noise_pre_db;

    gain_for_speech_db.min(gain_for_noise_db).clamp(
        AUTO_CALIBRATION_MAX_GAIN_MIN_DB,
        AUTO_CALIBRATION_MAX_GAIN_MAX_DB,
    )
}

/// Minimum frames required above the noise floor before the
/// speech-valley cap is trusted.  At 30 fps this is ~0.4 s of audio.
const SPEECH_VALLEY_MIN_FRAMES: usize = 12;

/// dB headroom above the noise floor that a frame must clear to be
/// counted as part of the "speech" distribution.  10 dB is the same
/// threshold the open-margin uses as a hard minimum, so any sample
/// above this is unambiguously above ambient.
const SPEECH_VALLEY_FLOOR_HEADROOM_DB: f32 = 10.0;

/// Highest dB the open threshold may take given the speech in the
/// window, or `f32::INFINITY` when the window holds no speech - in
/// which case the caller's `min(...)` falls through to `floor + margin`
/// and the threshold is set by the room alone.
///
/// Two independent ceilings, whichever is lower:
///
/// - **The observed valleys.**  3 dB below the 10th percentile of the
///   frames sitting clearly above the floor keeps the gate beneath even
///   the quieter tail of the speech distribution.
/// - **The syllabic envelope.**  [`AUTO_CALIBRATION_SPEECH_ENVELOPE_DB`]
///   below the speech peaks.  This one does not depend on the floor
///   being right, so it still holds when the recording contains nothing
///   but speech and there is no ambient stretch to measure.  The `P90 -
///   3 dB` this replaces was, by construction, *inside* the speech
///   distribution and never bound anything useful.
fn speech_cap_db(post_sorted: &[f32], floor_db: f32) -> f32 {
    let cutoff_db = floor_db + SPEECH_VALLEY_FLOOR_HEADROOM_DB;
    // post_sorted is ascending, so partition_point finds the first
    // entry that exceeds the cutoff in O(log n).
    let split = post_sorted.partition_point(|v| *v <= cutoff_db);
    let speech = &post_sorted[split..];
    if speech.len() < SPEECH_VALLEY_MIN_FRAMES {
        return f32::INFINITY;
    }
    let valley_cap = percentile(speech, 10.0) - 3.0;
    let envelope_cap = percentile(post_sorted, 90.0) - AUTO_CALIBRATION_SPEECH_ENVELOPE_DB;
    valley_cap.min(envelope_cap)
}

/// Standard deviation of the ambient band, or 0 when the window holds
/// too little of it to say anything - the caller then falls back to the
/// fixed minimum margins.
fn ambient_sigma_db(ambient: &[f32]) -> f32 {
    if ambient.len() < AMBIENT_SIGMA_MIN_FRAMES {
        return 0.0;
    }
    let mean: f32 = ambient.iter().sum::<f32>() / ambient.len() as f32;
    let variance: f32 =
        ambient.iter().map(|&v| (v - mean).powi(2)).sum::<f32>() / ambient.len() as f32;
    variance.sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The floor a [`Calibrator`] would report for these levels: the
    /// minimum, which is what minimum statistics converges on.
    fn floor_of(sorted_db: &[f32]) -> f32 {
        sorted_db.first().copied().unwrap_or(DIGITAL_SILENCE_DB)
    }

    fn to_db_vec(linears: &[f32]) -> Vec<f32> {
        let mut v: Vec<f32> = linears.iter().copied().map(linear_to_db).collect();
        v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        v
    }

    /// Helper that pushes the same value into both pre- and post-AGC
    /// channels, simulating the common "AGC disabled" calibration path.
    fn push_both(c: &mut Calibrator, rms: f32) {
        c.push(rms, rms);
    }

    #[test]
    fn silent_frames_are_rejected() {
        let mut c = Calibrator::new(100);
        for _ in 0..100 {
            // -80 dB is well below the digital-silence floor.
            push_both(&mut c, db_to_linear(-80.0));
        }
        assert!(
            c.compute(20).is_none(),
            "silence-only buffer must not emit a calibration"
        );
    }

    #[test]
    fn user_pausing_does_not_drop_threshold() {
        // Reproduce the reported bug: the speaker talks, then is
        // silent for the rest of the calibration window.  The old EMA
        // estimator collapsed the noise floor toward silence; this
        // estimator must hold the line at the actual ambient level.
        let mut c = Calibrator::new(300);
        // 50 ambient frames at -30 dB (a realistic room).
        for _ in 0..50 {
            push_both(&mut c, db_to_linear(-30.0));
        }
        // 30 speech bursts at -10 dB.
        for _ in 0..30 {
            push_both(&mut c, db_to_linear(-10.0));
        }
        // 200 frames of digital silence (user staring at the screen).
        for _ in 0..200 {
            push_both(&mut c, db_to_linear(-80.0));
        }

        let Some(result) = c.compute(20) else {
            panic!("calibrator should still produce a result after a long silent stretch")
        };
        let open_db = linear_to_db(result.vad_threshold);
        assert!(
            open_db > -30.0 && open_db < -10.0,
            "open threshold should sit between ambient (-30 dB) and speech (-10 dB), got {open_db} dB",
        );
    }

    /// One speech frame every `1/duty` frames, dipping `envelope_db`
    /// below `peak_db` in between - a crude syllabic envelope.
    fn syllable_db(i: usize, peak_db: f32, envelope_db: f32) -> f32 {
        let phase = (i % 5) as f32 / 4.0 * std::f32::consts::PI;
        peak_db - envelope_db * (1.0 - phase.sin())
    }

    /// Regression for the reported cut-off: a speaker who talks without
    /// a long break must not walk their own threshold up into their
    /// sentences.
    ///
    /// The old estimator read the noise floor off the 15th percentile of
    /// a 5 s sliding window.  Talk for longer than that window and every
    /// frame in it is speech, so the "floor" it found was a speech
    /// valley - roughly 12 dB above the real room here - and the open
    /// threshold it derived landed ~10 dB *above* the valleys.  The gate
    /// then closed on every dip the hold time did not cover, cutting the
    /// speaker off mid-sentence while they were plainly still talking.
    #[test]
    fn a_speaker_who_never_pauses_keeps_their_threshold() {
        const ROOM_DB: f32 = -45.0;
        const PEAK_DB: f32 = -15.0;
        const ENVELOPE_DB: f32 = 18.0;
        let valley_db = PEAK_DB - ENVELOPE_DB;

        let mut c = Calibrator::new(AUTO_CALIBRATION_WINDOW);
        // 2 s of room tone, as the mic test sees before the user starts.
        for _ in 0..60 {
            push_both(&mut c, db_to_linear(ROOM_DB));
        }
        // 13 s of continuous speech - far longer than the 5 s window, so
        // not one ambient frame is left in it by the end.
        for i in 0..400 {
            push_both(&mut c, db_to_linear(syllable_db(i, PEAK_DB, ENVELOPE_DB)));
        }

        let Some(result) = c.compute(20) else {
            panic!("13 s of speech is plenty to calibrate on")
        };
        let close_db = linear_to_db(result.vad_threshold * result.noise_gate_close_ratio);
        assert!(
            close_db < valley_db,
            "the gate must not close inside the speaker's own syllabic dips: \
             close={close_db:.1} dB, valleys reach {valley_db:.1} dB",
        );
        assert!(
            close_db > ROOM_DB,
            "the gate must still close on the room: close={close_db:.1} dB, \
             room={ROOM_DB:.1} dB",
        );
    }

    /// The floor is a property of the room, not of the last five
    /// seconds: it must survive a window that holds nothing but speech.
    #[test]
    fn the_floor_outlives_the_sliding_window() {
        let mut c = Calibrator::new(AUTO_CALIBRATION_WINDOW);
        for _ in 0..60 {
            push_both(&mut c, db_to_linear(-45.0));
        }
        for i in 0..400 {
            push_both(&mut c, db_to_linear(syllable_db(i, -15.0, 18.0)));
        }
        let floor = c.noise_floor_db().expect("a floor after 15 s of audio");
        assert!(
            (floor - -45.0).abs() < 1.0,
            "the floor should still be the room at -45 dB, got {floor} dB",
        );
        assert!(
            !c.samples_db.iter().any(|&db| db < -40.0),
            "the sliding window should hold no ambient frames at all by now",
        );
    }

    /// The one-shot calibration records ~3 s and the user is told to
    /// speak: there may be no ambient stretch in the recording at all.
    /// The syllabic-envelope cap has to carry it, since the floor
    /// estimate has nothing quiet to lock onto.
    #[test]
    fn speaking_through_the_whole_one_shot_still_clears_the_valleys() {
        const PEAK_DB: f32 = -15.0;
        const ENVELOPE_DB: f32 = 18.0;
        let valley_db = PEAK_DB - ENVELOPE_DB;

        let mut c = Calibrator::new(AUTO_CALIBRATION_WINDOW);
        for i in 0..90 {
            // Word gaps down near the room, as real speech has.
            let db = if i % 25 >= 22 {
                -43.0
            } else {
                syllable_db(i, PEAK_DB, ENVELOPE_DB)
            };
            push_both(&mut c, db_to_linear(db));
        }
        let result = c.compute(20).expect("3 s of speech is a valid calibration");
        let close_db = linear_to_db(result.vad_threshold * result.noise_gate_close_ratio);
        assert!(
            close_db < valley_db,
            "close threshold {close_db:.1} dB must stay under the {valley_db:.1} dB valleys",
        );
    }

    /// Regression: with a denoiser in the chain the room's ambience
    /// comes out far below the digital-silence floor while the raw
    /// frames are plainly above it.  Those frames are real input and
    /// must define the noise floor; dropping them would leave the
    /// quietest speech to stand in as "ambient" and push the open
    /// threshold up into the sentence tails - the "have to shout"
    /// calibration `DeepFilterNet` users reported.
    #[test]
    fn a_denoised_room_still_counts_as_ambient() {
        let mut c = Calibrator::new(300);
        // 100 room frames: -40 dB at the mic, -72 dB after the denoiser.
        for _ in 0..100 {
            c.push(db_to_linear(-72.0), db_to_linear(-40.0));
        }
        // 60 speech frames the denoiser leaves alone, valleys at -30 dB.
        for i in 0..60 {
            let db = -30.0 + (i as f32 / 59.0) * 15.0;
            c.push(db_to_linear(db), db_to_linear(db));
        }
        let Some(result) = c.compute(20) else {
            panic!("a denoised room is input, not silence")
        };
        let open_db = linear_to_db(result.vad_threshold);
        assert!(
            open_db < -33.0,
            "open threshold must sit below the -30 dB speech valleys, got {open_db} dB",
        );
        // The pre-chain window still saw the real mic level.
        assert!(result.max_gain_db > AUTO_CALIBRATION_MAX_GAIN_MIN_DB);
    }

    #[test]
    fn a_frame_with_no_input_is_dropped_from_both_windows() {
        let mut c = Calibrator::new(10);
        // Post-chain value would pass on its own; the raw frame says
        // nothing was captured.
        c.push(db_to_linear(-30.0), db_to_linear(-80.0));
        assert!(c.samples_db.is_empty());
        assert!(c.pre_agc_samples_db.is_empty());
    }

    /// A window with no speech in it at all: the gate is set by the room
    /// alone, at the fixed comfort margins.
    ///
    /// This used to assert a close ratio above 0.6, which the old code
    /// only reached by way of its `P90 - 3 dB` cap - in an all-ambient
    /// window that cap put the *open* threshold 3 dB **below** the room,
    /// so the gate could never close at all and the ratio it reported
    /// described nothing.  With the cap gone the thresholds are the
    /// documented 12 dB / 6 dB above the floor, and 6 dB of hysteresis
    /// is what the ratio says.
    #[test]
    fn a_room_with_no_speech_gates_on_the_comfort_margins() {
        let mut samples = Vec::new();
        for _ in 0..150 {
            samples.push(db_to_linear(-40.0));
        }
        let sorted_db = to_db_vec(&samples);
        let result = compute_from_sorted_db(&sorted_db, &sorted_db, floor_of(&sorted_db), 20);
        let open_db = linear_to_db(result.vad_threshold);
        assert!(
            (open_db - -28.0).abs() < 0.5,
            "open should sit the 12 dB comfort margin above the -40 dB room, got {open_db} dB",
        );
        let close_db = linear_to_db(result.vad_threshold * result.noise_gate_close_ratio);
        assert!(
            close_db > -40.0,
            "close must stay above the room or the gate never closes, got {close_db} dB",
        );
    }

    #[test]
    fn noisy_room_yields_lower_close_ratio() {
        // Wider ambient spread -> larger sigma -> close ratio pulls
        // toward the lower bound to give the gate more headroom.
        let mut samples = Vec::new();
        for i in 0..150 {
            let dither = ((i % 10) as f32 - 5.0) * 0.005;
            samples.push(db_to_linear(-40.0 + dither * 200.0));
        }
        let sorted_db = to_db_vec(&samples);
        let result = compute_from_sorted_db(&sorted_db, &sorted_db, floor_of(&sorted_db), 20);
        let ratio = result.noise_gate_close_ratio;
        assert!(
            ratio < AUTO_CALIBRATION_CLOSE_RATIO_MAX,
            "noisy room should not max out the close ratio, got {ratio}",
        );
    }

    #[test]
    fn threshold_clamps_at_the_extremes() {
        let extreme_low = to_db_vec(&[db_to_linear(-50.0); 60]);
        let low = compute_from_sorted_db(&extreme_low, &extreme_low, floor_of(&extreme_low), 20);
        assert!(
            low.vad_threshold >= AUTO_CALIBRATION_THRESHOLD_MIN,
            "lower clamp should hold for very quiet rooms"
        );

        let extreme_high = to_db_vec(&[db_to_linear(-3.0); 60]);
        let high =
            compute_from_sorted_db(&extreme_high, &extreme_high, floor_of(&extreme_high), 20);
        assert!(
            high.vad_threshold <= AUTO_CALIBRATION_THRESHOLD_MAX + f32::EPSILON,
            "upper clamp should hold for very loud rooms"
        );
    }

    #[test]
    fn hold_frames_matches_documented_baseline() {
        let sorted = to_db_vec(&[db_to_linear(-30.0); 60]);
        let result = compute_from_sorted_db(&sorted, &sorted, floor_of(&sorted), 20);
        assert_eq!(result.hold_frames, 20, "400 ms at the 20 ms default");
        // The tail is a duration, so a smaller frame needs more frames of
        // it - the gate would otherwise close inside the speaker's pauses.
        assert_eq!(hold_frames_for(10), 40);
        assert_eq!(hold_frames_for(60), 7);
    }

    /// Regression: with a speech distribution whose valleys reach
    /// down to -25 dB, the open threshold must sit below those
    /// valleys, not just below the speech peaks.  This is the
    /// gate-chatter bug that caused the algorithm to drop mid-speech
    /// for users with a wide syllabic envelope.
    #[test]
    fn open_threshold_sits_below_speech_valleys() {
        let mut samples = Vec::new();
        // 60 ambient frames at -45 dB.
        for _ in 0..60 {
            samples.push(db_to_linear(-45.0));
        }
        // 90 speech frames spanning -25 dB (valleys) to -10 dB (peaks),
        // roughly the 15 dB syllabic envelope reported by ITU-T P.56.
        for i in 0..90 {
            let db = -25.0 + (i as f32 / 89.0) * 15.0;
            samples.push(db_to_linear(db));
        }
        let sorted_db = to_db_vec(&samples);
        let result = compute_from_sorted_db(&sorted_db, &sorted_db, floor_of(&sorted_db), 20);
        let open_db = linear_to_db(result.vad_threshold);
        assert!(
            open_db < -25.0,
            "open threshold must sit below the speech valleys at -25 dB, got {open_db} dB",
        );
        // Sanity: it should still be well above the noise floor.
        assert!(
            open_db > -40.0,
            "open threshold should remain comfortably above the -45 dB noise floor, got {open_db} dB",
        );
    }
}
