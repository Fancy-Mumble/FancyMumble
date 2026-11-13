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
    Channel, ChannelId, Connection, Engine, EngineEvent, Message, SavedServer, ServerPing,
    Snapshot, User, Voice,
};
use crate::store::Store;

/// `(host, port)`: what a ping is kept under.
type Address = (String, u16);

/// What the adapter shares with the tasks it starts.
struct Shared {
    engine: EngineHandle,
    events: async_channel::Sender<EngineEvent>,
    servers: Mutex<Vec<SavedServer>>,
    pings: Mutex<HashMap<Address, ServerPing>>,
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
                if reason.is_some() {
                    self.tell(EngineEvent::Notice(reason.map(Into::into)));
                }
                self.tell(EngineEvent::StateChanged);
                self.tell(EngineEvent::CurrentChannelChanged);
            }
            api::EngineEvent::Rejected { reason } => {
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

impl Drop for RealEngine {
    fn drop(&mut self) {
        self.shared.engine.shutdown();
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
            users: engine
                .users()
                .into_iter()
                .map(|user| User {
                    session: user.session,
                    name: user.name.into(),
                    channel: user.channel,
                    muted: user.muted,
                    deafened: user.deafened,
                })
                .collect(),
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
        self.shared
            .engine
            .messages(channel)
            .into_iter()
            .map(|message| Message {
                sender: message.sender,
                sender_name: message.sender_name.into(),
                body: message.text.into(),
                sent_at_ms: message.sent_at_ms,
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
}
