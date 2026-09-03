//! A denoiser that rests while the noise gate is closed.
//!
//! The outbound chain runs the denoiser on every frame the microphone
//! delivers - fifty a second for as long as voice is on - and then asks the
//! gate whether the result was speech. Sitting quietly in a channel, the
//! answer is "no" for hours, and the denoiser is where nearly all of that
//! idle CPU goes: `RNNoise` is a recurrent network, `DeepFilterNet` a much
//! bigger one.
//!
//! The gate opens on the RMS of the *denoised* frame, and every backend only
//! ever attenuates, so a frame whose raw level is already well below the open
//! threshold cannot open the gate whatever the denoiser does to it. While the
//! gate is closed, such frames skip the denoiser and go to the gate as they
//! are; it zeroes them exactly as it would have. Once the gate is open - and
//! through its hold time after speech pauses - every frame is denoised, so
//! what is transmitted is untouched by this.
//!
//! The one thing that changes is that the denoiser's own state is not fed
//! during silence. A backend that learns the noise profile does so from the
//! first frames of each utterance instead, which is also what it did for the
//! first utterance after the pipeline started.

use tracing::debug;

use super::noise_gate::NoiseGate;
use super::AudioFilter;
use crate::audio::sample::AudioFrame;
use crate::error::Result;

/// A frame rests only when its raw level is this far under the open
/// threshold, in linear amplitude - 6 dB of margin against a backend that
/// shapes a frame's spectrum without strictly attenuating every band.
const REST_RATIO: f32 = 0.5;

/// Frames between diagnostic log lines (~10 s at 20 ms frames).
const LOG_EVERY: u64 = 500;

/// A denoiser and the gate that judges its output, fused so the denoiser can
/// skip the frames the gate would zero regardless.
pub struct GatedDenoiser {
    denoiser: Box<dyn AudioFilter>,
    gate: NoiseGate,
    enabled: bool,
    frames: u64,
    rested: u64,
}

impl std::fmt::Debug for GatedDenoiser {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GatedDenoiser")
            .field("denoiser", &self.denoiser.name())
            .field("gate", &self.gate)
            .field("enabled", &self.enabled)
            .field("frames", &self.frames)
            .field("rested", &self.rested)
            .finish()
    }
}

impl GatedDenoiser {
    /// Fuse `denoiser` with the `gate` that decides what it produced.
    pub fn new(denoiser: Box<dyn AudioFilter>, gate: NoiseGate) -> Self {
        Self {
            denoiser,
            gate,
            enabled: true,
            frames: 0,
            rested: 0,
        }
    }

    /// The gate this denoiser answers to.
    pub fn gate(&self) -> &NoiseGate {
        &self.gate
    }

    /// Frames that went to the gate without being denoised.
    pub fn rested_frames(&self) -> u64 {
        self.rested
    }

    /// Whether `frame` can skip the denoiser: the gate is closed and the raw
    /// level is too low to open it even undenoised.
    fn can_rest(&self, frame: &AudioFrame) -> bool {
        !self.gate.is_open()
            && NoiseGate::rms(frame.as_f32_samples()) < self.gate.open_threshold() * REST_RATIO
    }
}

impl AudioFilter for GatedDenoiser {
    fn name(&self) -> &str {
        "GatedDenoiser"
    }

    fn process(&mut self, frame: &mut AudioFrame) -> Result<()> {
        self.frames += 1;
        // A gate that has been switched off judges nothing, so nothing can
        // rest on its account.
        if self.gate.is_enabled() && self.can_rest(frame) {
            self.rested += 1;
        } else if self.denoiser.is_enabled() {
            self.denoiser.process(frame)?;
        }
        if self.frames.is_multiple_of(LOG_EVERY) {
            debug!(
                "GatedDenoiser: frames={}, rested={} ({:.0}%)",
                self.frames,
                self.rested,
                self.rested as f64 / self.frames as f64 * 100.0,
            );
        }
        if self.gate.is_enabled() {
            self.gate.process(frame)?;
        }
        Ok(())
    }

