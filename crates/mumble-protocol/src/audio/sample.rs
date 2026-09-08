//! Common audio sample types shared across the entire pipeline.
//!
//! Every pipeline stage speaks in terms of [`AudioFrame`] - a time-stamped
//! buffer of PCM samples with associated format metadata. This keeps all
//! stages decoupled: they only depend on this shared vocabulary, never on
//! each other.

/// PCM sample format used throughout the pipeline.
///
/// Mumble/Opus operates on 16-bit signed integer PCM internally, but
/// some filters prefer f32. Both are supported; conversion helpers are
/// provided.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SampleFormat {
    /// 16-bit signed integer (native Opus input).
    I16,
    /// 32-bit float, normalised to [-1.0, 1.0].
    F32,
}

impl SampleFormat {
    /// Number of bytes used by a single sample in this format.
    pub const fn byte_width(self) -> usize {
        match self {
            Self::I16 => 2,
            Self::F32 => 4,
        }
    }
}

/// Describes the shape of an audio buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AudioFormat {
    /// Sample rate in Hz (typically 48 000 for Opus).
    pub sample_rate: u32,
    /// Number of channels (1 = mono, 2 = stereo).
    pub channels: u16,
    /// Per-sample format.
    pub sample_format: SampleFormat,
}

impl AudioFormat {
    /// Mono 48 kHz 32-bit float format (used throughout the filter chain).
    pub const MONO_48KHZ_F32: Self = Self {
        sample_rate: 48_000,
        channels: 1,
        sample_format: SampleFormat::F32,
    };

    /// Mono 48 kHz 16-bit signed integer format (native Opus I/O).
    pub const MONO_48KHZ_I16: Self = Self {
        sample_rate: 48_000,
        channels: 1,
        sample_format: SampleFormat::I16,
    };
}

/// A single frame of PCM audio data flowing through the pipeline.
///
/// Frames always carry their format so that each stage can validate or
/// convert as needed without hidden assumptions.
#[derive(Debug, Clone)]
pub struct AudioFrame {
    /// The PCM sample buffer.
    ///
    /// - [`SampleFormat::I16`]: each sample is 2 bytes, little-endian.
    /// - [`SampleFormat::F32`]: each sample is 4 bytes, native-endian.
    ///
    /// Interleaved when multi-channel (L R L R ...).
    pub data: Vec<u8>,
    /// Format describing the samples in `data`.
    pub format: AudioFormat,
    /// Monotonically increasing frame sequence number.
    pub sequence: u64,
    /// Set by a voice-activity filter (e.g. [`NoiseGate`]) when this
    /// frame was silenced.  The outbound pipeline uses this to suppress
    /// transmission and send terminator packets at end-of-speech.
    pub is_silent: bool,
}

impl AudioFrame {
    /// Number of samples **per channel** in this frame.
    pub fn sample_count(&self) -> usize {
        let bytes_per_sample = match self.format.sample_format {
            SampleFormat::I16 => 2,
            SampleFormat::F32 => 4,
        };
        self.data.len() / (bytes_per_sample * self.format.channels as usize)
    }

    /// Duration of this frame in seconds.
    pub fn duration_secs(&self) -> f64 {
        self.sample_count() as f64 / self.format.sample_rate as f64
    }

    /// View the sample buffer as `&[f32]` (only valid when format is F32).
    ///
    /// # Panics
    /// Panics if the sample format is not `F32`.
    pub fn as_f32_samples(&self) -> &[f32] {
        assert_eq!(self.format.sample_format, SampleFormat::F32);
        bytemuck_cast_slice(&self.data)
    }

    /// View the sample buffer as `&mut [f32]` (only valid when format is F32).
    ///
    /// # Panics
    /// Panics if the sample format is not `F32`.
    pub fn as_f32_samples_mut(&mut self) -> &mut [f32] {
        assert_eq!(self.format.sample_format, SampleFormat::F32);
        bytemuck_cast_slice_mut(&mut self.data)
    }

    /// View the sample buffer as `&[i16]` (only valid when format is I16).
    ///
    /// # Panics
    /// Panics if the sample format is not `I16`.
    pub fn as_i16_samples(&self) -> &[i16] {
        assert_eq!(self.format.sample_format, SampleFormat::I16);
        bytemuck_cast_slice(&self.data)
    }
}

// -- Minimal safe byte-casting (avoids adding a `bytemuck` dep) -----

/// Reinterpret a byte buffer as samples.
///
/// `from_raw_parts` on `bytes.as_ptr().cast()` would be unsound here: a
/// `[u8]` is only guaranteed 1-byte aligned, and `T` is not. `align_to`
/// is what actually establishes the alignment, and the assertion below
/// turns a buffer that cannot be viewed as `T` into a panic rather than
/// an unaligned read.
///
/// # Panics
/// Panics if `bytes` is not a whole number of `T`, or does not start on a
/// `T` boundary.
#[allow(
    unsafe_code,
    reason = "align_to reinterprets bytes as T; sound because every bit pattern of \
              the sample types this is used with (i16, f32) is a valid value"
)]
fn bytemuck_cast_slice<T: Copy>(bytes: &[u8]) -> &[T] {
    assert_eq!(
        bytes.len() % size_of::<T>(),
        0,
        "sample buffer is not a whole number of samples"
    );
    // SAFETY: `T` is only ever `i16` or `f32` here, and every bit pattern
    // of those is a valid value, so no invalid `T` can be produced.
    let (head, samples, tail) = unsafe { bytes.align_to::<T>() };
    assert!(
        head.is_empty() && tail.is_empty(),
        "sample buffer is not aligned for this sample format"
    );
    samples
}

/// Mutable twin of [`bytemuck_cast_slice`].
///
/// # Panics
/// Panics if `bytes` is not a whole number of `T`, or does not start on a
/// `T` boundary.
#[allow(
    unsafe_code,
    reason = "align_to_mut reinterprets bytes as T; sound because every bit pattern \
              of the sample types this is used with (i16, f32) is a valid value"
)]
fn bytemuck_cast_slice_mut<T: Copy>(bytes: &mut [u8]) -> &mut [T] {
    assert_eq!(
        bytes.len() % size_of::<T>(),
        0,
        "sample buffer is not a whole number of samples"
    );
    // SAFETY: as above.
    let (head, samples, tail) = unsafe { bytes.align_to_mut::<T>() };
    assert!(
        head.is_empty() && tail.is_empty(),
        "sample buffer is not aligned for this sample format"
    );
    samples
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_count_mono_f32() {
        let frame = AudioFrame {
            data: vec![0u8; 4 * 480], // 480 f32 samples
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        assert_eq!(frame.sample_count(), 480);
    }

    #[test]
    fn i16_f32_roundtrip() {
        let original: i16 = 16000;
        let converted = fancy_utils::audio::f32_to_i16(fancy_utils::audio::i16_to_f32(original));
        assert_eq!(original, converted);
    }
}
