//! The real engine, behind the view's [`Engine`] trait.
//!
//! A mapping and little else: reads copy what the engine holds, commands are
//! handed to the engine's runtime and return at once, and the engine's
//! events are passed on under the view's names. What is added here is what
//! the engine has no notion of: the saved servers and their pings.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use mumble_tauri_lib::engine_api::{
    self as api, ConnectTarget, EngineDirs, EngineHandle, PingInfo,
};

use crate::engine::{
    AudioDevice, AudioDevices, Channel, ChannelId, ChosenDevices, Connection, Engine, EngineEvent,
    Message, SavedServer, ServerPing, Snapshot, User, Voice,
};
use crate::store::Store;

/// `(host, port)`: what a ping is kept under.
type Address = (String, u16);

/// A user's picture: the marker it was asked for under, and the picture once
/// it has arrived.
type AvatarSlot = (u32, Option<Arc<gpui::Image>>);

/// What the adapter shares with the tasks it starts.
struct Shared {
    engine: EngineHandle,
    events: async_channel::Sender<EngineEvent>,
    servers: Mutex<Vec<SavedServer>>,
    pings: Mutex<HashMap<Address, ServerPing>>,
    /// When each message that carries no time of its own was first read,
    /// per channel and in order: a stock server sends none, and "when it
    /// arrived here" is the time a reader expects beside it.
    first_read: Mutex<HashMap<ChannelId, Vec<u64>>>,
    /// Each user's picture: the marker it was fetched for, and the picture
    /// once it has arrived.
    avatars: Mutex<HashMap<u32, AvatarSlot>>,
    /// Whether the server refused this connection. The disconnect that
    /// follows a refusal has a reason of its own ("connection lost"), which
    /// must not replace the one that says why.
    refused: std::sync::atomic::AtomicBool,
    store: Store,
}

impl Shared {
    fn tell(&self, event: EngineEvent) {
        // The receiver lives as long as the view; with nobody left to tell
        // there is nothing to do about a failure.
        let _ = self.events.try_send(event);
    }

    /// Run `command`, and tell the user if it fails.
    async fn run(self: Arc<Self>, command: impl Future<Output = Result<(), String>>) {
        if let Err(reason) = command.await {
            self.tell(EngineEvent::Notice(Some(reason.into())));
        }
    }

    /// Pass one of the engine's events on, under the view's names.
    fn forward(self: &Arc<Self>, runtime: &tokio::runtime::Handle, event: api::EngineEvent) {
        match event {
            api::EngineEvent::Connecting | api::EngineEvent::StateChanged => {
                self.tell(EngineEvent::StateChanged);
            }
            api::EngineEvent::Connected => {
                self.tell(EngineEvent::Notice(None));
                self.tell(EngineEvent::StateChanged);
                self.open_current_conversation(runtime);
            }
            api::EngineEvent::Disconnected { reason } => {
                self.first_read
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clear();
                self.avatars
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clear();
                let refused = self
                    .refused
                    .swap(false, std::sync::atomic::Ordering::Relaxed);
                if let Some(reason) = disconnect_notice(reason, refused) {
                    self.tell(EngineEvent::Notice(Some(reason.into())));
                }
                self.tell(EngineEvent::StateChanged);
                self.tell(EngineEvent::CurrentChannelChanged);
            }
            api::EngineEvent::Rejected { reason } => {
                self.refused
                    .store(true, std::sync::atomic::Ordering::Relaxed);
                self.tell(EngineEvent::Notice(Some(reason.into())));
                self.tell(EngineEvent::StateChanged);
            }
            api::EngineEvent::CurrentChannelChanged => self.open_current_conversation(runtime),
            api::EngineEvent::UserTalking { session, talking } => {
                self.tell(EngineEvent::UserTalking { session, talking });
            }
            api::EngineEvent::VoiceChanged => self.tell(EngineEvent::StateChanged),
            api::EngineEvent::NewMessage { channel } => {
                self.tell(EngineEvent::NewMessage { channel });
            }
            api::EngineEvent::Denied { reason } => {
                let reason = reason.unwrap_or_else(|| "The server did not allow that.".to_owned());
                self.tell(EngineEvent::Notice(Some(reason.into())));
            }
            // The engine API may grow events this view does not draw yet.
            _ => {}
        }
    }

