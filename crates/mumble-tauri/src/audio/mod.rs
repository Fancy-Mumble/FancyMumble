//! Platform-specific audio capture and playback implementations.
//!
//! Each platform provides types that implement the protocol library's
//! [`AudioCapture`](mumble_protocol::audio::capture::AudioCapture) and
//! [`AudioPlayback`](mumble_protocol::audio::playback::AudioPlayback) traits,
//! allowing the pipeline infrastructure to drive real hardware without
//! knowing which OS audio API is in use.
//!
//! On desktop, two backends are available:
//!
//! * **rodio** (default) - higher-level push-based API with built-in
//!   mixing, sample-rate conversion, and background threading.
//! * **cpal** (legacy) - low-level callback-based API exposed as a
//!   fallback via the advanced settings toggle.
//!
//! The [`AudioDeviceFactory`] trait abstracts over platform-specific
//! device creation. [`PlatformAudioFactory`] dispatches to the
//! currently-selected backend at runtime so callers never need `cfg`
//! gates or backend checks.

use std::sync::atomic::AtomicU32;
#[cfg(not(target_os = "android"))]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use mumble_protocol::audio::capture::AudioCapture;
use mumble_protocol::audio::mixer::{SpeakerBuffers, SpeakerVolumes};
use mumble_protocol::error::Result;

#[cfg(not(target_os = "android"))]
mod desktop;

#[cfg(not(target_os = "android"))]
pub(crate) mod devices;

#[cfg(not(target_os = "android"))]
mod rodio_desktop;

#[cfg(not(target_os = "android"))]
mod shared_capture;

#[cfg(not(target_os = "android"))]
mod virtual_mic;

#[cfg(target_os = "android")]
mod android;

// -- Backend selection (desktop only) --------------------------------

/// When `true`, the rodio backend is used; when `false`, the legacy
/// cpal backend is used. Defaults to `true` (rodio).
#[cfg(not(target_os = "android"))]
static USE_RODIO_BACKEND: AtomicBool = AtomicBool::new(true);

/// Switch the desktop audio backend at runtime.
///
/// `true` selects the rodio backend (default), `false` selects the
/// legacy cpal backend.  The change takes effect on the next
/// `create_capture` / `create_mixing_playback` call (i.e. on the next
/// connect or voice toggle).
#[cfg(not(target_os = "android"))]
pub fn set_use_rodio_backend(use_rodio: bool) {
    USE_RODIO_BACKEND.store(use_rodio, Ordering::Relaxed);
}

/// Returns `true` if the rodio backend is currently selected.
#[cfg(not(target_os = "android"))]
pub fn is_rodio_backend() -> bool {
    USE_RODIO_BACKEND.load(Ordering::Relaxed)
}

/// When `true` (Windows only), capture opens the microphone in WASAPI
/// exclusive mode via the native backend. Off by default.
#[cfg(not(target_os = "android"))]
static EXCLUSIVE_INPUT: AtomicBool = AtomicBool::new(false);

/// Enable/disable WASAPI exclusive-mode microphone capture (Windows).
///
/// Applied from `AudioSettings::exclusive_input`; takes effect on the next
/// capture cold-start (connect / voice toggle / mic test).
#[cfg(not(target_os = "android"))]
pub fn set_exclusive_input(exclusive: bool) {
    EXCLUSIVE_INPUT.store(exclusive, Ordering::Relaxed);
}

/// On Android there is only one capture path; exclusive mode is a no-op.
#[cfg(target_os = "android")]
pub fn set_exclusive_input(_exclusive: bool) {}

/// On Android exclusive input is never used.
#[cfg(target_os = "android")]
pub fn is_exclusive_input() -> bool {
    false
}

/// On Android there is only one backend, so this is a no-op.
#[cfg(target_os = "android")]
pub fn set_use_rodio_backend(_use_rodio: bool) {}

/// On Android there is only one backend; always returns `true`.
#[cfg(target_os = "android")]
pub fn is_rodio_backend() -> bool {
    true
}

// -- Traits ----------------------------------------------------------

/// Abstract factory for creating platform-specific audio devices.
///
/// Each platform module implements this trait on a zero-sized struct.
/// Consumer code uses [`PlatformAudioFactory`] and never touches
/// `cfg` gates directly.
pub trait AudioDeviceFactory {
    /// Create a capture (microphone) device.
    ///
    /// `device_name` selects a specific input device; platforms that do
    /// not support device selection (e.g. Android) ignore it.
    fn create_capture(
        device_name: Option<&str>,
        frame_size: usize,
        volume: Arc<AtomicU32>,
    ) -> std::result::Result<Box<dyn AudioCapture>, String>;

