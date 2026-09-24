//! Voice messages: a short clip recorded from the microphone, sent as a file.
//!
//! Recorded here rather than in the webview with `MediaRecorder`, for three
//! reasons. The clip goes through the same input device, volume, AGC and
//! denoiser the user already set up for talking, so it sounds like them on a
//! call rather than like a raw laptop microphone. The format is the same on
//! every platform - Ogg Opus - where `MediaRecorder` hands back a different
//! container on each webview. And there is no second microphone permission
//! to ask for on the platforms whose webviews have one.
//!
//! The recorder is a plain thread, not a tokio task: the denoiser costs
//! milliseconds per frame, and blocking a runtime worker with it is what
//! starves the protocol loop and makes the live mixer drop audio.
//!
//! The finished clip is written to a temporary file and handed to the
//! frontend as a path, which uploads it with the ordinary file-sharing path
//! and a voice flag, then asks for the file to be discarded.

mod ogg;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use mumble_protocol::audio::capture::AudioCapture;
use mumble_protocol::audio::encoder::{
    AudioEncoder, OpusApplication, OpusEncoder, OpusEncoderConfig,
};
use mumble_protocol::audio::filter::FilterChain;
use mumble_protocol::audio::sample::{AudioFormat, AudioFrame};
use serde::Serialize;
use tauri::Emitter;
use tracing::{debug, warn};

use super::AppState;
use crate::audio::{AudioDeviceFactory, PlatformAudioFactory};

/// The event the recorder reports its progress on.
const STATE_EVENT: &str = "voice-message-state";

/// Samples per Opus packet: 20 ms at 48 kHz.
const FRAME: usize = 960;

/// 48 kHz, in the units the arithmetic below wants.
const SAMPLE_RATE: u64 = 48_000;

/// Bits per second. Speech-grade Opus: two minutes is about half a megabyte,
/// well inside the default cap, and indistinguishable from a higher rate on
/// the phone speaker most voice notes are played through.
const BITRATE: i32 = 32_000;

/// The longest take, whatever the server allows. A server with no limit
/// should not mean a recorder left running by accident fills the disk.
const HARD_LIMIT_MS: u32 = 30 * 60 * 1000;

/// How often the frontend hears the elapsed time and input level.
const REPORT_EVERY: Duration = Duration::from_millis(80);

/// How long the thread sleeps when no frame is ready yet.
const POLL: Duration = Duration::from_millis(5);

/// Bars in the waveform a clip is drawn with.
const WAVEFORM_BARS: usize = 48;

/// Whether a take is running, which holds live transmission.
///
/// Somebody recording a note in a voice channel is talking to the note, not
/// to the room, and with voice activation on the room would otherwise hear
/// every word of it. A process-wide flag rather than state behind a lock: the
/// outbound loop reads it per packet, and a lock taken there is how the mixer
/// ends up dropping samples. There is one microphone, so one flag.
pub(crate) static HOLDS_TRANSMISSION: AtomicBool = AtomicBool::new(false);

/// Raises [`HOLDS_TRANSMISSION`] for as long as it lives, so a take that ends
/// by any path - sent, cancelled, failed, panicked - lets the room back in.
struct TransmissionHold;

impl TransmissionHold {
    fn raise() -> Self {
        HOLDS_TRANSMISSION.store(true, Ordering::Relaxed);
        Self
    }
}

impl Drop for TransmissionHold {
    fn drop(&mut self) {
        HOLDS_TRANSMISSION.store(false, Ordering::Relaxed);
    }
}

/// What the recorder is doing, for the frontend's recording bar.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
enum RecorderState {
    /// Capturing. `level` is the last frame's loudness, 0 to 1.
    #[serde(rename_all = "camelCase")]
    Recording { elapsed_ms: u32, level: f32 },
    /// The take reached its ceiling and stopped itself; the clip is waiting
    /// for `finish` like any other.
    #[serde(rename_all = "camelCase")]
    Limit { elapsed_ms: u32 },
    /// The microphone could not be read. The take is over.
    Failed { reason: String },
}

/// One finished clip, as the frontend uploads it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceClip {
    /// Where the Ogg file is, until it is discarded.
    pub path: String,
    pub duration_ms: u32,
    pub size: u64,
    pub mime_type: &'static str,
    /// [`WAVEFORM_BARS`] loudness values, 0 to 100, for drawing the clip
    /// before anyone plays it.
    pub waveform: Vec<u8>,
}