    /// The local user is in a channel (again): open its conversation, then
    /// say so, so the view reads messages that are there to be read.
    fn open_current_conversation(self: &Arc<Self>, runtime: &tokio::runtime::Handle) {
        let shared = Arc::clone(self);
        drop(runtime.spawn(async move {
            if let Some(channel) = shared.engine.current_channel() {
                // A failure here is a conversation without stored history,
                // not something to interrupt the user with.
                let _ = shared.engine.open_conversation(channel).await;
            }
            shared.tell(EngineEvent::StateChanged);
            shared.tell(EngineEvent::CurrentChannelChanged);
        }));
    }
}

/// The real engine.
pub(crate) struct RealEngine {
    shared: Arc<Shared>,
    inbox: async_channel::Receiver<EngineEvent>,
    /// The engine's worker threads. Few: the view is idle almost always, and
    /// audio runs on threads of its own.
    runtime: tokio::runtime::Runtime,
}

impl RealEngine {
    /// Start the engine, keeping its files and the view's in `store`'s
    /// directory.
    ///
    /// # Errors
    ///
    /// When the runtime's threads cannot be started.
    pub(crate) fn start(data_dir: &std::path::Path) -> std::io::Result<Self> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("fancy-engine")
            .enable_all()
            .build()?;
        let (events, inbox) = async_channel::unbounded();
        let store = Store::new(data_dir);
        // The engine reports before the adapter exists to hear it, so the
        // adapter is reached through a slot filled in just below.
        let slot: Arc<std::sync::OnceLock<Arc<Shared>>> = Arc::default();
        let for_engine = Arc::clone(&slot);
        let handle = runtime.handle().clone();
        let engine = EngineHandle::start(
            EngineDirs {
                data: data_dir.to_path_buf(),
                cache: None,
            },
            runtime.handle().clone(),
            move |event| {
                if let Some(shared) = for_engine.get() {
                    shared.forward(&handle, event);
                }
            },
        );
        let shared = Arc::new(Shared {
            engine,
            events,
            servers: Mutex::new(store.servers()),
            pings: Mutex::default(),
            first_read: Mutex::default(),
            avatars: Mutex::default(),
            refused: std::sync::atomic::AtomicBool::new(false),
            store,
        });
        let _ = slot.set(Arc::clone(&shared));
        Ok(Self {
            shared,
            inbox,
            runtime,
        })
    }

    /// Run `command` on the engine's runtime, telling the user if it fails.
    fn spawn(&self, command: impl Future<Output = Result<(), String>> + Send + 'static) {
        drop(self.runtime.spawn(Arc::clone(&self.shared).run(command)));
    }

    /// The engine's users as the view's, each with its picture if that has
    /// arrived. A picture not asked for yet is asked for now; the view is
    /// told to read again when it lands.
    fn users_with_avatars(&self, users: Vec<api::UserInfo>) -> Vec<User> {
        let mut avatars = self
            .shared
            .avatars
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        // Sessions are reused: a picture belongs to whoever is here now.
        avatars.retain(|session, _| users.iter().any(|user| user.session == *session));
        users
            .into_iter()
            .map(|user| {
                let avatar = user
                    .avatar
                    .and_then(|marker| match avatars.get(&user.session) {
                        Some((fetched_for, image)) if *fetched_for == marker => image.clone(),
                        _ => {
                            let _ = avatars.insert(user.session, (marker, None));
                            self.fetch_avatar(user.session, marker);
                            None
                        }
                    });
                User {
                    session: user.session,
                    name: user.name.into(),
                    channel: user.channel,
                    muted: user.muted,
                    deafened: user.deafened,
                    avatar,
                }
            })
            .collect()
    }

    fn fetch_avatar(&self, session: u32, marker: u32) {
        let shared = Arc::clone(&self.shared);
        drop(self.runtime.spawn(async move {
            let Some(image) = shared
                .engine
                .user_avatar(session)
                .await
                .and_then(crate::picture::picture)
            else {
                return;
            };
            {
                let mut avatars = shared
                    .avatars
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner);
                // Only if nobody else took the session, or changed picture,
                // while this one was on its way.
                match avatars.get_mut(&session) {
                    Some((wanted, slot)) if *wanted == marker => *slot = Some(Arc::new(image)),
                    _ => return,
                }
            }
            shared.tell(EngineEvent::StateChanged);
        }));
    }

    /// Change the saved servers, write them out, and say so.
    fn edit_servers(&self, edit: impl FnOnce(&mut Vec<SavedServer>)) {
        let saved = {
            let mut servers = self
                .shared
                .servers
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            edit(&mut servers);
            servers.clone()
        };
        if let Err(error) = self.shared.store.save_servers(&saved) {
            self.shared.tell(EngineEvent::Notice(Some(
                format!("The saved servers could not be written: {error}").into(),
            )));
        }
        self.shared.tell(EngineEvent::ServersChanged);
    }
}