    /// Create a mixing playback device that reads from per-speaker
    /// buffers, sums all active speakers, and outputs to hardware.
    fn create_mixing_playback(
        device_name: Option<&str>,
        volume: Arc<AtomicU32>,
        buffers: SpeakerBuffers,
        speaker_volumes: SpeakerVolumes,
    ) -> std::result::Result<Box<dyn MixingPlayback>, String>;
}

/// A playback device that mixes multiple speakers in its audio callback.
///
/// Unlike [`AudioPlayback`], this device does not receive frames via
/// `write_frame` - decoded samples are written into [`SpeakerBuffers`]
/// by the [`AudioMixer`](mumble_protocol::audio::mixer::AudioMixer),
/// and the callback reads + sums them directly.
pub trait MixingPlayback: Send + 'static {
    /// Start the output stream.
    fn start(&mut self) -> Result<()>;
    /// Stop the output stream.
    fn stop(&mut self) -> Result<()>;
}

// -- Platform factory ------------------------------------------------

/// Desktop: dispatches to rodio or cpal based on the runtime toggle.
#[cfg(not(target_os = "android"))]
pub struct PlatformAudioFactory;

#[cfg(not(target_os = "android"))]
impl AudioDeviceFactory for PlatformAudioFactory {
    fn create_capture(
        device_name: Option<&str>,
        frame_size: usize,
        volume: Arc<AtomicU32>,
    ) -> std::result::Result<Box<dyn AudioCapture>, String> {
        // All consumers (voice pipeline, mic test, voice replay) go
        // through the shared-capture broker: ONE real device stream per
        // device, fanned out per consumer. Some drivers only admit a
        // single capture client (Komplete Audio 1 at non-48 kHz endpoint
        // rates), so per-consumer opens would fail with "device in use".
        //
        // The factory below runs at each cold start (first active
        // consumer) and picks the real backend then: the e2e virtual mic
        // (wall-clock-paced synthetic device, arbitrary sample rate),
        // rodio (default) or legacy cpal. It always captures 10 ms
        // frames at neutral volume - the broker handle applies each
        // consumer's own volume and frame size.
        let device = device_name.map(str::to_owned);
        let factory: shared_capture::CaptureFactory = Box::new(move || {
            const PUMP_FRAME: usize = 480;
            let neutral = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
            if let Ok(spec) = std::env::var(virtual_mic::ENV_VIRTUAL_MIC) {
                return virtual_mic::VirtualCapture::from_spec(&spec, PUMP_FRAME, neutral)
                    .map(|c| Box::new(c) as _)
                    .map_err(|e| format!("virtual mic init: {e}"));
            }
            // Windows exclusive mode: the native WASAPI backend "takes" the
            // device (exclusive open with shared fallback), the same way the
            // official Mumble client does - the only reliable capture path on
            // interfaces that admit a single client at non-48 kHz rates.
            #[cfg(target_os = "windows")]
            if EXCLUSIVE_INPUT.load(Ordering::Relaxed) {
                return Ok(Box::new(fancy_audio_device::WasapiCapture::new(
                    device.as_deref(),
                    PUMP_FRAME,
                    neutral,
                    true,
                )) as _);
            }
            if USE_RODIO_BACKEND.load(Ordering::Relaxed) {
                rodio_desktop::RodioAudioFactory::create_capture(
                    device.as_deref(),
                    PUMP_FRAME,
                    neutral,
                )
            } else {
                desktop::CpalAudioFactory::create_capture(device.as_deref(), PUMP_FRAME, neutral)
            }
        });
        Ok(shared_capture::acquire(
            device_name,
            frame_size,
            volume,
            factory,
        ))
    }

    fn create_mixing_playback(
        device_name: Option<&str>,
        volume: Arc<AtomicU32>,
        buffers: SpeakerBuffers,
        speaker_volumes: SpeakerVolumes,
    ) -> std::result::Result<Box<dyn MixingPlayback>, String> {
        if USE_RODIO_BACKEND.load(Ordering::Relaxed) {
            rodio_desktop::RodioAudioFactory::create_mixing_playback(
                device_name,
                volume,
                buffers,
                speaker_volumes,
            )
        } else {
            desktop::CpalAudioFactory::create_mixing_playback(
                device_name,
                volume,
                buffers,
                speaker_volumes,
            )
        }
    }
}