/// A take in progress.
#[derive(Debug)]
pub(crate) struct Recording {
    /// Set to end the take and keep it.
    stop: Arc<AtomicBool>,
    /// Set to end the take and throw it away.
    cancel: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<Result<Option<VoiceClip>, String>>,
}

/// Everything the thread needs, gathered before it starts.
struct Take {
    capture: Box<dyn AudioCapture>,
    filters: FilterChain,
    encoder: OpusEncoder,
    limit_ms: u32,
    dir: PathBuf,
    app: tauri::AppHandle,
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
}

/// Where clips wait between recording and upload.
fn clip_dir() -> PathBuf {
    std::env::temp_dir().join("fancy-mumble-voice")
}

/// Drop clips a previous run recorded and never got to discard.
fn sweep_stale(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let hour = Duration::from_secs(3600);
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age > hour);
        if stale {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// Root-mean-square loudness of one frame, 0 to 1.
fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|s| s * s).sum();
    #[allow(clippy::cast_precision_loss, reason = "a frame is 960 samples")]
    let mean = sum / samples.len() as f32;
    mean.sqrt().min(1.0)
}

/// Fold one loudness value per frame into [`WAVEFORM_BARS`] bars of 0-100.
///
/// Each bar is the loudest frame it covers, and the whole clip is scaled to
/// its own peak with a square root on top, so a quiet speaker's clip still
/// has a shape rather than a flat line along the bottom.
fn waveform(levels: &[f32]) -> Vec<u8> {
    if levels.is_empty() {
        return vec![0; WAVEFORM_BARS];
    }
    let bars: Vec<f32> = (0..WAVEFORM_BARS)
        .map(|bar| {
            let from = bar * levels.len() / WAVEFORM_BARS;
            let to = ((bar + 1) * levels.len() / WAVEFORM_BARS).max(from + 1);
            levels[from..to.min(levels.len())]
                .iter()
                .copied()
                .fold(0.0, f32::max)
        })
        .collect();
    let peak = bars.iter().copied().fold(0.0, f32::max);
    bars.iter()
        .map(|&bar| percent(if peak > 0.0 { (bar / peak).sqrt() } else { 0.0 }))
        .collect()
}

/// A 0-1 value as a whole percentage.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to 0..=100 first"
)]
fn percent(value: f32) -> u8 {
    (value * 100.0).round().clamp(0.0, 100.0) as u8
}

fn millis(samples: u64) -> u32 {
    u32::try_from(samples * 1000 / SAMPLE_RATE).unwrap_or(u32::MAX)
}

fn emit(app: &tauri::AppHandle, state: &RecorderState) {
    let _ = app.emit(STATE_EVENT, state);
}

impl Take {
    /// Record until told to stop or the limit is reached, then write the file.
    fn run(mut self) -> Result<Option<VoiceClip>, String> {
        let _hold = TransmissionHold::raise();
        if let Err(error) = self.capture.start() {
            let reason = error.to_string();
            super::audio::emit_capture_error(Some(&self.app), &reason);
            emit(
                &self.app,
                &RecorderState::Failed {
                    reason: reason.clone(),
                },
            );
            return Err(reason);
        }
        super::audio::clear_capture_error(Some(&self.app));

        // Any value will do; random so two clips spliced together by some
        // tool downstream do not claim to be one stream.
        let serial = uuid::Uuid::new_v4().as_fields().0;
        let mut writer = ogg::OggOpusWriter::new(serial, "Fancy Mumble");
        let mut pending: Vec<f32> = Vec::with_capacity(FRAME * 2);
        let mut levels: Vec<f32> = Vec::new();
        let mut samples: u64 = 0;
        let mut last_report = Instant::now();
        let limit_samples = u64::from(self.limit_ms) * SAMPLE_RATE / 1000;

        let reached_limit = loop {
            if self.stop.load(Ordering::Relaxed) || self.cancel.load(Ordering::Relaxed) {
                break false;
            }
            let mut read_any = false;
            while let Ok(mut frame) = self.capture.read_frame() {
                read_any = true;
                if let Err(error) = self.filters.process(&mut frame) {
                    debug!("voice message: filter chain error: {error}");
                }
                pending.extend_from_slice(frame.as_f32_samples());
            }
            // Cut into exact Opus frames, whatever size the device delivers.
            while pending.len() >= FRAME && samples < limit_samples {
                let chunk: Vec<f32> = pending.drain(..FRAME).collect();
                levels.push(rms(&chunk));
                let packet = self
                    .encoder
                    .encode(&frame_of(&chunk))
                    .map_err(|e| e.to_string())?;
                writer.push(packet.data, FRAME as u64);
                samples += FRAME as u64;
            }
            if samples >= limit_samples {
                break true;
            }
            if last_report.elapsed() >= REPORT_EVERY {
                last_report = Instant::now();
                emit(
                    &self.app,
                    &RecorderState::Recording {
                        elapsed_ms: millis(samples),
                        level: levels.last().copied().unwrap_or(0.0),
                    },
                );
            }
            if !read_any {
                std::thread::sleep(POLL);
            }
        };
        let _ = self.capture.stop();

        if self.cancel.load(Ordering::Relaxed) {
            return Ok(None);
        }
        if reached_limit {
            emit(
                &self.app,
                &RecorderState::Limit {
                    elapsed_ms: millis(samples),
                },
            );
        }
        if samples == 0 {
            return Err("nothing was recorded".to_owned());
        }
        self.write(writer.finish(), samples, &levels).map(Some)
    }