impl Engine for RealEngine {
    fn events(&self) -> async_channel::Receiver<EngineEvent> {
        self.inbox.clone()
    }

    fn snapshot(&self) -> Snapshot {
        let engine = &self.shared.engine;
        let connection = match engine.connection() {
            api::Connection::Disconnected => Connection::Disconnected,
            api::Connection::Connecting => Connection::Connecting,
            api::Connection::Connected => Connection::Connected,
        };
        if connection != Connection::Connected {
            return Snapshot {
                connection,
                ..Snapshot::disconnected()
            };
        }
        Snapshot {
            connection,
            own_session: engine.own_session(),
            current_channel: engine.current_channel(),
            channels: engine
                .channels()
                .into_iter()
                .map(|channel| Channel {
                    id: channel.id,
                    parent: channel.parent,
                    name: channel.name.into(),
                    position: channel.position,
                })
                .collect(),
            users: self.users_with_avatars(engine.users()),
            voice: match engine.voice() {
                api::Voice::Off => Voice::Off,
                api::Voice::On => Voice::On,
                api::Voice::Muted => Voice::Muted,
            },
            deafened: engine.deafened(),
        }
    }

    fn saved_servers(&self) -> Vec<SavedServer> {
        self.shared
            .servers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn ping(&self, host: &str, port: u16) -> Option<ServerPing> {
        self.shared
            .pings
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&(host.to_owned(), port))
            .cloned()
    }

    fn refresh_pings(&self) {
        let mut addresses: Vec<Address> = self
            .saved_servers()
            .iter()
            .map(|server| (server.host.to_string(), server.port))
            .collect();
        addresses.sort();
        addresses.dedup();
        for address in addresses {
            let shared = Arc::clone(&self.shared);
            drop(self.runtime.spawn(async move {
                let answer = answered(EngineHandle::ping(&address.0, address.1).await);
                {
                    let mut pings = shared.pings.lock().unwrap_or_else(PoisonError::into_inner);
                    let _ = match answer {
                        Some(ping) => pings.insert(address, ping),
                        None => pings.remove(&address),
                    };
                }
                shared.tell(EngineEvent::ServersChanged);
            }));
        }
    }

    fn save_server(&self, server: SavedServer) {
        self.edit_servers(
            |servers| match servers.iter_mut().find(|saved| saved.id == server.id) {
                Some(existing) => *existing = server,
                None => servers.push(server),
            },
        );
        self.refresh_pings();
    }

    fn remove_server(&self, id: &str) {
        self.edit_servers(|servers| servers.retain(|saved| saved.id != id));
    }

    fn connect(&self, id: &str, password: Option<String>) {
        let Some(server) = self
            .saved_servers()
            .into_iter()
            .find(|saved| saved.id == id)
        else {
            return;
        };
        self.shared.tell(EngineEvent::Notice(None));
        self.shared
            .refused
            .store(false, std::sync::atomic::Ordering::Relaxed);
        let engine = self.shared.engine.clone();
        self.spawn(async move {
            engine
                .connect(ConnectTarget {
                    host: server.host.to_string(),
                    port: server.port,
                    username: server.username.to_string(),
                    certificate: server.certificate.map(|label| label.to_string()),
                    password: password.filter(|password| !password.is_empty()),
                })
                .await
        });
    }

