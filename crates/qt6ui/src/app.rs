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
    /// Server limits from `ServerConfig` (0 = not announced): max bytes for
    /// an image message and for a plain text message.
    pub max_image_bytes: u32,
    pub max_message_bytes: u32,
    /// Our own raw comment as last seen on the wire, kept so the settings
    /// page can update single profile fields without wiping the ones it
    /// does not edit (nameStyle, themeColors, ... set in the full client).
    pub own_comment: String,
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
    ///
    /// `cert_pems` is an optional `(certificate, key)` PEM pair for TLS
    /// client auth (a saved server's identity); `None` connects anonymously.
    pub fn connect(
        self: Arc<Self>,
        ui: CxxQtThread<Backend>,
        host: String,
        port: u16,
        username: String,
        password: Option<String>,
        cert_pems: Option<(String, String)>,
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
            core.run_session(ui, host, port, username, password, cert_pems).await;
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
        cert_pems: Option<(String, String)>,
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

        let (client_cert_pem, client_key_pem) = match cert_pems {
            Some((cert, key)) => (Some(cert.into_bytes()), Some(key.into_bytes())),
            None => (None, None),
        };
        let config = ClientConfig {
            tcp: TcpConfig {
                server_host: host.clone(),
                server_port: port,
                accept_invalid_certs: true,
                client_cert_pem,
                client_key_pem,
            },
            udp: UdpConfig { server_host: host, server_port: port },
            ..ClientConfig::default()
        };

        match client::run(config, handler).await {
            Ok((client, join)) => {
                let _ = client
                    .send(Authenticate { username, password, tokens: vec![], totp: None })
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
    ///
    /// The event loop is taken out of `Shared` *before* `teardown` so it is
    /// NOT aborted while the `Disconnect` command is still in flight: the
    /// command must reach the event loop, which then exits on its own and
    /// closes the TCP connection (that close is what makes the server drop
    /// our session - aborting concurrently used to leak the connection and
    /// leave a pinging ghost session behind). Waiting happens off the Qt
    /// thread; the abort after the timeout is a safety net, and since the
    /// event loop's sub-tasks abort on drop it also closes the socket.
    pub fn disconnect(&self) {
        let (client, event_loop) = {
            let mut sh = self.lock();
            (sh.client.take(), sh.event_loop.take())
        };
        if let Some(client) = client {
            self.rt.spawn(async move {
                let _ = client.send(Disconnect).await;
                if let Some(mut join) = event_loop {
                    if tokio::time::timeout(Duration::from_secs(3), &mut join).await.is_err() {
                        tracing::warn!("event loop did not exit after Disconnect; aborting it");
                        join.abort();
                    }
                }
            });
        } else if let Some(join) = event_loop {
            join.abort();
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
            let (display_html, images) = crate::media::extract_images(&body);
            let display = fancy_utils::markdown::sanitize_styled_text(&display_html);
            let images_json = serde_json::json!(crate::media::spill_images(images)).to_string();
            ui_emit_chat(&ui, channel.to_string(), own_name, display, images_json);
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

    /// Send staged image files as one gallery, captioned by `caption`
    /// (markdown), mirroring the web client's `useChatSend.sendMediaGallery`:
    /// each image goes out as its own full-quality message carrying a shared
    /// gallery marker; a multi-image gallery's caption becomes its own
    /// leading message while a single image keeps it inline. `compressed`
    /// targets a third of the server's image budget to save bandwidth.
    ///
    /// The (possibly multi-second) fit/encode work runs on a dedicated
    /// thread: the single-worker tokio runtime also drives the outbound
    /// voice loop and must never stall on JPEG re-encoding.
    pub fn send_images(self: Arc<Self>, paths: Vec<String>, caption: String, compressed: bool) {
        let (client, channel, ui, own_name, max_image, max_message) = {
            let sh = self.lock();
            (
                sh.client.clone(),
                sh.current_channel,
                sh.ui.clone(),
                sh.own_name.clone(),
                sh.max_image_bytes,
                sh.max_message_bytes,
            )
        };
        let Some(client) = client else { return };
        let channel = channel.unwrap_or(0);

        let dropped = paths.len().saturating_sub(crate::media::MAX_GALLERY_IMAGES);
        let paths: Vec<String> =
            paths.into_iter().take(crate::media::MAX_GALLERY_IMAGES).collect();
        if dropped > 0 {
            if let Some(ui) = &ui {
                ui_log(
                    ui,
                    format!(
                        "Only the first {} images were sent.",
                        crate::media::MAX_GALLERY_IMAGES
                    ),
                );
            }
        }

        // 0 means "no special image limit" -> fall back to message_length
        // (and a sane default when the server announced neither).
        let max_bytes = if max_image > 0 {
            max_image as usize
        } else if max_message > 0 {
            max_message as usize
        } else {
            131_072
        };
        let per_image = if compressed { (max_bytes / 3).max(60_000) } else { max_bytes };

        let caption = caption.trim().to_owned();
        let caption_html = if caption.is_empty() {
            String::new()
        } else {
            fancy_utils::markdown::markdown_to_html(&caption)
        };
        let caption_text = fancy_utils::markdown::sanitize_styled_text(&caption_html);

        let rt = self.rt.handle().clone();
        std::thread::spawn(move || {
            let single = paths.len() == 1;
            let total = paths.len();
            let group = if single { String::new() } else { crate::media::new_gallery_id() };
            let mut bodies: Vec<String> = Vec::with_capacity(total + 1);

            // For a gallery the caption is its own leading message so every
            // tile stays a uniform image; a single image keeps it inline.
            if !single && !caption_html.is_empty() {
                bodies.push(caption_html.clone());
                if let Some(ui) = &ui {
                    ui_emit_chat(
                        ui,
                        channel.to_string(),
                        own_name.clone(),
                        caption_text.clone(),
                        "[]".to_owned(),
                    );
                }
            }

            for (index, path) in paths.iter().enumerate() {
                match crate::media::fit_image_file(path, per_image) {
                    Ok(data_url) => {
                        let name = path.rsplit(['/', '\\']).next().unwrap_or("image");
                        let img_html = format!(
                            "<img src=\"{data_url}\" alt=\"{}\" />",
                            crate::media::escape_attr(name)
                        );
                        let marker = if single {
                            String::new()
                        } else {
                            crate::media::gallery_marker(&group, index, total)
                        };
                        let cap = if single { caption_html.as_str() } else { "" };
                        bodies.push(format!("{marker}{cap}{img_html}"));
                        if let Some(ui) = &ui {
                            let text = if single { caption_text.clone() } else { String::new() };
                            // Echo through the disk spill too - the model
                            // must never retain the base64 payload.
                            let spilled = crate::media::spill_images(vec![data_url]);
                            let images_json = serde_json::json!(spilled).to_string();
                            ui_emit_chat(ui, channel.to_string(), own_name.clone(), text, images_json);
                        }
                    }
                    Err(e) => {
                        if let Some(ui) = &ui {
                            ui_log(ui, format!("Failed to send images: {e}"));
                        }
                    }
                }
            }

            // One task sends everything in order so the gallery arrives in
            // sequence on the wire.
            rt.spawn(async move {
                for message in bodies {
                    let _ = client
                        .send(SendTextMessage {
                            channel_ids: vec![channel],
                            user_sessions: vec![],
                            tree_ids: vec![],
                            message,
                            message_id: None,
                            timestamp: None,
                            edit_id: None,
                        })
                        .await;
                }
            });
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

    /// Set (or clear, with an empty path) our avatar: the image file is
    /// fitted to the server's image budget and sent as the Mumble texture.
    /// The server echoes it back in a `UserState`, which flows through the
    /// normal absorb/spill path and refreshes every avatar in the UI.
    pub fn set_avatar(self: Arc<Self>, path: String) {
        let (client, ui, max_image) = {
            let sh = self.lock();
            (sh.client.clone(), sh.ui.clone(), sh.max_image_bytes)
        };
        let Some(client) = client else { return };
        let rt = self.rt.handle().clone();
        std::thread::spawn(move || {
            let texture = if path.is_empty() {
                Vec::new() // clears the avatar
            } else {
                let budget = if max_image > 0 { max_image as usize } else { 131_072 };
                match crate::media::fit_image_file_bytes(&path, budget) {
                    Ok(bytes) => bytes,
                    Err(e) => {
                        if let Some(ui) = &ui {
                            ui_log(ui, format!("Failed to set avatar: {e}"));
                        }
                        return;
                    }
                }
            };
            rt.spawn(async move {
                let _ = client.send(mumble_protocol::command::SetTexture { texture }).await;
            });
        });
    }

    /// Update our Fancy profile (status, banner, bio) and publish it as
    /// the Mumble comment. Fields this client does not edit (nameStyle,
    /// themeColors, ...) are preserved from the last comment on the wire.
    /// `banner_image_path` is a local file ("" = no banner image).
    pub fn save_profile(
        self: Arc<Self>,
        status: String,
        banner_color: String,
        banner_image_path: String,
        bio_markdown: String,
    ) {
        let (client, ui, own_comment) = {
            let sh = self.lock();
            (sh.client.clone(), sh.ui.clone(), sh.own_comment.clone())
        };
        let Some(client) = client else { return };
        let rt = self.rt.handle().clone();
        std::thread::spawn(move || {
            let (existing, _) = crate::profile::split_comment(&own_comment);
            let mut profile = existing.unwrap_or_else(|| serde_json::json!({}));
            profile["v"] = serde_json::json!(1);

            let status = status.trim();
            if status.is_empty() {
                profile.as_object_mut().map(|o| o.remove("status"));
            } else {
                profile["status"] = serde_json::json!(status);
            }

            let mut banner = serde_json::Map::new();
            if !banner_color.trim().is_empty() {
                banner.insert("color".into(), serde_json::json!(banner_color.trim()));
            }
            if !banner_image_path.is_empty() {
                // The banner rides inside the comment: keep it well under
                // the server's image budget so the whole comment fits.
                match crate::media::fit_image_file(&banner_image_path, 98_304) {
                    Ok(data_url) => {
                        banner.insert("image".into(), serde_json::json!(data_url));
                    }
                    Err(e) => {
                        if let Some(ui) = &ui {
                            ui_log(ui, format!("Failed to set banner: {e}"));
                        }
                    }
                }
            }
            if banner.is_empty() {
                profile.as_object_mut().map(|o| o.remove("banner"));
            } else {
                profile["banner"] = serde_json::Value::Object(banner);
            }

            let bio = bio_markdown.trim();
            let bio_html =
                if bio.is_empty() { String::new() } else { fancy_utils::markdown::markdown_to_html(bio) };
            let comment = crate::profile::build_comment(&profile, &bio_html);

            rt.spawn(async move {
                let _ = client.send(mumble_protocol::command::SetComment { comment }).await;
            });
        });
    }

    /// Ask the server for a user's stats (hover card online/idle pills);
    /// the answer flows back through the `user_stats` signal.
    pub fn request_user_stats(&self, session: u32) {
        let client = self.lock().client.clone();
        let Some(client) = client else { return };
        self.rt.spawn(async move {
            let _ = client.send(mumble_protocol::command::RequestUserStats { session }).await;
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

/// Emit the `chatMessage` signal on the Qt thread. `images` is a JSON array
/// of displayable image sources extracted from the message body.
pub(crate) fn ui_emit_chat(
    ui: &CxxQtThread<Backend>,
    channel: String,
    sender: String,
    text: String,
    images: String,
) {
    let _ = ui.queue(move |mut o: Pin<&mut Backend>| {
        o.as_mut().chat_message(
            QString::from(&channel),
            QString::from(&sender),
            QString::from(&text),
            QString::from(&images),
        );
    });
}

/// Emit the `logMessage` signal on the Qt thread.
pub(crate) fn ui_log(ui: &CxxQtThread<Backend>, line: String) {
    tracing::info!("{line}");
    let _ = ui.queue(move |mut o: Pin<&mut Backend>| o.as_mut().log_message(QString::from(&line)));
}

/// Emit the `userStats` signal on the Qt thread (-1 = unknown).
pub(crate) fn ui_emit_user_stats(
    ui: &CxxQtThread<Backend>,
    session: i32,
    onlinesecs: i32,
    idlesecs: i32,
) {
    let _ = ui.queue(move |mut o: Pin<&mut Backend>| {
        o.as_mut().user_stats(session, onlinesecs, idlesecs);
    });
}
