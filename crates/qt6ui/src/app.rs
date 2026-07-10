//! `AppCore` - owns the tokio runtime and every bit of `mumble-protocol`
//! logic.  The QML `Backend` is a thin shell around this type.
//!
//! Threading model:
//! * The Qt/QML thread calls the invokables, which call `AppCore` methods.
//! * `AppCore` spawns work on its own tokio runtime (network, encode loop).
//! * Background tasks push UI updates back onto the Qt thread through a
//!   [`CxxQtThread`] handle (see the `ui_*` helpers).

use std::sync::atomic::AtomicU32;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use core::pin::Pin;

use cxx_qt::CxxQtThread;
use cxx_qt_lib::QString;
use tokio::runtime::Runtime;
use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;

use mumble_protocol::audio::encoder::{EncodedPacket, OpusEncoder, OpusEncoderConfig};
use mumble_protocol::audio::filter::noise_gate::{NoiseGate, NoiseGateConfig};
use mumble_protocol::audio::filter::FilterChain;
use mumble_protocol::audio::mixer::{AudioMixer, SpeakerBuffers, SpeakerVolumes};
use mumble_protocol::audio::pipeline::{OutboundPipeline, OutboundTick};
use mumble_protocol::audio::sample::AudioFormat;
use mumble_protocol::client::{self, ClientConfig, ClientHandle};
use mumble_protocol::command::{Authenticate, Disconnect, JoinChannel, SendTextMessage, SetSelfMute};
use mumble_protocol::message::UdpMessage;
use mumble_protocol::proto::mumble_udp;
use mumble_protocol::transport::tcp::TcpConfig;
use mumble_protocol::transport::udp::UdpConfig;

use fancy_audio_device::{CpalCapture, CpalMixingPlayback, MixingPlayback};

use crate::bridge::qobject::Backend;
use crate::events::QtEventHandler;

/// Frame size for capture/encode: 960 samples = 20 ms @ 48 kHz.
const FRAME_SIZE: usize = 960;

/// State shared between the Qt thread (invokables) and the tokio tasks.
#[derive(Default)]
pub struct Shared {
    /// Handle used to marshal UI updates onto the Qt thread.
    pub ui: Option<CxxQtThread<Backend>>,
    /// Command channel into the running protocol client.
    pub client: Option<ClientHandle>,
    /// The `client::run` outer task (connect + auth).
    pub connect_task: Option<JoinHandle<()>>,
    /// The protocol event loop task.
    pub event_loop: Option<JoinHandle<()>>,
    /// The outbound (mic -> encode -> send) task, when voice is on.
    pub outbound_task: Option<JoinHandle<()>>,
    /// Kept alive for the connection's lifetime; owns the cpal output stream.
    pub playback: Option<Box<dyn MixingPlayback>>,
    /// The channel we are currently in (target for outgoing chat).
    pub current_channel: Option<u32>,
    /// Our own display name, for locally echoing sent messages.
    pub own_name: String,
}

/// The application core.  Held behind an `Arc` inside the `Backend` QObject.
pub struct AppCore {
    rt: Runtime,
    shared: Arc<Mutex<Shared>>,
    input_volume: Arc<AtomicU32>,
    output_volume: Arc<AtomicU32>,
}

