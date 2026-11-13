//! The real engine, behind the view's [`Engine`] trait.
//!
//! A mapping and little else: reads copy what the engine holds, commands are
//! handed to the engine's runtime and return at once, and the engine's
//! events are passed on under the view's names. What is added here is what
//! the engine has no notion of: the saved servers and their pings.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use gpui::SharedString;

use mumble_tauri_lib::engine_api::{
    self as api, ConnectTarget, EngineDirs, EngineHandle, PingInfo,
};

use crate::engine::{
    Acl, AclGroup, AclRule, Attachment, KeyRequest, Poll, PollOption, Reader, WhisperTarget,
};
use crate::engine::{
    Action, AudioDevice, AudioDevices, Ban, CertificateTask, Channel, ChannelId, ChosenDevices,
    Connection, Conversation, Engine, EngineEvent, Found, Listing, Message, Preview, Reaction,
    Registered, SavedServer, Scheduled, ServerPing, SessionEntry, Snapshot, Subject, User, Voice,
    VoiceSettings, Window,
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
    first_read: Mutex<HashMap<Conversation, Vec<u64>>>,
    /// Each user's picture: the marker it was fetched for, and the picture
    /// once it has arrived.
    avatars: Mutex<HashMap<u32, AvatarSlot>>,
    /// Who put which emoji on which message, by channel and then by
    /// message: the engine passes reactions on and keeps none.
    reactions: Mutex<HashMap<u32, HashMap<String, Vec<api::ReactionInfo>>>>,
    /// The polls seen, by channel, with who answered what: the engine
    /// passes polls and votes on and keeps neither.
    polls: Mutex<HashMap<u32, Vec<HeldPoll>>>,
    /// The rules last read for a channel, whole: the groups go back to
    /// the server as they came, with the rules the view changed.
    acl: Mutex<Option<api::AclInfo>>,
    /// Who the whisper key speaks to.
    whisper_target: Mutex<Option<api::WhisperTarget>>,
    /// The channel whose readers were last asked for.
    readers_asked: Mutex<Option<u32>>,
    /// When the server was last told the local user is writing.
    typed_at: Mutex<Option<std::time::Instant>>,
    /// The identity the user last connected as, while they want to be on
    /// that server: what a lost connection is retried with.
    wanted: Mutex<Option<(String, Option<String>)>>,
    /// How many retries have been made since the connection was last up.
    retries: std::sync::atomic::AtomicU32,
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

    /// Drop what was kept about the server on screen: another one's
    /// sessions, messages and reactions would be taken for it.
    fn forget_server(&self) {
        self.first_read
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
        self.avatars
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
        self.reactions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
        *self
            .readers_asked
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = None;
        self.polls
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }

    /// A channel's rules arrived: keep them whole, and show the view its
    /// part of them.
    fn take_acl(&self, acl: api::AclInfo) {
        let shown = Acl {
            channel: acl.channel,
            inherit: acl.inherit,
            groups: acl
                .groups
                .iter()
                .map(|group| AclGroup {
                    name: group.name.clone().into(),
                    inherited: group.inherited_members.clone(),
                    added: group.add.clone(),
                    removed: group.remove.clone(),
                })
                .collect(),
            rules: acl
                .rules
                .iter()
                .map(|rule| AclRule {
                    here: rule.apply_here,
                    subs: rule.apply_subs,
                    inherited: rule.inherited,
                    user: rule.user,
                    group: rule.group.clone().map(Into::into),
                    grant: rule.grant,
                    deny: rule.deny,
                })
                .collect(),
        };
        *self.acl.lock().unwrap_or_else(PoisonError::into_inner) = Some(acl);
        self.tell(EngineEvent::Acl(shown));
    }

    /// Send a channel's rules as the view changed them, with the groups
    /// as the server last sent them.
    async fn set_acl(&self, changed: Acl) -> Result<(), String> {
        let read = self
            .acl
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
            .filter(|read| read.channel == changed.channel)
            .ok_or("These rules were not read from the server; open them again.")?;
        let groups = merged_groups(read.groups.clone(), changed.groups);
        self.engine
            .set_acl(api::AclInfo {
                inherit: changed.inherit,
                groups,
                rules: changed
                    .rules
                    .into_iter()
                    .map(|rule| api::AclRuleInfo {
                        apply_here: rule.here,
                        apply_subs: rule.subs,
                        inherited: rule.inherited,
                        user: rule.user,
                        group: rule.group.map(|group| group.to_string()),
                        grant: rule.grant,
                        deny: rule.deny,
                    })
                    .collect(),
                ..read
            })
            .await?;
        // What the server made of it is what there is to show.
        self.engine.request_acl(changed.channel).await
    }

    /// Put a poll to `channel`. The server passes it on and does not send
    /// it back: the asker's copy is made here.
    async fn ask(
        &self,
        channel: u32,
        question: String,
        options: Vec<String>,
        multiple: bool,
    ) -> Result<(), String> {
        let id = self
            .engine
            .create_poll(channel, question.clone(), options.clone(), multiple)
            .await?;
        self.hold_poll(
            channel,
            HeldPoll {
                id,
                question,
                options,
                multiple,
                by: self.own_name(),
                at_ms: now_ms(),
                votes: HashMap::new(),
            },
        );
        Ok(())
    }

    /// The rest of what [`RealEngine::act`] asks for: what is done to
    /// messages, polls and the administrator's lists.
    async fn act_on_conversation(&self, action: Action) -> Result<(), String> {
        let (engine, shared) = (&self.engine, self);
        match action {
            Action::EditMessage { channel, id, text } => {
                engine.edit_text(channel, &id, &text).await
            }
            Action::DeleteMessage { channel, id } => {
                engine.delete_messages(channel, vec![id]).await
            }
            Action::React {
                channel,
                id,
                emoji,
                add,
            } => engine.react(channel, &id, &emoji, add).await,
            Action::Pin {
                channel,
                id,
                pinned,
            } => engine.pin(channel, &id, pinned).await,
            Action::CreatePoll {
                channel,
                question,
                options,
                multiple,
            } => shared.ask(channel, question, options, multiple).await,
            Action::Vote {
                channel,
                poll,
                selected,
            } => {
                engine.vote(channel, &poll, selected.clone()).await?;
                if let Some(own) = engine.own_session() {
                    shared.hold_vote(channel, &poll, own, selected);
                }
                Ok(())
            }
            Action::SetAcl(acl) => shared.set_acl(acl).await,
            Action::SetBans(bans) => engine.set_bans(bans.iter().map(ban_info).collect()).await,
            Action::Unregister { id } => engine.change_registered(id, None).await,
            Action::SendLater {
                channel,
                body,
                at_ms,
            } => engine.schedule_text(channel, &body, at_ms).await,
            Action::CancelScheduled(id) => engine.cancel_scheduled(&id).await,
            Action::RenameRegistered { id, name } => {
                engine.change_registered(id, Some(name)).await?;
                // The list as the server has it now.
                engine.request_registered().await
            }
            Action::ToggleListen { channel } => {
                let toggled = engine.toggle_listen(channel).await.map(|_| ());
                shared.tell(EngineEvent::StateChanged);
                toggled
            }
            Action::PrioritySpeaker { session, priority } => {
                engine.set_priority_speaker(session, priority).await
            }
            // Everything else was done before this was asked.
            _ => Ok(()),
        }
    }

    /// Hold a poll put to `channel`, and say the channel has news.
    fn hold_poll(&self, channel: u32, poll: HeldPoll) {
        {
            let mut polls = self.polls.lock().unwrap_or_else(PoisonError::into_inner);
            let held = polls.entry(channel).or_default();
            // Once: a server may send the asker's own poll back to them,
            // or may not, and their copy is made either way.
            if held.iter().any(|known| known.id == poll.id) {
                return;
            }
            held.push(poll);
        }
        self.tell(EngineEvent::NewMessage {
            conversation: Conversation::Channel(channel),
        });
    }

    /// Record what `voter` answered to a poll of `channel`.
    fn hold_vote(&self, channel: u32, poll: &str, voter: u32, selected: Vec<u32>) {
        if let Some(held) = self
            .polls
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get_mut(&channel)
            .and_then(|polls| polls.iter_mut().find(|held| held.id == poll))
        {
            let _ = held.votes.insert(voter, selected);
        }
        self.tell(EngineEvent::NewMessage {
            conversation: Conversation::Channel(channel),
        });
    }

    /// The name the local user goes by on the server.
    fn own_name(&self) -> String {
        self.engine
            .own_session()
            .map(|own| self.name_of(own))
            .unwrap_or_default()
    }

    /// The name of the user `session`, if they are still here.
    fn name_of(&self, session: u32) -> String {
        self.engine
            .users()
            .into_iter()
            .find(|user| user.session == session)
            .map(|user| user.name)
            .unwrap_or_default()
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
                self.retries.store(0, std::sync::atomic::Ordering::Relaxed);
                self.tell(EngineEvent::Notice(None));
                self.tell(EngineEvent::StateChanged);
                self.open_current_conversation(runtime);
            }
            api::EngineEvent::Disconnected { reason } => {
                self.forget_server();
                let refused = self
                    .refused
                    .swap(false, std::sync::atomic::Ordering::Relaxed);
                let lost = reason.is_some() && !refused;
                if let Some(reason) = disconnect_notice(reason, refused) {
                    self.tell(EngineEvent::Notice(Some(reason.into())));
                }
                if refused {
                    // Asking again would only be refused again.
                    *self.wanted.lock().unwrap_or_else(PoisonError::into_inner) = None;
                } else if lost {
                    self.reconnect_later(runtime);
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
                self.tell(EngineEvent::NewMessage {
                    conversation: Conversation::Channel(channel),
                });
            }
            api::EngineEvent::NewDirectMessage { session } => {
                self.tell(EngineEvent::NewMessage {
                    conversation: Conversation::Direct(session),
                });
            }
            api::EngineEvent::UnreadChanged => self.tell(EngineEvent::StateChanged),
            api::EngineEvent::Denied { reason } => {
                let reason = reason.unwrap_or_else(|| "The server did not allow that.".to_owned());
                self.tell(EngineEvent::Notice(Some(reason.into())));
            }
            api::EngineEvent::Notify { title, body } => crate::notify::show(&title, &body),
            other => self.forward_answer(other),
        }
    }

    /// The rest of [`Self::forward`]: what the server answers when asked,
    /// and what happens around messages.
    fn forward_answer(&self, event: api::EngineEvent) {
        match event {
            api::EngineEvent::Whispering(whispering) => {
                self.tell(EngineEvent::Whispering(whispering));
            }
            api::EngineEvent::KeyRequests { channel } => {
                self.tell(EngineEvent::KeyRequests { channel });
            }
            api::EngineEvent::Poll(poll) => self.hold_poll(
                poll.channel,
                HeldPoll {
                    id: poll.id,
                    question: poll.question,
                    options: poll.options,
                    multiple: poll.multiple,
                    // A server that names only the session leaves the
                    // name to be looked up among who is here.
                    by: poll
                        .creator_name
                        .filter(|name| !name.is_empty())
                        .unwrap_or_else(|| self.name_of(poll.creator)),
                    at_ms: now_ms(),
                    votes: HashMap::new(),
                },
            ),
            api::EngineEvent::PollVote(vote) => {
                self.hold_vote(vote.channel, &vote.poll, vote.voter, vote.selected);
            }
            api::EngineEvent::Readers { channel, readers } => {
                // Everybody but the local user: that they have read what
                // they are looking at is no news.
                let own = self.engine.own_hash();
                self.tell(EngineEvent::Readers {
                    channel,
                    readers: readers
                        .into_iter()
                        .filter(|reader| Some(&reader.hash) != own.as_ref())
                        .map(|reader| Reader {
                            name: reader.name.into(),
                            read_up_to: reader.read_up_to.into(),
                        })
                        .collect(),
                });
            }
            api::EngineEvent::LinkPreviews(previews) => self.tell(EngineEvent::Previews(
                previews.into_iter().map(preview_of).collect(),
            )),
            api::EngineEvent::Acl(acl) => self.take_acl(acl),
            api::EngineEvent::Bans(bans) => {
                self.tell(EngineEvent::Bans(bans.into_iter().map(ban_of).collect()));
            }
            api::EngineEvent::Registered(users) => self.tell(EngineEvent::Registered(
                users.into_iter().map(registered_of).collect(),
            )),
            api::EngineEvent::Scheduled(waiting) => self.tell(EngineEvent::Scheduled(
                waiting.into_iter().map(scheduled_of).collect(),
            )),
            api::EngineEvent::ScheduleAnswered { refused } => self.tell(match refused {
                Some(reason) => EngineEvent::Notice(Some(reason.into())),
                None => EngineEvent::ScheduleTaken,
            }),
            api::EngineEvent::UserStats(stats) => self.tell(EngineEvent::Facts {
                subject: Subject::User(stats.session),
                facts: user_facts(&stats),
            }),
            api::EngineEvent::Typing { channel, session } => {
                self.tell(EngineEvent::Typing { channel, session });
            }
            api::EngineEvent::Reaction {
                channel,
                reaction,
                added,
            } => {
                note_reaction(
                    self.reactions
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .entry(channel)
                        .or_default(),
                    reaction,
                    added,
                );
                self.tell(EngineEvent::NewMessage {
                    conversation: Conversation::Channel(channel),
                });
            }
            api::EngineEvent::Reactions { channel, reactions } => {
                let mut by_message = HashMap::new();
                for reaction in reactions {
                    note_reaction(&mut by_message, reaction, true);
                }
                let _ = self
                    .reactions
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .insert(channel, by_message);
                self.tell(EngineEvent::NewMessage {
                    conversation: Conversation::Channel(channel),
                });
            }
            // The engine API may grow events this view does not draw yet.
            _ => {}
        }
    }

    /// The connection was lost, not ended: try again after a pause that
    /// grows with each attempt, for as long as the user still wants to be
    /// on that server.
    fn reconnect_later(self: &Arc<Self>, runtime: &tokio::runtime::Handle) {
        let attempt = self
            .retries
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let Some(pause) = retry_pause(attempt) else {
            return;
        };
        let shared = Arc::clone(self);
        drop(runtime.spawn(async move {
            tokio::time::sleep(pause).await;
            let wanted = shared
                .wanted
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .clone();
            let Some((id, password)) = wanted else {
                return;
            };
            if shared.engine.connection() != api::Connection::Disconnected {
                return;
            }
            let Some(server) = shared
                .servers
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .iter()
                .find(|saved| saved.id == id)
                .cloned()
            else {
                return;
            };
            shared.tell(EngineEvent::Notice(Some(
                "Connection lost. Reconnecting…".into(),
            )));
            let _ = shared.engine.connect(target_of(&server, password)).await;
        }));
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
            reactions: Mutex::default(),
            typed_at: Mutex::default(),
            readers_asked: Mutex::default(),
            whisper_target: Mutex::default(),
            acl: Mutex::default(),
            polls: Mutex::default(),
            wanted: Mutex::default(),
            retries: std::sync::atomic::AtomicU32::new(0),
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
        let unread = self.shared.engine.unread_directs();
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
                    unread: unread.get(&user.session).copied().unwrap_or(0),
                    session: user.session,
                    name: user.name.into(),
                    channel: user.channel,
                    muted: user.muted,
                    deafened: user.deafened,
                    avatar,
                    priority: user.priority_speaker,
                    account: user.account,
                    hash: user.hash.map(Into::into),
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
        // The other servers stay on the rail whatever this one is doing.
        let saved = self.saved_servers();
        let mut sessions: Vec<SessionEntry> = engine
            .sessions()
            .into_iter()
            .filter(|session| session.connection != api::Connection::Disconnected)
            .map(|session| SessionEntry {
                key: format!("{}:{}", session.host, session.port).into(),
                name: saved
                    .iter()
                    .find(|server| {
                        server.host.as_ref() == session.host && server.port == session.port
                    })
                    .map_or_else(|| session.host.into(), |server| server.label.clone()),
                id: session.id.into(),
                active: session.active,
            })
            .collect();
        // The engine keeps them in no order; the rail is not to shuffle.
        sessions.sort_by(|a, b| (&a.name, &a.id).cmp(&(&b.name, &b.id)));
        if connection != Connection::Connected {
            return Snapshot {
                connection,
                sessions,
                ..Snapshot::disconnected()
            };
        }
        let unread_channels = engine.unread_channels();
        let listening = engine.listening();
        Snapshot {
            connection,
            own_session: engine.own_session(),
            current_channel: engine.current_channel(),
            channels: engine
                .channels()
                .into_iter()
                .map(|channel| Channel {
                    unread: unread_channels.get(&channel.id).copied().unwrap_or(0),
                    id: channel.id,
                    parent: channel.parent,
                    name: channel.name.into(),
                    position: channel.position,
                    history: channel.keeps_history,
                    encrypted: channel.encrypted,
                    listening: listening.contains(&channel.id),
                })
                .collect(),
            users: self.users_with_avatars(engine.users()),
            voice: match engine.voice() {
                api::Voice::Off => Voice::Off,
                api::Voice::On => Voice::On,
                api::Voice::Muted => Voice::Muted,
            },
            deafened: engine.deafened(),
            welcome: engine.welcome().map(Into::into),
            sessions,
            fancy: engine.fancy(),
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

    fn key_requests(&self, channel: u32) -> Vec<KeyRequest> {
        self.shared
            .engine
            .key_requests(channel)
            .into_iter()
            .map(|asking| KeyRequest {
                hash: asking.hash.into(),
                name: asking.name.into(),
            })
            .collect()
    }

    fn polls(&self, conversation: Conversation) -> Vec<Poll> {
        let Conversation::Channel(channel) = conversation else {
            return Vec::new();
        };
        let polls = self
            .shared
            .polls
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let Some(held) = polls.get(&channel).filter(|held| !held.is_empty()) else {
            return Vec::new();
        };
        let own = self.shared.engine.own_session();
        held.iter().map(|poll| poll.as_it_stands(own)).collect()
    }

    fn read_up_to(&self, conversation: Conversation, id: SharedString) {
        let Conversation::Channel(channel) = conversation else {
            return;
        };
        let engine = self.shared.engine.clone();
        if !engine.fancy() {
            return;
        }
        // Nobody misses a receipt that did not get through. One frame: a
        // server counts what a client sends, and drops what is too much.
        drop(
            self.runtime
                .spawn(async move { engine.mark_read_up_to(channel, &id).await }),
        );
    }

    fn search_messages(&self, query: &str) -> Vec<Found> {
        self.shared
            .engine
            .search_messages(query)
            .into_iter()
            .filter_map(|found| {
                let conversation = match (found.channel, found.direct) {
                    (Some(channel), _) => Conversation::Channel(channel),
                    (None, Some(session)) => Conversation::Direct(session),
                    (None, None) => return None,
                };
                Some(Found {
                    text: found.text.into(),
                    about: format!("{} · {}", found.sender_name, found.place).into(),
                    conversation,
                })
            })
            .collect()
    }

    fn previews(&self, urls: Vec<SharedString>) {
        let shared = Arc::clone(&self.shared);
        if !shared.engine.fancy() {
            return;
        }
        drop(self.runtime.spawn(async move {
            let urls = urls.into_iter().map(|url| url.to_string()).collect();
            // What the engine already holds comes back here; the rest in
            // an event. A failure is a card not shown, and worth no words.
            if let Ok(held) = shared.engine.link_previews(urls).await
                && !held.is_empty()
            {
                shared.tell(EngineEvent::Previews(
                    held.into_iter().map(preview_of).collect(),
                ));
            }
        }));
    }

    fn request_acl(&self, channel: u32) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.request_acl(channel).await });
    }

    fn signal_available(&self) -> bool {
        self.shared.engine.signal_available()
    }

    fn request_scheduled(&self) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.request_scheduled().await });
    }

    fn list(&self, listing: Listing) {
        let engine = self.shared.engine.clone();
        self.spawn(async move {
            match listing {
                Listing::Bans => engine.request_bans().await,
                Listing::Registered => engine.request_registered().await,
            }
        });
    }

    fn certificates(&self) -> Vec<SharedString> {
        self.shared
            .engine
            .certificates()
            .into_iter()
            .map(Into::into)
            .collect()
    }

    fn manage_certificate(&self, task: CertificateTask) {
        let shared = Arc::clone(&self.shared);
        // Files are read and written: not on the view's thread.
        drop(self.runtime.spawn_blocking(move || {
            let engine = &shared.engine;
            let said = match task {
                CertificateTask::Delete(label) => engine
                    .delete_certificate(&label)
                    .map(|()| format!("Deleted the certificate \u{201c}{label}\u{201d}.")),
                CertificateTask::Export { label, to } => engine
                    .export_certificate(&label, &to)
                    .map(|()| format!("Exported to {}. Keep it private.", to.display())),
                CertificateTask::Import(from) => engine
                    .import_certificate(&from)
                    .map(|label| format!("Imported the certificate \u{201c}{label}\u{201d}.")),
            };
            shared.tell(EngineEvent::CertificatesChanged);
            shared.tell(EngineEvent::Notice(Some(
                said.unwrap_or_else(|problem| problem).into(),
            )));
        }));
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
        self.shared
            .retries
            .store(0, std::sync::atomic::Ordering::Relaxed);
        let password = password.filter(|password| !password.is_empty());
        *self
            .shared
            .wanted
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some((id.to_owned(), password.clone()));
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.connect(target_of(&server, password)).await });
    }

    fn disconnect(&self) {
        // On purpose: nothing is to bring the connection back.
        *self
            .shared
            .wanted
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = None;
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.disconnect().await });
    }

    fn load_earlier(&self, conversation: Conversation, before: Option<SharedString>) {
        // Only a channel has a history on the server to fetch from.
        let Conversation::Channel(channel) = conversation else {
            return;
        };
        let engine = self.shared.engine.clone();
        if !engine
            .channels()
            .iter()
            .any(|known| known.id == channel && known.keeps_history)
        {
            return;
        }
        self.spawn(async move {
            engine
                .fetch_earlier(channel, before.map(|id| id.to_string()), EARLIER_PAGE)
                .await
        });
    }

    fn window(&self, conversation: Conversation, limit: usize) -> Window {
        let engine = &self.shared.engine;
        let (window, held) = match conversation {
            Conversation::Channel(channel) => (
                engine.messages_tail(channel, limit),
                engine.message_count(channel),
            ),
            Conversation::Direct(session) => (
                engine.direct_messages_tail(session, limit),
                engine.direct_message_count(session),
            ),
        };
        let api::MessageWindow { messages, earlier } = window;
        let mut first_read = self
            .shared
            .first_read
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let read_at = first_read.entry(conversation).or_default();
        stamp_first_read(read_at, held, now_ms());
        // The stamps are for the whole history; the window is its end.
        let read_at = &read_at[read_at.len().saturating_sub(messages.len())..];
        let reactions = self
            .shared
            .reactions
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let on_channel = match conversation {
            Conversation::Channel(channel) => reactions.get(&channel),
            Conversation::Direct(_) => None,
        };
        let own_hash = on_channel.and_then(|_| self.shared.engine.own_hash());
        let messages = messages
            .into_iter()
            .zip(read_at.iter())
            .map(|(message, read_at)| Message {
                reactions: message
                    .id
                    .as_ref()
                    .and_then(|id| on_channel?.get(id))
                    .map(|given| tally(given, own_hash.as_deref()))
                    .unwrap_or_default(),
                sender: message.sender,
                sender_name: message.sender_name.into(),
                body: message.text.into(),
                sent_at_ms: message.sent_at_ms.or(Some(*read_at)),
                own: message.own,
                id: message.id.map(Into::into),
                edited: message.edited,
                failed: message.failed,
                pinned: message.pinned,
                files: attachments(&message.html),
                reply_to: api::reply_target(&message.html).map(|to| to.to_owned().into()),
                html: message.html.into(),
            })
            .collect();
        Window { messages, earlier }
    }

    fn message_count(&self, conversation: Conversation) -> usize {
        match conversation {
            Conversation::Channel(channel) => self.shared.engine.message_count(channel),
            Conversation::Direct(session) => self.shared.engine.direct_message_count(session),
        }
    }

    fn open(&self, conversation: Conversation) {
        let engine = self.shared.engine.clone();
        match conversation {
            Conversation::Channel(channel) => {
                engine.mark_channel_read(channel);
                // How far the others have read is asked once on opening;
                // after that the server says when one of them reads on.
                // Opening is also how a message on screen is marked read,
                // so it is called for the same channel over and over.
                let first = self
                    .shared
                    .readers_asked
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .replace(channel)
                    != Some(channel);
                self.spawn(async move {
                    engine.open_conversation(channel).await?;
                    if first && engine.fancy() {
                        let _ = engine.request_readers(channel).await;
                    }
                    Ok(())
                });
            }
            Conversation::Direct(session) => {
                if let Err(reason) = engine.open_direct(session) {
                    self.shared.tell(EngineEvent::Notice(Some(reason.into())));
                }
            }
        }
    }

    fn join_channel(&self, channel: ChannelId) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.join_channel(channel).await });
    }

    fn send_message(&self, conversation: Conversation, body: String) {
        if body.trim().is_empty() {
            return;
        }
        let engine = self.shared.engine.clone();
        self.spawn(async move {
            match conversation {
                Conversation::Channel(channel) => engine.send_text(channel, &body).await,
                Conversation::Direct(session) => engine.send_direct_text(session, &body).await,
            }
        });
    }

    fn send_reply(&self, conversation: Conversation, to: SharedString, body: String) {
        if body.trim().is_empty() {
            return;
        }
        let engine = self.shared.engine.clone();
        self.spawn(async move {
            match conversation {
                Conversation::Channel(channel) => engine.reply_text(channel, &to, &body).await,
                Conversation::Direct(session) => {
                    engine.reply_direct_text(session, &to, &body).await
                }
            }
        });
    }

    fn send_picture(&self, conversation: Conversation, file: Vec<u8>) {
        let engine = self.shared.engine.clone();
        let limit = engine.picture_limit();
        self.spawn(async move {
            // Decoding and scaling is work, and not for the engine's own
            // threads.
            let html =
                tokio::task::spawn_blocking(move || crate::picture::message_html(&file, limit))
                    .await
                    .map_err(|error| error.to_string())??;
            match conversation {
                Conversation::Channel(channel) => engine.send_html(channel, html).await,
                Conversation::Direct(session) => engine.send_direct_html(session, html).await,
            }
        });
    }

    fn send_file(&self, conversation: Conversation, path: std::path::PathBuf) {
        let engine = self.shared.engine.clone();
        self.spawn(async move {
            let Conversation::Channel(channel) = conversation else {
                return Err(
                    "Files are shared in channels; a direct message takes pictures.".into(),
                );
            };
            if !engine.fancy() {
                return Err("This server keeps no files; it takes pictures only.".into());
            }
            engine.share_file(channel, &path).await
        });
    }

    fn save_file(&self, key: SharedString, to: std::path::PathBuf) {
        let shared = Arc::clone(&self.shared);
        self.spawn(async move {
            let bytes = shared.engine.save_shared_file(&key, &to).await?;
            shared.tell(EngineEvent::Notice(Some(
                format!(
                    "Saved {} ({}).",
                    to.display(),
                    crate::ui::size_in_words(bytes)
                )
                .into(),
            )));
            Ok(())
        });
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
        let name = |device: Option<SharedString>| device.map(|name| name.to_string());
        if let Err(reason) = self
            .shared
            .engine
            .select_devices(name(devices.input), name(devices.output))
        {
            self.shared.tell(EngineEvent::Notice(Some(reason.into())));
        }
    }

    fn typing(&self, conversation: Conversation) {
        // Only channels are told, and only a Fancy server understands.
        let Conversation::Channel(channel) = conversation else {
            return;
        };
        if !self.shared.engine.fancy() {
            return;
        }
        {
            let mut typed_at = self
                .shared
                .typed_at
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            if typed_at.is_some_and(|at| at.elapsed() < TYPING_EVERY) {
                return;
            }
            *typed_at = Some(std::time::Instant::now());
        }
        let engine = self.shared.engine.clone();
        // Not worth a notice when it fails: nobody misses it.
        drop(
            self.runtime
                .spawn(async move { engine.typing(channel).await }),
        );
    }

    fn activate_session(&self, id: &str) {
        let shared = Arc::clone(&self.shared);
        let id = id.to_owned();
        drop(self.runtime.spawn(async move {
            if let Err(reason) = shared.engine.activate_session(&id).await {
                shared.tell(EngineEvent::Notice(Some(reason.into())));
            }
            // Another server altogether: everything is to be read again.
            shared.forget_server();
            shared.tell(EngineEvent::StateChanged);
            shared.tell(EngineEvent::CurrentChannelChanged);
        }));
    }

    fn leave_session(&self, id: &str) {
        let shared = Arc::clone(&self.shared);
        let id = id.to_owned();
        self.spawn(async move {
            let left = shared.engine.disconnect_session(&id).await;
            shared.tell(EngineEvent::StateChanged);
            left
        });
    }

    fn set_focused(&self, focused: bool) {
        self.shared.engine.set_focused(focused);
    }

    fn act(&self, action: Action) {
        let engine = self.shared.engine.clone();
        let shared = Arc::clone(&self.shared);
        let reason = |reason: String| Some(reason).filter(|reason| !reason.trim().is_empty());
        self.spawn(async move {
            match action {
                Action::SetUserVolume { session, volume } => {
                    engine.set_user_volume(session, volume);
                    Ok(())
                }
                Action::Kick {
                    session,
                    reason: why,
                } => engine.kick(session, reason(why)).await,
                Action::Ban {
                    session,
                    reason: why,
                } => engine.ban(session, reason(why)).await,
                Action::ServerMute { session, muted } => engine.server_mute(session, muted).await,
                Action::ServerDeafen { session, deafened } => {
                    engine.server_deafen(session, deafened).await
                }
                Action::MoveUser { session, channel } => engine.move_user(session, channel).await,
                Action::Register { session } => engine.register(session).await,
                Action::ResetComment { session } => engine.reset_comment(session).await,
                Action::RemovePicture { session } => engine.remove_avatar(session).await,
                Action::CreateChannel {
                    parent,
                    name,
                    history,
                    encrypted,
                } => {
                    let history = match (history, encrypted) {
                        (_, true) => api::History::EndToEnd,
                        (true, false) => api::History::OnServer,
                        (false, false) => api::History::None,
                    };
                    engine.create_channel(parent, name, history).await
                }
                Action::CreateSignalChannel { parent, name } => {
                    engine
                        .create_channel(parent, name, api::History::Signal)
                        .await
                }
                Action::AnswerKeyRequest {
                    channel,
                    hash,
                    share,
                } => engine.answer_key_request(channel, &hash, share).await,
                Action::RenameChannel { channel, name } => {
                    engine.rename_channel(channel, name).await
                }
                Action::DescribeChannel { channel, text } => {
                    engine
                        .change_channel(
                            channel,
                            api::ChannelChange {
                                description: Some(text),
                                ..api::ChannelChange::default()
                            },
                        )
                        .await
                }
                Action::SetChannelPassword { channel, password } => {
                    engine
                        .change_channel(
                            channel,
                            api::ChannelChange {
                                password: Some(password),
                                ..api::ChannelChange::default()
                            },
                        )
                        .await
                }
                Action::DeleteChannel { channel } => engine.delete_channel(channel).await,
                Action::JoinWithPassword { channel, password } => {
                    engine.join_channel_with_password(channel, password).await
                }
                Action::SetComment(text) => engine.set_comment(&text).await,
                Action::SetAvatar(image) => engine.set_avatar(image).await,
                other => shared.act_on_conversation(other).await,
            }
        });
    }

    fn about(&self, subject: Subject) {
        let shared = Arc::clone(&self.shared);
        drop(self.runtime.spawn(async move {
            let html = match subject {
                Subject::User(session) => {
                    // The answer comes back as an event of its own.
                    let _ = shared.engine.request_user_stats(session).await;
                    shared.engine.user_comment(session).await
                }
                Subject::Channel(channel) => shared.engine.channel_description(channel),
                Subject::Server => {
                    shared.tell(EngineEvent::Facts {
                        subject,
                        facts: server_facts(&shared.engine.server()),
                    });
                    shared.engine.welcome()
                }
            };
            shared.tell(EngineEvent::About {
                subject,
                html: html.filter(|html| !html.trim().is_empty()).map(Into::into),
            });
        }));
    }

    fn voice_settings(&self) -> VoiceSettings {
        let voice = self.shared.engine.voice_settings();
        VoiceSettings {
            push_to_talk: voice.push_to_talk,
            threshold: voice.activation_threshold,
            noise_suppression: voice.noise_suppression,
            automatic_gain: voice.automatic_gain,
            input_volume: voice.input_volume,
            output_volume: voice.output_volume,
            bitrate_bps: voice.bitrate_bps,
            voice_over_tcp: voice.voice_over_tcp,
        }
    }

    fn set_voice_settings(&self, settings: VoiceSettings) {
        if let Err(reason) = self.shared.engine.set_voice_settings(api::VoiceSettings {
            push_to_talk: settings.push_to_talk,
            activation_threshold: settings.threshold,
            noise_suppression: settings.noise_suppression,
            automatic_gain: settings.automatic_gain,
            input_volume: settings.input_volume,
            output_volume: settings.output_volume,
            bitrate_bps: settings.bitrate_bps,
            voice_over_tcp: settings.voice_over_tcp,
        }) {
            self.shared.tell(EngineEvent::Notice(Some(reason.into())));
        }
    }

    fn set_whisper_target(&self, target: Option<WhisperTarget>) {
        let target = target.map(|target| match target {
            WhisperTarget::User(session) => api::WhisperTarget::User(session),
            WhisperTarget::Channel(channel) => api::WhisperTarget::Channel(channel),
        });
        *self
            .shared
            .whisper_target
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = target;
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.prepare_whisper(target).await });
    }

    fn whisper(&self, held: bool) {
        let target = *self
            .shared
            .whisper_target
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let engine = self.shared.engine.clone();
        self.spawn(async move {
            match (held, target) {
                (true, Some(target)) => engine.whisper_start(target).await,
                (true, None) => Ok(()),
                (false, _) => engine.whisper_end().await,
            }
        });
    }

    fn push_to_talk(&self, held: bool) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.push_to_talk(held).await });
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

