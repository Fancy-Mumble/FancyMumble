//! Audio playback abstraction (pipeline output stage).
//!
//! Implement [`AudioPlayback`] to send decoded PCM audio to any
//! hardware or virtual output device.

use crate::audio::sample::{AudioFormat, AudioFrame};
use crate::error::Result;

/// Trait for playing audio on an output device.
///
/// Implementations interact with the OS audio subsystem.
/// The pipeline only depends on this trait.
pub trait AudioPlayback: Send + 'static {
    /// The native input format expected by this playback device.
    fn format(&self) -> AudioFormat;

    /// Write a frame of audio to the output device.
    ///
    /// The frame must match (or be convertible to) the format returned
    /// by [`format()`](AudioPlayback::format).
    fn write_frame(&mut self, frame: &AudioFrame) -> Result<()>;

    /// Start the playback device.
    fn start(&mut self) -> Result<()>;

    /// Stop the playback device.
    fn stop(&mut self) -> Result<()>;
}

/// A playback device that mixes multiple speakers in its own audio callback.
///
/// Unlike [`AudioPlayback`], this device does not receive frames via
/// `write_frame` - decoded samples are written into
/// [`SpeakerBuffers`](crate::audio::mixer::SpeakerBuffers) by the
/// [`AudioMixer`](crate::audio::mixer::AudioMixer), and the device's own
/// output callback reads and sums them directly.
///
/// The trait lives here (not in a device-specific crate) so that every
/// front-end backend - cpal, rodio, oboe (Android) - implements the same
/// interface regardless of the platform audio API in use.
pub trait MixingPlayback: Send + 'static {
    /// Start the output stream.
    fn start(&mut self) -> Result<()>;
    /// Stop the output stream.
    fn stop(&mut self) -> Result<()>;
}

/// Soft-clip a sample to the `[-1.0, 1.0]` range.
///
/// Samples within `[-0.9, 0.9]` pass through unchanged.  Beyond that
/// threshold the signal is smoothly compressed using `tanh` so it
/// asymptotically approaches +/-1.0 without ever exceeding it.  This
/// avoids the harsh distortion of hard clipping while preserving
/// dynamics for normal-level audio.  Shared by all mixing-playback
/// backends so the output character is identical across platforms.
#[inline]
#[must_use]
pub fn soft_clip(sample: f32) -> f32 {
    const KNEE: f32 = 0.9;
    if sample.abs() <= KNEE {
        return sample;
    }
    let sign = sample.signum();
    let excess = sample.abs() - KNEE;
    let compressed = KNEE + (1.0 - KNEE) * (excess / (1.0 - KNEE)).tanh();
    sign * compressed
}

// -- Null playback (testing / headless) -----------------------------

/// A playback sink that discards all audio. Useful for testing or bots.
#[derive(Debug)]
pub struct NullPlayback {
    format: AudioFormat,
}

impl NullPlayback {
    /// Create a new null playback sink with the given format.
    pub fn new(format: AudioFormat) -> Self {
        Self { format }
    }
}

impl AudioPlayback for NullPlayback {
    fn format(&self) -> AudioFormat {
        self.format
    }

    fn write_frame(&mut self, _frame: &AudioFrame) -> Result<()> {
        Ok(())
    }

    fn start(&mut self) -> Result<()> {
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        Ok(())
    }
}