impl AppCore {
    /// Build the core and its tokio runtime.
    ///
    /// A single worker thread is plenty: the runtime only drives network I/O
    /// and the (light) encode loop; real-time audio runs on cpal's own
    /// threads.  Keeping it to one worker minimises idle RAM.
    pub fn new() -> Self {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .expect("failed to build tokio runtime");
        Self {
            rt,
            shared: Arc::new(Mutex::new(Shared::default())),
            input_volume: Arc::new(AtomicU32::new(1.0_f32.to_bits())),
            output_volume: Arc::new(AtomicU32::new(1.0_f32.to_bits())),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Shared> {
        self.shared.lock().expect("shared state mutex poisoned")
    }

    /// Connect to `host:port` and authenticate as `username`.
    pub fn connect(
        self: Arc<Self>,
        ui: CxxQtThread<Backend>,
        host: String,
        port: u16,
        username: String,
        password: Option<String>,
    ) {
        // Tear down any previous session first.
        self.teardown();

        {
            let mut sh = self.lock();
            sh.ui = Some(ui.clone());
            sh.own_name = username.clone();
        }
        ui_set_status(&ui, "connecting".to_owned());

        let core = Arc::clone(&self);
        let task = self.rt.spawn(async move {
            core.run_session(ui, host, port, username, password).await;
        });
        self.lock().connect_task = Some(task);
    }

    /// The async body of a connection: set up inbound audio, run the client,
    /// authenticate, and stash the handles.
    async fn run_session(
        self: Arc<Self>,
        ui: CxxQtThread<Backend>,
        host: String,
        port: u16,
        username: String,
        password: Option<String>,
    ) {
        // -- Inbound audio: mixer writes into buffers, playback reads them.
        let buffers: SpeakerBuffers = Arc::new(Mutex::new(std::collections::HashMap::new()));
        let volumes: SpeakerVolumes = Arc::new(Mutex::new(std::collections::HashMap::new()));
        match CpalMixingPlayback::new(None, self.output_volume.clone(), buffers.clone(), volumes) {
            Ok(mut pb) => {
                if let Err(e) = pb.start() {
                    ui_log(&ui, format!("playback start failed: {e}"));
                }
                self.lock().playback = Some(Box::new(pb));
            }
            Err(e) => ui_log(&ui, format!("no audio output: {e}")),
        }
        let mixer = AudioMixer::new(buffers, AudioFormat::MONO_48KHZ_F32);

        let handler = QtEventHandler::new(ui.clone(), Arc::clone(&self.shared), mixer);

        let config = ClientConfig {
            tcp: TcpConfig {
                server_host: host.clone(),
                server_port: port,
                accept_invalid_certs: true,
                client_cert_pem: None,
                client_key_pem: None,
            },
            udp: UdpConfig { server_host: host, server_port: port },
            ..ClientConfig::default()
        };

        match client::run(config, handler).await {
            Ok((client, join)) => {
                let _ = client
                    .send(Authenticate { username, password, tokens: vec![] })
                    .await;
                // Start muted (don't transmit) but NOT deafened, so the user
                // hears others immediately.  Enabling voice unmutes.
                let _ = client.send(SetSelfMute { muted: true }).await;
                let mut sh = self.lock();
                sh.client = Some(client);
                sh.event_loop = Some(join);
            }
            Err(e) => ui_set_status(&ui, format!("error: {e}")),
        }
    }

    /// Disconnect and stop audio.
    pub fn disconnect(&self) {
        let client = self.lock().client.clone();
        if let Some(client) = client {
            self.rt.spawn(async move {
                let _ = client.send(Disconnect).await;
            });
        }
        self.teardown();
        if let Some(ui) = self.lock().ui.clone() {
            ui_set_status(&ui, "disconnected".to_owned());
        }
    }

    /// Abort tasks, stop the mic + speaker streams, and clear session state.
    fn teardown(&self) {
        let mut sh = self.lock();
        for task in [sh.connect_task.take(), sh.event_loop.take(), sh.outbound_task.take()]
            .into_iter()
            .flatten()
        {
            task.abort();
        }
        if let Some(mut pb) = sh.playback.take() {
            let _ = pb.stop();
        }
        sh.client = None;
        sh.current_channel = None;
    }

    /// Send a chat message to the current channel and echo it locally
    /// (Mumble servers do not reflect a sender's own text message back).
    ///
    /// `text` is markdown (from the WYSIWYG input); the wire body is HTML,
    /// like the web client sends.
    pub fn send_message(&self, text: String) {
        let (client, channel, ui, own_name) = {
            let sh = self.lock();
            (sh.client.clone(), sh.current_channel, sh.ui.clone(), sh.own_name.clone())
        };
        let Some(client) = client else { return };
        let channel = channel.unwrap_or(0);
        let body = fancy_utils::markdown::markdown_to_html(&text);
        if let Some(ui) = ui {
            let display = fancy_utils::markdown::sanitize_styled_text(&body);
            ui_emit_chat(&ui, channel.to_string(), own_name, display);
        }
        self.rt.spawn(async move {
            let _ = client
                .send(SendTextMessage {
                    channel_ids: vec![channel],
                    user_sessions: vec![],
                    tree_ids: vec![],
                    message: body,
                    message_id: None,
                    timestamp: None,
                    edit_id: None,
                })
                .await;
        });
    }

    /// Move ourselves into `channel_id`.
    pub fn join_channel(&self, channel_id: u32) {
        let client = self.lock().client.clone();
        let Some(client) = client else { return };
        self.rt.spawn(async move {
            let _ = client.send(JoinChannel { channel_id, password: None }).await;
        });
    }

    /// Toggle voice: unmute + start the mic pipeline, or mute + stop it.
    pub fn set_voice_enabled(&self, enabled: bool) {
        let (client, ui) = {
            let sh = self.lock();
            (sh.client.clone(), sh.ui.clone())
        };
        let Some(client) = client else { return };

        if enabled {
            let unmute = client.clone();
            self.rt.spawn(async move {
                let _ = unmute.send(SetSelfMute { muted: false }).await;
            });
            match build_outbound(self.input_volume.clone()) {
                Ok(pipeline) => {
                    let task = self.rt.spawn(outbound_loop(pipeline, client));
                    let mut sh = self.lock();
                    if let Some(old) = sh.outbound_task.replace(task) {
                        old.abort();
                    }
                }
                Err(e) => {
                    if let Some(ui) = ui {
                        ui_log(&ui, format!("microphone init failed: {e}"));
                    }
                }
            }
        } else {
            if let Some(old) = self.lock().outbound_task.take() {
                old.abort();
            }
            self.rt.spawn(async move {
                let _ = client.send(SetSelfMute { muted: true }).await;
            });
        }
    }
}

impl Default for AppCore {
    fn default() -> Self {
        Self::new()
    }
}

// -- Outbound audio ---------------------------------------------------

/// Build the mic -> noise-gate -> Opus pipeline.
fn build_outbound(input_volume: Arc<AtomicU32>) -> Result<OutboundPipeline, String> {
    let capture = CpalCapture::new(None, FRAME_SIZE, input_volume).map_err(|e| e.to_string())?;
    let encoder = OpusEncoder::new(OpusEncoderConfig::default(), AudioFormat::MONO_48KHZ_F32)
        .map_err(|e| e.to_string())?;
    let mut filters = FilterChain::new();
    filters.push(Box::new(NoiseGate::new(NoiseGateConfig::default())));
    Ok(OutboundPipeline::new(Box::new(capture), filters, Box::new(encoder)))
}

/// Drive the outbound pipeline: read mic frames, encode, and send to the
/// server on the high-priority audio path.
async fn outbound_loop(mut pipeline: OutboundPipeline, client: ClientHandle) {
    if let Err(e) = pipeline.start() {
        tracing::warn!("capture start failed: {e}");
        return;
    }
    let mut interval = tokio::time::interval(Duration::from_millis(10));
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        let _ = interval.tick().await;
        // Drain a bounded number of frames per tick.
        for _ in 0..4 {
            match pipeline.tick() {
                Ok(OutboundTick::Audio(packet)) => send_audio_packet(&client, packet, false),
                Ok(OutboundTick::Terminator(packet)) => send_audio_packet(&client, packet, true),
                Ok(OutboundTick::Silence) => {}
                Ok(OutboundTick::NoData) => break,
                Err(e) => {
                    tracing::warn!("outbound audio error: {e}");
                    return;
                }
            }
        }
    }
}

fn send_audio_packet(client: &ClientHandle, packet: EncodedPacket, is_terminator: bool) {
    let audio = mumble_udp::Audio {
        header: Some(mumble_udp::audio::Header::Target(0)),
        sender_session: 0,
        frame_number: packet.sequence,
        opus_data: packet.data,
        positional_data: Vec::new(),
        volume_adjustment: 0.0,
        is_terminator,
    };
    let _ = client.send_audio(UdpMessage::Audio(audio));
}

// -- UI marshalling helpers (called from tokio tasks) -----------------

/// Set the `status` property on the Qt thread.
pub(crate) fn ui_set_status(ui: &CxxQtThread<Backend>, status: String) {
    let _ = ui.queue(move |mut o: Pin<&mut Backend>| o.as_mut().set_status(QString::from(&status)));
}

/// Replace the `channelsJson` property on the Qt thread.
pub(crate) fn ui_set_channels(ui: &CxxQtThread<Backend>, json: String) {
    let _ = ui.queue(move |mut o: Pin<&mut Backend>| o.as_mut().set_channels_json(QString::from(&json)));
}

/// Update the `selfChannel` property on the Qt thread.
pub(crate) fn ui_set_self_channel(ui: &CxxQtThread<Backend>, channel: i32) {
    let _ = ui.queue(move |mut o: Pin<&mut Backend>| o.as_mut().set_self_channel(channel));
}

/// Emit the `chatMessage` signal on the Qt thread.
pub(crate) fn ui_emit_chat(ui: &CxxQtThread<Backend>, channel: String, sender: String, text: String) {
    let _ = ui.queue(move |mut o: Pin<&mut Backend>| {
        o.as_mut().chat_message(QString::from(&channel), QString::from(&sender), QString::from(&text));
    });
}

/// Emit the `logMessage` signal on the Qt thread.
pub(crate) fn ui_log(ui: &CxxQtThread<Backend>, line: String) {
    tracing::info!("{line}");
    let _ = ui.queue(move |mut o: Pin<&mut Backend>| o.as_mut().log_message(QString::from(&line)));
}