/// How to connect as the saved identity `server`.
fn target_of(server: &SavedServer, password: Option<String>) -> ConnectTarget {
    ConnectTarget {
        host: server.host.to_string(),
        port: server.port,
        username: server.username.to_string(),
        certificate: server.certificate.as_ref().map(ToString::to_string),
        password,
    }
}

/// A poll as the adapter holds it: what was asked, and who answered what.
struct HeldPoll {
    id: String,
    question: String,
    options: Vec<String>,
    multiple: bool,
    by: String,
    at_ms: u64,
    /// Each voter's answer, whole: a new one replaces the old.
    votes: HashMap<u32, Vec<u32>>,
}

impl HeldPoll {
    /// The poll with its answers counted, as `own` sees it.
    fn as_it_stands(&self, own: Option<u32>) -> Poll {
        let chosen_by_own = own.and_then(|own| self.votes.get(&own));
        Poll {
            id: self.id.clone().into(),
            question: self.question.clone().into(),
            options: self
                .options
                .iter()
                .zip(0_u32..)
                .map(|(text, at)| PollOption {
                    text: text.clone().into(),
                    votes: u32::try_from(
                        self.votes
                            .values()
                            .filter(|selected| selected.contains(&at))
                            .count(),
                    )
                    .unwrap_or(u32::MAX),
                    own: chosen_by_own.is_some_and(|selected| selected.contains(&at)),
                })
                .collect(),
            multiple: self.multiple,
            by: self.by.clone().into(),
            at_ms: self.at_ms,
        }
    }
}

