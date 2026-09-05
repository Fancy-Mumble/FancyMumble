//! Desktop audio for a broadcast: capture -> Opus -> the audio track.
//!
//! Sits beside the video capture threads: one thread pulls interleaved
//! stereo blocks from the platform capture, cuts them into 20 ms Opus
//! frames and writes each as a sample on the broadcaster's audio track.
//! Linux captures the default sink's monitor over PipeWire; other platforms
//! report that desktop audio is not available yet, and the share goes on
//! without it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use webrtc::media::Sample;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

/// Opus frame length; 20 ms is the codec's sweet spot for music-like
/// content and what every WebRTC stack expects.
pub(crate) const FRAME: Duration = Duration::from_millis(20);
pub(crate) const SAMPLE_RATE: u32 = 48_000;
pub(crate) const CHANNELS: usize = 2;
/// Samples per channel in one frame.
const FRAME_SAMPLES: usize = (SAMPLE_RATE as usize / 1000) * 20;
/// Desktop audio is music-like; Opus at this rate is transparent for it.
const BITRATE_BPS: i32 = 128_000;
/// Capture blocks buffered between the real-time capture and the encoder.
const QUEUE_BLOCKS: usize = 64;

/// A running platform capture (kept alive for as long as the encoder runs).
pub(crate) trait CaptureHandle: Send {}

#[cfg(all(target_os = "linux", feature = "gpu"))]
impl CaptureHandle for crate::linux::audio_capture::DesktopAudioCapture {}

/// Start the platform's desktop audio capture.
#[cfg(all(target_os = "linux", feature = "gpu"))]
fn start_capture(tx: SyncSender<Vec<f32>>) -> Result<Box<dyn CaptureHandle>, String> {
    crate::linux::audio_capture::DesktopAudioCapture::start(tx)
        .map(|c| Box::new(c) as Box<dyn CaptureHandle>)
}

#[cfg(not(all(target_os = "linux", feature = "gpu")))]
fn start_capture(_tx: SyncSender<Vec<f32>>) -> Result<Box<dyn CaptureHandle>, String> {
    Err("desktop audio capture is not available on this platform yet".to_owned())
}

/// Spawn the audio thread for `track`. Fails only if the platform capture
/// cannot start; from then on the thread runs until `stop` is set.
pub(crate) fn spawn_audio_thread(
    track: Arc<TrackLocalStaticSample>,
    rt: tokio::runtime::Handle,
    stop: Arc<AtomicBool>,
) -> Result<std::thread::JoinHandle<()>, String> {
    let (tx, rx) = sync_channel::<Vec<f32>>(QUEUE_BLOCKS);
    let capture = start_capture(tx)?;
    let mut encoder = opus::Encoder::new(
        SAMPLE_RATE,
        opus::Channels::Stereo,
        opus::Application::Audio,
    )
    .map_err(|e| format!("opus encoder: {e}"))?;
    encoder
        .set_bitrate(opus::Bitrate::Bits(BITRATE_BPS))
        .map_err(|e| format!("opus bitrate: {e}"))?;
    std::thread::Builder::new()
        .name("screenshare-audio".into())
        .spawn(move || {
            let _capture = capture; // ends the PipeWire stream when the thread does
            encode_loop(&rx, &mut encoder, &track, &rt, &stop);
        })
        .map_err(|e| format!("audio thread spawn: {e}"))
}

fn encode_loop(
    rx: &Receiver<Vec<f32>>,
    encoder: &mut opus::Encoder,
    track: &Arc<TrackLocalStaticSample>,
    rt: &tokio::runtime::Handle,
    stop: &Arc<AtomicBool>,
) {
    let mut pending: Vec<f32> = Vec::with_capacity(FRAME_SAMPLES * CHANNELS * 4);
    let mut packet = vec![0u8; 4000];
    let mut frames = 0u64;
    let mut failures = 0u64;
    while !stop.load(Ordering::SeqCst) {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(block) => pending.extend_from_slice(&block),
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                tracing::warn!("screenshare: desktop audio capture ended; audio stops");
                return;
            }
        }
        let frame_len = FRAME_SAMPLES * CHANNELS;
        let mut consumed = 0;
        while pending.len() - consumed >= frame_len {
            let frame = &pending[consumed..consumed + frame_len];
            consumed += frame_len;
            let written = match encoder.encode_float(frame, &mut packet) {
                Ok(n) => n,
                Err(e) => {
                    failures += 1;
                    if failures.is_power_of_two() {
                        tracing::warn!(failures, "screenshare: opus encode failed: {e}");
                    }
                    continue;
                }
            };
            let sample = Sample {
                data: Bytes::copy_from_slice(&packet[..written]),
                duration: FRAME,
                ..Default::default()
            };
            if let Err(e) = rt.block_on(track.write_sample(&sample)) {
                failures += 1;
                if failures.is_power_of_two() {
                    tracing::warn!(failures, "screenshare: audio write_sample failed: {e}");
                }
            }
            frames += 1;
            if frames.is_multiple_of(500) {
                tracing::debug!(frames, "screenshare: desktop audio frames sent");
            }
        }
        let _ = pending.drain(..consumed);
    }
}
