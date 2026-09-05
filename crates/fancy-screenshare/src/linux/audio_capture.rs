//! Desktop audio capture: the default sink's monitor, over PipeWire.
//!
//! A PipeWire capture stream with `stream.capture.sink=true` and no target
//! records whatever plays on the default sink - "what the speakers play",
//! which is what a screen share means by desktop audio. A PipeWire sink has
//! no separate monitor node; that property IS the monitor (the PulseAudio
//! `<sink>.monitor` name falls back to the microphone here). The stream asks
//! for F32LE 48 kHz stereo, which is what the Opus encoder wants, and
//! PipeWire converts on its side.

use std::sync::mpsc::SyncSender;
use std::time::Duration;

use pipewire as pw;
use pw::spa;

/// Sample rate and layout of the blocks delivered by [`DesktopAudioCapture`].
pub(crate) const SAMPLE_RATE: u32 = 48_000;
pub(crate) const CHANNELS: usize = 2;

/// A running capture; dropping it ends the stream.
pub(crate) struct DesktopAudioCapture {
    quit: Option<pw::channel::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl std::fmt::Debug for DesktopAudioCapture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DesktopAudioCapture").finish_non_exhaustive()
    }
}

impl DesktopAudioCapture {
    /// Start capturing. Interleaved stereo f32 blocks at 48 kHz arrive on
    /// `tx`; a block the receiver has no room for is dropped rather than
    /// stalling PipeWire's real-time thread. Returns once the stream is
    /// streaming, or with why it could not be.
    pub(crate) fn start(tx: SyncSender<Vec<f32>>) -> Result<Self, String> {
        let (quit_tx, quit_rx) = pw::channel::channel::<()>();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let thread = std::thread::Builder::new()
            .name("pw-desktop-audio".into())
            .spawn(move || {
                if let Err(e) = run_loop(tx, quit_rx, ready_tx.clone()) {
                    // Unheard if the loop already reported ready: an error
                    // after that ends the capture, which the encoder thread
                    // notices as a closed channel.
                    let _ = ready_tx.send(Err(e));
                }
            })
            .map_err(|e| format!("pipewire audio thread spawn: {e}"))?;
        let mut capture = Self {
            quit: Some(quit_tx),
            thread: Some(thread),
        };
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(capture),
            Ok(Err(e)) => {
                capture.stop();
                Err(e)
            }
            Err(_) => {
                capture.stop();
                Err("pipewire audio capture did not start within 5 s".to_owned())
            }
        }
    }

    fn stop(&mut self) {
        if let Some(quit) = self.quit.take() {
            let _ = quit.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for DesktopAudioCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

struct Listener {
    format: spa::param::audio::AudioInfoRaw,
    tx: SyncSender<Vec<f32>>,
    ready: Option<std::sync::mpsc::Sender<Result<(), String>>>,
    dropped: u64,
}

fn run_loop(
    tx: SyncSender<Vec<f32>>,
    quit_rx: pw::channel::Receiver<()>,
    ready: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    pw::init();
    let mainloop = pw::main_loop::MainLoop::new(None).map_err(|e| format!("pw mainloop: {e}"))?;
    let context = pw::context::Context::new(&mainloop).map_err(|e| format!("pw context: {e}"))?;
    let core = context.connect(None).map_err(|e| format!("pw connect: {e}"))?;

    let loop_weak = mainloop.downgrade();
    let _quit_guard = quit_rx.attach(mainloop.loop_(), move |()| {
        if let Some(mainloop) = loop_weak.upgrade() {
            mainloop.quit();
        }
    });

    let stream = pw::stream::Stream::new(
        &core,
        "fancy-screenshare-audio",
        pw::properties::properties! {
            *pw::keys::MEDIA_TYPE => "Audio",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
            *pw::keys::NODE_NAME => "fancy-screenshare-audio",
            "stream.capture.sink" => "true",
        },
    )
    .map_err(|e| format!("pw audio stream: {e}"))?;

    let _listener = register_listener(&stream, tx, ready)?;
    let bytes = format_pod()?;
    let mut params = [spa::pod::Pod::from_bytes(&bytes).ok_or("audio format pod rejected")?];
    stream
        .connect(
            spa::utils::Direction::Input,
            None,
            pw::stream::StreamFlags::AUTOCONNECT
                | pw::stream::StreamFlags::MAP_BUFFERS
                | pw::stream::StreamFlags::RT_PROCESS,
            &mut params,
        )
        .map_err(|e| format!("pw audio connect: {e}"))?;

    mainloop.run();
    Ok(())
}

/// The stream's callbacks: readiness, the negotiated format, and the
/// real-time process hook that hands blocks to the encoder.
fn register_listener(
    stream: &pw::stream::Stream,
    tx: SyncSender<Vec<f32>>,
    ready: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<pw::stream::StreamListener<Listener>, String> {
    stream
        .add_local_listener_with_user_data(Listener {
            format: spa::param::audio::AudioInfoRaw::new(),
            tx,
            ready: Some(ready),
            dropped: 0,
        })
        .state_changed(|_stream, user, _old, new| match new {
            pw::stream::StreamState::Streaming => {
                if let Some(ready) = user.ready.take() {
                    let _ = ready.send(Ok(()));
                }
            }
            pw::stream::StreamState::Error(message) => {
                if let Some(ready) = user.ready.take() {
                    let _ = ready.send(Err(format!("pipewire audio stream: {message}")));
                }
            }
            _ => {}
        })
        .param_changed(|_stream, user, id, param| {
            let Some(param) = param else { return };
            if id != spa::param::ParamType::Format.as_raw() {
                return;
            }
            let Ok((media_type, media_subtype)) = spa::param::format_utils::parse_format(param)
            else {
                return;
            };
            if media_type != spa::param::format::MediaType::Audio
                || media_subtype != spa::param::format::MediaSubtype::Raw
            {
                return;
            }
            if user.format.parse(param).is_ok() {
                tracing::info!(
                    rate = user.format.rate(),
                    channels = user.format.channels(),
                    "screenshare: desktop audio capture negotiated"
                );
            }
        })
        .process(|stream, user| {
            let Some(mut buffer) = stream.dequeue_buffer() else { return };
            let datas = buffer.datas_mut();
            let Some(data) = datas.first_mut() else { return };
            let chunk = data.chunk();
            let (offset, size) = (chunk.offset() as usize, chunk.size() as usize);
            let Some(bytes) = data.data() else { return };
            let Some(bytes) = bytes.get(offset..offset + size) else { return };
            let channels = (user.format.channels() as usize).max(1);
            let block = to_stereo(bytes, channels);
            if user.tx.try_send(block).is_err() {
                user.dropped += 1;
                if user.dropped.is_power_of_two() {
                    tracing::warn!(
                        dropped = user.dropped,
                        "screenshare: desktop audio encoder not keeping up; dropping blocks"
                    );
                }
            }
        })
        .register()
        .map_err(|e| format!("pw audio listener: {e}"))
}

/// The one format offered: F32LE, 48 kHz, stereo.
fn format_pod() -> Result<Vec<u8>, String> {
    let mut info = spa::param::audio::AudioInfoRaw::new();
    info.set_format(spa::param::audio::AudioFormat::F32LE);
    info.set_rate(SAMPLE_RATE);
    #[allow(clippy::cast_possible_truncation, reason = "two channels")]
    info.set_channels(CHANNELS as u32);
    let object = spa::pod::Object {
        type_: spa::utils::SpaTypes::ObjectParamFormat.as_raw(),
        id: spa::param::ParamType::EnumFormat.as_raw(),
        properties: info.into(),
    };
    let (cursor, _) = spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(object),
    )
    .map_err(|e| format!("audio format pod: {e:?}"))?;
    Ok(cursor.into_inner())
}

/// Little-endian f32 samples in `channels` interleaved channels, folded to
/// stereo: mono is duplicated, anything wider keeps its first two channels.
fn to_stereo(bytes: &[u8], channels: usize) -> Vec<f32> {
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    match channels {
        2 => samples,
        1 => samples.iter().flat_map(|&s| [s, s]).collect(),
        n => samples
            .chunks_exact(n)
            .flat_map(|frame| [frame[0], frame[1]])
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::to_stereo;

    /// The real capture, against the machine's default sink.
    ///
    /// Plays a short tone into that sink and asserts the monitor hears it.
    /// Silence would also prove the stream runs, but not that it is pointed
    /// at the sink rather than a microphone - the `stream.capture.sink`
    /// mix-up this module exists to avoid.
    #[test]
    #[ignore = "needs PipeWire and plays a brief tone on the default sink"]
    fn the_default_sink_monitor_hears_what_it_plays() {
        use std::sync::mpsc::sync_channel;
        use std::time::{Duration, Instant};

        let wav = std::env::var("FANCY_TEST_TONE").expect("FANCY_TEST_TONE=<path to a wav>");
        let (tx, rx) = sync_channel(64);
        let _capture = super::DesktopAudioCapture::start(tx).expect("capture starts");
        let mut player = std::process::Command::new("pw-play")
            .args(["--volume", "0.2", &wav])
            .spawn()
            .expect("pw-play");

        let deadline = Instant::now() + Duration::from_secs(6);
        let mut peak = 0f32;
        let mut blocks = 0u32;
        while Instant::now() < deadline {
            let Ok(block) = rx.recv_timeout(Duration::from_millis(500)) else {
                continue;
            };
            blocks += 1;
            peak = block.iter().fold(peak, |acc, s| acc.max(s.abs()));
            if peak > 0.02 {
                break;
            }
        }
        let _ = player.kill();
        let _ = player.wait();
        assert!(blocks > 0, "the monitor delivered no audio at all");
        assert!(peak > 0.02, "the monitor stayed silent through the tone (peak {peak})");
    }

    #[test]
    fn channel_layouts_fold_to_stereo() {
        let f = |v: &[f32]| v.iter().flat_map(|s| s.to_le_bytes()).collect::<Vec<u8>>();
        assert_eq!(to_stereo(&f(&[0.5, -0.5]), 2), vec![0.5, -0.5]);
        assert_eq!(to_stereo(&f(&[0.25]), 1), vec![0.25, 0.25]);
        assert_eq!(to_stereo(&f(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]), 6), vec![1.0, 2.0]);
    }
}