/// The files the message `html` shares. Most messages share none, and
/// that is found out without taking the message apart.
fn attachments(html: &str) -> Vec<Attachment> {
    if !html.contains("FANCY_FILE") {
        return Vec::new();
    }
    api::attachments_in(html)
        .into_iter()
        .map(|file| Attachment {
            name: file.filename.into(),
            size: file.size,
            key: file.key.map(Into::into),
            url: file.url.map(Into::into),
        })
        .collect()
}

fn preview_of(preview: api::LinkPreview) -> Preview {
    Preview {
        url: preview.url.into(),
        title: preview.title.map(Into::into),
        description: preview.description.map(Into::into),
        site: preview.site.map(Into::into),
        picture: preview
            .thumbnail
            .and_then(crate::picture::picture)
            .map(Arc::new),
    }
}

fn ban_of(ban: api::BanInfo) -> Ban {
    Ban {
        address: ban.address.into(),
        mask: ban.mask,
        name: ban.name.into(),
        hash: ban.hash.into(),
        reason: ban.reason.into(),
        start: ban.start.into(),
        duration_secs: ban.duration_secs,
    }
}

fn ban_info(ban: &Ban) -> api::BanInfo {
    api::BanInfo {
        address: ban.address.to_string(),
        mask: ban.mask,
        name: ban.name.to_string(),
        hash: ban.hash.to_string(),
        reason: ban.reason.to_string(),
        start: ban.start.to_string(),
        duration_secs: ban.duration_secs,
    }
}