#[cfg(target_os = "android")]
pub use android::OboeAudioFactory as PlatformAudioFactory;

/// Soft-clip a sample to the [-1.0, 1.0] range.
///
/// Samples within [-0.9, 0.9] pass through unchanged.  Beyond that
/// threshold the signal is smoothly compressed using `tanh` so it
/// asymptotically approaches +/-1.0 without ever exceeding it.  This
/// avoids the harsh distortion of hard clipping while preserving
/// dynamics for normal-level audio.
#[cfg(not(target_os = "android"))]
#[inline]
pub(crate) fn soft_clip(sample: f32) -> f32 {
    const KNEE: f32 = 0.9;
    if sample.abs() <= KNEE {
        return sample;
    }
    let sign = sample.signum();
    let excess = sample.abs() - KNEE;
    let compressed = KNEE + (1.0 - KNEE) * (excess / (1.0 - KNEE)).tanh();
    sign * compressed
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    /// Reproduces the client's exact runtime scenario against REAL
    /// hardware: a "voice" capture and a "mic test" capture on the same
    /// device, concurrently, both via `PlatformAudioFactory::create_capture`
    /// (the brokered path). The second must NOT do a real device open -
    /// on single-client devices (Komplete Audio 1 at non-48 kHz) that
    /// would fail with 0x800700AA "resource in use".
    ///
    /// `cargo test -p mumble-tauri double_capture_hw -- --ignored --nocapture`
    #[test]
    #[ignore = "requires audio hardware; run with --ignored --nocapture"]
    #[cfg(not(target_os = "android"))]
    fn double_capture_hw_shares_one_device() {
        use mumble_protocol::audio::capture::AudioCapture;
        use std::sync::atomic::AtomicU32;
        use std::sync::Arc;

        let v1 = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        let v2 = Arc::new(AtomicU32::new(1.0_f32.to_bits()));

        // Consumer 1 = voice pipeline (960-sample frames).
        let mut voice =
            PlatformAudioFactory::create_capture(None, 960, v1).expect("create voice capture");
        voice.start().expect("voice start");
        println!("voice capture started");

        // Consumer 2 = mic test, same device, WHILE voice is active.
        let mut mic_test =
            PlatformAudioFactory::create_capture(None, 960, v2).expect("create mic-test capture");
        match mic_test.start() {
            Ok(()) => println!("mic-test capture started (shared) - OK"),
            Err(e) => panic!("mic-test start collided with voice: {e}"),
        }

        // Both must actually receive audio.
        let pull = |c: &mut Box<dyn AudioCapture>, who: &str| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            let mut n = 0;
            while n < 10 && std::time::Instant::now() < deadline {
                match c.read_frame() {
                    Ok(_) => n += 1,
                    Err(mumble_protocol::error::Error::NotEnoughSamples) => {
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Err(e) => panic!("{who} read_frame: {e}"),
                }
            }
            n
        };
        assert!(pull(&mut voice, "voice") >= 10, "voice starved");
        assert!(pull(&mut mic_test, "mic_test") >= 10, "mic_test starved");
        let _ = voice.stop();
        let _ = mic_test.stop();
        println!("both consumers shared one device and received audio - PASS");
    }

    #[test]
    fn soft_clip_passes_through_below_knee() {
        for &v in &[0.0, 0.5, -0.5, 0.89, -0.89] {
            assert_eq!(soft_clip(v), v, "below knee should pass through unchanged");
        }
    }

    #[test]
    fn soft_clip_compresses_above_knee() {
        let out = soft_clip(1.2);
        assert!(out > 0.9, "should be above knee: {out}");
        assert!(out < 1.0, "should be below 1.0: {out}");
    }

    #[test]
    fn soft_clip_never_exceeds_one() {
        for i in 1..100 {
            let v = i as f32;
            assert!(soft_clip(v).abs() <= 1.0, "soft_clip({v}) exceeded 1.0");
            assert!(soft_clip(-v).abs() <= 1.0, "soft_clip({}) exceeded 1.0", -v);
        }
    }

    #[test]
    fn soft_clip_is_symmetric() {
        for &v in &[0.95, 1.0, 1.5, 3.0] {
            let pos = soft_clip(v);
            let neg = soft_clip(-v);
            assert!(
                (pos + neg).abs() < 1e-6,
                "asymmetric: soft_clip({v})={pos}, soft_clip({})={neg}",
                -v
            );
        }
    }
}
