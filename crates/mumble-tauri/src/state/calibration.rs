//! Voice-activation auto-calibration.
//!
//! Implements a robust noise-floor estimator that avoids the classic
//! "user is silent" trap: traditional EMA-based calibrators drag the
//! noise floor down toward digital silence whenever the speaker pauses,
//! producing a useless near-zero threshold.
//!
//! The estimator here is inspired by Martin's *Minimum Statistics*
//! (R. Martin, "Noise Power Spectral Density Estimation Based on
//! Optimal Smoothing and Minimum Statistics", IEEE TSAP 2001) and the
//! IMCRA refinement (Cohen 2003): a sliding window of recent frame
//! energies is kept, frames below a *digital-silence floor* are
//! discarded as "no input" rather than "quiet ambient noise", and the
//! noise floor is read off the lower percentile of the remaining
//! distribution.  The spread of the lower half of the distribution
//! gives the hysteresis budget for the close-threshold.
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

/// Fixed hold-frames recommendation (20 ms frames -> 400 ms tail).
/// Empirically wide enough to cover natural intra-word and inter-word
/// pauses without dragging breath noise over the wire.  See ITU-T P.56
/// which shows pause distributions in conversational speech centred
/// around 250-400 ms.
pub(super) const AUTO_CALIBRATION_HOLD_FRAMES: u32 = 20;

/// Hard floor for the close ratio when the noise floor is volatile.
const AUTO_CALIBRATION_CLOSE_RATIO_MIN: f32 = 0.4;

/// Hard ceiling for the close ratio when the noise floor is steady.
/// 0.75 keeps the close threshold a comfortable ~2.5 dB below the open
/// threshold even in the steadiest rooms - chatter-free without
/// closing the gate inside the natural amplitude dips of speech.
const AUTO_CALIBRATION_CLOSE_RATIO_MAX: f32 = 0.75;

/// Minimum number of usable (non-silence) frames needed before the
/// calibrator will emit a result.  At ~30 frames/s this is ~1 s of
/// audio - long enough to be statistically meaningful.
const AUTO_CALIBRATION_MIN_FRAMES: usize = 30;

/// Standard sliding-window length (~5 s at 30 frames/s) used by the
/// live mic-test calibrator.  Long enough to span typical pause
/// patterns; short enough to react when the user switches mic.
pub(super) const AUTO_CALIBRATION_WINDOW: usize = 150;

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
    /// Post-AGC samples drive the noise-gate threshold derivation.
    samples_db: VecDeque<f32>,
    /// Pre-AGC samples drive the max-gain derivation - we need to know
    /// how loud the mic is *before* AGC compresses it.
    pre_agc_samples_db: VecDeque<f32>,
    capacity: usize,
}