fn registered_of(user: api::RegisteredInfo) -> Registered {
    Registered {
        id: user.id,
        name: user.name.into(),
        last_seen: user.last_seen.map(Into::into),
        last_channel: user.last_channel,
    }
}

/// A length of time in the two largest units that say something.
fn span(secs: u32) -> String {
    let (days, hours, minutes) = (secs / 86_400, secs / 3600 % 24, secs / 60 % 60);
    match (days, hours, minutes) {
        (0, 0, 0) => format!("{secs} s"),
        (0, 0, minutes) => format!("{minutes} min"),
        (0, hours, minutes) => format!("{hours} h {minutes} min"),
        (days, hours, _) => format!("{days} d {hours} h"),
    }
}

/// What a server knows of a user's connection, as the info card lists it.
fn user_facts(stats: &api::UserStats) -> Vec<(SharedString, SharedString)> {
    let mut facts: Vec<(SharedString, SharedString)> = Vec::new();
    let mut fact = |name: &str, value: String| facts.push((name.to_owned().into(), value.into()));
    fact("Ping", format!("{} ms", stats.tcp_ping_ms));
    if stats.udp_ping_ms > 0 {
        fact("Voice ping", format!("{} ms", stats.udp_ping_ms));
    }
    if let Some(online) = stats.online_secs {
        fact("Connected for", span(online));
    }
    if let Some(idle) = stats.idle_secs {
        fact("Idle for", span(idle));
    }
    if let Some(version) = &stats.version {
        fact("Client", version.clone());
    }
    if let Some(os) = &stats.os {
        fact("System", os.clone());
    }
    if let Some(address) = &stats.address {
        fact("Address", address.clone());
    }
    facts
}

/// What a server says of itself, as the info card lists it.
fn server_facts(server: &api::ServerDetails) -> Vec<(SharedString, SharedString)> {
    let mut facts: Vec<(SharedString, SharedString)> = Vec::new();
    let mut fact = |name: &str, value: String| facts.push((name.to_owned().into(), value.into()));
    fact("Address", format!("{}:{}", server.host, server.port));
    fact(
        "Users",
        match server.max_users {
            Some(most) => format!("{} of {most}", server.users),
            None => server.users.to_string(),
        },
    );
    if let Some(release) = &server.release {
        fact("Server", release.clone());
    }
    if let Some(os) = &server.os {
        fact("System", os.clone());
    }
    if let Some(protocol) = &server.protocol {
        fact("Protocol", protocol.clone());
    }
    if let Some(bits) = server.max_bandwidth {
        fact("Voice bitrate limit", format!("{} kbit/s", bits / 1000));
    }
    fact(
        "Fancy extensions",
        if server.fancy { "yes" } else { "no" }.to_owned(),
    );
    facts
}

/// How many older messages are asked of the server at a time.
const EARLIER_PAGE: u32 = 100;

/// How often, at most, the server is told the local user is writing.
const TYPING_EVERY: std::time::Duration = std::time::Duration::from_secs(3);

/// Put `reaction` among a channel's, or with `added` false take it out.
fn note_reaction(
    channel: &mut HashMap<String, Vec<api::ReactionInfo>>,
    reaction: api::ReactionInfo,
    added: bool,
) {
    let on_message = channel.entry(reaction.message.clone()).or_default();
    // One of each emoji a person: a second is the first again.
    on_message.retain(|known| !(known.by == reaction.by && known.emoji == reaction.emoji));
    if added {
        on_message.push(reaction);
    }
}

/// The reactions on one message as it shows them: each emoji once, in the
/// order it was first used, with how many put it there.
fn tally(given: &[api::ReactionInfo], own_hash: Option<&str>) -> Vec<Reaction> {
    let mut tallied: Vec<Reaction> = Vec::new();
    for reaction in given {
        let own = own_hash == Some(reaction.by.as_str());
        match tallied
            .iter_mut()
            .find(|known| known.emoji.as_ref() == reaction.emoji)
        {
            Some(known) => {
                known.count += 1;
                known.own |= own;
            }
            None => tallied.push(Reaction {
                emoji: reaction.emoji.clone().into(),
                count: 1,
                own,
            }),
        }
    }
    tallied
}

/// How long to wait before retry number `attempt` (from zero) of a lost
/// connection: two seconds, doubling, at most thirty; `None` once it has
/// been tried often enough that the server is simply gone.
fn retry_pause(attempt: u32) -> Option<std::time::Duration> {
    const ATTEMPTS: u32 = 10;
    (attempt < ATTEMPTS).then(|| std::time::Duration::from_secs((2u64 << attempt.min(4)).min(30)))
}

/// What to tell the user when a session ends: the engine's reason, unless
/// the server had just refused the connection and said why.
fn disconnect_notice(reason: Option<String>, refused: bool) -> Option<String> {
    reason.filter(|_| !refused)
}

/// Unix epoch milliseconds, now.
/// The groups as the server sent them, with the members the view changed:
/// everything else a group carries goes back as it came. A group the view
/// made is new, and takes its parent's members as groups do.
fn merged_groups(read: Vec<api::AclGroupInfo>, changed: Vec<AclGroup>) -> Vec<api::AclGroupInfo> {
    let mut groups = read;
    for group in changed {
        if let Some(known) = groups
            .iter_mut()
            .find(|known| known.name == group.name.as_ref())
        {
            known.add = group.added;
            known.remove = group.removed;
        } else if !group.added.is_empty() {
            groups.push(api::AclGroupInfo {
                name: group.name.to_string(),
                inherited: false,
                inherit: true,
                inheritable: true,
                add: group.added,
                remove: group.removed,
                inherited_members: Vec::new(),
                color: None,
                icon: None,
                style_preset: None,
                metadata: HashMap::new(),
            });
        }
    }
    groups
}