    fn disconnect(&self) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.disconnect().await });
    }

    fn messages(&self, channel: ChannelId) -> Vec<Message> {
        let messages = self.shared.engine.messages(channel);
        let mut first_read = self
            .shared
            .first_read
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let read_at = first_read.entry(channel).or_default();
        stamp_first_read(read_at, messages.len(), now_ms());
        messages
            .into_iter()
            .zip(read_at.iter())
            .map(|(message, read_at)| Message {
                sender: message.sender,
                sender_name: message.sender_name.into(),
                body: message.text.into(),
                html: message.html.into(),
                sent_at_ms: message.sent_at_ms.or(Some(*read_at)),
                own: message.own,
            })
            .collect()
    }

    fn join_channel(&self, channel: ChannelId) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.enter_channel(channel).await });
    }

    fn send_message(&self, channel: ChannelId, body: String) {
        if body.trim().is_empty() {
            return;
        }
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.send_text(channel, &body).await });
    }

    fn toggle_microphone(&self) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.toggle_microphone().await });
    }

    fn toggle_deafen(&self) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.toggle_deafen().await });
    }

    fn audio_devices(&self) -> AudioDevices {
        let device = |device: api::AudioDeviceInfo| AudioDevice {
            name: device.name.into(),
            is_default: device.is_default,
        };
        let devices = EngineHandle::audio_devices();
        AudioDevices {
            inputs: devices.inputs.into_iter().map(device).collect(),
            outputs: devices.outputs.into_iter().map(device).collect(),
        }
    }

    fn chosen_devices(&self) -> ChosenDevices {
        let (input, output) = self.shared.engine.selected_devices();
        ChosenDevices {
            input: input.map(Into::into),
            output: output.map(Into::into),
        }
    }

    fn choose_devices(&self, devices: ChosenDevices) {
        let name = |device: Option<gpui::SharedString>| device.map(|name| name.to_string());
        if let Err(reason) = self
            .shared
            .engine
            .select_devices(name(devices.input), name(devices.output))
        {
            self.shared.tell(EngineEvent::Notice(Some(reason.into())));
        }
    }

    fn shutdown(&self) {
        let engine = self.shared.engine.clone();
        // Leave properly, so the server and the others see a departure and
        // not a timeout; then write out what the engine holds in memory.
        let _ = self.runtime.block_on(async move {
            tokio::time::timeout(std::time::Duration::from_secs(2), engine.disconnect()).await
        });
        self.shared.engine.shutdown();
    }
}

/// What to tell the user when a session ends: the engine's reason, unless
/// the server had just refused the connection and said why.
fn disconnect_notice(reason: Option<String>, refused: bool) -> Option<String> {
    reason.filter(|_| !refused)
}

/// Unix epoch milliseconds, now.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

/// Keep `read_at` as long as the channel's history: a message read for the
/// first time is stamped `now`, and a history that shrank (messages were
/// deleted) forgets the stamps past its end.
fn stamp_first_read(read_at: &mut Vec<u64>, messages: usize, now: u64) {
    read_at.resize(messages, now);
}