    fn reset(&mut self) {
        self.denoiser.reset();
        self.gate.reset();
        self.frames = 0;
        self.rested = 0;
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use super::*;
    use crate::audio::filter::noise_gate::NoiseGateConfig;
    use crate::audio::sample::AudioFormat;

    /// A stand-in denoiser that only counts how often it was asked.
    struct Counting {
        calls: Arc<AtomicUsize>,
        enabled: bool,
    }

    impl AudioFilter for Counting {
        fn name(&self) -> &str {
            "Counting"
        }
        fn process(&mut self, _frame: &mut AudioFrame) -> Result<()> {
            let _ = self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
        fn reset(&mut self) {}
        fn is_enabled(&self) -> bool {
            self.enabled
        }
        fn set_enabled(&mut self, enabled: bool) {
            self.enabled = enabled;
        }
    }

    fn frame(level: f32) -> AudioFrame {
        let mut data = Vec::with_capacity(960 * 4);
        for _ in 0..960 {
            data.extend_from_slice(&level.to_ne_bytes());
        }
        AudioFrame {
            data,
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        }
    }

    fn gate(hold_frames: u32) -> NoiseGate {
        NoiseGate::new(NoiseGateConfig {
            open_threshold: 0.01,
            close_threshold: 0.008,
            hold_frames,
            attack_samples: 0,
            release_samples: 0,
        })
    }

    fn fused(hold_frames: u32) -> (GatedDenoiser, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let denoiser = Counting {
            calls: Arc::clone(&calls),
            enabled: true,
        };
        (GatedDenoiser::new(Box::new(denoiser), gate(hold_frames)), calls)
    }

    #[test]
    fn quiet_frames_rest_while_the_gate_is_closed() -> Result<()> {
        let (mut filter, calls) = fused(2);
        for _ in 0..10 {
            let mut f = frame(0.002);
            filter.process(&mut f)?;
            assert!(f.is_silent);
            assert!(f.as_f32_samples().iter().all(|&s| s == 0.0));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(filter.rested_frames(), 10);
        Ok(())
    }

    #[test]
    fn a_frame_near_the_threshold_is_still_denoised() -> Result<()> {
        // Under the threshold, but not under it by the margin: the denoiser
        // must see it, and the gate still stays closed.
        let (mut filter, calls) = fused(2);
        let mut f = frame(0.007);
        filter.process(&mut f)?;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(f.is_silent);
        assert!(!filter.gate().is_open());
        Ok(())
    }

    #[test]
    fn speech_is_denoised_and_so_is_the_hold_after_it() -> Result<()> {
        let (mut filter, calls) = fused(2);
        let mut loud = frame(0.05);
        filter.process(&mut loud)?;
        assert!(!loud.is_silent);
        assert!(filter.gate().is_open());
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        // Two held frames, then the gate closes on the third quiet one - all
        // three go through the denoiser because the gate is open for them.
        for expected_silent in [false, false, true] {
            let mut quiet = frame(0.002);
            filter.process(&mut quiet)?;
            assert_eq!(quiet.is_silent, expected_silent);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 4);
        assert!(!filter.gate().is_open());

        // Closed again: quiet frames rest.
        let mut quiet = frame(0.002);
        filter.process(&mut quiet)?;
        assert_eq!(calls.load(Ordering::SeqCst), 4);
        assert_eq!(filter.rested_frames(), 1);
        Ok(())
    }

    #[test]
    fn a_disabled_gate_never_lets_a_frame_rest() -> Result<()> {
        let (mut filter, calls) = fused(2);
        // `set_enabled` on the fused filter is its own switch; the gate's
        // is reached through the chain it was built with, so poke it here.
        filter.gate.set_enabled(false);
        let mut f = frame(0.002);
        filter.process(&mut f)?;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(!f.is_silent);
        Ok(())
    }

    #[test]
    fn reset_forgets_the_count_and_closes_the_gate() -> Result<()> {
        let (mut filter, _) = fused(2);
        let mut loud = frame(0.05);
        filter.process(&mut loud)?;
        assert!(filter.gate().is_open());
        filter.reset();
        assert!(!filter.gate().is_open());
        assert_eq!(filter.rested_frames(), 0);
        Ok(())
    }
}