/// A waiting message, under the view's names.
fn scheduled_of(message: api::ScheduledInfo) -> Scheduled {
    Scheduled {
        id: message.id.into(),
        channels: message.channels,
        html: message.html.into(),
        at_ms: message.at_ms,
    }
}

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
    fn reactions_are_tallied_by_emoji_and_a_removal_takes_one_out() {
        let by = |emoji: &str, who: &str| api::ReactionInfo {
            message: "m".to_owned(),
            emoji: emoji.to_owned(),
            by: who.to_owned(),
            by_name: who.to_owned(),
        };
        let mut channel = HashMap::new();
        note_reaction(&mut channel, by("👍", "ann"), true);
        note_reaction(&mut channel, by("🎉", "bob"), true);
        note_reaction(&mut channel, by("👍", "bob"), true);
        // Said twice, counted once.
        note_reaction(&mut channel, by("👍", "bob"), true);
        let tallied = tally(&channel["m"], Some("bob"));
        let shown: Vec<_> = tallied
            .iter()
            .map(|reaction| (reaction.emoji.as_ref(), reaction.count, reaction.own))
            .collect();
        assert_eq!(shown, [("👍", 2, true), ("🎉", 1, true)]);

        note_reaction(&mut channel, by("👍", "bob"), false);
        let tallied = tally(&channel["m"], Some("bob"));
        let shown: Vec<_> = tallied
            .iter()
            .map(|reaction| (reaction.emoji.as_ref(), reaction.count, reaction.own))
            .collect();
        assert_eq!(shown, [("👍", 1, false), ("🎉", 1, true)]);
    }

    #[test]
    fn a_poll_counts_each_voters_latest_answer() {
        let mut poll = HeldPoll {
            id: "p".to_owned(),
            question: "Tea?".to_owned(),
            options: vec!["Yes".to_owned(), "No".to_owned(), "Later".to_owned()],
            multiple: true,
            by: "Rin".to_owned(),
            at_ms: 0,
            votes: HashMap::new(),
        };
        let _ = poll.votes.insert(1, vec![0, 2]);
        let _ = poll.votes.insert(2, vec![1]);
        // Voter 2 thinks again: the new answer replaces the old.
        let _ = poll.votes.insert(2, vec![0]);
        let stands = poll.as_it_stands(Some(1));
        let counted: Vec<_> = stands
            .options
            .iter()
            .map(|option| (option.text.as_ref(), option.votes, option.own))
            .collect();
        assert_eq!(
            counted,
            [("Yes", 2, true), ("No", 0, false), ("Later", 1, true)]
        );
        assert!(
            poll.as_it_stands(None)
                .options
                .iter()
                .all(|option| !option.own)
        );
    }

    #[test]
    fn a_span_is_said_in_its_two_largest_units() {
        assert_eq!(span(42), "42 s");
        assert_eq!(span(125), "2 min");
        assert_eq!(span(3 * 3600 + 5 * 60), "3 h 5 min");
        assert_eq!(span(2 * 86_400 + 7 * 3600 + 59), "2 d 7 h");
    }

    #[test]
    fn retries_back_off_and_then_give_up() {
        let seconds = |attempt| retry_pause(attempt).map(|pause| pause.as_secs());
        assert_eq!(seconds(0), Some(2));
        assert_eq!(seconds(1), Some(4));
        assert_eq!(seconds(2), Some(8));
        assert_eq!(seconds(3), Some(16));
        assert_eq!(seconds(4), Some(30), "held at thirty");
        assert_eq!(seconds(9), Some(30));
        assert_eq!(seconds(10), None, "then no more");
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
        // Each is known to the other by their certificate, which is what a
        // friend is kept by.
        wait_for("certificates to be known", || known_apart(&alice));
        wait_for("each to see the other", || {
            alice.snapshot().users.len() >= 2 && bob.snapshot().users.len() >= 2
        });
        let on_alice = alice.snapshot();
        let channel = on_alice.current_channel.expect("alice is in a channel");
        assert!(on_alice.own_session.is_some());
        assert!(!on_alice.channels.is_empty(), "the channel tree arrived");
        assert_eq!(bob.snapshot().current_channel, Some(channel));

        let room = Conversation::Channel(channel);
        alice.send_message(room, "hello <b>bob</b> & co".to_owned());
        wait_for("bob to receive the message", || {
            bob.messages(room)
                .iter()
                .any(|message| message.body.as_ref() == "hello <b>bob</b> & co")
        });
        let received = bob.messages(room);
        let message = received.last().expect("the message");
        assert_eq!(message.sender_name.as_ref(), "LiveAlice");
        assert!(!message.own);
        wait_for("alice to see her own message", || {
            alice.messages(room).iter().any(|message| message.own)
        });

        direct_message_reaches_only_bob(&alice, &bob, room, received.len());

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

    /// A picture set by one client is fetched and decoded by the other.
    #[test]
    #[ignore = "needs a live server; set FANCY_GPUI_TEST_SERVER=host:port"]
    fn live_a_picture_set_by_one_is_seen_by_the_other() {
        let address = std::env::var("FANCY_GPUI_TEST_SERVER").expect("FANCY_GPUI_TEST_SERVER");
        let (host, port) = address.rsplit_once(':').expect("host:port");
        let port: u16 = port.parse().expect("a port");
        let client = |name: &str| {
            let dir =
                std::env::temp_dir().join(format!("fancy-gpui-pic-{name}-{}", std::process::id()));
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
            engine.connect("live", None);
            (engine, dir)
        };
        let (painter, painter_dir) = client("PicPainter");
        let (viewer, viewer_dir) = client("PicViewer");
        wait_for("both to connect", || {
            painter.snapshot().users.len() >= 2 && viewer.snapshot().users.len() >= 2
        });
        // A real, tiny JPEG.
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode_image(&image::RgbImage::from_pixel(
                8,
                8,
                image::Rgb([200, 40, 40]),
            ))
            .expect("a jpeg");
        painter.act(Action::SetAvatar(jpeg.clone()));

        // The same picture as a message: it arrives as one, whole.
        let room = Conversation::Channel(painter.snapshot().current_channel.expect("a channel"));
        painter.send_picture(room, jpeg.clone());
        wait_for("the viewer to receive the picture", || {
            viewer
                .messages(room)
                .iter()
                .any(|message| crate::rich::Rich::parse(&message.html).images == [jpeg.clone()])
        });
        wait_for("the viewer to have the painter's picture", || {
            viewer
                .snapshot()
                .users
                .iter()
                .any(|user| user.name.as_ref() == "PicPainter" && user.avatar.is_some())
        });
        painter.disconnect();
        viewer.disconnect();
        wait_for("both to leave", || {
            painter.snapshot().connection == Connection::Disconnected
                && viewer.snapshot().connection == Connection::Disconnected
        });
        drop((painter, viewer));
        let _ = std::fs::remove_dir_all(painter_dir);
        let _ = std::fs::remove_dir_all(viewer_dir);
    }

    /// A direct message reaches only the one it is for, and counts as
    /// unread there until the conversation is opened.
    fn direct_message_reaches_only_bob(
        alice: &RealEngine,
        bob: &RealEngine,
        room: Conversation,
        in_room: usize,
    ) {
        let bob_session = bob.snapshot().own_session.expect("bob's session");
        let alice_session = alice.snapshot().own_session.expect("alice's session");
        alice.send_message(Conversation::Direct(bob_session), "just for you".to_owned());
        let from_alice = Conversation::Direct(alice_session);
        wait_for("bob to receive the direct message", || {
            bob.messages(from_alice)
                .iter()
                .any(|message| message.body.as_ref() == "just for you")
        });
        assert_eq!(bob.messages(room).len(), in_room, "not in the channel");
        wait_for("bob to see it counted unread", || {
            bob.snapshot()
                .users
                .iter()
                .any(|user| user.session == alice_session && user.unread == 1)
        });
        bob.open(from_alice);
        wait_for("opening it to mark it read", || {
            bob.snapshot().users.iter().all(|user| user.unread == 0)
        });
    }

    /// Poll `done` for up to twenty seconds.
    #[track_caller]
    /// Whether `engine` sees two users with two different certificates.
    fn known_apart(engine: &RealEngine) -> bool {
        let hashes: Vec<_> = engine
            .snapshot()
            .users
            .iter()
            .filter_map(|user| user.hash.clone())
            .collect();
        hashes.len() >= 2 && hashes[0] != hashes[1]
    }

    fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        while !done() {
            assert!(
                std::time::Instant::now() < deadline,
                "timed out waiting for {what}"
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
    /// One engine on two live servers at once: the second joins the first
    /// on the rail, and going back and forth swaps what the snapshot is of.
    ///
    /// ```text
    /// FANCY_GPUI_TEST_SERVERS=127.0.0.1:64738,127.0.0.1:64739 cargo test -- --ignored live
    /// ```
    #[test]
    #[ignore = "needs two live servers; set FANCY_GPUI_TEST_SERVERS=host:port,host:port"]
    fn live_one_client_on_two_servers() {
        let servers = std::env::var("FANCY_GPUI_TEST_SERVERS").expect("FANCY_GPUI_TEST_SERVERS");
        let dir = std::env::temp_dir().join(format!("fancy-gpui-live-two-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let engine = RealEngine::start(&dir).expect("the engine starts");
        for (label, address) in ["first", "second"].into_iter().zip(servers.split(',')) {
            let (host, port) = address.rsplit_once(':').expect("host:port");
            engine.save_server(SavedServer {
                id: label.into(),
                label: label.into(),
                host: host.to_owned().into(),
                port: port.parse().expect("a port"),
                username: "LiveTwo".into(),
                certificate: Some("livetwo".into()),
                favorite: false,
            });
        }
        let active = |engine: &RealEngine| {
            engine
                .snapshot()
                .sessions
                .iter()
                .find(|session| session.active)
                .map(|session| session.name.to_string())
        };

        engine.connect("first", None);
        wait_for("the first server", || {
            engine.snapshot().connection == Connection::Connected
        });
        assert_eq!(active(&engine).as_deref(), Some("first"));
        let first_channels = engine.snapshot().channels.len();

        // The certificate made for that connect leaves in a file and
        // comes back from it.
        assert_eq!(engine.certificates(), ["livetwo"]);
        let exported = dir.join("exported.json");
        engine.manage_certificate(CertificateTask::Export {
            label: "livetwo".to_owned(),
            to: exported.clone(),
        });
        wait_for("the export", || exported.exists());
        engine.manage_certificate(CertificateTask::Delete("livetwo".to_owned()));
        wait_for("the certificate to go", || engine.certificates().is_empty());
        engine.manage_certificate(CertificateTask::Import(exported));
        wait_for("the certificate to come back", || {
            engine.certificates() == ["livetwo"]
        });

        engine.connect("second", None);
        wait_for("the second server beside the first", || {
            let now = engine.snapshot();
            now.connection == Connection::Connected
                && now.sessions.len() == 2
                && active(&engine).as_deref() == Some("second")
        });

        let now = engine.snapshot();
        assert_eq!(now.sessions[0].name.as_ref(), "first", "in a settled order");
        let first = now.sessions[0].id.clone();
        engine.activate_session(&first);
        wait_for("the first server again", || {
            active(&engine).as_deref() == Some("first")
        });
        let back = engine.snapshot();
        assert_eq!(back.connection, Connection::Connected);
        assert_eq!(back.channels.len(), first_channels);
        assert_eq!(back.sessions.len(), 2, "still on both");

        // Leaving the one showing falls back to the other.
        engine.disconnect();
        wait_for("the second server alone", || {
            let now = engine.snapshot();
            now.sessions.len() == 1 && active(&engine).as_deref() == Some("second")
        });
        assert_eq!(engine.snapshot().connection, Connection::Connected);
        engine.disconnect();
        wait_for("none", || {
            engine.snapshot().connection == Connection::Disconnected
        });
        assert!(engine.snapshot().sessions.is_empty());
        engine.shutdown();
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A client on the live Fancy server named by `FANCY_GPUI_TEST_FANCY`,
    /// connecting as `name`.
    fn fancy_client(name: &str, password: Option<String>) -> (RealEngine, std::path::PathBuf) {
        let address = std::env::var("FANCY_GPUI_TEST_FANCY").expect("FANCY_GPUI_TEST_FANCY");
        let (host, port) = address.rsplit_once(':').expect("host:port");
        let dir = std::env::temp_dir().join(format!(
            "fancy-gpui-fancy-{}-{}",
            name.to_lowercase(),
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let engine = RealEngine::start(&dir).expect("the engine starts");
        engine.save_server(SavedServer {
            id: "live".into(),
            label: "live".into(),
            host: host.to_owned().into(),
            port: port.parse().expect("a port"),
            username: name.to_owned().into(),
            certificate: Some(name.to_lowercase().into()),
            favorite: false,
        });
        engine.connect("live", password);
        (engine, dir)
    }

    /// The message of `room` that reads `text`, as `engine` holds it.
    fn said(engine: &RealEngine, room: Conversation, text: &str) -> Option<Message> {
        engine
            .messages(room)
            .into_iter()
            .find(|message| message.body.as_ref() == text)
    }

    /// The tail of the test below, on the clients it already has: bob
    /// answers the message `id`, and alice's copy of the answer names it.
    fn replies_name_what_they_answer(
        alice: &RealEngine,
        bob: &RealEngine,
        room: Conversation,
        id: &str,
    ) {
        // No faster than a server takes them.
        std::thread::sleep(std::time::Duration::from_secs(1));
        bob.send_reply(room, id.to_owned().into(), "agreed".to_owned());
        wait_for("alice to receive the reply", || {
            said(alice, room, "agreed").is_some()
        });
        let reply = said(alice, room, "agreed").expect("the reply");
        assert_eq!(reply.reply_to.as_ref().map(AsRef::as_ref), Some(id));
        // The mark is a comment: it is in the message and not in its words.
        assert_eq!(
            crate::rich::Rich::parse(&reply.html).text.as_str(),
            "agreed"
        );

        // A name after an at sign is a mention, to a client that knows them.
        std::thread::sleep(std::time::Duration::from_secs(1));
        bob.send_message(room, "ping @FancyAlice".to_owned());
        wait_for("alice to be mentioned", || {
            said(alice, room, "ping @FancyAlice").is_some_and(|message| {
                crate::rich::Rich::parse(&message.html)
                    .spans
                    .iter()
                    .any(|(range, style)| style.mention && range.len() == "@FancyAlice".len())
            })
        });
    }

    /// What only a Fancy server does: a message is edited and reacted to,
    /// and one client sees the other writing.
    ///
    /// ```text
    /// FANCY_GPUI_TEST_FANCY=127.0.0.1:64738 cargo test -- --ignored live_fancy
    /// ```
    #[test]
    #[ignore = "needs a live Fancy server; set FANCY_GPUI_TEST_FANCY=host:port"]
    fn live_fancy_messages_are_edited_and_reacted_to() {
        let (alice, alice_dir) = fancy_client("FancyAlice", None);
        let (bob, bob_dir) = fancy_client("FancyBob", None);
        wait_for("both to connect", || {
            alice.snapshot().users.len() >= 2 && bob.snapshot().users.len() >= 2
        });
        assert!(alice.snapshot().fancy, "the server speaks the extensions");
        let channel = alice.snapshot().current_channel.expect("a channel");
        let room = Conversation::Channel(channel);

        alice.send_message(room, "first draft".to_owned());
        wait_for("bob to receive it, with an id", || {
            said(&bob, room, "first draft").is_some_and(|message| message.id.is_some())
        });
        let id = said(&alice, room, "first draft")
            .and_then(|message| message.id)
            .expect("alice's own copy has the id")
            .to_string();
        assert_eq!(
            said(&bob, room, "first draft")
                .and_then(|message| message.id)
                .map(|id| id.to_string()),
            Some(id.clone()),
            "one id for both"
        );

        // Bob says how far he has read, and alice hears of it.
        let read = alice.events();
        bob.read_up_to(room, id.clone().into());
        wait_for("alice to hear that bob has read it", || {
            std::iter::from_fn(|| read.try_recv().ok()).any(|event| {
                matches!(event, EngineEvent::Readers { channel: of, readers }
                if of == channel && readers.iter().any(|reader| {
                    reader.name.as_ref() == "FancyBob" && reader.read_up_to.as_ref() == id
                }))
            })
        });

        // Bob is seen writing.
        let seen = alice.events();
        bob.typing(room);
        let bob_session = bob.snapshot().own_session.expect("bob's session");
        wait_for("alice to see bob writing", || {
            std::iter::from_fn(|| seen.try_recv().ok()).any(|event| {
                event
                    == EngineEvent::Typing {
                        channel,
                        session: bob_session,
                    }
            })
        });

        alice.act(Action::EditMessage {
            channel,
            id: id.clone(),
            text: "second draft".to_owned(),
        });
        wait_for("bob to see the edit", || {
            said(&bob, room, "second draft").is_some_and(|message| message.edited)
        });
        assert!(
            said(&bob, room, "first draft").is_none(),
            "changed, not added"
        );
        // What is held can be searched, and says where it was said.
        let found = bob.search_messages("second dra");
        assert!(
            found
                .iter()
                .any(|found| found.conversation == room && found.about.contains("FancyAlice")),
            "{found:?}"
        );

        // A server counts what a client sends and drops what is too much
        // at once; a person does not react this fast.
        std::thread::sleep(std::time::Duration::from_secs(1));
        let react = |add| Action::React {
            channel,
            id: id.clone(),
            emoji: "👍".to_owned(),
            add,
        };
        bob.act(react(true));
        wait_for("both to see bob's reaction", || {
            let on = |engine: &RealEngine| {
                said(engine, room, "second draft")
                    .map(|message| message.reactions)
                    .unwrap_or_default()
            };
            let (at_alice, at_bob) = (on(&alice), on(&bob));
            at_alice.len() == 1
                && at_alice[0].count == 1
                && !at_alice[0].own
                && at_bob.len() == 1
                && at_bob[0].own
        });
        bob.act(react(false));
        wait_for("the reaction to go again", || {
            said(&alice, room, "second draft").is_some_and(|message| message.reactions.is_empty())
        });

        replies_name_what_they_answer(&alice, &bob, room, &id);

        alice.shutdown();
        bob.shutdown();
        let _ = std::fs::remove_dir_all(alice_dir);
        let _ = std::fs::remove_dir_all(bob_dir);
    }

    /// The tail of the history test, on the clients it already has: `late`
    /// hears `root` from inside `channel`, and `alice` reads what the
    /// server knows of `admin` and of itself.
    fn listening_and_what_is_known(
        alice: &RealEngine,
        late: &RealEngine,
        admin: &RealEngine,
        root: u32,
        channel: u32,
    ) {
        // Hearing a channel without being in it.
        let listens = |engine: &RealEngine| {
            engine
                .snapshot()
                .channels
                .iter()
                .any(|known| known.id == root && known.listening)
        };
        assert!(!listens(late));
        late.act(Action::ToggleListen { channel: root });
        wait_for("the latecomer to listen to the root", || listens(late));
        assert_eq!(late.snapshot().current_channel, Some(channel));

        // What the server knows of a user's connection.
        let told = alice.events();
        let admin_session = admin.snapshot().own_session.expect("the admin's session");
        alice.about(Subject::User(admin_session));
        wait_for("the admin's connection to be described", || {
            std::iter::from_fn(|| told.try_recv().ok()).any(|event| {
                matches!(
                    event,
                    EngineEvent::Facts { subject, facts }
                        if subject == Subject::User(admin_session)
                            && facts.iter().any(|(name, _)| name.as_ref() == "Ping")
                )
            })
        });
        // What is said about a channel is changed by one and read by another.
        admin.act(Action::DescribeChannel {
            channel,
            text: "Kept for <good>".to_owned(),
        });
        wait_for("the channel's new description", || {
            alice.about(Subject::Channel(channel));
            std::thread::sleep(std::time::Duration::from_millis(300));
            std::iter::from_fn(|| told.try_recv().ok()).any(|event| {
                matches!(event, EngineEvent::About { subject, html: Some(html) }
                    if subject == Subject::Channel(channel)
                        && crate::rich::Rich::parse(&html).text == "Kept for <good>")
            })
        });
        alice.about(Subject::Server);
        wait_for("the server to be described", || {
            std::iter::from_fn(|| told.try_recv().ok()).any(|event| {
                matches!(
                    event,
                    EngineEvent::Facts { subject: Subject::Server, facts }
                        if facts.iter().any(|(name, value)| {
                            name.as_ref() == "Fancy extensions" && value.as_ref() == "yes"
                        })
                )
            })
        });
    }

    /// A channel made to keep its messages serves them to whoever comes
    /// later, and a message deleted there is gone for everyone. Making the
    /// channel takes the server's `SuperUser`:
    ///
    /// ```text
    /// FANCY_GPUI_TEST_FANCY=127.0.0.1:64738 FANCY_GPUI_TEST_SUPERUSER=<password> \
    ///     cargo test -- --ignored live_fancy_history
    /// ```
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_history_is_kept_and_a_message_deleted_for_everyone() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let (alice, alice_dir) = fancy_client("KeptAlice", None);
        wait_for("both to connect", || {
            admin.snapshot().users.len() >= 2 && alice.snapshot().users.len() >= 2
        });
        let name = format!("kept-{}", std::process::id());
        let root = admin.snapshot().current_channel.expect("the root");
        admin.act(Action::CreateChannel {
            parent: root,
            name: name.clone(),
            history: true,
            encrypted: false,
        });
        let kept = |engine: &RealEngine| {
            engine
                .snapshot()
                .channels
                .into_iter()
                .find(|channel| channel.name.as_ref() == name)
        };
        wait_for("the channel, keeping its messages", || {
            kept(&alice).is_some_and(|channel| channel.history)
        });
        let channel = kept(&alice).expect("the channel").id;
        let room = Conversation::Channel(channel);
        admin.join_channel(channel);
        alice.join_channel(channel);
        wait_for("both to be in it", || {
            alice.snapshot().current_channel == Some(channel)
                && admin.snapshot().current_channel == Some(channel)
        });

        alice.send_message(room, "to be deleted".to_owned());
        alice.send_message(room, "to be kept".to_owned());
        wait_for("the admin to have both", || {
            said(&admin, room, "to be deleted").is_some()
                && said(&admin, room, "to be kept").is_some()
        });
        let id = said(&alice, room, "to be deleted")
            .and_then(|message| message.id)
            .expect("an id")
            .to_string();
        alice.act(Action::DeleteMessage { channel, id });
        wait_for("the message to go for both", || {
            said(&alice, room, "to be deleted").is_none()
                && said(&admin, room, "to be deleted").is_none()
        });
        assert_eq!(alice.message_count(room), alice.messages(room).len());

        // A pin is for everyone, and for whoever comes later.
        let id = said(&alice, room, "to be kept")
            .and_then(|message| message.id)
            .expect("an id")
            .to_string();
        admin.act(Action::Pin {
            channel,
            id,
            pinned: true,
        });
        wait_for("alice to see the pin", || {
            said(&alice, room, "to be kept").is_some_and(|message| message.pinned)
        });

        // Somebody who was not there reads what was kept, and only that.
        let (late, late_dir) = fancy_client("KeptLate", None);
        wait_for("the latecomer to connect", || kept(&late).is_some());
        late.join_channel(channel);
        late.open(room);
        wait_for("the latecomer to read the history", || {
            said(&late, room, "to be kept").is_some()
        });
        assert!(said(&late, room, "to be deleted").is_none());
        listening_and_what_is_known(&alice, &late, &admin, root, channel);

        admin.act(Action::DeleteChannel { channel });
        wait_for("the channel to go", || kept(&alice).is_none());
        for (engine, dir) in [(admin, admin_dir), (alice, alice_dir), (late, late_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    /// The administrator's lists arrive for the `SuperUser`, and are
    /// refused, with words, to somebody who is not one.
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_the_administrators_lists_are_for_administrators() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let (guest, guest_dir) = fancy_client("ListGuest", None);
        wait_for("both to connect", || {
            admin.snapshot().users.len() >= 2 && guest.snapshot().users.len() >= 2
        });
        let told = admin.events();
        let next = |wanted: fn(&EngineEvent) -> bool| {
            std::iter::from_fn(|| told.try_recv().ok()).any(|event| wanted(&event))
        };
        admin.list(Listing::Bans);
        wait_for("the ban list", || {
            next(|event| matches!(event, EngineEvent::Bans(_)))
        });
        admin.list(Listing::Registered);
        // Whoever is on it: a new server has registered nobody yet.
        wait_for("the registered accounts", || {
            next(|event| matches!(event, EngineEvent::Registered(_)))
        });

        let refused = guest.events();
        guest.list(Listing::Bans);
        wait_for("the guest to be refused", || {
            std::iter::from_fn(|| refused.try_recv().ok())
                .any(|event| matches!(event, EngineEvent::Notice(Some(_))))
        });
        for (engine, dir) in [(admin, admin_dir), (guest, guest_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    /// A kept channel's history is read a page at a time: the newest
    /// first, and further back on asking, from the server.
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_history_is_read_back_a_page_at_a_time() {
        const SENT: usize = 60;
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        wait_for("the admin to connect", || {
            admin.snapshot().connection == Connection::Connected
        });
        let name = format!("paged-{}", std::process::id());
        let root = admin.snapshot().current_channel.expect("the root");
        admin.act(Action::CreateChannel {
            parent: root,
            name: name.clone(),
            history: true,
            encrypted: false,
        });
        let paged = |engine: &RealEngine| {
            engine
                .snapshot()
                .channels
                .into_iter()
                .find(|channel| channel.name.as_ref() == name)
                .map(|channel| channel.id)
        };
        wait_for("the channel", || paged(&admin).is_some());
        let channel = paged(&admin).expect("the channel");
        let room = Conversation::Channel(channel);
        admin.join_channel(channel);
        wait_for("the admin to be in it", || {
            admin.snapshot().current_channel == Some(channel)
        });
        for line in 0..SENT {
            admin.send_message(room, format!("line {line}"));
            // In order, and no faster than a server takes them: one that
            // limits how fast a client may talk drops the rest unsaid.
            wait_for("the line to be held", || {
                said(&admin, room, &format!("line {line}")).is_some()
            });
            std::thread::sleep(std::time::Duration::from_millis(450));
        }

        // A server writes what it keeps after it has passed it on, and on
        // a busy disk it falls behind: give it time to have kept it all.
        let settle = std::env::var("FANCY_GPUI_TEST_SETTLE_SECS")
            .ok()
            .and_then(|secs| secs.parse().ok())
            .unwrap_or(5);
        std::thread::sleep(std::time::Duration::from_secs(settle));

        let (late, late_dir) = fancy_client("PagedLate", None);
        wait_for("the latecomer to connect", || paged(&late).is_some());
        late.join_channel(channel);
        late.open(room);
        wait_for("the newest page", || {
            late.window(room, 100)
                .messages
                .last()
                .is_some_and(|message| message.body.as_ref() == format!("line {}", SENT - 1))
        });
        // Step back until the first line is there; each step asks the
        // server for what lies before the oldest message held.
        let mut wanted = 100;
        let mut steps = 0;
        loop {
            let window = late.window(room, wanted);
            if window
                .messages
                .first()
                .is_some_and(|message| message.body.as_ref() == "line 0")
            {
                assert_eq!(window.messages.len(), SENT);
                assert!(!window.earlier, "nothing lies before the first line");
                break;
            }
            assert!(window.earlier, "there is more, and it says so");
            assert!(steps < 10, "the history never came");
            steps += 1;
            wanted += 100;
            let oldest = window
                .messages
                .first()
                .and_then(|message| message.id.clone());
            let held = late.message_count(room);
            late.load_earlier(room, oldest);
            wait_for("an earlier page", || late.message_count(room) > held);
        }

        admin.act(Action::DeleteChannel { channel });
        wait_for("the channel to go", || paged(&late).is_none());
        for (engine, dir) in [(admin, admin_dir), (late, late_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    /// The server looks behind a link and says what is there. It needs
    /// the server to reach the web: `example.org` is what it is asked of.
    #[test]
    #[ignore = "needs a live Fancy server that can reach the web"]
    fn live_fancy_a_link_is_looked_behind() {
        let (alice, alice_dir) = fancy_client("LinkAlice", None);
        wait_for("alice to connect", || {
            alice.snapshot().connection == Connection::Connected
        });
        let told = alice.events();
        alice.previews(vec!["https://example.org/".into()]);
        wait_for("the card", || {
            std::iter::from_fn(|| told.try_recv().ok()).any(|event| {
                matches!(event, EngineEvent::Previews(cards)
                if cards.iter().any(|card| {
                    card.url.as_ref() == "https://example.org/"
                        && card.title.as_ref().is_some_and(|title| title.contains("Example"))
                }))
            })
        });
        // Asked again, it is answered from what is held: no second wait.
        alice.previews(vec!["https://example.org/".into()]);
        wait_for("the card again", || {
            std::iter::from_fn(|| told.try_recv().ok())
                .any(|event| matches!(event, EngineEvent::Previews(_)))
        });
        alice.shutdown();
        let _ = std::fs::remove_dir_all(alice_dir);
    }
    /// A channel sealed the Signal way: two who are in it read each other,
    /// and one who comes later reads what is said from then on and nothing
    /// from before. Needs the Signal bridge library beside the test binary.
    #[test]
    #[ignore = "needs a live Fancy server and the Signal bridge library"]
    fn live_fancy_a_signal_sealed_channel_is_read_by_who_is_in_it() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        wait_for("the admin to connect", || {
            admin.snapshot().connection == Connection::Connected
        });
        assert!(admin.signal_available(), "the bridge library is not here");
        let name = format!("signal-{}", std::process::id());
        let root = admin.snapshot().current_channel.expect("the root");
        admin.act(Action::CreateSignalChannel {
            parent: root,
            name: name.clone(),
        });
        let made = |engine: &RealEngine| {
            engine
                .snapshot()
                .channels
                .into_iter()
                .find(|channel| channel.name.as_ref() == name)
        };
        wait_for("the channel, encrypted", || {
            made(&admin).is_some_and(|channel| channel.encrypted)
        });
        let channel = made(&admin).expect("the channel").id;
        let room = Conversation::Channel(channel);
        let enter = |engine: &RealEngine| {
            engine.join_channel(channel);
            wait_for("to be in the channel", || {
                engine.snapshot().current_channel == Some(channel)
            });
            engine.open(room);
        };
        enter(&admin);
        let (bob, bob_dir) = fancy_client("SignalBob", None);
        wait_for("bob to see the channel", || made(&bob).is_some());
        enter(&bob);
        std::thread::sleep(std::time::Duration::from_secs(2));

        admin.send_message(room, "between the two of us".to_owned());
        wait_for("bob to read the admin", || {
            said(&bob, room, "between the two of us").is_some()
        });
        std::thread::sleep(std::time::Duration::from_secs(1));
        bob.send_message(room, "and back".to_owned());
        wait_for("the admin to read bob", || {
            said(&admin, room, "and back").is_some()
        });

        admin.act(Action::DeleteChannel { channel });
        admin.shutdown();
        bob.shutdown();
        let _ = std::fs::remove_dir_all(admin_dir);
        let _ = std::fs::remove_dir_all(bob_dir);
    }

    /// A message is left with the server to send in a few seconds: it waits
    /// in the list, a second one is called off, and the first arrives.
    #[test]
    #[ignore = "needs a live Fancy server; set FANCY_GPUI_TEST_FANCY=host:port"]
    fn live_fancy_a_message_is_sent_later_and_another_called_off() {
        let (alice, alice_dir) = fancy_client("LaterAlice", None);
        let (bob, bob_dir) = fancy_client("LaterBob", None);
        wait_for("both to connect", || {
            alice.snapshot().users.len() >= 2 && bob.snapshot().users.len() >= 2
        });
        let channel = alice.snapshot().current_channel.expect("a channel");
        let room = Conversation::Channel(channel);
        let told = alice.events();
        let mut waiting = Vec::new();
        let mut listed = |alice: &RealEngine, want: usize| {
            alice.request_scheduled();
            wait_for("the list of what waits", || {
                std::iter::from_fn(|| told.try_recv().ok()).any(|event| match event {
                    EngineEvent::Scheduled(list) => {
                        waiting = list;
                        waiting.len() == want
                    }
                    EngineEvent::Notice(Some(reason)) => panic!("refused: {reason}"),
                    _ => false,
                })
            });
            waiting.clone()
        };
        let soon = now_ms() + 4_000;
        alice.act(Action::SendLater {
            channel,
            body: "kept back".to_owned(),
            at_ms: soon,
        });
        alice.act(Action::SendLater {
            channel,
            body: "never sent".to_owned(),
            at_ms: now_ms() + 3_600_000,
        });
        std::thread::sleep(std::time::Duration::from_secs(1));
        let both = listed(&alice, 2);
        let doomed = both
            .iter()
            .find(|message| message.html.contains("never sent"))
            .expect("the second waits too");
        assert_eq!(doomed.channels, [channel]);
        alice.act(Action::CancelScheduled(doomed.id.clone()));
        std::thread::sleep(std::time::Duration::from_secs(1));

        wait_for("the first to arrive", || {
            bob.window(room, 50)
                .messages
                .iter()
                .any(|message| message.body.contains("kept back"))
        });
        assert!(now_ms() + 500 >= soon, "not before its time");
        assert!(listed(&alice, 0).is_empty(), "nothing waits any more");
        assert!(
            !bob.window(room, 50)
                .messages
                .iter()
                .any(|message| message.body.contains("never sent"))
        );
        alice.shutdown();
        bob.shutdown();
        let _ = std::fs::remove_dir_all(alice_dir);
        let _ = std::fs::remove_dir_all(bob_dir);
    }

    /// A poll is asked by one and answered by both; each sees how it
    /// stands, and which answer is their own.
    #[test]
    #[ignore = "needs a live Fancy server; set FANCY_GPUI_TEST_FANCY=host:port"]
    fn live_fancy_a_poll_is_asked_and_answered() {
        let (alice, alice_dir) = fancy_client("PollAlice", None);
        let (bob, bob_dir) = fancy_client("PollBob", None);
        wait_for("both to connect", || {
            alice.snapshot().users.len() >= 2 && bob.snapshot().users.len() >= 2
        });
        let channel = alice.snapshot().current_channel.expect("a channel");
        let room = Conversation::Channel(channel);
        alice.act(Action::CreatePoll {
            channel,
            question: "Tea?".to_owned(),
            options: vec!["Yes".to_owned(), "No".to_owned()],
            multiple: false,
        });
        wait_for("both to have the poll", || {
            alice.polls(room).len() == 1 && bob.polls(room).len() == 1
        });
        let poll = bob.polls(room).remove(0);
        assert_eq!(poll.question.as_ref(), "Tea?");
        assert_eq!(poll.by.as_ref(), "PollAlice");
        assert_eq!(alice.polls(room)[0].id, poll.id, "one id for both");

        let vote = |selected: Vec<u32>| Action::Vote {
            channel,
            poll: poll.id.to_string(),
            selected,
        };
        bob.act(vote(vec![1]));
        alice.act(vote(vec![0]));
        let stands = |engine: &RealEngine| -> Vec<(u32, bool)> {
            engine.polls(room)[0]
                .options
                .iter()
                .map(|option| (option.votes, option.own))
                .collect()
        };
        wait_for("both votes to be counted by both", || {
            stands(&alice) == [(1, true), (1, false)] && stands(&bob) == [(1, false), (1, true)]
        });
        // Bob thinks again: his answer moves, it is not added.
        std::thread::sleep(std::time::Duration::from_secs(1));
        bob.act(vote(vec![0]));
        wait_for("bob's vote to move", || {
            stands(&alice) == [(2, true), (0, false)] && stands(&bob) == [(2, true), (0, false)]
        });
        for (engine, dir) in [(alice, alice_dir), (bob, bob_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    /// A file is shared by one who may and saved by the other, byte for
    /// byte.
    #[test]
    #[ignore = "needs a live Fancy server that keeps files, and its SuperUser password"]
    fn live_fancy_a_file_is_shared_and_saved() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (alice, alice_dir) = fancy_client("SuperUser", Some(password));
        let (bob, bob_dir) = fancy_client("FileBob", None);
        wait_for("both to connect", || {
            alice.snapshot().users.len() >= 2 && bob.snapshot().users.len() >= 2
        });
        let channel = alice.snapshot().current_channel.expect("a channel");
        let room = Conversation::Channel(channel);
        // Not a picture, and not small enough to be all one block.
        let contents: Vec<u8> = (0..200_000_u32).flat_map(u32::to_le_bytes).collect();
        let original = alice_dir.join("numbers.bin");
        std::fs::write(&original, &contents).expect("writable");

        // A guest may not: the server says so, and nothing is sent.
        let told = bob.events();
        let unsent = bob_dir.join("unsent.bin");
        std::fs::write(&unsent, b"not a picture").expect("writable");
        bob.send_file(room, unsent);
        wait_for("the guest to be refused, with words", || {
            std::iter::from_fn(|| told.try_recv().ok())
                .any(|event| matches!(event, EngineEvent::Notice(Some(_))))
        });

        alice.send_file(room, original);
        let shared = |engine: &RealEngine| {
            engine
                .messages(room)
                .into_iter()
                .find_map(|message| message.files.into_iter().next())
        };
        wait_for("both to have the file's card", || {
            shared(&alice).is_some() && shared(&bob).is_some()
        });
        let file = shared(&bob).expect("the file");
        assert_eq!(file.name.as_ref(), "numbers.bin");
        assert_eq!(file.size, Some(contents.len() as u64));

        let saved = bob_dir.join("saved.bin");
        bob.save_file(file.key.expect("a key"), saved.clone());
        wait_for("the file to be saved whole", || {
            std::fs::read(&saved).is_ok_and(|read| read == contents)
        });
        for (engine, dir) in [(alice, alice_dir), (bob, bob_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    /// A channel kept under a key the server does not have: the one who
    /// made it holds the key, a newcomer asks for it, and reads what was
    /// said before they came once it is shared with them.
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_an_encrypted_channels_key_is_asked_for_and_shared() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        wait_for("the admin to connect", || {
            admin.snapshot().connection == Connection::Connected
        });
        let name = format!("sealed-{}", std::process::id());
        let root = admin.snapshot().current_channel.expect("the root");
        admin.act(Action::CreateChannel {
            parent: root,
            name: name.clone(),
            history: true,
            encrypted: true,
        });
        let sealed = |engine: &RealEngine| {
            engine
                .snapshot()
                .channels
                .into_iter()
                .find(|channel| channel.name.as_ref() == name)
        };
        wait_for("the channel, encrypted", || {
            sealed(&admin).is_some_and(|channel| channel.encrypted && channel.history)
        });
        let channel = sealed(&admin).expect("the channel").id;
        let room = Conversation::Channel(channel);
        admin.join_channel(channel);
        wait_for("the admin to be in it", || {
            admin.snapshot().current_channel == Some(channel)
        });
        admin.open(room);
        std::thread::sleep(std::time::Duration::from_secs(1));
        admin.send_message(room, "said before anybody came".to_owned());
        wait_for("the admin's own message", || {
            said(&admin, room, "said before anybody came").is_some()
        });

        let (late, late_dir) = fancy_client("SealedLate", None);
        wait_for("the latecomer to connect", || sealed(&late).is_some());
        late.join_channel(channel);
        late.open(room);
        wait_for("the latecomer to ask for the key", || {
            admin
                .key_requests(channel)
                .iter()
                .any(|asking| asking.name.as_ref() == "SealedLate")
        });
        assert!(
            said(&late, room, "said before anybody came").is_none(),
            "not readable without the key"
        );
        let asking = admin.key_requests(channel).remove(0);
        admin.act(Action::AnswerKeyRequest {
            channel,
            hash: asking.hash.to_string(),
            share: true,
        });
        wait_for("the request to be answered", || {
            admin.key_requests(channel).is_empty()
        });
        std::thread::sleep(std::time::Duration::from_secs(1));
        admin.send_message(room, "said to both".to_owned());
        wait_for("the latecomer to read what is said now", || {
            said(&late, room, "said to both").is_some()
        });
        // And, with the key, what was kept from before they came.
        late.open(room);
        wait_for("the latecomer to read what was said before", || {
            said(&late, room, "said before anybody came").is_some()
        });

        admin.act(Action::DeleteChannel { channel });
        wait_for("the channel to go", || sealed(&late).is_none());
        for (engine, dir) in [(admin, admin_dir), (late, late_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    /// A channel's rules are read, changed and take effect: a rule that
    /// denies entering keeps a guest out, and taking it away lets them in.
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_a_channels_permissions_are_changed_and_hold() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let (guest, guest_dir) = fancy_client("AclGuest", None);
        wait_for("both to connect", || {
            admin.snapshot().users.len() >= 2 && guest.snapshot().users.len() >= 2
        });
        let name = format!("ruled-{}", std::process::id());
        let root = admin.snapshot().current_channel.expect("the root");
        admin.act(Action::CreateChannel {
            parent: root,
            name: name.clone(),
            history: false,
            encrypted: false,
        });
        let ruled = |engine: &RealEngine| {
            engine
                .snapshot()
                .channels
                .into_iter()
                .find(|channel| channel.name.as_ref() == name)
                .map(|channel| channel.id)
        };
        wait_for("the channel", || ruled(&guest).is_some());
        let channel = ruled(&guest).expect("the channel");

        let told = admin.events();
        let rules = |told: &async_channel::Receiver<EngineEvent>| {
            std::iter::from_fn(|| told.try_recv().ok()).find_map(|event| match event {
                EngineEvent::Acl(acl) if acl.channel == channel => Some(acl),
                _ => None,
            })
        };
        admin.request_acl(channel);
        let mut read = None;
        wait_for("the channel's rules", || {
            read = rules(&told);
            read.is_some()
        });
        let mut acl = read.expect("the rules");
        let own_before = acl.rules.iter().filter(|rule| !rule.inherited).count();

        // Nobody may enter.
        acl.rules.push(AclRule {
            here: true,
            subs: true,
            inherited: false,
            user: None,
            group: Some("all".into()),
            grant: 0,
            deny: 0x4,
        });
        admin.act(Action::SetAcl(acl));
        let mut saved = None;
        wait_for("the rules as the server took them", || {
            saved = rules(&told).filter(|acl| {
                acl.rules.iter().filter(|rule| !rule.inherited).count() == own_before + 1
            });
            saved.is_some()
        });
        let refused = guest.events();
        guest.join_channel(channel);
        wait_for("the guest to be refused", || {
            std::iter::from_fn(|| refused.try_recv().ok())
                .any(|event| matches!(event, EngineEvent::Notice(Some(_))))
        });
        assert_eq!(guest.snapshot().current_channel, Some(root));

        // The rule goes, and the guest gets in.
        let mut acl = saved.expect("the rules");
        acl.rules.retain(|rule| rule.inherited || rule.deny != 0x4);
        admin.act(Action::SetAcl(acl));
        wait_for("the rule to be gone", || {
            rules(&told).is_some_and(|acl| {
                acl.rules.iter().filter(|rule| !rule.inherited).count() == own_before
            })
        });
        guest.join_channel(channel);
        wait_for("the guest to be let in", || {
            guest.snapshot().current_channel == Some(channel)
        });

        guest.join_channel(root);
        admin.act(Action::DeleteChannel { channel });
        wait_for("the channel to go", || ruled(&guest).is_none());
        for (engine, dir) in [(admin, admin_dir), (guest, guest_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    /// A whisper reaches the one it is for and nobody else in the channel.
    /// As with the voice test: run it where no speakers are attached.
    #[test]
    #[ignore = "needs a live server; set FANCY_GPUI_TEST_SERVER=host:port"]
    #[allow(unsafe_code, reason = "`std::env::set_var` is unsafe in Rust 2024")]
    fn live_a_whisper_is_heard_by_its_target_alone() {
        let address = std::env::var("FANCY_GPUI_TEST_SERVER").expect("FANCY_GPUI_TEST_SERVER");
        let (host, port) = address.rsplit_once(':').expect("host:port");
        let port: u16 = port.parse().expect("a port");
        // SAFETY: set before any engine thread reads the environment.
        unsafe { std::env::set_var("FANCY_E2E_VIRTUAL_MIC", "sine:48000:440") };
        let client = |name: &str| {
            let dir = std::env::temp_dir()
                .join(format!("fancy-gpui-whisper-{name}-{}", std::process::id()));
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
            engine.connect("live", None);
            (engine, dir)
        };
        let (alice, alice_dir) = client("WhisperAlice");
        let (bob, bob_dir) = client("WhisperBob");
        let (carol, carol_dir) = client("WhisperCarol");
        wait_for("all three to see each other", || {
            [&alice, &bob, &carol]
                .iter()
                .all(|engine| engine.snapshot().users.len() >= 3)
        });
        // Listening: voice on, microphones muted.
        for listener in [&bob, &carol] {
            listener.toggle_microphone();
            wait_for("a listener's voice to turn on", || {
                listener.snapshot().voice == Voice::On
            });
            listener.toggle_microphone();
            wait_for("a listener to mute", || {
                listener.snapshot().voice == Voice::Muted
            });
        }
        let session = |engine: &RealEngine| engine.snapshot().own_session.expect("a session");
        let (alice_session, bob_session) = (session(&alice), session(&bob));
        let talking = |heard: &async_channel::Receiver<EngineEvent>| {
            std::iter::from_fn(|| heard.try_recv().ok()).any(|event| {
                event
                    == EngineEvent::UserTalking {
                        session: alice_session,
                        talking: true,
                    }
            })
        };
        let (at_bob, at_carol, at_alice) = (bob.events(), carol.events(), alice.events());

        alice.set_whisper_target(Some(WhisperTarget::User(bob_session)));
        std::thread::sleep(std::time::Duration::from_millis(500));
        alice.whisper(true);
        wait_for("alice to be told she is whispering", || {
            std::iter::from_fn(|| at_alice.try_recv().ok())
                .any(|event| event == EngineEvent::Whispering(true))
        });
        wait_for("bob to hear the whisper", || talking(&at_bob));
        // Long enough that carol would have heard it, were it for her.
        std::thread::sleep(std::time::Duration::from_secs(2));
        assert!(!talking(&at_carol), "a whisper is not for the channel");
        alice.whisper(false);
        wait_for("the whisper to end", || {
            std::iter::from_fn(|| at_alice.try_recv().ok())
                .any(|event| event == EngineEvent::Whispering(false))
        });

        for (engine, dir) in [(alice, alice_dir), (bob, bob_dir), (carol, carol_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}