/// A ping as the server list shows it, or `None` for a server that is down
/// or said too little to show.
fn answered(ping: PingInfo) -> Option<ServerPing> {
    if !ping.online {
        return None;
    }
    Some(ServerPing {
        users: ping.users.unwrap_or(0),
        max_users: ping.max_users.unwrap_or(0),
        latency_ms: ping.latency_ms.unwrap_or(0),
        version: ping.version.unwrap_or_default().into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_message_is_stamped_when_first_read_and_keeps_that_time() {
        let mut read_at = Vec::new();
        stamp_first_read(&mut read_at, 2, 100);
        stamp_first_read(&mut read_at, 3, 200);
        assert_eq!(read_at, [100, 100, 200], "the first two keep their time");
        stamp_first_read(&mut read_at, 1, 300);
        assert_eq!(read_at, [100], "a shorter history forgets the rest");
    }

    #[test]
    fn a_refusal_is_not_replaced_by_the_disconnect_that_follows_it() {
        let lost = || Some("Connection lost".to_owned());
        assert_eq!(disconnect_notice(lost(), false), lost());
        assert_eq!(disconnect_notice(lost(), true), None);
        assert_eq!(
            disconnect_notice(None, false),
            None,
            "a wanted leave says nothing"
        );
    }

    #[test]
    fn a_server_that_is_down_has_no_ping_to_show() {
        let down = PingInfo {
            online: false,
            latency_ms: None,
            users: None,
            max_users: None,
            version: None,
        };
        assert!(answered(down).is_none());
        let up = answered(PingInfo {
            online: true,
            latency_ms: Some(18),
            users: Some(3),
            max_users: Some(101),
            version: Some("1.6.0".to_owned()),
        })
        .expect("an answer");
        assert_eq!((up.users, up.max_users, up.latency_ms), (3, 101, 18));
        assert_eq!(up.version.as_ref(), "1.6.0");
    }

    /// Two engines on one live server: connect, see each other, talk in
    /// text, turn voice on and hear each other. Ignored unless a server is
    /// named:
    ///
    /// ```text
    /// FANCY_GPUI_TEST_SERVER=127.0.0.1:64738 cargo test -- --ignored live
    /// ```
    ///
    /// Voice is captured from the engine's virtual microphone, so nothing is
    /// recorded; what is received is played on the default output.
    #[test]
    #[ignore = "needs a live server; set FANCY_GPUI_TEST_SERVER=host:port"]
    #[allow(unsafe_code, reason = "`std::env::set_var` is unsafe in Rust 2024")]
    fn live_two_clients_connect_chat_and_turn_voice_on() {
        let address = std::env::var("FANCY_GPUI_TEST_SERVER").expect("FANCY_GPUI_TEST_SERVER");
        let (host, port) = address.rsplit_once(':').expect("host:port");
        let port: u16 = port.parse().expect("a port");
        // SAFETY: set before any engine thread reads the environment.
        unsafe { std::env::set_var("FANCY_E2E_VIRTUAL_MIC", "sine:48000:440") };

        let client = |name: &str| {
            let dir =
                std::env::temp_dir().join(format!("fancy-gpui-live-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            let engine = RealEngine::start(&dir).expect("the engine starts");
            engine.save_server(SavedServer {
                id: "live".into(),
                label: "live".into(),
                host: host.to_owned().into(),
                port,
                username: name.to_owned().into(),
                certificate: Some(name.to_lowercase().into()),
                favorite: false,
            });
            (engine, dir)
        };
        let (alice, alice_dir) = client("LiveAlice");
        let (bob, bob_dir) = client("LiveBob");

        // The saved server is written to disk and read back by a new store.
        assert_eq!(Store::new(&alice_dir).servers().len(), 1);

        alice.connect("live", None);
        bob.connect("live", None);
        wait_for("both to connect", || {
            alice.snapshot().connection == Connection::Connected
                && bob.snapshot().connection == Connection::Connected
        });
        wait_for("each to see the other", || {
            alice.snapshot().users.len() >= 2 && bob.snapshot().users.len() >= 2
        });
        let on_alice = alice.snapshot();
        let channel = on_alice.current_channel.expect("alice is in a channel");
        assert!(on_alice.own_session.is_some());
        assert!(!on_alice.channels.is_empty(), "the channel tree arrived");
        assert_eq!(bob.snapshot().current_channel, Some(channel));

        alice.send_message(channel, "hello <b>bob</b> & co".to_owned());
        wait_for("bob to receive the message", || {
            bob.messages(channel)
                .iter()
                .any(|message| message.body.as_ref() == "hello <b>bob</b> & co")
        });
        let received = bob.messages(channel);
        let message = received.last().expect("the message");
        assert_eq!(message.sender_name.as_ref(), "LiveAlice");
        assert!(!message.own);
        wait_for("alice to see her own message", || {
            alice.messages(channel).iter().any(|message| message.own)
        });

        assert_eq!(alice.snapshot().voice, Voice::Off);
        alice.toggle_microphone();
        wait_for("alice's voice to turn on", || {
            alice.snapshot().voice == Voice::On
        });
        wait_for("bob to see alice unmuted", || {
            bob.snapshot()
                .users
                .iter()
                .any(|user| user.name.as_ref() == "LiveAlice" && !user.muted)
        });
        // Hearing: with voice on, bob is sent alice's audio, decodes it, and
        // is told she is talking. (Run where no speakers are attached, or
        // with a null sink chosen: her microphone is a 440 Hz tone.)
        let alice_session = on_alice.own_session.expect("alice's session");
        let heard = bob.events();
        bob.toggle_microphone();
        wait_for("bob's voice to turn on", || {
            bob.snapshot().voice == Voice::On
        });
        wait_for("bob to hear alice", || {
            std::iter::from_fn(|| heard.try_recv().ok()).any(|event| {
                event
                    == EngineEvent::UserTalking {
                        session: alice_session,
                        talking: true,
                    }
            })
        });

        alice.toggle_microphone();
        wait_for("alice to mute", || alice.snapshot().voice == Voice::Muted);

        bob.disconnect();
        wait_for("bob to leave", || {
            bob.snapshot().connection == Connection::Disconnected
                && alice.snapshot().users.len() == 1
        });
        alice.disconnect();
        wait_for("alice to leave", || {
            alice.snapshot().connection == Connection::Disconnected
        });
        drop((alice, bob));
        let _ = std::fs::remove_dir_all(alice_dir);
        let _ = std::fs::remove_dir_all(bob_dir);
    }

    /// Poll `done` for up to twenty seconds.
    #[track_caller]
    fn wait_for(what: &str, done: impl Fn() -> bool) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while !done() {
            assert!(
                std::time::Instant::now() < deadline,
                "timed out waiting for {what}"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}
