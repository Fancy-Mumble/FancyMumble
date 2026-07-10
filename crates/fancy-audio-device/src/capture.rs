//! Cpal-based microphone capture implementing [`AudioCapture`].

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tracing::{error, warn};

use mumble_protocol::audio::capture::AudioCapture;
use mumble_protocol::audio::sample::{AudioFormat, AudioFrame};
use mumble_protocol::error::{Error, Result};

/// Captures microphone input via cpal and makes it available as
/// [`AudioFrame`]s through the [`AudioCapture`] trait.
///
/// Internally a cpal input stream pushes samples into a lock-based
/// ring buffer. [`read_frame`](AudioCapture::read_frame) drains
/// exactly one frame's worth of samples (960 @ 48 kHz = 20 ms).
pub struct CpalCapture {
    format: AudioFormat,
    /// Samples per channel per frame (e.g. 960 for 20 ms @ 48 kHz).
    frame_size: usize,
    sequence: u64,
    buffer: Arc<Mutex<VecDeque<f32>>>,
    stream: Option<cpal::Stream>,
    device: cpal::Device,
    /// Number of channels the hardware actually uses.
    hw_channels: u16,
    /// Live input volume multiplier (`f32` bits in `AtomicU32`).
    volume: Arc<AtomicU32>,
    /// Suppresses repeated overflow warnings from the cpal callback.
    /// Set to `true` on first overflow, cleared when the consumer
    /// catches up in `read_frame`.
    overflow_warned: Arc<AtomicBool>,
}

impl std::fmt::Debug for CpalCapture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CpalCapture")
            .field("format", &self.format)
            .field("frame_size", &self.frame_size)
            .field("sequence", &self.sequence)
            .field("hw_channels", &self.hw_channels)
            .finish_non_exhaustive()
    }
}

// SAFETY: On Windows / WASAPI the underlying COM objects use the MTA
// model and are safe to send between threads.  The `!Send` marker in
// cpal is a conservative cross-platform guard that does not apply here.
#[allow(unsafe_code, reason = "WASAPI COM objects are MTA-safe; cpal's !Send is a conservative cross-platform guard")]
unsafe impl Send for CpalCapture {}

impl CpalCapture {
    /// Create a new capture source.
    ///
    /// * `device_name` - choose a specific device, or `None` for default.
    /// * `frame_size` - samples per channel per frame (e.g. 960 for Mumble).
    /// * `volume` - shared atomic volume multiplier (`f32` bits as `u32`).
    pub fn new(device_name: Option<&str>, frame_size: usize, volume: Arc<AtomicU32>) -> Result<Self> {
        let host = cpal::default_host();

        let device = if let Some(name) = device_name {
            host.input_devices()
                .map_err(|e| Error::InvalidState(e.to_string()))?
                .find(|d| {
                    d.description()
                        .ok()
                        .map(|desc| desc.name().to_string())
                        .as_deref()
                        == Some(name)
                })
                .ok_or_else(|| Error::InvalidState(format!("Input device '{name}' not found")))?
        } else {
            host.default_input_device()
                .ok_or_else(|| Error::InvalidState("No default input device".into()))?
        };

        // Use the device's preferred channel count so we don't fail on
        // devices that only support stereo.
        let default_cfg = device
            .default_input_config()
            .map_err(|e| Error::InvalidState(e.to_string()))?;
        let hw_channels = default_cfg.channels();

        Ok(Self {
            format: AudioFormat::MONO_48KHZ_F32,
            frame_size,
            sequence: 0,
            buffer: Arc::new(Mutex::new(VecDeque::with_capacity(9_600))),
            stream: None,
            device,
            hw_channels,
            volume,
            overflow_warned: Arc::new(AtomicBool::new(false)),
        })
    }
}

fn handle_cpal_input(
    buffer: &Arc<Mutex<VecDeque<f32>>>,
    data: &[f32],
    hw_channels: u16,
    overflow_warned: &Arc<AtomicBool>,
) {
    let Ok(mut buf) = buffer.lock() else { return };
    if hw_channels == 1 {
        buf.extend(data.iter().copied());
    } else {
        for chunk in data.chunks(hw_channels as usize) {
            let sum: f32 = chunk.iter().sum();
            buf.push_back(sum / hw_channels as f32);
        }
    }
    const MAX_SAMPLES: usize = 9_600;
    if buf.len() > MAX_SAMPLES {
        if !overflow_warned.swap(true, Ordering::Relaxed) {
            warn!("cpal capture buffer overflow, discarding oldest samples");
        }
        let excess = buf.len() - MAX_SAMPLES;
        let _ = buf.drain(..excess);
    }
}

impl AudioCapture for CpalCapture {
    fn format(&self) -> AudioFormat {
        self.format
    }

    fn read_frame(&mut self) -> Result<AudioFrame> {
        let mut buf = self
            .buffer
            .lock()
            .map_err(|e| Error::InvalidState(e.to_string()))?;

        if buf.len() < self.frame_size {
            return Err(Error::NotEnoughSamples);
        }

        // If the buffer has accumulated significantly more than one
        // frame, the encoding loop fell behind.  Skip old audio to
        // avoid sending stale voice packets.
        let max_queued = self.frame_size * 5; // ~100 ms at 48 kHz
        if buf.len() > max_queued {
            let excess = buf.len() - self.frame_size;
            warn!(
                "capture buffer overflow: {} samples ({:.0} ms), dropping {} stale samples",
                buf.len(),
                buf.len() as f32 / 48.0,
                excess,
            );
            let _ = buf.drain(..excess);
        }

        self.overflow_warned.store(false, Ordering::Relaxed);

        let vol = f32::from_bits(self.volume.load(Ordering::Relaxed));
        let mut data = Vec::with_capacity(self.frame_size * 4);
        for s in buf.drain(..self.frame_size) {
            data.extend_from_slice(&(s * vol).to_ne_bytes());
        }

        self.sequence += 1;
        Ok(AudioFrame {
            data,
            format: self.format,
            sequence: self.sequence,
            is_silent: false,
        })
    }

    fn start(&mut self) -> Result<()> {
        let buffer = self.buffer.clone();
        let hw_channels = self.hw_channels;
        let overflow_warned = self.overflow_warned.clone();

        let stream_config = cpal::StreamConfig {
            channels: hw_channels,
            sample_rate: 48_000,
            buffer_size: cpal::BufferSize::Default,
        };

        let stream = self
            .device
            .build_input_stream(
                &stream_config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    handle_cpal_input(&buffer, data, hw_channels, &overflow_warned);
                },
                |err| error!("cpal input error: {err}"),
                None,
            )
            .map_err(|e| Error::InvalidState(e.to_string()))?;

        stream
            .play()
            .map_err(|e| Error::InvalidState(e.to_string()))?;

        self.stream = Some(stream);
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        self.stream = None;
        if let Ok(mut buf) = self.buffer.lock() {
            buf.clear();
        }
        Ok(())
    }
}