impl Calibrator {
    pub(super) fn new(capacity: usize) -> Self {
        Self {
            samples_db: VecDeque::with_capacity(capacity),
            pre_agc_samples_db: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    /// Push a frame's post-AGC and pre-AGC RMS into the sliding window.
    ///
    /// Silent frames (below the digital-silence floor) are dropped on
    /// the post-AGC side so long pauses do not contaminate the noise
    /// estimate.  The pre-AGC side keeps anything above its own
    /// digital-silence floor so the max-gain estimator sees a full
    /// distribution of mic levels.
    ///
    /// When the AGC is disabled, callers pass the same value twice and
    /// both estimators agree by construction.
    pub(super) fn push(&mut self, post_agc_rms: f32, pre_agc_rms: f32) {
        let post_db = linear_to_db(post_agc_rms);
        if post_db > DIGITAL_SILENCE_DB {
            if self.samples_db.len() == self.capacity {
                let _ = self.samples_db.pop_front();
            }
            self.samples_db.push_back(post_db);
        }

        let pre_db = linear_to_db(pre_agc_rms);
        if pre_db > DIGITAL_SILENCE_DB {
            if self.pre_agc_samples_db.len() == self.capacity {
                let _ = self.pre_agc_samples_db.pop_front();
            }
            self.pre_agc_samples_db.push_back(pre_db);
        }
    }

    pub(super) fn ready(&self) -> bool {
        self.samples_db.len() >= AUTO_CALIBRATION_MIN_FRAMES
    }

    /// Compute open/close thresholds, hold time and max gain from the
    /// buffered frame energies.  Returns `None` if fewer than
    /// `AUTO_CALIBRATION_MIN_FRAMES` non-silent frames have been seen.
    pub(super) fn compute(&self) -> Option<CalibrationResult> {
        if !self.ready() {
            return None;
        }
        let mut post_sorted: Vec<f32> = self.samples_db.iter().copied().collect();
        post_sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        let mut pre_sorted: Vec<f32> = self.pre_agc_samples_db.iter().copied().collect();
        pre_sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        Some(compute_from_sorted_db(&post_sorted, &pre_sorted))
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
/// the safe default.
///
/// Splits into a separate function so unit tests can exercise the
/// algorithm directly without setting up a `Calibrator`.
fn compute_from_sorted_db(post_sorted: &[f32], pre_sorted: &[f32]) -> CalibrationResult {
    // Noise floor = 15th percentile of non-silent frames.  Robust
    // against the occasional micro-silence that slips past the digital
    // gate AND against speech bursts at the top of the distribution.
    let floor_db = percentile(post_sorted, 15.0);

    // Speech ceiling reference = 90th percentile, used to bound the
    // open threshold so it cannot land inside the speech distribution.
    let speech_db = percentile(post_sorted, 90.0);

    // Speech-valley reference: lowest 10% of frames that are clearly
    // *above* the noise floor.  Conversational speech has a 10-15 dB
    // syllabic envelope (ITU-T P.56), so the gate must sit below the
    // speech valleys rather than just below the speech peaks - that is
    // what the old `P90 - 3` cap got wrong and what caused the gate to
    // chatter mid-sentence on otherwise good calibrations.
    let speech_valley_db = speech_valley_cap_db(post_sorted, floor_db);

    // Spread of the lower half (treated as the ambient distribution)
    // sets dynamic hysteresis.  Quiet, steady rooms get a tight gate;
    // noisy rooms get a wider one so the gate does not chatter.
    let mid = post_sorted.len() / 2;
    let ambient = &post_sorted[..mid.max(1)];
    let mean: f32 = ambient.iter().sum::<f32>() / ambient.len() as f32;
    let variance: f32 = ambient.iter().map(|&v| (v - mean).powi(2)).sum::<f32>()
        / ambient.len() as f32;
    let sigma_db = variance.sqrt();

    let open_margin_db = (3.0 * sigma_db).max(AUTO_CALIBRATION_MIN_OPEN_MARGIN_DB);
    let close_margin_db = (2.0 * sigma_db).max(AUTO_CALIBRATION_MIN_CLOSE_MARGIN_DB);

    // Open threshold: floor + margin, capped 3 dB below the *lower*
    // edge of the speech distribution so valleys do not drop us below
    // the gate.  A second cap at `speech_p90 - 3 dB` guards against
    // degenerate cases (no clear speech band detected).
    let speech_cap_db = speech_valley_db.min(speech_db - 3.0);
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
        hold_frames: AUTO_CALIBRATION_HOLD_FRAMES,
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

    gain_for_speech_db
        .min(gain_for_noise_db)
        .clamp(AUTO_CALIBRATION_MAX_GAIN_MIN_DB, AUTO_CALIBRATION_MAX_GAIN_MAX_DB)
}

/// Minimum frames required above the noise floor before the
/// speech-valley cap is trusted.  At 30 fps this is ~0.4 s of audio.
const SPEECH_VALLEY_MIN_FRAMES: usize = 12;

/// dB headroom above the noise floor that a frame must clear to be
/// counted as part of the "speech" distribution.  10 dB is the same
/// threshold the open-margin uses as a hard minimum, so any sample
/// above this is unambiguously above ambient.
const SPEECH_VALLEY_FLOOR_HEADROOM_DB: f32 = 10.0;

/// 10th-percentile dB of frames sitting clearly above the noise floor.
///
/// Returns `f32::INFINITY` when too few speech frames are present, so
/// the caller's `min(...)` operator falls back transparently to the
/// `P90 - 3 dB` cap.
fn speech_valley_cap_db(post_sorted: &[f32], floor_db: f32) -> f32 {
    let cutoff_db = floor_db + SPEECH_VALLEY_FLOOR_HEADROOM_DB;
    // post_sorted is ascending, so partition_point finds the first
    // entry that exceeds the cutoff in O(log n).
    let split = post_sorted.partition_point(|v| *v <= cutoff_db);
    let speech = &post_sorted[split..];
    if speech.len() < SPEECH_VALLEY_MIN_FRAMES {
        return f32::INFINITY;
    }
    // 3 dB below the 10th percentile keeps the gate beneath even the
    // quieter tail of the speech distribution.
    percentile(speech, 10.0) - 3.0
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(c.compute().is_none(), "silence-only buffer must not emit a calibration");
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

        let Some(result) = c.compute() else {
            panic!("calibrator should still produce a result after a long silent stretch")
        };
        let open_db = linear_to_db(result.vad_threshold);
        assert!(
            open_db > -25.0 && open_db < -10.0,
            "open threshold should sit between ambient (-30 dB) and speech (-10 dB), got {open_db} dB",
        );
    }

    #[test]
    fn quiet_steady_room_yields_high_close_ratio() {
        // Almost-flat ambient distribution -> tiny sigma -> close
        // ratio near the upper bound (gate closes quickly).
        let mut samples = Vec::new();
        for _ in 0..150 {
            samples.push(db_to_linear(-40.0));
        }
        let sorted_db = to_db_vec(&samples);
        let result = compute_from_sorted_db(&sorted_db, &sorted_db);
        let ratio = result.noise_gate_close_ratio;
        assert!(ratio > 0.6, "steady room should produce a high close ratio, got {ratio}");
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
        let result = compute_from_sorted_db(&sorted_db, &sorted_db);
        let ratio = result.noise_gate_close_ratio;
        assert!(
            ratio < AUTO_CALIBRATION_CLOSE_RATIO_MAX,
            "noisy room should not max out the close ratio, got {ratio}",
        );
    }

    #[test]
    fn threshold_clamps_at_the_extremes() {
        let extreme_low = to_db_vec(&[db_to_linear(-50.0); 60]);
        let low = compute_from_sorted_db(&extreme_low, &extreme_low);
        assert!(
            low.vad_threshold >= AUTO_CALIBRATION_THRESHOLD_MIN,
            "lower clamp should hold for very quiet rooms"
        );

        let extreme_high = to_db_vec(&[db_to_linear(-3.0); 60]);
        let high = compute_from_sorted_db(&extreme_high, &extreme_high);
        assert!(
            high.vad_threshold <= AUTO_CALIBRATION_THRESHOLD_MAX + f32::EPSILON,
            "upper clamp should hold for very loud rooms"
        );
    }

    #[test]
    fn hold_frames_matches_documented_baseline() {
        let sorted = to_db_vec(&[db_to_linear(-30.0); 60]);
        let result = compute_from_sorted_db(&sorted, &sorted);
        assert_eq!(result.hold_frames, AUTO_CALIBRATION_HOLD_FRAMES);
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
        let result = compute_from_sorted_db(&sorted_db, &sorted_db);
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