    fn write(&self, bytes: Vec<u8>, samples: u64, levels: &[f32]) -> Result<VoiceClip, String> {
        std::fs::create_dir_all(&self.dir)
            .map_err(|e| format!("create {}: {e}", self.dir.display()))?;
        let short = uuid::Uuid::new_v4().simple().to_string();
        let path = self.dir.join(format!("voice-message-{}.ogg", &short[..8]));
        std::fs::write(&path, &bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
        Ok(VoiceClip {
            path: path.to_string_lossy().into_owned(),
            duration_ms: millis(samples),
            size: bytes.len() as u64,
            mime_type: "audio/ogg",
            waveform: waveform(levels),
        })
    }
}

/// One Opus-sized chunk as the encoder takes it.
fn frame_of(samples: &[f32]) -> AudioFrame {
    AudioFrame {
        data: samples.iter().flat_map(|s| s.to_ne_bytes()).collect(),
        format: AudioFormat::MONO_48KHZ_F32,
        sequence: 0,
        is_silent: false,
    }
}

impl AppState {
    /// Start recording a voice message.
    ///
    /// `limit_ms` is the server's ceiling, or zero for none; the take stops
    /// itself there and reports `limit`, rather than running on to be refused
    /// once it is uploaded. A take already running is thrown away first.
    pub fn start_voice_message(&self, limit_ms: u32) -> Result<(), String> {
        self.cancel_voice_message();

        let settings = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.audio.settings.clone()
        };
        let volume = Arc::new(AtomicU32::new(settings.input_volume.to_bits()));
        let capture = PlatformAudioFactory::create_capture(
            settings.selected_device.as_deref(),
            FRAME,
            volume,
        )?;
        let encoder = OpusEncoder::new(
            OpusEncoderConfig {
                bitrate: BITRATE,
                frame_size: FRAME,
                application: OpusApplication::Voip,
                complexity: 10,
                // Nothing is lost on the way to a file.
                fec: false,
                packet_loss_percent: 0,
                ..OpusEncoderConfig::default()
            },
            AudioFormat::MONO_48KHZ_F32,
        )
        .map_err(|e| e.to_string())?;

        let dir = clip_dir();
        sweep_stale(&dir);
        let stop = Arc::new(AtomicBool::new(false));
        let cancel = Arc::new(AtomicBool::new(false));
        let take = Take {
            capture,
            filters: super::audio::voice_message_filters(&settings),
            encoder,
            limit_ms: if limit_ms == 0 {
                HARD_LIMIT_MS
            } else {
                limit_ms.min(HARD_LIMIT_MS)
            },
            dir,
            app: self.app_handle().ok_or("No app handle")?,
            stop: Arc::clone(&stop),
            cancel: Arc::clone(&cancel),
        };
        let thread = std::thread::Builder::new()
            .name("voice-message".to_owned())
            .spawn(move || take.run())
            .map_err(|e| format!("start the recorder: {e}"))?;

        let mut held = self.voice_message.lock().map_err(|e| e.to_string())?;
        *held = Some(Recording {
            stop,
            cancel,
            thread,
        });
        Ok(())
    }

    /// End the take and hand back the clip.
    pub async fn finish_voice_message(&self) -> Result<VoiceClip, String> {
        let recording = self
            .voice_message
            .lock()
            .map_err(|e| e.to_string())?
            .take()
            .ok_or("Not recording a voice message")?;
        recording.stop.store(true, Ordering::Relaxed);
        tauri::async_runtime::spawn_blocking(move || recording.thread.join())
            .await
            .map_err(|e| e.to_string())?
            .map_err(|_| "the recorder stopped unexpectedly".to_owned())?
            .and_then(|clip| clip.ok_or_else(|| "the voice message was cancelled".to_owned()))
    }

    /// End the take and throw it away. Doing nothing when none is running.
    pub fn cancel_voice_message(&self) {
        let Some(recording) = self
            .voice_message
            .lock()
            .ok()
            .and_then(|mut held| held.take())
        else {
            return;
        };
        recording.cancel.store(true, Ordering::Relaxed);
        // Joined off the caller's thread: the recorder notices within one
        // poll, but whoever cancelled should not wait even that long.
        drop(std::thread::spawn(move || {
            if recording.thread.join().is_err() {
                warn!("voice message recorder panicked while cancelling");
            }
        }));
    }

    /// Delete a clip once it has been sent, or when the user discards it.
    ///
    /// Only ever inside the clip directory, whatever path the frontend names:
    /// this command deletes files, and a path from IPC is not to be trusted
    /// with that.
    pub fn discard_voice_clip(&self, path: &str) -> Result<(), String> {
        let dir = clip_dir()
            .canonicalize()
            .map_err(|e| format!("no voice clips to discard: {e}"))?;
        let target = Path::new(path)
            .canonicalize()
            .map_err(|e| format!("no such clip: {e}"))?;
        if target.parent() != Some(dir.as_path()) {
            return Err("not a voice clip".to_owned());
        }
        std::fs::remove_file(&target).map_err(|e| format!("delete {}: {e}", target.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_waveform_always_has_every_bar_and_peaks_at_one_hundred() {
        let levels: Vec<f32> = (0..500).map(|i| (i % 50) as f32 / 100.0).collect();
        let bars = waveform(&levels);
        assert_eq!(bars.len(), WAVEFORM_BARS);
        assert_eq!(bars.iter().copied().max(), Some(100));
    }

    #[test]
    fn a_clip_shorter_than_the_bar_count_still_fills_the_bars() {
        let bars = waveform(&[0.1, 0.5, 0.2]);
        assert_eq!(bars.len(), WAVEFORM_BARS);
        assert!(bars.contains(&100));
    }

    #[test]
    fn silence_draws_a_flat_line_rather_than_dividing_by_zero() {
        assert_eq!(waveform(&[0.0; 200]), vec![0; WAVEFORM_BARS]);
        assert_eq!(waveform(&[]), vec![0; WAVEFORM_BARS]);
    }

    #[test]
    fn loudness_of_a_full_scale_square_wave_is_one() {
        let square: Vec<f32> = (0..FRAME)
            .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
            .collect();
        assert!((rms(&square) - 1.0).abs() < 1e-6);
        assert!(rms(&[]).abs() < f32::EPSILON);
    }

    #[test]
    fn twenty_milliseconds_of_samples_is_twenty_milliseconds() {
        assert_eq!(millis(FRAME as u64), 20);
        assert_eq!(millis(SAMPLE_RATE * 120), 120_000);
    }

    #[test]
    fn a_real_encoder_produces_a_stream_a_decoder_accepts() {
        // The container is only worth anything if what it holds decodes:
        // encode a second of tone, read the packets back out of the pages,
        // and check they are the encoder's own and that libopus takes them.
        use mumble_protocol::audio::decoder::{AudioDecoder, OpusDecoder};

        let mut encoder = OpusEncoder::new(
            OpusEncoderConfig {
                bitrate: BITRATE,
                application: OpusApplication::Voip,
                ..OpusEncoderConfig::default()
            },
            AudioFormat::MONO_48KHZ_F32,
        )
        .expect("an encoder");
        let mut writer = ogg::OggOpusWriter::new(1, "test");
        let mut sent = Vec::new();
        for n in 0..50 {
            let chunk: Vec<f32> = (0..FRAME)
                .map(|i| {
                    let t = (n * FRAME + i) as f32 / 48_000.0;
                    (t * 440.0 * std::f32::consts::TAU).sin() * 0.5
                })
                .collect();
            let packet = encoder.encode(&frame_of(&chunk)).expect("encodes");
            writer.push(packet.data.clone(), FRAME as u64);
            sent.push(packet);
        }
        let read_back = ogg::packets(&writer.finish());

        // Two header packets, then every audio packet in order.
        assert_eq!(read_back.len(), sent.len() + 2);
        let mut decoder = OpusDecoder::new(AudioFormat::MONO_48KHZ_F32).expect("a decoder");
        for (original, stored) in sent.iter().zip(&read_back[2..]) {
            assert_eq!(&original.data, stored);
            let frame = decoder.decode(original).expect("every packet decodes");
            assert_eq!(frame.sample_count(), FRAME);
        }
    }
}
