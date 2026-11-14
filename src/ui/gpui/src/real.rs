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
    Acl, AclRule, Attachment, KeyRequest, OpenTo, Pin, Pinned, Poll, PollOption, Reach,
    Reader, Retry, ShareAs, WhisperTarget,
};
use crate::engine::{
    Action, AudioDevice, AudioDevices, Ban, CarryOver, CertificateTask, Channel, ChannelId,
    ChosenDevices, Connection, Conversation, Engine, EngineEvent, Found, Listing, Message, Preview,
    Reaction, Registered, Role, SavedServer, Scheduled, ServerPing, SessionEntry, Setting,
    Snapshot, Subject, User, Voice, VoiceSettings, Window,
};
use crate::store::Store;

/// Keep what the engine says of what it does: on the terminal in a debug
/// build, and in a file of the day under `logs` in `data_dir`.
///
/// `wanted` is what the user asked for, if anything: a filter as `RUST_LOG`
/// takes one, or `off` for no file. Left alone it is the engine's `info`,
/// which is a few lines a connection: enough to say afterwards why one ended.
pub(crate) fn start_logs(data_dir: &std::path::Path, wanted: Option<&str>) {
    let to_file = wanted != Some("off");
    let level = wanted.filter(|_| to_file);
    if let Err(reason) = api::logs::start(data_dir.join("logs"), level, to_file) {
        eprintln!("logging is not as asked ({reason})");
    }
}

/// Keep the log as `choices` say, unless the environment asked for a log of
/// its own (`FANCY_GPUI_LOG`), which wins as it does for the theme.
pub(crate) fn steer_logs_unless_asked(choices: &crate::store::LogChoices) {
    if std::env::var_os("FANCY_GPUI_LOG").is_none() {
        steer_logs(choices);
    }
}

/// Keep the log as `choices` say, while running.
pub(crate) fn steer_logs(choices: &crate::store::LogChoices) {
    api::logs::set_auto_zip(choices.auto_zip_logs);
    api::logs::set_terminal_logging(choices.terminal_logging);
    // Before logging has started (a made-up engine) these say so; nothing
    // is lost by that.
    let _ = api::logs::set_level(choices.level());
    let _ = api::logs::set_file_logging(choices.log_to_file);
}

/// Write every kept log file into the one compressed file `to`.
pub(crate) fn export_logs(to: &std::path::Path) -> Result<(), String> {
    api::logs::export(to)
}

/// Delete the identities the engine keeps under `data_dir`.
pub(crate) fn forget_identities(data_dir: &std::path::Path) -> Result<(), String> {
    api::reset::forget_identities(data_dir)
}

/// What, typed, is sent as `html`: the engine's own reading, the other way.
pub(crate) fn source(html: &str) -> String {
    api::source(html)
}

/// How the stretches of `text` will be set once it is sent: the engine's
/// own reading of the marks people type, which needs no engine running.
pub(crate) fn typed(text: &str) -> Vec<(std::ops::Range<usize>, Setting)> {
    api::typed(text)
        .into_iter()
        .map(|typed| {
            let api::Setting {
                bold,
                italic,
                struck,
                underlined,
                hidden,
                code,
                quoted,
                mark,
                linked,
            } = typed.setting;
            let setting = Setting {
                bold,
                italic,
                struck,
                underlined,
                hidden,
                code,
                quoted,
                mark,
                linked,
            };
            (typed.range, setting)
        })
        .collect()
}

mod account;
mod devices;
mod groups;
mod livery;
mod profile;
#[cfg(test)]
mod account_live;
#[cfg(test)]
mod onboarding_live;
#[cfg(test)]
mod share_live;
#[cfg(test)]
mod legacy_live;

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
    /// What the pings said of each server's livery, and the livery of each
    /// server the engine is on.
    liveries: crate::livery::Ledger,
    /// When each message that carries no time of its own was first read,
    /// per channel and in order: a stock server sends none, and "when it
    /// arrived here" is the time a reader expects beside it.
    first_read: Mutex<HashMap<Conversation, Vec<u64>>>,
    /// The messages whose bodies the engine was asked to put away, by id,
    /// as they are handed to the view: without their pictures.
    light: Mutex<HashMap<String, Light>>,
    /// Each user's picture: the marker it was fetched for, and the picture
    /// once it has arrived.
    avatars: Mutex<HashMap<u32, AvatarSlot>>,
    /// Who put which emoji on which message, by channel and then by
    /// message: the engine passes reactions on and keeps none.
    reactions: Mutex<HashMap<u32, HashMap<String, Vec<api::ReactionInfo>>>>,
    /// What is pinned, by channel, as the server listed it: the engine
    /// marks the messages it holds and keeps no list, and a pin may be on
    /// a message further back than those.
    pins: Mutex<HashMap<u32, Vec<api::PinInfo>>>,
    /// The polls seen, by channel, with who answered what: the engine
    /// passes polls and votes on and keeps neither.
    polls: Mutex<HashMap<u32, Vec<HeldPoll>>>,
    /// The rules last read for a channel, whole: the groups go back to
    /// the server as they came, with the rules the view changed.
    acl: Mutex<Option<api::AclInfo>>,
    /// The server's roles: the groups of its root channel. Asked for on
    /// arriving; `roles_asked` is set while that answer is awaited, so a
    /// refusal of it is not shown as if the user had asked for something.
    roles: Mutex<Vec<Role>>,
    roles_asked: Mutex<Option<std::time::Instant>>,
    /// When the member list asked for the registered accounts, while that
    /// answer is awaited: a refusal of it is no news either.
    directory_asked: Mutex<Option<std::time::Instant>>,
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
    /// Whether a lost connection is left lost: the user's choice.
    stay_disconnected: std::sync::atomic::AtomicBool,
    /// The retry that is waited for, while one is. Whoever waits for it
    /// makes it only if it is still theirs: retrying at once, or giving
    /// up, takes it away.
    retry: Mutex<Option<Retry>>,
    /// Whether the server refused this connection. The disconnect that
    /// follows a refusal has a reason of its own ("connection lost"), which
    /// must not replace the one that says why.
    refused: std::sync::atomic::AtomicBool,
    store: Store,
    /// What the engine says of voice messages: what the server allows, and
    /// how the take is going.
    voice: Arc<crate::voice::heard::Heard>,
    /// What the engine says of the voice check and the voice packets.
    sound: Arc<crate::sound_check::heard::Heard>,
    /// Screen sharing over this engine.
    media: Arc<crate::share::real::RealMedia>,
    /// The server's GIF service: what it offers, and the searches waiting
    /// for its answers.
    gifs: crate::gif::server::ServerGifs,
}

impl Shared {
    fn tell(&self, event: EngineEvent) {
        // The receiver lives as long as the view; with nobody left to tell
        // there is nothing to do about a failure.
        let _ = self.events.try_send(event);
    }

    /// Drop what was kept about the server on screen: another one's
    /// sessions, messages and reactions would be taken for it.
    /// Ask for the server's roles, quietly: most servers tell only their
    /// administrators, and that is not news.
    fn ask_for_roles(self: &Arc<Self>, runtime: &tokio::runtime::Handle) {
        *self
            .roles_asked
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(std::time::Instant::now());
        let shared = Arc::clone(self);
        drop(runtime.spawn(async move {
            let _ = shared.engine.request_acl(ROOT).await;
        }));
    }

    /// Whether rules arriving now answer the adapter's own question about
    /// roles: it was asked, and no longer ago than a server takes to
    /// answer. Asked once, answered once.
    fn roles_answered(&self) -> bool {
        self.roles_asked
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
            .is_some_and(|asked| asked.elapsed() < ROLES_ANSWER_WITHIN)
    }

    /// Whether a refusal arriving now is of the adapter's own question
    /// about roles: the right to write the root channel's rules, missing
    /// there, moments after it was asked for.
    fn roles_refused(&self, permission: Option<u32>, channel: Option<u32>) -> bool {
        let about_roles = channel == Some(ROOT) && permission.is_some_and(|bits| bits & WRITE != 0);
        about_roles
            && self
                .roles_asked
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .is_some_and(|asked| asked.elapsed() < ROLES_ANSWER_WITHIN)
    }

    /// Whether a refusal arriving now is of the member list's question for
    /// the registered accounts: a right to read them, missing at the root,
    /// moments after it was asked for. Answered once.
    fn directory_refused(&self, permission: Option<u32>, channel: Option<u32>) -> bool {
        let about_accounts = channel == Some(ROOT)
            && permission.is_some_and(|bits| bits & (REGISTER | READ_REGISTER) != 0);
        about_accounts
            && self
                .directory_asked
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .take()
                .is_some_and(|asked| asked.elapsed() < ROLES_ANSWER_WITHIN)
    }

    /// The root channel's groups, as roles.
    fn take_roles(&self, acl: &api::AclInfo) {
        let roles = acl
            .groups
            .iter()
            // A leading tilde is the server's own bookkeeping.
            .filter(|group| !group.name.starts_with('~'))
            .map(|group| Role {
                name: group.name.clone().into(),
                color: group
                    .color
                    .as_deref()
                    .and_then(crate::theme::parse_color)
                    .map(Into::into),
                members: group
                    .add
                    .iter()
                    .chain(&group.inherited_members)
                    .copied()
                    .filter(|account| !group.remove.contains(account))
                    .collect(),
            })
            .collect();
        *self.roles.lock().unwrap_or_else(PoisonError::into_inner) = roles;
        self.tell(EngineEvent::StateChanged);
    }

    fn forget_server(&self) {
        self.voice.forget();
        self.sound.forget_stats();
        self.gifs.forget();
        self.roles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
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
        if acl.channel == ROOT {
            self.take_roles(&acl);
            // The answer to the adapter's own question is not the user's.
            if self.roles_answered() {
                return;
            }
        }
        let shown = Acl {
            channel: acl.channel,
            inherit: acl.inherit,
            groups: acl
                .groups
                .iter()
                .map(groups::shown)
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

    /// Delete what the server keeps of a channel, all of it or one user's,
    /// and say that what there is to show has changed.
    async fn purge(&self, channel: ChannelId, by: Option<u32>) -> Result<(), String> {
        let hash = match by {
            None => None,
            Some(session) => Some(
                self.engine
                    .users()
                    .into_iter()
                    .find(|user| user.session == session)
                    .and_then(|user| user.hash)
                    .ok_or("That user has no certificate to know their messages by.")?,
            ),
        };
        self.engine.purge_messages(channel, hash).await?;
        self.tell(EngineEvent::NewMessage {
            conversation: Conversation::Channel(channel),
        });
        Ok(())
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
        let groups = changed.groups.into_iter().map(groups::sent).collect();
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
            Action::DeleteMessages { channel, ids } => engine.delete_messages(channel, ids).await,
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
            Action::Unregister { id } => {
                engine.change_registered(id, None).await?;
                // The list as the server has it now, as after a rename.
                engine.request_registered().await
            }
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
                self.set_retry(None);
                self.tell(EngineEvent::Notice(None));
                self.tell(EngineEvent::StateChanged);
                self.open_current_conversation(runtime);
                self.ask_for_roles(runtime);
                self.ask_for_voice_support(runtime);
                self.gifs.ask_support();
            }
            api::EngineEvent::Disconnected { reason } => {
                self.forget_server();
                self.read_liveries(runtime);
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
                    self.set_retry(None);
                } else if lost
                    && !self
                        .stay_disconnected
                        .load(std::sync::atomic::Ordering::Relaxed)
                {
                    self.reconnect_later(runtime);
                }
                self.tell(EngineEvent::StateChanged);
                self.tell(EngineEvent::CurrentChannelChanged);
            }
            api::EngineEvent::Rejected { reason, wants } => {
                self.refused
                    .store(true, std::sync::atomic::Ordering::Relaxed);
                match wants {
                    api::Wanted::Password => {
                        self.tell(EngineEvent::Wanted(crate::engine::Wanted::Password));
                    }
                    api::Wanted::Code => {
                        self.tell(EngineEvent::Wanted(crate::engine::Wanted::Code));
                    }
                    api::Wanted::Nothing => {}
                }
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
            api::EngineEvent::Denied {
                reason,
                permission,
                channel,
            } => {
                // The roles were asked for unprompted; being refused them
                // is how most servers answer, and nothing to show.
                if self.roles_refused(permission, channel) {
                    return;
                }
                // So were the accounts the member list asked for: it lists
                // who is on instead.
                if self.directory_refused(permission, channel) {
                    self.tell(EngineEvent::DirectoryRefused);
                    return;
                }
                let reason = reason.unwrap_or_else(|| "The server did not allow that.".to_owned());
                self.tell(EngineEvent::Notice(Some(reason.into())));
            }
            api::EngineEvent::Notify { title, body } => crate::notify::show(&title, &body),
            api::EngineEvent::Livery => self.read_liveries(runtime),
            api::EngineEvent::UploadProgress {
                upload_id,
                bytes_sent,
                total_bytes,
            } => self.tell(EngineEvent::Upload {
                id: upload_id.into(),
                now: crate::engine::Uploaded::Sent {
                    bytes: bytes_sent,
                    of: total_bytes,
                },
            }),
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
            api::EngineEvent::Registered(users) => {
                // Answered: a refusal from now on is of something else.
                let _ = self
                    .directory_asked
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .take();
                self.tell(EngineEvent::Registered(
                    users.into_iter().map(registered_of).collect(),
                ));
            }
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
                // Only for an administrator, and only for a user on several
                // devices: empty otherwise, which draws no section.
                devices: devices::listed(
                    stats
                        .devices
                        .iter()
                        .map(|device| (device.device_name.as_deref(), device)),
                ),
            }),
            api::EngineEvent::Account(account) => {
                self.tell(EngineEvent::Account(crate::engine::AccountNews::Settings(account)));
            }
            api::EngineEvent::AccountAck(ack) => {
                self.tell(EngineEvent::Account(crate::engine::AccountNews::Ack(ack)));
            }
            api::EngineEvent::OnboardingConfig(_) => {
                self.tell(EngineEvent::Onboarding(crate::engine::OnboardingNews::Config));
            }
            api::EngineEvent::OnboardingResponse(response) => self.tell(EngineEvent::Onboarding(
                crate::engine::OnboardingNews::Response(response),
            )),
            api::EngineEvent::PluginsChanged => self.tell(EngineEvent::PluginsChanged),
            api::EngineEvent::Typing { channel, session } => {
                self.tell(EngineEvent::Typing { channel, session });
            }
            other => self.forward_marks(other),
        }
    }

    /// The rest of [`Self::forward_answer`]: what is put on messages,
    /// reactions and pins. The engine passes each on and keeps no list.
    fn forward_marks(&self, event: api::EngineEvent) {
        match event {
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
            api::EngineEvent::Pin {
                channel,
                pin,
                pinned,
            } => {
                note_pin(
                    self.pins
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .entry(channel)
                        .or_default(),
                    pin,
                    pinned,
                );
                self.tell(EngineEvent::NewMessage {
                    conversation: Conversation::Channel(channel),
                });
            }
            api::EngineEvent::Pins { channel, pins } => {
                let _ = self
                    .pins
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .insert(channel, pins);
                self.tell(EngineEvent::NewMessage {
                    conversation: Conversation::Channel(channel),
                });
            }
            api::EngineEvent::VoiceSupport(support) => {
                self.voice.allow(support);
                self.tell(EngineEvent::StateChanged);
            }
            api::EngineEvent::VoiceRecording(recording) => self.voice.note(recording),
            api::EngineEvent::MicLevel { rms, peak } => self.sound.hear_level(rms, peak),
            api::EngineEvent::GateCalibrated => self.sound.hear_calibrated(),
            api::EngineEvent::Replay(replay) => self.sound.hear_replay(replay),
            api::EngineEvent::VoiceStats(stats) => self.sound.hear_stats(stats),
            api::EngineEvent::GifSupport(support) => {
                if self.gifs.noted_support(&support) {
                    self.tell(EngineEvent::StateChanged);
                }
            }
            api::EngineEvent::GifPage(page) => self.gifs.noted_page(page),
            api::EngineEvent::GifRefused(refused) => self.gifs.noted_refused(refused),
            // An answer for a peer of a share is taken here, on the
            // receive thread; what the view needs goes on.
            api::EngineEvent::WebRtcSignal(signal) => {
                if let Some(heard) = self.media.heard(signal) {
                    self.tell(EngineEvent::Share(heard));
                }
            }
            api::EngineEvent::DrawStroke(stroke) => {
                self.tell(EngineEvent::Share(crate::share::real::heard_stroke(stroke)));
            }
            // The engine API may grow events this view does not draw yet.
            _ => {}
        }
    }

    /// Ask what the server allows of voice messages; a server that predates
    /// them never answers, which reads as no.
    fn ask_for_voice_support(self: &Arc<Self>, runtime: &tokio::runtime::Handle) {
        let shared = Arc::clone(self);
        drop(runtime.spawn(async move {
            let _ = shared.engine.request_voice_support().await;
        }));
    }

    /// The connection was lost, not ended: try again after a pause that
    /// grows with each attempt, for as long as the user still wants to be
    /// on that server.
    fn reconnect_later(self: &Arc<Self>, runtime: &tokio::runtime::Handle) {
        let attempt = self
            .retries
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let pause = retry_pause(attempt);
        let waited = Retry {
            attempt: attempt.saturating_add(1),
            at: std::time::Instant::now() + pause,
        };
        self.set_retry(Some(waited));
        let shared = Arc::clone(self);
        drop(runtime.spawn(async move {
            tokio::time::sleep(pause).await;
            // Made at once meanwhile, or given up: no longer this one's.
            if shared.retry() == Some(waited) {
                shared.try_again().await;
            }
        }));
    }

    /// The retry that is waited for.
    fn retry(&self) -> Option<Retry> {
        *self.retry.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn set_retry(&self, retry: Option<Retry>) {
        *self.retry.lock().unwrap_or_else(PoisonError::into_inner) = retry;
    }

    /// Connect again as the user last did, if they still want to be on
    /// that server and are not.
    async fn try_again(self: Arc<Self>) {
        let wanted = self
            .wanted
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        let Some((id, password)) = wanted else {
            return;
        };
        if self.engine.connection() != api::Connection::Disconnected {
            return;
        }
        let Some(server) = self
            .servers
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .find(|saved| saved.id == id)
            .cloned()
        else {
            return;
        };
        // The attempt is under way: what is waited for now is its answer.
        if let Some(retry) = self
            .retry
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_mut()
        {
            retry.at = std::time::Instant::now();
        }
        self.tell(EngineEvent::StateChanged);
        let _ = self.engine.connect(target_of(&server, password)).await;
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
        // A run that must stay silent touches no audio device at all.
        if crate::voice::silent() {
            api::audio::keep_silent();
        }
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
                // What is put away out of memory stays with this
                // client's own files, not in a folder shared with others.
                cache: Some(data_dir.join("cache")),
            },
            runtime.handle().clone(),
            move |event| {
                if let Some(shared) = for_engine.get() {
                    shared.forward(&handle, event);
                }
            },
        );
        let media = Arc::new(crate::share::real::RealMedia::new(
            engine.clone(),
            runtime.handle().clone(),
            events.clone(),
        ));
        let gifs =
            crate::gif::server::ServerGifs::new(Arc::new(engine.clone()), runtime.handle().clone());
        let shared = Arc::new(Shared {
            media,
            gifs,
            engine,
            events,
            servers: Mutex::new(store.servers()),
            pings: Mutex::default(),
            liveries: crate::livery::Ledger::default(),
            first_read: Mutex::default(),
            light: Mutex::default(),
            avatars: Mutex::default(),
            reactions: Mutex::default(),
            typed_at: Mutex::default(),
            readers_asked: Mutex::default(),
            whisper_target: Mutex::default(),
            acl: Mutex::default(),
            roles: Mutex::default(),
            roles_asked: Mutex::default(),
            directory_asked: Mutex::default(),
            pins: Mutex::default(),
            polls: Mutex::default(),
            wanted: Mutex::default(),
            retries: std::sync::atomic::AtomicU32::new(0),
            retry: Mutex::default(),
            stay_disconnected: std::sync::atomic::AtomicBool::new(false),
            refused: std::sync::atomic::AtomicBool::new(false),
            store,
            voice: Arc::default(),
            sound: Arc::default(),
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

    /// Run `send`, which says something in `conversation`, and then have the
    /// view read the conversation again. The engine announces what others
    /// say; what the local user said it keeps without a word, and a view
    /// that waited for the next thing to happen would show it only then.
    fn say(
        &self,
        conversation: Conversation,
        send: impl Future<Output = Result<(), String>> + Send + 'static,
    ) {
        let shared = Arc::clone(&self.shared);
        self.spawn(async move {
            send.await?;
            shared.tell(EngineEvent::NewMessage { conversation });
            Ok(())
        });
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
                    server_muted: user.muted_by_server,
                    server_deafened: user.deafened_by_server,
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
    /// Where the web client keeps its files on this computer, and what it
    /// holds that this client does not.
    fn to_carry(&self) -> Option<(std::path::PathBuf, crate::carry::New)> {
        let from = crate::paths::other_install()?;
        let held = api::carry::held_in(&from);
        let new = crate::carry::New::of(
            &held,
            &self.saved_servers(),
            &self.shared.engine.certificates(),
        );
        Some((from, new))
    }

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

    fn media(&self) -> Arc<dyn crate::share::Media> {
        self.shared.media.clone()
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
                connecting: session.connection == api::Connection::Connecting,
            })
            .collect();
        // The engine keeps them in no order; the rail is not to shuffle.
        sessions.sort_by(|a, b| (&a.name, &a.id).cmp(&(&b.name, &b.id)));
        if connection != Connection::Connected {
            return Snapshot {
                connection,
                sessions,
                retry: self.shared.retry(),
                ..Snapshot::disconnected()
            };
        }
        let unread_channels = engine.unread_channels();
        let listening = engine.listening();
        // Friend chats are not drawn in the tree; whoever sits in one is
        // shown in the root, where a client that cannot see the room puts
        // them too.
        let (channels, friend_chats): (Vec<_>, Vec<_>) = engine
            .channels()
            .into_iter()
            .partition(|channel| !channel.friend_chat);
        let mut users = self.users_with_avatars(engine.users());
        for user in &mut users {
            if friend_chats.iter().any(|chat| chat.id == user.channel) {
                user.channel = ROOT;
            }
        }
        Snapshot {
            connection,
            own_session: engine.own_session(),
            current_channel: engine.current_channel(),
            channels: channels
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
                    signal: channel.signal,
                    rights: crate::rights::Rights::new(channel.permissions),
                    restricted: channel.restricted,
                    temporary: channel.temporary,
                    max_users: channel.max_users,
                    private: channel.private,
                })
                .collect(),
            users,
            voice: match engine.voice() {
                api::Voice::Off => Voice::Off,
                api::Voice::On => Voice::On,
                api::Voice::Muted => Voice::Muted,
            },
            deafened: engine.deafened(),
            welcome: engine.welcome().map(Into::into),
            sessions,
            retry: None,
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

    fn pinged(&self, host: &str, port: u16) -> Option<crate::livery::Pinged> {
        self.shared.liveries.pinged(&format!("{host}:{port}"))
    }

    fn live_livery(&self, key: &str) -> Option<Arc<crate::livery::Livery>> {
        self.shared.liveries.live(key)
    }

    fn probe_livery(&self, host: &str, port: u16) {
        self.shared
            .probe_livery(self.runtime.handle(), host, port);
    }

    fn save_about(&self, save: crate::profile::Save) {
        self.shared.save_about(self.runtime.handle(), save);
    }

    fn fetch_page(&self, page: mumble_tauri_lib::engine_api::about::PageRef) {
        self.shared.fetch_page(self.runtime.handle(), page);
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
                let ping = EngineHandle::ping(&address.0, address.1).await;
                let key = format!("{}:{}", address.0, address.1);
                shared.liveries.heard(key, livery::pinged(&ping));
                let answer = answered(ping);
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
                // How far back it is among what is held: what has to be
                // shown to show it.
                let at = found.id.and_then(|id| {
                    let ids: Vec<Option<String>> = match conversation {
                        Conversation::Channel(channel) => self.shared.engine.messages(channel),
                        Conversation::Direct(session) => {
                            self.shared.engine.direct_messages(session)
                        }
                    }
                    .into_iter()
                    .map(|message| message.id)
                    .collect();
                    let place = ids.iter().position(|held| held.as_deref() == Some(&id))?;
                    Some((id.into(), ids.len() - place))
                });
                Some(Found {
                    text: found.text.into(),
                    about: format!("{} · {}", found.sender_name, found.place).into(),
                    conversation,
                    at,
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

    fn roles(&self) -> Vec<Role> {
        self.shared
            .roles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn signal_available(&self) -> bool {
        self.shared.engine.signal_available()
    }

    fn is_recording(&self) -> bool {
        self.shared.engine.is_recording()
    }

    fn record(&self, directory: Option<std::path::PathBuf>) {
        let engine = &self.shared.engine;
        let said = match directory {
            Some(directory) => engine
                .start_recording(&directory)
                .map(|file| format!("Recording to {}", file.display())),
            None => engine
                .stop_recording()
                .map(|file| format!("Recorded to {}", file.display())),
        };
        self.shared.tell(EngineEvent::Notice(Some(
            said.unwrap_or_else(|why| why).into(),
        )));
        self.shared.tell(EngineEvent::StateChanged);
    }

    fn request_scheduled(&self) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.request_scheduled().await });
    }

    fn picture_limit(&self) -> usize {
        self.shared.engine.picture_limit()
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

    fn directory(&self) {
        *self
            .shared
            .directory_asked
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(std::time::Instant::now());
        self.list(Listing::Registered);
    }

    fn account_picture(&self, account: u32) -> Option<Arc<gpui::Image>> {
        self.shared
            .engine
            .registered_avatar(account)
            .and_then(crate::picture::picture)
            .map(Arc::new)
    }

    fn put_directory_away(&self) {
        self.shared.engine.release_registered_avatars();
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
                CertificateTask::Create(label) => engine
                    .create_certificate(&label)
                    .map(|()| format!("Made the identity \u{201c}{label}\u{201d}.")),
            };
            shared.tell(EngineEvent::CertificatesChanged);
            shared.tell(EngineEvent::Notice(Some(
                said.unwrap_or_else(|problem| problem).into(),
            )));
        }));
    }

    fn recovery_phrase(&self, label: &str) -> Result<String, String> {
        self.shared.engine.recovery_phrase(label)
    }

    fn restore_phrase(&self, label: &str, phrase: &str) -> Result<(), String> {
        self.shared.engine.restore_recovery_phrase(label, phrase)
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
        self.connect_with_code(id, password, None);
    }

    fn connect_with_code(&self, id: &str, password: Option<String>, code: Option<String>) {
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
        self.shared.set_retry(None);
        let password = password.filter(|password| !password.is_empty());
        *self
            .shared
            .wanted
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some((id.to_owned(), password.clone()));
        let engine = self.shared.engine.clone();
        // The code goes with this attempt only: a retry would send a
        // spent one.
        let target = ConnectTarget {
            totp: code.filter(|code| !code.is_empty()),
            ..target_of(&server, password)
        };
        self.spawn(async move { engine.connect(target).await });
    }

    fn disconnect(&self) {
        // On purpose: nothing is to bring the connection back.
        *self
            .shared
            .wanted
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = None;
        // Given up while it was waited for: there is no session to end,
        // and nothing else would say so.
        if self
            .shared
            .retry
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
            .is_some()
        {
            self.shared.tell(EngineEvent::Notice(None));
            self.shared.tell(EngineEvent::StateChanged);
        }
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.disconnect().await });
    }

    fn carry_over(&self) -> Option<CarryOver> {
        self.to_carry()?.1.counted()
    }

    fn carry_now(&self) {
        let Some((from, new)) = self.to_carry() else {
            return;
        };
        let crate::carry::New {
            servers,
            certificates,
        } = new;
        // Who one is first: a server saved without its certificate would
        // arrive as a stranger.
        let taken = match self.shared.engine.take_certificates(&from, &certificates) {
            Ok(taken) => taken.len(),
            Err(reason) => {
                self.shared.tell(EngineEvent::Notice(Some(
                    format!("Not everything could be brought over: {reason}").into(),
                )));
                return;
            }
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_nanos());
        let brought = servers.len();
        self.edit_servers(|saved| {
            saved.extend(
                servers
                    .into_iter()
                    .enumerate()
                    .map(|(nth, server)| crate::carry::as_saved(server, nth, now)),
            );
        });
        self.refresh_pings();
        let counted = |count: usize, one: &str| match count {
            1 => format!("1 {one}"),
            more => format!("{more} {one}s"),
        };
        self.shared.tell(EngineEvent::Done(
            format!(
                "Brought over {} and {}.",
                counted(brought, "server"),
                counted(taken, "certificate")
            )
            .into(),
        ));
    }

    fn set_dual_path(&self, sending: bool) {
        self.shared.engine.set_dual_path(sending);
    }

    fn account_offered(&self) -> bool {
        self.shared.engine.account_offered()
    }

    fn account(&self) -> Option<crate::engine::AccountSettings> {
        self.shared.engine.account()
    }

    fn update_account(&self, action: crate::engine::AccountAction, password: Option<String>) {
        self.send_account(action, password);
    }

    fn offer_account(&self, password: Option<String>) {
        self.offer_link(password);
    }

    fn withdraw_offer(&self, device: String) {
        self.withdraw_link(device);
    }

    fn onboarding_offered(&self) -> bool {
        self.shared.engine.onboarding_offered()
    }

    fn onboarding_config(&self) -> Option<crate::engine::OnboardingConfig> {
        self.shared.engine.onboarding_config()
    }

    fn onboarding_response(&self) -> Option<crate::engine::OnboardingResponse> {
        self.shared.engine.onboarding_response()
    }

    fn request_onboarding_response(&self) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.request_onboarding_response().await });
    }

    fn submit_onboarding(&self, response: crate::engine::OnboardingResponse) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.submit_onboarding_response(response).await });
    }

    fn register_whisper(
        &self,
        slot: u8,
        reach: Option<mumble_tauri_lib::engine_api::whisper::WhisperReach>,
    ) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.register_whisper_slot(slot, reach).await });
    }

    fn whisper_slot(
        &self,
        slot: u8,
        reach: Option<mumble_tauri_lib::engine_api::whisper::WhisperReach>,
    ) {
        let engine = self.shared.engine.clone();
        self.spawn(async move {
            match reach {
                Some(reach) => engine.start_whisper_slot(slot, reach).await,
                None => engine.whisper_end().await,
            }
        });
    }

    fn find_user(&self, hash: Option<&str>, name: &str, session: Option<&str>) -> Option<(SharedString, u32)> {
        self.shared
            .engine
            .find_user(hash, name, session)
            .map(|(session, user)| (session.into(), user))
    }

    fn server_plugins(&self) -> Vec<crate::engine::ServerPlugin> {
        self.shared.engine.server_plugins()
    }

    fn signal_bridge(&self) -> Option<crate::engine::SignalBridge> {
        Some(mumble_tauri_lib::engine_api::plugins::signal_bridge())
    }

    fn set_reconnecting(&self, reconnecting: bool) {
        self.shared
            .stay_disconnected
            .store(!reconnecting, std::sync::atomic::Ordering::Relaxed);
        // Told to stop while one was waited for: that one is not made.
        if !reconnecting && self.shared.retry().is_some() {
            self.shared.set_retry(None);
            self.shared.tell(EngineEvent::StateChanged);
        }
    }

    fn retry_now(&self) {
        // Whoever was waiting finds the retry is no longer theirs.
        if self.shared.retry().is_none() {
            return;
        }
        let shared = Arc::clone(&self.shared);
        drop(self.runtime.spawn(shared.try_again()));
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
            .map(|message| self.shared.lightened(conversation, message))
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

    fn whole(&self, _: Conversation, id: &str) -> Option<String> {
        self.shared.engine.put_away_body(id).ok()
    }

    fn pins(&self, conversation: Conversation) -> Vec<Pin> {
        // Only a channel keeps what is pinned in it.
        let Conversation::Channel(channel) = conversation else {
            return Vec::new();
        };
        let listed = self
            .shared
            .pins
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let listed = listed.get(&channel).map_or(&[][..], Vec::as_slice);
        pins_of(listed, &self.shared.engine.messages(channel))
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
        self.say(conversation, async move {
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
        self.say(conversation, async move {
            match conversation {
                Conversation::Channel(channel) => engine.reply_text(channel, &to, &body).await,
                Conversation::Direct(session) => {
                    engine.reply_direct_text(session, &to, &body).await
                }
            }
        });
    }

    fn send_gif(
        &self,
        conversation: Conversation,
        url: SharedString,
        reply_to: Option<SharedString>,
    ) {
        let engine = self.shared.engine.clone();
        self.say(conversation, async move {
            let html = engine.picked_gif_html(&url, reply_to.as_ref().map(AsRef::as_ref));
            match conversation {
                Conversation::Channel(channel) => engine.send_html(channel, html).await,
                Conversation::Direct(session) => engine.send_direct_html(session, html).await,
            }
        });
    }

    fn gif_service(&self) -> Option<crate::gif::Service> {
        self.shared.gifs.service()
    }

    fn send_picture(&self, conversation: Conversation, file: Vec<u8>) {
        let engine = self.shared.engine.clone();
        let limit = engine.picture_limit();
        self.say(conversation, async move {
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

    fn file_sharing(&self) -> crate::engine::FileSharing {
        let sharing = self.shared.engine.file_sharing();
        crate::engine::FileSharing {
            by_link: sharing.by_link,
            expiring: sharing.expiring,
        }
    }

    fn send_pictures(&self, conversation: Conversation, files: Vec<Vec<u8>>) {
        let engine = self.shared.engine.clone();
        let limit = engine.picture_limit();
        self.say(conversation, async move {
            // Fitting is work, and not for the engine's own threads. Too many
            // for one message, they go a message each, as before.
            let htmls = tokio::task::spawn_blocking(move || {
                match crate::inline_album::message(&files, limit)? {
                    Some(html) => Ok(vec![html]),
                    None => files
                        .iter()
                        .map(|file| crate::picture::message_html(file, limit))
                        .collect::<Result<Vec<_>, String>>(),
                }
            })
            .await
            .map_err(|error| error.to_string())??;
            for html in htmls {
                match conversation {
                    Conversation::Channel(channel) => engine.send_html(channel, html).await?,
                    Conversation::Direct(session) => engine.send_direct_html(session, html).await?,
                }
            }
            Ok(())
        });
    }

    fn send_file(&self, conversation: Conversation, path: std::path::PathBuf) {
        let engine = self.shared.engine.clone();
        self.say(conversation, async move {
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

    fn share(
        &self,
        conversation: Conversation,
        text: String,
        files: Vec<std::path::PathBuf>,
        how: ShareAs,
    ) {
        let files = files
            .into_iter()
            .map(|path| (SharedString::default(), path))
            .collect();
        self.share_tracked(conversation, text, files, how);
    }

    fn share_tracked(
        &self,
        conversation: Conversation,
        text: String,
        files: Vec<(SharedString, std::path::PathBuf)>,
        how: ShareAs,
    ) {
        let engine = self.shared.engine.clone();
        let shared = Arc::clone(&self.shared);
        let ids: Vec<SharedString> = files
            .iter()
            .map(|(id, _)| id.clone())
            .filter(|id| !id.is_empty())
            .collect();
        self.say(conversation, async move {
            // What came of each file the view follows.
            let tell = |id: &SharedString, now: crate::engine::Uploaded| {
                shared.tell(EngineEvent::Upload { id: id.clone(), now });
            };
            let all_failed = |why: &str| {
                for id in &ids {
                    tell(id, crate::engine::Uploaded::Failed(why.to_owned().into()));
                }
            };
            let Conversation::Channel(channel) = conversation else {
                let why = "Files are shared in channels; a direct message takes pictures.";
                all_failed(why);
                return Err(why.into());
            };
            if !engine.fancy() {
                let why = "This server keeps no files; it takes pictures only.";
                all_failed(why);
                return Err(why.into());
            }
            // Measuring a picture and making its small copies is work,
            // and not for the engine's own threads.
            let full = how.full;
            let made = tokio::task::spawn_blocking(move || outgoing(&files, full))
                .await
                .map_err(|error| error.to_string())
                .and_then(|made| made);
            let made = match made {
                Ok(made) => made,
                Err(why) => {
                    all_failed(&why);
                    return Err(why);
                }
            };
            let went = engine
                .share_files(channel, &text, &made.files, &share_as(how))
                .await;
            // Whatever came of it, what was made for it is no longer needed.
            let _ = std::fs::remove_dir_all(&made.folder);
            let unsent = match went {
                Ok(unsent) => unsent,
                Err(why) => {
                    all_failed(&why);
                    return Err(why);
                }
            };
            for id in &ids {
                let now = match unsent.iter().find(|file| file.upload_id == id.as_ref()) {
                    Some(file) if file.why == api::CANCELLED => crate::engine::Uploaded::Cancelled,
                    Some(file) => crate::engine::Uploaded::Failed(file.why.clone().into()),
                    None => crate::engine::Uploaded::Done,
                };
                tell(id, now);
            }
            Ok(())
        });
    }

    fn cancel_upload(&self, id: SharedString) {
        let _ = self.shared.engine.cancel_upload(&id);
    }

    fn fetch_shared(&self, key: SharedString) {
        let shared = Arc::clone(&self.shared);
        self.spawn(async move {
            let picture = fetched(&shared.engine, &key).await;
            shared.tell(EngineEvent::Shared { key, picture });
            Ok(())
        });
    }

    fn voice_support(&self) -> Option<crate::voice::Support> {
        self.shared.voice.support()
    }

    fn recorder(&self) -> Box<dyn crate::voice::Recorder> {
        if crate::voice::silent() {
            return Box::new(crate::voice::tone_recorder::ToneRecorder::default());
        }
        Box::new(crate::voice::engine_recorder::EngineRecorder::new(
            self.shared.engine.clone(),
            self.runtime.handle().clone(),
            Arc::clone(&self.shared.voice),
        ))
    }

    fn voice_player(&self) -> Box<dyn crate::voice::Player> {
        Box::new(crate::voice::engine_player::EnginePlayer::new(
            self.shared.engine.clone(),
            self.runtime.handle().clone(),
            crate::voice::silent(),
        ))
    }

    fn send_voice(&self, conversation: Conversation, clip: crate::voice::Clip) {
        let engine = self.shared.engine.clone();
        let channel = self.shared.engine.current_channel();
        self.say(conversation, async move {
            let clip = crate::voice::engine_recorder::engine_clip(clip);
            // A direct message goes up to the channel the user is in.
            let (channel, direct) = match conversation {
                Conversation::Channel(channel) => (Some(channel), None),
                Conversation::Direct(session) => (channel, Some(session)),
            };
            let Some(channel) = channel else {
                let _ = engine.discard_voice_clip(&clip.path);
                return Err("Join a channel to send a voice message from.".to_owned());
            };
            engine.send_voice_message(channel, direct, &clip).await
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

    fn turn_voice_off(&self) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.turn_voice_off().await });
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

    fn typed(&self, text: &str) -> Vec<(std::ops::Range<usize>, Setting)> {
        typed(text)
    }

    fn source(&self, html: &str) -> String {
        source(html)
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
            let _ = shared.engine.request_voice_support().await;
            shared.gifs.ask_support();
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
                Action::MakeChannel(new) => engine.create_channel_as(new_channel(new)).await,
                Action::MoveEveryone { from, to } => engine.move_everyone(from, to).await,
                Action::Purge { channel, by } => shared.purge(channel, by).await,
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
                Action::SetBanner(image) => {
                    let held = match engine.own_session() {
                        Some(own) => engine.user_comment(own).await,
                        None => None,
                    };
                    let profile =
                        crate::profile::with_banner(held.as_deref().unwrap_or_default(), &image);
                    engine.set_profile(&profile).await
                }
                Action::PatchProfile(change) => {
                    let held = match engine.own_session() {
                        Some(own) => engine.user_comment(own).await,
                        None => None,
                    };
                    let profile =
                        crate::profile_fields::patched(held.as_deref().unwrap_or_default(), &change);
                    engine.set_profile(&profile).await
                }
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
                        devices: Vec::new(),
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
        crate::sound_check::settings::voice_of(&self.shared.engine.audio_settings())
    }

    fn set_voice_settings(&self, settings: VoiceSettings) {
        let mut audio = self.shared.engine.audio_settings();
        crate::sound_check::settings::apply(&mut audio, &settings);
        api::audio::set_legacy_backend(settings.legacy_backend);
        if let Err(reason) = self.shared.engine.set_audio_settings(audio) {
            self.shared.tell(EngineEvent::Notice(Some(reason.into())));
        }
    }

    fn tune_denoiser(&self, knobs: std::collections::BTreeMap<String, f32>) {
        let mut audio = self.shared.engine.audio_settings();
        audio.denoiser_params = knobs;
        if let Err(reason) = self.shared.engine.set_audio_settings(audio) {
            self.shared.tell(EngineEvent::Notice(Some(reason.into())));
        }
    }

    fn sound_check(&self) -> Box<dyn crate::sound_check::SoundCheck> {
        Box::new(crate::sound_check::engine_check::EngineCheck::new(
            self.shared.engine.clone(),
            Arc::clone(&self.shared.sound),
        ))
    }

    fn voice_stats(&self) -> Option<crate::sound_check::Stats> {
        self.shared.sound.stats()
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
        totp: None,
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

/// A message whose body was put away, as it is handed to the view: its
/// words and a mark where each picture was, and what it says in a line.
#[derive(Debug)]
struct Light {
    html: String,
    text: String,
}

impl Shared {
    /// `message` as the view is to hold it. One heavy with pictures has
    /// its body put away by the engine and is handed on without them; one
    /// put away before is handed on as it was then.
    fn lightened(
        &self,
        conversation: Conversation,
        mut message: api::MessageInfo,
    ) -> api::MessageInfo {
        let Some(id) = message.id.clone() else {
            return message;
        };
        let mut light = self.light.lock().unwrap_or_else(PoisonError::into_inner);
        if EngineHandle::is_put_away(&message.html) {
            // What stood in its place says nothing: the words come from
            // what was kept of it.
            if let Some(kept) = light.get(&id) {
                message.html.clone_from(&kept.html);
                message.text.clone_from(&kept.text);
            }
            return message;
        }
        if !crate::away::is_heavy(&message.html) {
            return message;
        }
        let put = match conversation {
            Conversation::Channel(channel) => self.engine.put_away(channel, &id),
            Conversation::Direct(session) => self.engine.put_away_direct(session, &id),
        };
        match put {
            Ok(()) => {
                message.html = crate::away::light(&message.html);
                let kept = Light {
                    html: message.html.clone(),
                    text: message.text.clone(),
                };
                let _ = light.insert(id, kept);
            }
            // Held whole, as before there was anywhere to put it.
            Err(error) => tracing::debug!(%error, "a heavy message was not put away"),
        }
        message
    }
}

/// How the engine is told to share, from how the view says it.
fn share_as(how: ShareAs) -> api::ShareAs {
    api::ShareAs {
        reach: match how.reach {
            Reach::Here => api::Reach::Here,
            Reach::Link => api::Reach::Link,
            Reach::Password(password) => api::Reach::Password(password),
        },
        lasts_secs: how.lasts.secs(),
    }
}

/// Files made ready to go up, and the folder what was made for them is in.
struct Made {
    files: Vec<api::ToShare>,
    folder: std::path::PathBuf,
}

/// Make `files` ready to go up: each picture measured and given a small
/// copy to stand in for it, and unless `full` a smaller one to go up in
/// its place where it is large. What is made is written beside nothing of
/// the user's: into a folder of its own, removed once the files are up.
fn outgoing(files: &[(SharedString, std::path::PathBuf)], full: bool) -> Result<Made, String> {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nth = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let folder = std::env::temp_dir().join(format!("fancy-gpui-up-{}-{nth}", std::process::id()));
    std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    let written = |name: String, bytes: &[u8]| -> Result<std::path::PathBuf, String> {
        let path = folder.join(name);
        std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
        Ok(path)
    };
    let mut made = Vec::with_capacity(files.len());
    for (at, (upload_id, path)) in files.iter().enumerate() {
        // Only what may be a picture is read here: anything else goes up
        // a piece at a time, however large it is.
        let picture = crate::picture::at(path)
            .map(|file| crate::picture::outgoing(&file, !full))
            .unwrap_or_default();
        let stem = path
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();
        let smaller = match &picture.smaller {
            // Under its own name, in a folder of its own: the name is what
            // its message will call it.
            Some(bytes) => {
                std::fs::create_dir_all(folder.join(at.to_string()))
                    .map_err(|error| error.to_string())?;
                Some(written(format!("{at}/{stem}.jpg"), bytes))
            }
            None => None,
        };
        let stand_in = match &picture.stand_in {
            Some(bytes) => Some(written(format!("{at}-small.jpg"), bytes)?),
            None => None,
        };
        made.push(api::ToShare {
            path: match smaller {
                Some(smaller) => smaller?,
                None => path.clone(),
            },
            stand_in,
            pixels: picture.pixels,
            legacy: picture.legacy,
            upload_id: upload_id.to_string(),
        });
    }
    Ok(Made {
        files: made,
        folder,
    })
}

/// The shared picture kept under `key`, fetched: by way of a file, which
/// is how the engine hands shared files over, read and removed at once.
async fn fetched(engine: &EngineHandle, key: &str) -> Option<Arc<gpui::Image>> {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nth = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let to = std::env::temp_dir().join(format!("fancy-gpui-down-{}-{nth}", std::process::id()));
    let fetched = engine.save_shared_file(key, &to).await;
    let bytes = fetched.ok().and_then(|_| std::fs::read(&to).ok());
    let _ = std::fs::remove_file(&to);
    crate::picture::picture(bytes?).map(Arc::new)
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
            // A server's plugin keeps a file under its link and nothing
            // else: the link is then what it is fetched by.
            key: file.key.or_else(|| file.url.clone()).map(Into::into),
            url: file.url.map(Into::into),
            open_to: match file.mode.as_deref() {
                Some("public") => OpenTo::Link,
                Some("password") => OpenTo::Password,
                _ => OpenTo::Here,
            },
            stand_in: file.thumb_key.map(Into::into),
            pixels: file.pixels,
            voice: file.voice.map(|note| crate::voice::Note {
                duration_ms: note.duration_ms,
                waveform: note.waveform.into(),
            }),
            expires_at: file.expires_at.filter(|at| *at > 0),
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
        kind: preview.kind.map(Into::into),
        picture_url: preview.picture_url.map(Into::into),
        icon: preview.icon.and_then(crate::picture::picture).map(Arc::new),
        details: crate::engine::PreviewDetails {
            picture_size: preview.picture_size,
            author: preview.author.map(Into::into),
            duration: preview.duration.map(Into::into),
            published: preview.published.map(Into::into),
            facts: preview
                .facts
                .into_iter()
                .map(|(name, value)| (name.into(), value.into()))
                .collect(),
            price: preview.price.map(|price| crate::engine::PreviewPrice {
                amount: price.amount.into(),
                currency: price.currency.into(),
                was: price.was.into(),
                availability: price.availability.into(),
            }),
        },
    }
}

/// A channel to be made, as the engine takes it: what was left empty is
/// left to the server.
fn new_channel(new: crate::engine::NewChannel) -> api::NewChannel {
    use crate::engine::Kept;
    let said = |text: String| Some(text).filter(|text| !text.trim().is_empty());
    api::NewChannel {
        parent: new.parent,
        name: new.name,
        description: said(new.about),
        password: said(new.password),
        max_users: new.most,
        position: new.position,
        temporary: new.temporary,
        hidden: new.hidden,
        history: match new.kept {
            Kept::No => api::History::None,
            Kept::OnServer => api::History::OnServer,
            Kept::Sealed => api::History::EndToEnd,
            Kept::Signal => api::History::Signal,
        },
    }
}

fn ban_of(ban: api::BanInfo) -> Ban {
    Ban {
        mask: crate::bans::bits_from_wire(&ban.address, ban.mask),
        address: ban.address.into(),
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
        mask: crate::bans::bits_to_wire(&ban.address, ban.mask),
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
        picture: user.picture,
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

/// Put `pin` among a channel's, or with `pinned` false take it out.
fn note_pin(channel: &mut Vec<api::PinInfo>, pin: api::PinInfo, pinned: bool) {
    channel.retain(|known| known.message != pin.message);
    if pinned {
        channel.push(pin);
    }
}

/// What is pinned in a channel: what the server `listed`, and whatever
/// else the `held` messages (oldest first) say is pinned. Each with its
/// message, where that is held. The pin put on last comes first.
fn pins_of(listed: &[api::PinInfo], held: &[api::MessageInfo]) -> Vec<Pin> {
    let said = |id: &str| {
        let at = held
            .iter()
            .position(|message| message.id.as_deref() == Some(id))?;
        let message = &held[at];
        Some(Pinned {
            sender_name: message.sender_name.clone().into(),
            text: message.text.clone().into(),
            sent_at_ms: message.sent_at_ms,
            from_newest: held.len() - at,
        })
    };
    let mut pins: Vec<Pin> = listed
        .iter()
        .map(|pin| Pin {
            id: pin.message.clone().into(),
            by: (!pin.by.is_empty()).then(|| pin.by.clone().into()),
            at_ms: (pin.at_ms > 0).then_some(pin.at_ms),
            said: said(&pin.message),
        })
        .collect();
    // Pinned while this client was not listening for the list.
    for message in held.iter().filter(|message| message.pinned) {
        let Some(id) = message.id.as_deref() else {
            continue;
        };
        if !pins.iter().any(|pin| pin.id.as_ref() == id) {
            pins.push(Pin {
                id: id.to_owned().into(),
                by: None,
                at_ms: message.pinned_at_ms,
                said: said(id),
            });
        }
    }
    pins.sort_by_key(|pin| std::cmp::Reverse(pin.at_ms));
    pins
}

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
/// connection: two seconds, doubling, at most thirty. There is no last
/// attempt: a server that is down for an evening is come back to when it
/// is up, and what ends the trying is the user leaving.
fn retry_pause(attempt: u32) -> std::time::Duration {
    std::time::Duration::from_secs((2u64 << attempt.min(4)).min(30))
}

/// What to tell the user when a session ends: the engine's reason, unless
/// the server had just refused the connection and said why.
fn disconnect_notice(reason: Option<String>, refused: bool) -> Option<String> {
    reason.filter(|_| !refused)
}

/// Unix epoch milliseconds, now.
/// The permission to write a channel's rules, as Mumble numbers it.
const WRITE: u32 = 0x1;

/// The permissions to read the registered accounts, as Mumble numbers
/// them: an administrator's, and the lookup every registered user has.
const REGISTER: u32 = 0x4_0000;
const READ_REGISTER: u32 = 0x80_0000;

/// How long after asking for the roles an answer is taken to be to that.
const ROLES_ANSWER_WITHIN: std::time::Duration = std::time::Duration::from_secs(5);

/// The channel every server has, at the top of its tree.
const ROOT: u32 = 0;

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

    /// The whole way: another install's directory is read, its certificate
    /// and servers arrive here, and a second look finds nothing left. The
    /// other install is made for the test; the user's own is never read.
    #[test]
    #[allow(unsafe_code, reason = "`std::env::set_var` is unsafe in Rust 2024")]
    fn what_another_install_holds_is_brought_over_once() {
        let scratch = std::env::temp_dir().join(format!("fancy-gpui-carry-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&scratch);
        let (other, here) = (scratch.join("other"), scratch.join("here"));
        // The other install: a certificate under its label, and its store
        // of saved servers.
        let identity = other.join("identities").join("sebi");
        std::fs::create_dir_all(&identity).expect("the other install is made");
        for (name, text) in [
            ("tls.cert.pem", "a certificate"),
            ("tls.key.pem", "its key"),
        ] {
            std::fs::write(identity.join(name), text).expect("the identity is written");
        }
        std::fs::write(
            other.join("servers.json"),
            r#"{"servers":[{"id":"1","label":"Home","host":"magical.example","port":64738,
                "username":"Sebi","cert_label":"sebi","favorite":true}]}"#,
        )
        .expect("the store is written");
        // SAFETY: no other test of this binary reads this variable.
        unsafe { std::env::set_var("FANCY_GPUI_IMPORT_FROM", &other) };
        let engine = RealEngine::start(&here).expect("the engine starts");
        assert_eq!(
            engine.carry_over(),
            Some(CarryOver {
                servers: 1,
                certificates: 1
            })
        );
        engine.carry_now();
        let saved = engine.saved_servers();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].label.as_ref(), "Home");
        assert_eq!(
            saved[0].certificate.as_ref().map(AsRef::as_ref),
            Some("sebi")
        );
        assert_eq!(engine.certificates(), ["sebi"]);
        let key = here.join("identities").join("sebi").join("tls.key.pem");
        assert_eq!(
            std::fs::read_to_string(key).ok().as_deref(),
            Some("its key")
        );
        assert!(identity.join("tls.key.pem").exists(), "copied, not moved");
        assert_eq!(engine.carry_over(), None, "nothing left to bring");
        // Kept across a restart, as any saved server is.
        engine.shutdown();
        let again = RealEngine::start(&here).expect("the engine starts again");
        assert_eq!(again.saved_servers().len(), 1);
        again.shutdown();
        unsafe { std::env::remove_var("FANCY_GPUI_IMPORT_FROM") };
        let _ = std::fs::remove_dir_all(scratch);
    }

    #[test]
    fn what_is_pinned_is_the_servers_list_and_what_the_messages_say() {
        let message = |id: &str, pinned: bool| api::MessageInfo {
            sender: Some(3),
            sender_name: "Rin".to_owned(),
            text: format!("said {id}"),
            html: String::new(),
            sent_at_ms: Some(10),
            own: false,
            id: Some(id.to_owned()),
            edited: false,
            pinned,
            pinned_at_ms: pinned.then_some(50),
            failed: false,
        };
        let pin = |id: &str, at_ms| api::PinInfo {
            message: id.to_owned(),
            by: "Alex".to_owned(),
            at_ms,
        };
        let held = [message("a", false), message("b", true), message("c", true)];
        // The server listed one that is held and one too far back to be;
        // "c" was pinned without the list saying so.
        let pins = pins_of(&[pin("b", 70), pin("old", 20)], &held);
        let ids: Vec<_> = pins.iter().map(|pin| pin.id.as_ref()).collect();
        assert_eq!(ids, ["b", "c", "old"], "the pin put on last comes first");
        assert_eq!(pins[0].by.as_ref().map(AsRef::as_ref), Some("Alex"));
        let said = pins[0].said.as_ref().expect("held");
        assert_eq!((said.text.as_ref(), said.from_newest), ("said b", 2));
        assert_eq!(pins[1].by, None, "nobody said who");
        assert!(pins[2].said.is_none(), "further back than what is held");
        // A pin taken off is off the list.
        let mut listed = vec![pin("b", 70)];
        note_pin(&mut listed, pin("b", 90), false);
        assert!(listed.is_empty());
    }

    #[test]
    fn retries_back_off_and_never_give_up() {
        let seconds = |attempt| retry_pause(attempt).as_secs();
        assert_eq!(seconds(0), 2);
        assert_eq!(seconds(1), 4);
        assert_eq!(seconds(2), 8);
        assert_eq!(seconds(3), 16);
        assert_eq!(seconds(4), 30, "held at thirty");
        assert_eq!(seconds(10), 30, "for as long as the server is wanted");
        assert_eq!(seconds(u32::MAX), 30);
    }

    #[test]
    fn a_server_that_is_down_has_no_ping_to_show() {
        let down = PingInfo {
            online: false,
            latency_ms: None,
            users: None,
            max_users: None,
            version: None,
            livery_digest: None,
        };
        assert!(answered(down).is_none());
        let up = answered(PingInfo {
            online: true,
            latency_ms: Some(18),
            users: Some(3),
            max_users: Some(101),
            version: Some("1.6.0".to_owned()),
            livery_digest: Some(String::new()),
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
        let told = painter.events();
        while told.try_recv().is_ok() {}
        painter.send_picture(room, jpeg.clone());
        // Nobody else announces what the painter said: it is told to read
        // again itself, and by then the picture is among its messages.
        let shows = |engine: &RealEngine| {
            engine
                .messages(room)
                .iter()
                .any(|message| crate::rich::Rich::parse(&message.html).images == [jpeg.clone()])
        };
        wait_for("the painter to be told of its own picture", || {
            std::iter::from_fn(|| told.try_recv().ok()).any(|event| {
                matches!(event, EngineEvent::NewMessage { conversation } if conversation == room)
                    && shows(&painter)
            })
        });
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

    /// The picture of somebody with an account is seen by who is there and
    /// by who comes later. On Starling 0.2.20 it is the only kind that is: a
    /// guest's picture is announced there too, but the request for it is
    /// answered from accounts alone
    /// (`live_a_picture_set_by_one_is_seen_by_the_other` shows that).
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_the_picture_of_somebody_registered_is_seen_by_the_others() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let (painter, painter_dir) = fancy_client("PicKept", None);
        wait_for("both to connect", || {
            admin.snapshot().users.len() >= 2 && painter.snapshot().users.len() >= 2
        });
        let _ = registered(&admin, "PicKept");
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode_image(&image::RgbImage::from_pixel(
                8,
                8,
                image::Rgb([40, 40, 200]),
            ))
            .expect("a jpeg");
        painter.act(Action::SetAvatar(jpeg));
        let has_it = |engine: &RealEngine| {
            let users = engine.snapshot().users;
            users
                .iter()
                .any(|user| user.name.as_ref() == "PicKept" && user.avatar.is_some())
        };
        wait_for("the administrator to have the picture", || has_it(&admin));
        let (late, late_dir) = fancy_client("PicLate", None);
        wait_for("somebody who comes later to have it too", || has_it(&late));
        for (engine, dir) in [
            (admin, admin_dir),
            (painter, painter_dir),
            (late, late_dir),
        ] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// A profile of the older format is converted by its owner and saved;
    /// somebody else then reads it in the new format, and what follows the
    /// profile's mark is plain HTML for any other client. The owner is
    /// registered, as a guest's long comment is not served on Starling.
    /// With `FANCY_GPUI_TEST_FILES=1` (the server's file store reachable at
    /// the address it gives out) the full pictures are kept there too, and
    /// the reader opens the full profile.
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_a_profile_is_converted_and_read_in_the_new_format() {
        use mumble_tauri_lib::engine_api::about::{Limits, Migration, Written};
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let files = std::env::var("FANCY_GPUI_TEST_FILES").is_ok_and(|on| on == "1");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let (owner, owner_dir) = fancy_client("AboutOwner", None);
        let (reader, reader_dir) = fancy_client("AboutReader", None);
        wait_for("all three to connect", || {
            [&admin, &owner, &reader]
                .iter()
                .all(|engine| engine.snapshot().users.len() >= 3)
        });
        let _ = registered(&admin, "AboutOwner");
        let session = owner.snapshot().own_session.expect("the owner's session");
        let older = older_profile();
        owner
            .runtime
            .block_on(owner.shared.engine.set_written_comment(&older))
            .expect("the older profile written");
        let told = reader.events();
        let read_by = |engine: &RealEngine, told: &async_channel::Receiver<EngineEvent>, wanted: &str| {
            comment_read(engine, told, session, wanted)
        };
        let before = read_by(&reader, &told, "data:image");
        assert!(crate::profile::Said::of(&before).0.is_older(), "the older format");

        // The owner converts, from their own comment as the server holds it.
        let own_told = owner.events();
        let own = read_by(&owner, &own_told, "data:image");
        let mut migration = Migration::read(&own);
        migration.thumbnail(Limits::CARD.thumbs);
        let keep = if files {
            migration
                .embedded
                .iter()
                .enumerate()
                .map(|(at, picture)| (at, Arc::new(picture.bytes.clone())))
                .collect()
        } else {
            Vec::new()
        };
        owner.save_about(crate::profile::Save {
            about: migration.card(),
            keep,
            full_text: None,
            page: None,
            titles: ("About".into(), "Pictures".into()),
        });
        wait_for("the conversion to be saved", || {
            std::iter::from_fn(|| own_told.try_recv().ok()).any(|event| match event {
                EngineEvent::AboutSaved(saved) => {
                    assert!(saved.is_ok(), "saved: {saved:?}");
                    true
                }
                _ => false,
            })
        });

        // Somebody else reads it in the new format, thumbnails and all.
        let after = read_by(&reader, &told, "\"about\"");
        let written = Written::read(&after);
        read_in_the_new_format(&written);
        if files {
            let page = written.page().expect("a full profile");
            reader.fetch_page(page);
            wait_for("the full profile", || {
                std::iter::from_fn(|| told.try_recv().ok()).any(|event| {
                    matches!(event, EngineEvent::ProfilePage { page: Ok(page), .. }
                        if !page.sections.is_empty())
                })
            });
        }
        for (engine, dir) in [
            (admin, admin_dir),
            (owner, owner_dir),
            (reader, reader_dir),
        ] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// The profile of the older format the conversion test starts from: its
    /// words, a list, a link, and the same picture twice, pasted in whole.
    fn older_profile() -> String {
        let mut picture = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut picture)
            .encode_image(&image::RgbImage::from_fn(240, 160, |x, y| {
                image::Rgb([(x % 256) as u8, (y % 256) as u8, 120])
            }))
            .expect("a jpeg");
        let address = crate::picture::data_uri(&picture).expect("an address");
        format!(
            concat!(
                r#"<!--FANCY:{{"v":1,"status":"Testing"}}-->"#,
                r#"<p style="text-align:center"><strong>Hello World!</strong></p>"#,
                r#"<p style="text-align:center"><a href="https://example.org/x">A link</a></p>"#,
                r#"<p style="text-align:center"><strong>Quotes</strong></p>"#,
                r#"<ul><li>Make the world more exciting</li><li>うるさい</li></ul>"#,
                r#"<p><img src="{0}"><img src="{0}"></p>"#,
            ),
            address
        )
    }

    /// `session`'s comment as `engine` reads it, once it holds `wanted`:
    /// asked for again until it does.
    fn comment_read(
        engine: &RealEngine,
        told: &async_channel::Receiver<EngineEvent>,
        session: u32,
        wanted: &str,
    ) -> String {
        let mut held = None;
        wait_for(wanted, || {
            engine.about(Subject::User(session));
            std::thread::sleep(std::time::Duration::from_millis(300));
            held = std::iter::from_fn(|| told.try_recv().ok()).find_map(|event| match event {
                EngineEvent::About {
                    subject,
                    html: Some(html),
                } if subject == Subject::User(session) && html.contains(wanted) => {
                    Some(html.to_string())
                }
                _ => None,
            });
            held.is_some()
        });
        held.expect("the comment")
    }

    /// The converted profile as somebody else reads it: the about with its
    /// two thumbnails and its status, and for a plain client sensible HTML
    /// (the words, a list as lines, a link, and no picture at all).
    fn read_in_the_new_format(written: &mumble_tauri_lib::engine_api::about::Written) {
        let about = written.about().expect("an about");
        assert_eq!(about.pictures().count(), 2);
        assert!(about.pictures().all(|picture| picture.thumb_weight().is_some()));
        assert_eq!(written.profile.as_ref().map(|p| p["status"].clone()), Some("Testing".into()));
        let plain = &written.html;
        assert!(plain.contains("<strong>Hello World!</strong>"), "{plain}");
        assert!(plain.contains(r#"<a href="https://example.org/x">A link</a>"#));
        assert!(!plain.contains("<img") && !plain.contains("data:"));
        assert_eq!(
            crate::rich::Rich::parse(plain).text,
            "Hello World!\nA link\nQuotes\n\u{2022} Make the world more exciting\n\u{2022} うるさい"
        );
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
    /// Take `channel` away again and leave `admin` at the root: an account is put back where it last was, and the next
    /// test to connect as it should not start in a channel that is gone.
    fn clear_away(admin: &RealEngine, channel: ChannelId) {
        let root = admin
            .snapshot()
            .channels
            .iter()
            .find(|known| known.parent.is_none())
            .map_or(0, |known| known.id);
        admin.join_channel(root);
        wait_for("the admin to be back at the root", || {
            admin.snapshot().current_channel == Some(root)
        });
        admin.act(Action::DeleteChannel { channel });
        // Time for the server to do it. The one who deletes a channel from
        // outside it has been seen not to be told it is gone, so this
        // waits for the clock and not for the channel to leave the tree.
        std::thread::sleep(std::time::Duration::from_secs(1));
    }

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
        // Longer than anything takes: the throwaway server built from the
        // source of August 2026 answers nobody for about fifteen seconds
        // after somebody connects, and then everybody at once.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
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
        // `FANCY_GPUI_TEST_LOGS=<folder>` keeps what the engines say there,
        // for a test that fails without saying why.
        static LOGGED: std::sync::Once = std::sync::Once::new();
        if let Ok(logs) = std::env::var("FANCY_GPUI_TEST_LOGS") {
            LOGGED.call_once(|| start_logs(std::path::Path::new(&logs), Some("debug")));
        }
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
                    EngineEvent::Facts { subject, facts, .. }
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
                    EngineEvent::Facts { subject: Subject::Server, facts, .. }
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
        admin.act(Action::MakeChannel(crate::engine::NewChannel {
            parent: root,
            name: name.clone(),
            kept: crate::engine::Kept::OnServer,
            ..crate::engine::NewChannel::default()
        }));
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
        // It is on the list of what is pinned there, with who pinned it, as
        // the server says (Starling from 0.2.21 stamps it; before, absent).
        let listed = alice.pins(room);
        assert_eq!(listed.len(), 1, "{listed:?}");
        let by = listed[0].by.as_ref().map(AsRef::as_ref);
        assert_eq!(by, Some("SuperUser"), "{by:?}");
        let text = listed[0].said.as_ref().map(|said| said.text.to_string());
        assert_eq!(text.as_deref(), Some("to be kept"));

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

    /// Whoever comes later is told what is pinned in a channel that keeps
    /// its messages. Starling 0.2.20 does not do this: it passes a pin on
    /// to who is there and keeps none, so this fails there at the last
    /// wait.
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_a_pin_is_told_to_who_comes_later() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        wait_for("the administrator to connect", || {
            admin.snapshot().connection == Connection::Connected
        });
        let name = format!("pinned-{}", std::process::id());
        let root = admin.snapshot().current_channel.expect("the root");
        admin.act(Action::MakeChannel(crate::engine::NewChannel {
            parent: root,
            name: name.clone(),
            kept: crate::engine::Kept::OnServer,
            ..crate::engine::NewChannel::default()
        }));
        let kept = |engine: &RealEngine| {
            let channels = engine.snapshot().channels;
            channels
                .into_iter()
                .find(|channel| channel.name.as_ref() == name)
                .map(|channel| channel.id)
        };
        wait_for("the channel", || kept(&admin).is_some());
        let channel = kept(&admin).expect("the channel");
        let room = Conversation::Channel(channel);
        admin.join_channel(channel);
        wait_for("the administrator to be in it", || {
            admin.snapshot().current_channel == Some(channel)
        });
        admin.send_message(room, "worth keeping".to_owned());
        wait_for("the message to have its id", || {
            said(&admin, room, "worth keeping").is_some_and(|message| message.id.is_some())
        });
        let id = said(&admin, room, "worth keeping")
            .and_then(|message| message.id)
            .expect("an id")
            .to_string();
        admin.act(Action::Pin {
            channel,
            id,
            pinned: true,
        });
        wait_for("the pin to take", || admin.pins(room).len() == 1);

        let (late, late_dir) = fancy_client("PinLate", None);
        wait_for("the latecomer to connect", || kept(&late).is_some());
        late.join_channel(channel);
        late.open(room);
        wait_for("the latecomer to read the history", || {
            said(&late, room, "worth keeping").is_some()
        });
        wait_for("the latecomer to be told of the pin", || {
            late.pins(room).len() == 1
        });
        for (engine, dir) in [(admin, admin_dir), (late, late_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    /// A server that goes away is waited for, and come back to when it
    /// is there again; giving up meanwhile ends the waiting.
    ///
    /// The server has to be a Docker container this test may stop and
    /// start: `FANCY_GPUI_TEST_CONTAINER` names it.
    #[test]
    #[ignore = "stops and starts the server's container; set FANCY_GPUI_TEST_CONTAINER"]
    fn live_fancy_a_lost_connection_is_waited_for_and_comes_back() {
        let container =
            std::env::var("FANCY_GPUI_TEST_CONTAINER").expect("FANCY_GPUI_TEST_CONTAINER");
        let docker = |verb: &str| {
            let done = std::process::Command::new("docker")
                .args([verb, &container])
                .output()
                .expect("docker runs");
            assert!(done.status.success(), "docker {verb}: {done:?}");
        };
        let (alice, dir) = fancy_client("RetryAlice", None);
        let connection = || alice.snapshot().connection;
        wait_for("alice to connect", || connection() == Connection::Connected);
        docker("stop");
        wait_for("the retry to be waited for", || {
            alice.snapshot().retry.is_some()
        });
        assert_ne!(connection(), Connection::Connected);
        let first = alice.snapshot().retry.expect("a retry").attempt;
        docker("start");
        wait_for("alice to be back", || connection() == Connection::Connected);
        assert!(alice.snapshot().retry.is_none(), "nothing left to wait for");
        // Gone again, and this time not wanted back.
        docker("stop");
        wait_for("the next retry", || alice.snapshot().retry.is_some());
        assert_eq!(
            alice.snapshot().retry.expect("a retry").attempt,
            first,
            "counted from the last time it was up"
        );
        alice.disconnect();
        wait_for("the waiting to end", || alice.snapshot().retry.is_none());
        docker("start");
        std::thread::sleep(std::time::Duration::from_secs(6));
        assert_eq!(
            connection(),
            Connection::Disconnected,
            "given up is given up"
        );
        alice.shutdown();
        let _ = std::fs::remove_dir_all(dir);
    }
    /// An engine that is on no server: what the live Fancy server's ping
    /// says of its livery, once it has come back.
    fn livery_pinged() -> (RealEngine, std::path::PathBuf, String, u16, Option<String>) {
        let address = std::env::var("FANCY_GPUI_TEST_FANCY").expect("FANCY_GPUI_TEST_FANCY");
        let (host, port) = address.rsplit_once(':').expect("host:port");
        let port: u16 = port.parse().expect("a port");
        let dir = std::env::temp_dir().join(format!("fancy-gpui-livery-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let engine = RealEngine::start(&dir).expect("the engine starts");
        engine.save_server(SavedServer {
            id: "looked-at".into(),
            label: "looked at".into(),
            host: host.to_owned().into(),
            port,
            username: "Onlooker".into(),
            certificate: None,
            favorite: false,
        });
        engine.refresh_pings();
        wait_for("the ping", || engine.pinged(host, port).is_some());
        let Some(crate::livery::Pinged::Up { digest }) = engine.pinged(host, port) else {
            panic!("the server is down");
        };
        (engine, dir, host.to_owned(), port, digest.map(|digest| digest.to_string()))
    }

    /// What `engine` was told when it asked the server at `key` for its
    /// livery.
    fn probed(engine: &RealEngine, key: &str) -> Option<Arc<crate::livery::Livery>> {
        let heard = engine.events();
        let mut answer = None;
        wait_for("the server to answer the probe", || {
            for event in std::iter::from_fn(|| heard.try_recv().ok()) {
                if let EngineEvent::LiveryProbed { key: of, livery } = event
                    && of.as_ref() == key
                {
                    answer = Some(livery);
                }
            }
            answer.is_some()
        });
        answer.flatten()
    }

    /// The livery of the live Fancy server as a client that joins it is
    /// told it, once it has all its pictures; with the digest its ping says.
    fn livery_told(digest: &str, key: &str) -> (RealEngine, std::path::PathBuf, Arc<crate::livery::Livery>) {
        let (guest, dir) = fancy_client("LiveryGuest", None);
        wait_for("the livery of the server joined", || {
            guest.live_livery(key).is_some_and(|livery| {
                livery.digest.as_ref() == digest && livery.banner.is_some() && livery.icon.is_some()
            })
        });
        let told = guest.live_livery(key).expect("told");
        (guest, dir, told)
    }

    /// A server with a livery tells it to a client that joins, under the
    /// digest its ping carries. The server must have a livery with a banner
    /// and an icon: its operator sets them (Starling's operator API,
    /// `POST /v1/livery`, `PUT /v1/livery/banner` and `/icon`).
    #[test]
    #[ignore = "needs a live Fancy server with a livery; set FANCY_GPUI_TEST_FANCY=host:port"]
    fn live_fancy_a_livery_is_told_on_joining_under_the_pings_digest() {
        let (onlooker, onlooker_dir, host, port, digest) = livery_pinged();
        let digest = digest.expect("a Fancy server says whether it has a livery");
        assert!(!digest.is_empty(), "the server has a livery");
        let (guest, guest_dir, told) = livery_told(&digest, &format!("{host}:{port}"));
        assert!(told.name.is_some(), "its name: {told:?}");
        for (engine, dir) in [(onlooker, onlooker_dir), (guest, guest_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// A server with a livery is asked for it without joining, and the
    /// answer is the livery a client that joins is told.
    #[test]
    #[ignore = "needs a live Fancy server with a livery; set FANCY_GPUI_TEST_FANCY=host:port"]
    fn live_fancy_a_livery_is_asked_for_without_joining() {
        let (onlooker, onlooker_dir, host, port, digest) = livery_pinged();
        let key = format!("{host}:{port}");
        let digest = digest.expect("a Fancy server says whether it has a livery");
        assert!(!digest.is_empty(), "the server has a livery");
        onlooker.probe_livery(&host, port);
        let asked = probed(&onlooker, &key);
        assert!(
            onlooker.snapshot().sessions.is_empty(),
            "asking joined nothing"
        );
        let asked = asked.expect("the livery, asked without joining");
        assert_eq!(asked.digest.as_ref(), digest, "the one the ping vouches for");
        let (guest, guest_dir, told) = livery_told(&digest, &key);
        assert_eq!(*told, *asked, "the same livery, pictures and all");
        for (engine, dir) in [(onlooker, onlooker_dir), (guest, guest_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// A Fancy server with no livery says so in its ping, and has none to
    /// give when asked.
    #[test]
    #[ignore = "needs a live Fancy server with no livery; set FANCY_GPUI_TEST_FANCY=host:port"]
    fn live_fancy_a_server_without_a_livery_says_so() {
        let (onlooker, dir, host, port, digest) = livery_pinged();
        assert_eq!(digest.as_deref(), Some(""), "an empty digest: none");
        onlooker.probe_livery(&host, port);
        let asked = probed(&onlooker, &format!("{host}:{port}"));
        assert!(
            asked
                .as_ref()
                .is_none_or(|livery| livery.digest.is_empty() && livery.banner.is_none()),
            "nothing to draw: {asked:?}"
        );
        onlooker.shutdown();
        let _ = std::fs::remove_dir_all(dir);
    }

    /// What the server allows arrives with the channels: somebody who
    /// just walked in is told what they may do at the root, and it is not
    /// what an administrator may.
    #[test]
    #[ignore = "needs a live Fancy server; set FANCY_GPUI_TEST_FANCY=host:port"]
    fn live_fancy_a_guest_is_told_what_they_may_do() {
        use crate::rights::Right;
        let (guest, dir) = fancy_client("RightsGuest", None);
        let root = || {
            guest
                .snapshot()
                .channels
                .into_iter()
                .find(|channel| channel.parent.is_none())
                .map(|channel| channel.rights)
                .unwrap_or_default()
        };
        // Known once anything at all is answered: `may` is true of
        // everything until then, and of nothing a guest lacks after.
        wait_for("the root's rights", || !root().may(Right::KICK));
        assert!(!root().has(Right::WRITE) && !root().has(Right::BAN));
        assert!(root().has(Right::SELF_REGISTER) || !root().has(Right::REGISTER));
        guest.shutdown();
        let _ = std::fs::remove_dir_all(dir);
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
    /// A ban added by hand is on the address it names and no other. The
    /// wire counts an IPv4 address's bits behind ninety-six more; the same
    /// ban sent with the short count would turn every IPv4 address away,
    /// and a server refuses it, with words. A ban on somebody connected
    /// sends them off, and keeps them off.
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_a_ban_added_by_hand_is_on_the_address_it_names() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let on = |engine: &RealEngine| engine.snapshot().connection == Connection::Connected;
        wait_for("the administrator to connect", || on(&admin));
        let told = admin.events();
        let listed = || {
            // No faster than a server takes them.
            std::thread::sleep(std::time::Duration::from_secs(1));
            admin.list(Listing::Bans);
            let mut held = None;
            wait_for("the ban list", || {
                held = std::iter::from_fn(|| told.try_recv().ok()).find_map(|event| match event {
                    EngineEvent::Bans(bans) => Some(bans),
                    _ => None,
                });
                held.is_some()
            });
            held.unwrap_or_default()
        };
        // An address set aside for examples: nobody connects from it.
        let entered = crate::bans::Entered {
            address: "203.0.113.7".to_owned(),
            name: "Nobody".to_owned(),
            ..Default::default()
        };
        let ban = entered.ban(SharedString::default()).expect("a ban");
        admin.act(Action::SetBans(vec![ban]));
        let held = listed();
        assert_eq!(held.len(), 1);
        assert_eq!(
            (held[0].address.as_ref(), held[0].mask),
            ("203.0.113.7", 32)
        );
        assert!(!held[0].start.is_empty(), "the server started it");
        let (guest, guest_dir) = fancy_client("BanGuest", None);
        wait_for("a guest at another address to get in", || on(&guest));
        guest.shutdown();
        let _ = std::fs::remove_dir_all(guest_dir);

        // The same ban, with the short count as the wire's.
        let short = api::BanInfo {
            address: "203.0.113.7".to_owned(),
            mask: 32,
            name: String::new(),
            hash: String::new(),
            reason: String::new(),
            start: String::new(),
            duration_secs: 0,
        };
        let noticed = |events: &async_channel::Receiver<EngineEvent>| {
            std::iter::from_fn(|| events.try_recv().ok())
                .any(|event| matches!(event, EngineEvent::Notice(Some(_))))
        };
        admin
            .runtime
            .block_on(admin.shared.engine.set_bans(vec![short]))
            .expect("the list is sent");
        wait_for("the short mask to be refused, with words", || noticed(&told));
        let held = listed();
        assert_eq!(held.len(), 1, "nothing of a refused list is applied");
        assert!(!held[0].covers_everybody(), "{held:?}");
        let (other, other_dir) = fancy_client("BanGuestTwo", None);
        wait_for("everybody on IPv4 still to get in", || on(&other));

        // A ban on somebody connected, by their certificate: they are sent
        // off, and turned away when they come back.
        let hash = admin
            .snapshot()
            .users
            .into_iter()
            .find(|user| user.name.as_ref() == "BanGuestTwo")
            .and_then(|user| user.hash)
            .expect("the guest's certificate");
        let on_them = crate::bans::Entered {
            address: "203.0.113.8".to_owned(),
            name: "BanGuestTwo".to_owned(),
            hash: hash.to_string(),
            ..Default::default()
        }
        .ban(SharedString::default())
        .expect("a ban");
        let turned = other.events();
        admin.act(Action::SetBans(vec![held[0].clone(), on_them]));
        let mut was_told = false;
        wait_for("the banned guest to be sent off and kept off", || {
            was_told |= noticed(&turned);
            was_told && !on(&other)
        });
        // Coming back with the same certificate is refused at login.
        other.connect("live", None);
        wait_for("the banned guest to be refused again", || noticed(&turned));
        std::thread::sleep(std::time::Duration::from_secs(2));
        assert!(!on(&other), "still off");
        assert!(on(&admin), "and nobody else");
        admin.act(Action::SetBans(Vec::new()));
        std::thread::sleep(std::time::Duration::from_secs(1));
        assert!(listed().is_empty(), "lifted");
        for (engine, dir) in [(admin, admin_dir), (other, other_dir)] {
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
        admin.act(Action::MakeChannel(crate::engine::NewChannel {
            parent: root,
            name: name.clone(),
            kept: crate::engine::Kept::OnServer,
            ..crate::engine::NewChannel::default()
        }));
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
    /// The card of a picture says it is one and brings the picture, and a
    /// video's card comes with its still and title: what the view's embeds
    /// are drawn from (`src/ui/embeds.rs`).
    #[test]
    #[ignore = "needs a live Fancy server that can reach the web"]
    fn live_fancy_a_card_says_what_a_link_is() {
        let picture = "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg";
        let video = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
        let (alice, alice_dir) = fancy_client("CardAlice", None);
        wait_for("alice to connect", || {
            alice.snapshot().connection == Connection::Connected
        });
        let told = alice.events();
        alice.previews(vec![picture.into(), video.into()]);
        let mut cards: Vec<Preview> = Vec::new();
        wait_for("both cards", || {
            for event in std::iter::from_fn(|| told.try_recv().ok()) {
                if let EngineEvent::Previews(more) = event {
                    cards.extend(more);
                }
            }
            [picture, video]
                .iter()
                .all(|url| cards.iter().any(|card| card.url.as_ref() == *url))
        });
        let card = |url: &str| cards.iter().find(|card| card.url.as_ref() == url);
        for url in [picture, video] {
            let card = card(url).expect("a card");
            eprintln!(
                "{url}: kind {:?}, picture_url {:?}, title {:?}, picture sent {}",
                card.kind,
                card.picture_url,
                card.title,
                card.picture.is_some()
            );
        }
        let picture_card = card(picture).expect("a card");
        assert_eq!(picture_card.kind.as_ref().map(AsRef::as_ref), Some("image"));
        // Starling sends the picture's copy and never where it lives, so
        // nothing has to be fetched from the origin to see it.
        assert!(picture_card.picture.is_some());
        let video_card = card(video).expect("a card");
        assert!(video_card.title.is_some() && video_card.picture.is_some());
        alice.shutdown();
        let _ = std::fs::remove_dir_all(alice_dir);
    }
    /// With voice on, what is heard is written to a WAV file until the
    /// recording is stopped; with voice off there is nothing to record.
    ///
    /// Run on its own (`-- --ignored alone_what_is_heard`), which is why
    /// its name does not start with `live`: the engine spawns the writer
    /// on the runtime the first engine of the process handed it, and in a
    /// run of all the live tests that engine is long shut down. An
    /// application has one engine, and does not meet this.
    #[test]
    #[ignore = "needs a live Fancy server, and to be run alone"]
    fn alone_what_is_heard_is_recorded_to_a_file() {
        let (alice, alice_dir) = fancy_client("RecordAlice", None);
        wait_for("alice to connect", || {
            alice.snapshot().connection == Connection::Connected
        });
        let folder = alice_dir.join("recordings");
        std::fs::create_dir_all(&folder).expect("a folder");
        alice.record(Some(folder.clone()));
        assert!(!alice.is_recording(), "nothing is heard with voice off");
        alice.toggle_microphone();
        wait_for("voice to turn on", || alice.snapshot().voice == Voice::On);
        alice.record(Some(folder.clone()));
        assert!(alice.is_recording());
        std::thread::sleep(std::time::Duration::from_secs(1));
        alice.record(None);
        assert!(!alice.is_recording());
        let recorded = || -> Vec<_> {
            std::fs::read_dir(&folder)
                .expect("the folder")
                .filter_map(Result::ok)
                .collect()
        };
        wait_for("the file to be there", || recorded().len() == 1);
        let files = recorded();
        // Nobody else is here to be heard, so the file may hold no more
        // than its header; it is finished a moment after the stop.
        wait_for("the file to be a finished WAV", || {
            std::fs::read(files[0].path())
                .is_ok_and(|written| written.starts_with(b"RIFF") && written.len() >= 44)
        });
        alice.shutdown();
        let _ = std::fs::remove_dir_all(alice_dir);
    }

    /// An administrator deletes what one user said in a channel that keeps
    /// its messages, then everything: both see it go.
    #[test]
    #[ignore = "needs a live Fancy server; set FANCY_GPUI_TEST_FANCY=host:port"]
    fn live_fancy_a_channel_is_emptied_of_one_users_messages_then_of_all() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let (alice, alice_dir) = fancy_client("PurgeAlice", None);
        wait_for("both to connect", || {
            admin.snapshot().users.len() >= 2 && alice.snapshot().users.len() >= 2
        });
        let name = format!("purged-{}", std::process::id());
        let root = admin.snapshot().current_channel.expect("the root");
        admin.act(Action::MakeChannel(crate::engine::NewChannel {
            parent: root,
            name: name.clone(),
            kept: crate::engine::Kept::OnServer,
            ..crate::engine::NewChannel::default()
        }));
        let made = |engine: &RealEngine| {
            engine
                .snapshot()
                .channels
                .into_iter()
                .find(|channel| channel.name.as_ref() == name)
        };
        wait_for("the channel", || {
            made(&admin).is_some() && made(&alice).is_some()
        });
        let channel = made(&admin).expect("the channel").id;
        let room = Conversation::Channel(channel);
        for engine in [&admin, &alice] {
            engine.join_channel(channel);
            wait_for("to be in the channel", || {
                engine.snapshot().current_channel == Some(channel)
            });
            engine.open(room);
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
        admin.send_message(room, "the admin's".to_owned());
        std::thread::sleep(std::time::Duration::from_secs(1));
        alice.send_message(room, "alice's".to_owned());
        wait_for("both messages with both", || {
            [&admin, &alice].iter().all(|engine| {
                said(engine, room, "the admin's").is_some()
                    && said(engine, room, "alice's").is_some()
            })
        });
        let her = admin
            .snapshot()
            .users
            .into_iter()
            .find(|user| user.name.as_ref() == "PurgeAlice")
            .expect("alice")
            .session;
        admin.act(Action::Purge {
            channel,
            by: Some(her),
        });
        wait_for("alice's to go, for both", || {
            [&admin, &alice]
                .iter()
                .all(|engine| said(engine, room, "alice's").is_none())
        });
        assert!(said(&admin, room, "the admin's").is_some(), "only hers");
        std::thread::sleep(std::time::Duration::from_secs(1));
        admin.act(Action::Purge { channel, by: None });
        wait_for("everything to go, for both", || {
            admin.messages(room).is_empty() && alice.messages(room).is_empty()
        });
        clear_away(&admin, channel);
        admin.shutdown();
        alice.shutdown();
        let _ = std::fs::remove_dir_all(admin_dir);
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
        admin.act(Action::MakeChannel(crate::engine::NewChannel {
            parent: root,
            name: name.clone(),
            kept: crate::engine::Kept::Signal,
            ..crate::engine::NewChannel::default()
        }));
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

        clear_away(&admin, channel);
        admin.shutdown();
        bob.shutdown();
        let _ = std::fs::remove_dir_all(admin_dir);
        let _ = std::fs::remove_dir_all(bob_dir);
    }

    /// What is typed with marks for emphasis and code arrives set that way,
    /// and what was not meant as a mark arrives as it was typed.
    #[test]
    #[ignore = "needs a live Fancy server; set FANCY_GPUI_TEST_FANCY=host:port"]
    fn live_fancy_marks_typed_for_emphasis_arrive_as_emphasis() {
        let (alice, alice_dir) = fancy_client("MarkAlice", None);
        let (bob, bob_dir) = fancy_client("MarkBob", None);
        wait_for("both to connect", || {
            alice.snapshot().users.len() >= 2 && bob.snapshot().users.len() >= 2
        });
        let room = Conversation::Channel(alice.snapshot().current_channel.expect("a channel"));
        alice.send_message(room, "**loud**, `x < y` and 2 * 3 * 4".to_owned());
        let mut got = None;
        wait_for("bob to read it", || {
            got = said(&bob, room, "loud, x < y and 2 * 3 * 4");
            got.is_some()
        });
        let html = got.expect("the message").html;
        assert!(html.contains("<b>loud</b>"), "{html}");
        assert!(html.contains("<code>x &lt; y</code>"), "{html}");
        assert!(html.contains("2 * 3 * 4"), "{html}");
        alice.shutdown();
        bob.shutdown();
        let _ = std::fs::remove_dir_all(alice_dir);
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
    /// The first file's mark in `html`, read as the web client reads it,
    /// with the fields it has checked to be those `sendVoiceMessage.ts`
    /// writes.
    fn web_mark(html: &str) -> serde_json::Value {
        let mark = html
            .split("<!-- FANCY_FILE:")
            .nth(1)
            .and_then(|rest| rest.split(" -->").next())
            .expect("a file's mark");
        let stated: serde_json::Value = serde_json::from_slice(
            &base64::Engine::decode(&base64::engine::general_purpose::STANDARD, mark)
                .expect("base64"),
        )
        .expect("JSON");
        let mut fields: Vec<&str> = stated
            .as_object()
            .expect("an object")
            .keys()
            .map(String::as_str)
            .collect();
        fields.sort_unstable();
        assert_eq!(
            fields,
            ["expiresAt", "filename", "key", "mode", "sizeBytes", "url", "voice"]
        );
        stated
    }
    /// A voice message recorded from a made-up tone (no microphone is
    /// touched) is sent by one and arrives at the other as a voice message:
    /// its length and shape in its message, as the web client writes it,
    /// and a file that decodes to that length and plays, silently, to its
    /// end.
    #[test]
    #[ignore = "needs a live Fancy server that keeps files on 8080, and its SuperUser password"]
    fn live_fancy_a_voice_message_is_sent_and_arrives_as_one() {
        use crate::voice::State;
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (alice, alice_dir) = fancy_client("SuperUser", Some(password));
        let (bob, bob_dir) = fancy_client("VoiceBob", None);
        wait_for("both to connect", || {
            alice.snapshot().users.len() >= 2 && bob.snapshot().users.len() >= 2
        });
        wait_for("the server to say it takes voice messages", || {
            alice.voice_support().is_some_and(|support| support.available)
        });
        // In a channel of its own, gone again at the end: the server may
        // be one others use.
        let name = format!("voice-{}", std::process::id());
        let root = alice.snapshot().current_channel.expect("the root");
        alice.act(Action::MakeChannel(crate::engine::NewChannel {
            parent: root,
            name: name.clone(),
            ..crate::engine::NewChannel::default()
        }));
        let made = |engine: &RealEngine| {
            engine
                .snapshot()
                .channels
                .into_iter()
                .find(|channel| channel.name.as_ref() == name)
                .map(|channel| channel.id)
        };
        wait_for("the channel", || made(&alice).is_some() && made(&bob).is_some());
        let channel = made(&alice).expect("the channel");
        alice.join_channel(channel);
        bob.join_channel(channel);
        wait_for("both to be in it", || {
            alice.snapshot().current_channel == Some(channel)
                && bob.snapshot().current_channel == Some(channel)
        });
        let room = Conversation::Channel(channel);

        let mut recorder = alice.recorder();
        recorder.start(0).expect("a take starts");
        std::thread::sleep(std::time::Duration::from_millis(1_600));
        let clip = recorder
            .finish()
            .recv_blocking()
            .expect("an answer")
            .expect("a clip");
        assert!(clip.duration_ms >= 1_500, "{clip:?}");
        let (length, shape, kept_at) = (clip.duration_ms, clip.waveform.clone(), clip.path.clone());
        alice.send_voice(room, clip);
        let voiced = |engine: &RealEngine| {
            engine.messages(room).into_iter().find_map(|message| {
                let file = message.files.into_iter().find(|file| file.voice.is_some())?;
                Some((message.html, file))
            })
        };
        wait_for("both to have the voice message", || {
            voiced(&alice).is_some() && voiced(&bob).is_some()
        });
        assert!(!kept_at.exists(), "the take's file is let go of once sent");
        let (html, file) = voiced(&bob).expect("the voice message");
        let note = file.voice.clone().expect("a voice message");
        assert_eq!(file.name.as_ref(), "voice-message.ogg");
        assert_eq!(note.duration_ms, length);
        assert_eq!(&note.waveform[..], &shape[..]);

        // What the web client reads it from: the mark's every field, as
        // `sendVoiceMessage.ts` writes them.
        let stated = web_mark(&html);
        assert_eq!(stated["url"], "");
        assert_eq!(stated["mode"], "session");
        assert_eq!(stated["voice"]["durationMs"], length);
        assert_eq!(stated["voice"]["waveform"].as_array().map(Vec::len), Some(48));
        assert_eq!(stated["sizeBytes"], file.size.expect("its size"));

        // The file is the clip: it decodes to the length its message says.
        let key = file.key.clone().expect("a key");
        let saved = bob_dir.join("voice.ogg");
        let written = bob
            .runtime
            .block_on(bob.shared.engine.save_shared_file(&key, &saved))
            .expect("fetched");
        assert_eq!(Some(written), file.size, "the whole file");
        let bytes = std::fs::read(&saved).expect("saved");
        let reader = mumble_tauri_lib::engine_api::voice::VoiceClipReader::new(&bytes)
            .expect("Ogg Opus");
        assert_eq!(reader.duration_ms(), length);

        // And it plays, silently, at twice the speed, to its end.
        let mut player = bob.voice_player();
        player.play(&key, note.duration_ms, 0, 2.0);
        wait_for("it to play", || player.now().state == State::Playing);
        wait_for("it to end", || player.now().state == State::Ended);
        alice.join_channel(root);
        bob.join_channel(root);
        alice.act(Action::DeleteChannel { channel });
        wait_for("the channel to go", || made(&alice).is_none());
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
        admin.act(Action::MakeChannel(crate::engine::NewChannel {
            parent: root,
            name: name.clone(),
            kept: crate::engine::Kept::Sealed,
            ..crate::engine::NewChannel::default()
        }));
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
        admin.act(Action::MakeChannel(crate::engine::NewChannel {
            parent: root,
            name: name.clone(),
            kept: crate::engine::Kept::No,
            ..crate::engine::NewChannel::default()
        }));
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
    /// A channel made with its options together arrives with its limit and
    /// its place. Its password and that its messages are kept are sent the
    /// same way and not looked for here: the server image these tests run
    /// on is older than both (it does not keep history for a channel made
    /// by the older, name-only way either).
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_a_channel_is_made_with_its_options_together() {
        use crate::engine::{Kept, NewChannel};
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let (guest, guest_dir) = fancy_client("FormGuest", None);
        wait_for("both to connect", || {
            admin.snapshot().users.len() >= 2 && guest.snapshot().users.len() >= 2
        });
        let name = format!("formed-{}", std::process::id());
        let root = admin.snapshot().current_channel.expect("the root");
        admin.act(Action::MakeChannel(NewChannel {
            parent: root,
            name: name.clone(),
            about: "Made in one go".to_owned(),
            password: "sesame".to_owned(),
            most: Some(3),
            position: Some(5),
            temporary: false,
            hidden: false,
            kept: Kept::OnServer,
        }));
        let formed = |engine: &RealEngine| {
            let channels = engine.snapshot().channels;
            channels
                .into_iter()
                .find(|channel| channel.name.as_ref() == name)
        };
        // Everything said of it is the server's to send, and not at once.
        wait_for("the channel with its limit", || {
            formed(&guest).is_some_and(|made| made.max_users == 3)
        });
        let made = formed(&guest).expect("the channel");
        assert_eq!((made.parent, made.position), (Some(root), 5));
        assert!(!made.temporary, "{made:?}");
        admin.act(Action::DeleteChannel { channel: made.id });
        wait_for("the channel to go", || formed(&guest).is_none());
        for (engine, dir) in [(admin, admin_dir), (guest, guest_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// Every picture in a folder, sent one after another, arrives as a
    /// picture and leaves both clients connected: whatever its kind and
    /// however large, since one too large for the server is made smaller
    /// first. For pictures as people send them, which no made-up one is.
    ///
    /// ```text
    /// FANCY_GPUI_TEST_PICTURES=<folder> FANCY_GPUI_TEST_FANCY=host:port \
    ///     cargo test --release -- --ignored live_fancy_pictures --nocapture
    /// ```
    #[test]
    #[ignore = "needs a live Fancy server and FANCY_GPUI_TEST_PICTURES=<folder>"]
    fn live_fancy_pictures_from_a_folder_arrive_whatever_their_size() {
        let folder = std::env::var("FANCY_GPUI_TEST_PICTURES").expect("FANCY_GPUI_TEST_PICTURES");
        let mut files: Vec<_> = std::fs::read_dir(&folder)
            .expect("a folder")
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_file())
            .collect();
        files.sort();
        assert!(!files.is_empty(), "no pictures in {folder}");
        let (alice, alice_dir) = fancy_client("PictureAlice", None);
        let (bob, bob_dir) = fancy_client("PictureBob", None);
        wait_for("both to connect", || {
            alice.snapshot().users.len() >= 2 && bob.snapshot().users.len() >= 2
        });
        let room = Conversation::Channel(alice.snapshot().current_channel.expect("a channel"));
        let limit = alice.shared.engine.picture_limit();
        // A heavy message is held without its pictures: read back whole.
        let pictures = |engine: &RealEngine| -> Vec<Vec<u8>> {
            engine
                .messages(room)
                .iter()
                .flat_map(|message| {
                    let whole = message
                        .id
                        .as_ref()
                        .filter(|_| crate::away::is_light(&message.html))
                        .and_then(|id| engine.whole(room, id))
                        .unwrap_or_else(|| message.html.to_string());
                    crate::rich::Rich::parse(&whole).images
                })
                .collect()
        };
        for (nth, path) in files.iter().enumerate() {
            let file = std::fs::read(path).expect("readable");
            let sent = crate::picture::dimensions(&file);
            let started = std::time::Instant::now();
            alice.send_picture(room, file.clone());
            // Longer than anything else is waited for: a picture of thirty
            // megapixels is read, scaled and encoded before it is sent.
            let deadline = started + std::time::Duration::from_secs(180);
            while pictures(&bob).len() <= nth {
                assert!(
                    std::time::Instant::now() < deadline,
                    "{} did not arrive ({:?})",
                    path.display(),
                    alice.snapshot().connection
                );
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            let arrived = pictures(&bob).pop().expect("a picture");
            let size = crate::picture::dimensions(&arrived).expect("a readable picture");
            eprintln!(
                "{}: {} bytes, {sent:?} -> {} bytes, {size:?} in {:.1}s{}",
                path.file_name().unwrap_or_default().display(),
                file.len(),
                arrived.len(),
                started.elapsed().as_secs_f32(),
                if arrived == file { " (as it was)" } else { "" },
            );
            assert!(
                arrived.len() * 4 / 3 <= limit,
                "within what the server takes"
            );
            // Heavy, it is held light, and the engine holds a mark for it.
            let held = bob.messages(room).pop().expect("a message");
            assert_eq!(
                crate::away::is_light(&held.html),
                arrived.len() * 4 / 3 > 64 * 1024,
                "{} bytes held as {} of message",
                arrived.len(),
                held.html.len()
            );
            // The sender shows it too, and nobody was logged out by it.
            wait_for("the sender to show it", || pictures(&alice).len() > nth);
            for engine in [&alice, &bob] {
                assert_eq!(engine.snapshot().connection, Connection::Connected);
            }
            // No faster than a server takes them.
            std::thread::sleep(std::time::Duration::from_millis(1200));
        }
        for (engine, dir) in [(alice, alice_dir), (bob, bob_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// As `admin`, let everybody in `channel` share files: with those there,
    /// and by link. A guest is let do neither until somebody says so.
    fn let_everybody_share(admin: &RealEngine, channel: ChannelId) {
        let heard = admin.events();
        admin.request_acl(channel);
        let mut rules = next_rules(&heard, channel);
        rules.rules.push(AclRule {
            here: true,
            subs: true,
            inherited: false,
            user: None,
            group: Some("all".into()),
            grant: 0x4000 | 0x8000,
            deny: 0,
        });
        admin.act(Action::SetAcl(rules));
        std::thread::sleep(std::time::Duration::from_secs(2));
    }

    /// Files shared from the tray arrive as their message says: several in
    /// one message with what was typed, open to whom the sender chose, a
    /// picture with its size and a small copy that can be fetched and is a
    /// picture; and one sealed with a password says so and has no small
    /// copy for the server to look at.
    #[test]
    #[ignore = "needs a live Fancy server that keeps files, and its SuperUser password"]
    fn live_fancy_files_are_shared_as_the_sender_chose() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let (alice, alice_dir) = fancy_client("ShareAlice", None);
        let (bob, bob_dir) = fancy_client("ShareBob", None);
        wait_for("all three to connect", || {
            [&admin, &alice, &bob]
                .iter()
                .all(|engine| engine.snapshot().users.len() >= 3)
        });
        let root = alice.snapshot().current_channel.expect("a channel");
        let room = Conversation::Channel(root);
        let_everybody_share(&admin, root);
        let folder = std::env::temp_dir().join(format!("fancy-gpui-share-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("writable");
        let (notes, photo) = (folder.join("notes.txt"), folder.join("photo.png"));
        std::fs::write(&notes, b"what was agreed").expect("writable");
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(1200, 800, |x, y| {
            image::Rgb([(x % 251) as u8, (y % 241) as u8, 90])
        }))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("a png");
        std::fs::write(&photo, &png).expect("writable");

        let told = bob.events();
        alice.share(
            room,
            "from the meeting".to_owned(),
            vec![photo.clone(), notes.clone()],
            ShareAs {
                reach: Reach::Link,
                lasts: crate::engine::Lasts::Day,
                full: false,
            },
        );
        let shared = |engine: &RealEngine, with: &str| {
            engine
                .messages(room)
                .into_iter()
                .find(|message| message.body.contains(with))
        };
        wait_for("the message with both files", || {
            shared(&bob, "from the meeting").is_some_and(|message| message.files.len() == 2)
        });
        let message = shared(&bob, "from the meeting").expect("the message");
        let (picture, text) = (&message.files[0], &message.files[1]);
        assert_eq!(picture.name.as_ref(), "photo.png");
        assert_eq!(text.name.as_ref(), "notes.txt");
        for file in &message.files {
            assert_eq!(file.open_to, OpenTo::Link, "{file:?}");
            assert!(file.url.is_some() && file.key.is_some(), "{file:?}");
        }
        assert_eq!(picture.pixels, Some((1200, 800)));
        assert!(text.pixels.is_none() && text.stand_in.is_none());
        // What it is shown from is fetched, and is a picture: the small
        // copy where the server keeps one beside it, the file itself where
        // the server's plugin keeps one file a share.
        let from = picture.shown_from().cloned().expect("a way to show it");
        bob.fetch_shared(from.clone());
        let mut fetched = None;
        wait_for("what it is shown from", || {
            fetched = std::iter::from_fn(|| told.try_recv().ok()).find_map(|event| match event {
                EngineEvent::Shared { key, picture } if key == from => Some(picture),
                _ => None,
            });
            fetched.is_some()
        });
        let fetched = fetched.flatten().expect("a picture");
        let expected = if picture.stand_in.is_some() {
            (480, 320)
        } else {
            (1200, 800)
        };
        assert_eq!(crate::picture::dimensions(fetched.bytes()), Some(expected));

        // Sealed with a password: said so, and nothing beside it.
        alice.share(
            room,
            "for those who know".to_owned(),
            vec![photo],
            ShareAs {
                reach: Reach::Password("sesame".to_owned()),
                ..ShareAs::default()
            },
        );
        wait_for("the sealed one", || {
            shared(&bob, "for those who know").is_some_and(|message| message.files.len() == 1)
        });
        let sealed = shared(&bob, "for those who know").expect("the message");
        assert_eq!(sealed.files[0].open_to, OpenTo::Password);
        assert!(sealed.files[0].stand_in.is_none(), "{:?}", sealed.files[0]);
        assert!(sealed.files[0].shown_from().is_none());
        for (engine, dir) in [(admin, admin_dir), (alice, alice_dir), (bob, bob_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
        let _ = std::fs::remove_dir_all(folder);
    }

    /// Fills a server with what a busy one has, and stays: four people,
    /// each with a face and a banner made from the pictures of a folder,
    /// who then say every picture in it, one after another. Not a test of
    /// anything by itself: it is what a client is measured beside. It stays
    /// for `FANCY_GPUI_TEST_HOLD_SECS` seconds after the last picture, and
    /// says `filled` when that one has arrived.
    ///
    /// ```text
    /// FANCY_GPUI_TEST_PICTURES=<folder> FANCY_GPUI_TEST_HOLD_SECS=600 \
    ///     cargo test --release -- --ignored live_fancy_a_room_is_filled --nocapture
    /// ```
    #[test]
    #[ignore = "needs a live Fancy server and FANCY_GPUI_TEST_PICTURES=<folder>"]
    fn live_fancy_a_room_is_filled_with_faces_and_pictures() {
        let folder = std::env::var("FANCY_GPUI_TEST_PICTURES").expect("FANCY_GPUI_TEST_PICTURES");
        let hold = std::env::var("FANCY_GPUI_TEST_HOLD_SECS")
            .ok()
            .and_then(|secs| secs.parse().ok())
            .unwrap_or(0);
        let mut files: Vec<_> = std::fs::read_dir(&folder)
            .expect("a folder")
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_file())
            .filter_map(|path| std::fs::read(path).ok())
            .collect();
        files.sort_by_key(Vec::len);
        assert!(!files.is_empty(), "no pictures in {folder}");
        let people: Vec<(RealEngine, std::path::PathBuf)> = ["Mika", "Ren", "Sora", "Yuki"]
            .into_iter()
            .map(|name| fancy_client(name, None))
            .collect();
        wait_for("all four to connect", || {
            people
                .iter()
                .all(|(engine, _)| engine.snapshot().users.len() >= people.len())
        });
        // A face and a banner each, as this client would send them.
        for (nth, (engine, _)) in people.iter().enumerate() {
            let face = files.get(nth % files.len()).expect("a file");
            let over = files.get((nth + 4) % files.len()).expect("a file");
            if let Ok(face) = crate::picture::avatar(face) {
                engine.act(Action::SetAvatar(face));
            }
            if let Ok(banner) = crate::picture::banner(over) {
                engine.act(Action::SetBanner(banner));
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(2));
        let (first, _) = people.first().expect("somebody");
        let room = Conversation::Channel(first.snapshot().current_channel.expect("a channel"));
        // Counted where they stand: a heavy message is held without them.
        let pictures = |engine: &RealEngine| -> usize {
            engine
                .messages(room)
                .iter()
                .map(|message| message.html.matches("<img").count())
                .sum()
        };
        for (nth, file) in files.iter().enumerate() {
            let (says, _) = people.get(nth % people.len()).expect("somebody");
            let (hears, _) = people.get((nth + 1) % people.len()).expect("somebody");
            says.send_picture(room, file.clone());
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
            while pictures(hears) <= nth {
                assert!(
                    std::time::Instant::now() < deadline,
                    "picture {nth} did not arrive"
                );
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
        eprintln!(
            "filled: {} pictures from {} people",
            files.len(),
            people.len()
        );
        std::thread::sleep(std::time::Duration::from_secs(hold));
        for (engine, dir) in people {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// A channel made keeping its messages keeps them, and one made hidden
    /// is shown to whoever made it and not to a guest. Needs a server that
    /// does both when a channel is made: one built from source of August
    /// 2026 or later.
    #[test]
    #[ignore = "needs a live Fancy server of August 2026 or later and its SuperUser password"]
    fn live_fancy_a_channel_is_made_hidden_or_keeping_its_messages() {
        use crate::engine::{Kept, NewChannel};
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let (guest, guest_dir) = fancy_client("HiddenGuest", None);
        wait_for("both to connect", || {
            admin.snapshot().users.len() >= 2 && guest.snapshot().users.len() >= 2
        });
        let root = admin.snapshot().current_channel.expect("the root");
        let (kept, hidden) = (
            format!("kept-{}", std::process::id()),
            format!("hidden-{}", std::process::id()),
        );
        let new = |name: &str, hidden, kept| NewChannel {
            parent: root,
            name: name.to_owned(),
            about: String::new(),
            password: String::new(),
            most: None,
            position: None,
            temporary: false,
            hidden,
            kept,
        };
        admin.act(Action::MakeChannel(new(&kept, false, Kept::OnServer)));
        admin.act(Action::MakeChannel(new(&hidden, true, Kept::No)));
        let seen = |engine: &RealEngine, name: &str| {
            let channels = engine.snapshot().channels;
            channels
                .into_iter()
                .find(|channel| channel.name.as_ref() == name)
        };
        wait_for("the channel that keeps its messages", || {
            seen(&guest, &kept).is_some_and(|made| made.history)
        });
        wait_for("the hidden channel, for who made it", || {
            seen(&admin, &hidden).is_some()
        });
        // The guest was told of the other one, made first, so would have
        // been told of this one by now.
        std::thread::sleep(std::time::Duration::from_secs(2));
        assert!(seen(&guest, &hidden).is_none(), "a guest sees it");
        for (engine, dir) in [(admin, admin_dir), (guest, guest_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// Register whoever is called `name`, as `admin`, and say which account
    /// they were given.
    fn registered(admin: &RealEngine, name: &str) -> u32 {
        let named = || {
            let users = admin.snapshot().users;
            users.into_iter().find(|user| user.name.as_ref() == name)
        };
        let session = named().expect("somebody of that name").session;
        admin.act(Action::Register { session });
        let mut account = None;
        wait_for("the account", || {
            account = named().and_then(|user| user.account);
            account.is_some()
        });
        account.expect("the account")
    }

    /// The accounts `engine` is given when the member list asks for them.
    fn directory_of(engine: &RealEngine) -> Vec<Registered> {
        let told = engine.events();
        engine.directory();
        let mut listed = None;
        wait_for("the registered accounts", || {
            listed = std::iter::from_fn(|| told.try_recv().ok()).find_map(|event| match event {
                EngineEvent::Registered(accounts) => Some(accounts),
                _ => None,
            });
            listed.is_some()
        });
        listed.unwrap_or_default()
    }

    /// Put `account` in a new role `name` of the colour `color`, as
    /// `admin`, and wait until `admin` has the role.
    fn give_role(admin: &RealEngine, name: &str, color: &str, account: u32) {
        let told = admin.events();
        admin.request_acl(ROOT);
        let _ = next_rules(&told, ROOT);
        let mut rules = admin
            .shared
            .acl
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
            .expect("the root's rules");
        rules.groups.push(api::AclGroupInfo {
            name: name.to_owned(),
            inherited: false,
            inherit: true,
            inheritable: true,
            add: vec![account],
            remove: Vec::new(),
            inherited_members: Vec::new(),
            color: Some(color.to_owned()),
            icon: None,
            style_preset: None,
            metadata: HashMap::new(),
        });
        admin
            .runtime
            .block_on(admin.shared.engine.set_acl(rules))
            .expect("the rules are sent");
        let has_it = || admin.roles().iter().any(|role| role.name.as_ref() == name);
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_secs(1));
            admin.request_acl(ROOT);
            std::thread::sleep(std::time::Duration::from_millis(500));
            if has_it() {
                return;
            }
        }
        panic!("the role never arrived");
    }

    /// A registered member who is not on is listed to another member for
    /// the member list, and to an administrator, who also has the role
    /// they were given; a guest is refused, without a word, and the
    /// member list lists who is on instead.
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_registered_members_who_are_away_are_listed_with_their_roles() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let (gone, gone_dir) = fancy_client("MemberGone", None);
        let (member, member_dir) = fancy_client("MemberStays", None);
        let (guest, guest_dir) = fancy_client("MemberGuest", None);
        wait_for("all four to connect", || {
            [&admin, &gone, &member, &guest]
                .iter()
                .all(|engine| engine.snapshot().users.len() >= 4)
        });
        let gone_id = registered(&admin, "MemberGone");
        let _ = registered(&admin, "MemberStays");
        give_role(&admin, "Wardens", "#3f9fd8", gone_id);
        gone.shutdown();
        let _ = std::fs::remove_dir_all(gone_dir);
        wait_for("them to be gone", || {
            let users = member.snapshot().users;
            !users.iter().any(|user| user.name.as_ref() == "MemberGone")
        });

        let listed = directory_of(&member);
        let entry = listed.iter().find(|account| account.id == gone_id);
        assert_eq!(
            entry.map(|account| account.name.as_ref()),
            Some("MemberGone"),
            "listed to a member: {listed:?}"
        );
        assert!(directory_of(&admin).iter().any(|account| account.id == gone_id));
        let role = admin.roles().into_iter().find(|role| role.name.as_ref() == "Wardens");
        let role = role.expect("the administrator has the role");
        assert!(role.members.contains(&gone_id));
        assert!(role.color.is_some(), "the role keeps its colour");

        let told = guest.events();
        guest.directory();
        wait_for("the guest to be refused", || {
            std::iter::from_fn(|| told.try_recv().ok())
                .any(|event| matches!(event, EngineEvent::DirectoryRefused))
        });
        std::thread::sleep(std::time::Duration::from_secs(1));
        assert!(
            !std::iter::from_fn(|| told.try_recv().ok())
                .any(|event| matches!(event, EngineEvent::Notice(Some(_)))),
            "a refusal is no news"
        );
        for (engine, dir) in [
            (admin, admin_dir),
            (member, member_dir),
            (guest, guest_dir),
        ] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// What the Roles page writes reaches the server and comes back: a
    /// role made with its style, what else it keeps and what it grants,
    /// renamed, then deleted with its rule. How it is drawn is asked for
    /// last: Starling keeps none of it today (reported), and that alone
    /// fails here.
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_a_role_is_made_renamed_and_deleted_as_the_roles_page_writes_it() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        wait_for("the administrator to connect", || {
            admin.snapshot().connection == Connection::Connected
        });
        let read = |admin: &RealEngine| {
            let told = admin.events();
            admin.request_acl(ROOT);
            next_rules(&told, ROOT)
        };
        // Sent, and the rules waited for until they say what was written:
        // an answer to an earlier question can still be on its way.
        let write = |admin: &RealEngine, rules: Acl, holds: &dyn Fn(&Acl) -> bool| {
            let told = admin.events();
            admin.act(Action::SetAcl(rules));
            let mut back = next_rules(&told, ROOT);
            for _ in 0..20 {
                if holds(&back) {
                    break;
                }
                admin.request_acl(ROOT);
                back = next_rules(&told, ROOT);
            }
            back
        };
        let named = |acl: &Acl, name: &str| acl.groups.iter().any(|group| group.name.as_ref() == name);
        let mut rules = read(&admin);
        let mut keepers = crate::engine::AclGroup::new("Keepers");
        keepers.look.style = Some("neon".into());
        keepers.look.color = Some("#3f9fd8".into());
        let _ = keepers.look.metadata.insert("motto".into(), "keep".into());
        rules.groups.push(keepers);
        rules.rules.push(AclRule {
            here: true,
            subs: true,
            inherited: false,
            user: None,
            group: Some("Keepers".into()),
            grant: 0x1_0000,
            deny: 0,
        });
        let back = write(&admin, rules, &|acl| named(acl, "Keepers"));
        let made = back.groups.iter().find(|group| group.name.as_ref() == "Keepers");
        let made = made.expect("the role, made").clone();
        assert!(back.rules.iter().any(|rule| {
            rule.group.as_ref().is_some_and(|group| group.as_ref() == "Keepers") && rule.grant == 0x1_0000
        }));

        let mut renamed = back.clone();
        for group in renamed.groups.iter_mut().filter(|group| group.name.as_ref() == "Keepers") {
            group.name = "Wardens".into();
        }
        for rule in renamed.rules.iter_mut().filter(|rule| {
            rule.group.as_ref().is_some_and(|group| group.as_ref() == "Keepers")
        }) {
            rule.group = Some("Wardens".into());
        }
        let back = write(&admin, renamed, &|acl| named(acl, "Wardens"));
        assert!(back.groups.iter().all(|group| group.name.as_ref() != "Keepers"), "not beside the old");
        assert!(back.groups.iter().any(|group| group.name.as_ref() == "Wardens"));

        let mut gone = back.clone();
        gone.groups.retain(|group| group.name.as_ref() != "Wardens");
        gone.rules.retain(|rule| !rule.group.as_ref().is_some_and(|group| group.as_ref() == "Wardens"));
        let back = write(&admin, gone, &|acl| !named(acl, "Wardens"));
        assert!(back.groups.iter().all(|group| group.name.as_ref() != "Wardens"), "deleted");
        // How it is drawn, last: Starling keeps none of it today (reported).
        assert_eq!(made.look.style.as_ref().map(ToString::to_string).as_deref(), Some("neon"));
        assert_eq!(
            made.look.metadata.get("motto").map(ToString::to_string).as_deref(),
            Some("keep")
        );
        assert!(made.look.color.is_some(), "the colour kept by the server");
        admin.shutdown();
        let _ = std::fs::remove_dir_all(admin_dir);
    }

    /// The next list of registered accounts the server sends `told` that
    /// `holds` is true of.
    fn next_registered(
        told: &async_channel::Receiver<EngineEvent>,
        what: &str,
        holds: impl Fn(&[Registered]) -> bool,
    ) {
        wait_for(what, || {
            std::iter::from_fn(|| told.try_recv().ok()).any(|event| match event {
                EngineEvent::Registered(accounts) => holds(&accounts),
                _ => false,
            })
        });
    }

    /// What the Users page does to an account reaches the server, and the
    /// list read again says so: a role taken away through the root's
    /// groups as its dialog writes them, a new name, and the registration
    /// gone.
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_the_users_page_changes_an_account_and_its_list_follows() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let (member, member_dir) = fancy_client("PageMember", None);
        wait_for("both to connect", || admin.snapshot().users.len() >= 2);
        let id = registered(&admin, "PageMember");
        give_role(&admin, "Keepers", "#3f9fd8", id);

        // The dialog's way: the root's rules as the view has them, the
        // account taken out of one group, sent back whole.
        let told = admin.events();
        admin.request_acl(ROOT);
        let mut rules = next_rules(&told, ROOT);
        let keepers = rules
            .groups
            .iter_mut()
            .find(|group| group.name.as_ref() == "Keepers")
            .expect("the role, as a group");
        keepers.added.retain(|added| *added != id);
        admin.act(Action::SetAcl(rules));
        wait_for("the role to lose its member", || {
            admin
                .roles()
                .iter()
                .any(|role| role.name.as_ref() == "Keepers" && !role.members.contains(&id))
        });

        let told = admin.events();
        admin.act(Action::RenameRegistered {
            id,
            name: "PageRenamed".to_owned(),
        });
        next_registered(&told, "the list with the new name", |accounts| {
            accounts
                .iter()
                .any(|account| account.id == id && account.name.as_ref() == "PageRenamed")
        });
        let told = admin.events();
        admin.act(Action::Unregister { id });
        next_registered(&told, "the list without the account", |accounts| {
            !accounts.iter().any(|account| account.id == id)
        });
        for (engine, dir) in [(admin, admin_dir), (member, member_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// The rules of `channel`, the next time the server sends them.
    fn next_rules(told: &async_channel::Receiver<EngineEvent>, channel: ChannelId) -> Acl {
        let mut rules = None;
        wait_for("the channel's rules", || {
            rules = std::iter::from_fn(|| told.try_recv().ok()).find_map(|event| match event {
                EngineEvent::Acl(acl) if acl.channel == channel => Some(acl),
                _ => None,
            });
            rules.is_some()
        });
        rules.expect("the rules")
    }

    /// A rule for one account holds for whoever is connected as it and
    /// for nobody else; and the list of accounts names it, with when it was
    /// last on written in a way this client reads.
    #[test]
    #[ignore = "needs a live Fancy server and its SuperUser password"]
    fn live_fancy_a_rule_for_one_person_holds_for_them_alone() {
        let password =
            std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
        let (admin, admin_dir) = fancy_client("SuperUser", Some(password));
        let (one, one_dir) = fancy_client("RuledOne", None);
        let (other, other_dir) = fancy_client("RuledOther", None);
        wait_for("all three to connect", || {
            [&admin, &one, &other]
                .iter()
                .all(|engine| engine.snapshot().users.len() >= 3)
        });
        let account = registered(&admin, "RuledOne");

        let told = admin.events();
        std::thread::sleep(std::time::Duration::from_secs(1));
        admin.list(Listing::Registered);
        let mut listed = None;
        wait_for("the registered accounts", || {
            listed = std::iter::from_fn(|| told.try_recv().ok()).find_map(|event| match event {
                EngineEvent::Registered(users) => Some(users),
                _ => None,
            });
            listed.is_some()
        });
        let listed = listed.unwrap_or_default();
        let entry = listed.iter().find(|user| user.id == account);
        let entry = entry.expect("the account is listed");
        assert_eq!(entry.name.as_ref(), "RuledOne");
        if let Some(seen) = entry.last_seen.as_ref().filter(|seen| !seen.is_empty()) {
            assert!(crate::ui::accounts::seen_ms(seen).is_some(), "{seen}");
        }

        // No faster than a server takes them: what comes too fast is
        // dropped without a word.
        let breathe = || std::thread::sleep(std::time::Duration::from_secs(3));
        breathe();
        let name = format!("ruled-one-{}", std::process::id());
        let root = admin.snapshot().current_channel.expect("the root");
        admin.act(Action::MakeChannel(crate::engine::NewChannel {
            parent: root,
            name: name.clone(),
            kept: crate::engine::Kept::No,
            ..crate::engine::NewChannel::default()
        }));
        let ruled = |engine: &RealEngine| {
            let channels = engine.snapshot().channels;
            let found = channels
                .into_iter()
                .find(|channel| channel.name.as_ref() == name);
            found.map(|channel| channel.id)
        };
        wait_for("the channel", || {
            ruled(&one).is_some() && ruled(&other).is_some()
        });
        let channel = ruled(&one).expect("the channel");
        admin.request_acl(channel);
        let mut acl = next_rules(&told, channel);
        breathe();
        // The one account may not enter.
        acl.rules.push(AclRule {
            here: true,
            subs: true,
            inherited: false,
            user: Some(account),
            group: None,
            grant: 0,
            deny: 0x4,
        });
        admin.act(Action::SetAcl(acl));
        let taken = next_rules(&told, channel);
        assert!(
            taken.rules.iter().any(|rule| rule.user == Some(account)),
            "{taken:?}"
        );
        let refused = one.events();
        one.join_channel(channel);
        wait_for("the one to be refused", || {
            std::iter::from_fn(|| refused.try_recv().ok())
                .any(|event| matches!(event, EngineEvent::Notice(Some(_))))
        });
        assert_eq!(one.snapshot().current_channel, Some(root));
        other.join_channel(channel);
        wait_for("the other to be let in", || {
            other.snapshot().current_channel == Some(channel)
        });

        other.join_channel(root);
        admin.act(Action::DeleteChannel { channel });
        wait_for("the channel to go", || ruled(&one).is_none());
        admin.act(Action::Unregister { id: account });
        std::thread::sleep(std::time::Duration::from_secs(1));
        for (engine, dir) in [(admin, admin_dir), (one, one_dir), (other, other_dir)] {
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

    /// GIFs on a Fancy server: its own GIF service is asked about on
    /// joining, and on a server with no provider key it says it has none,
    /// so nobody is offered a GIF without a key of their own. One client
    /// then picks a GIF from a stand-in for Klipy on this machine and sends
    /// it as the web client does; the other reads a picture by its address
    /// and fetches an animation from there.
    #[test]
    #[ignore = "needs a live Fancy server"]
    fn live_fancy_a_picked_gif_is_sent_and_seen_as_a_playing_picture() {
        use crate::gif::stand_in::{KEY, StandIn};
        use crate::gif::{Source as _, Why, klipy::Klipy, wait};
        let (alice, alice_dir) = fancy_client("GifAlice", None);
        let (bob, bob_dir) = fancy_client("GifBob", None);
        wait_for("both to connect", || {
            alice.snapshot().users.len() >= 2 && bob.snapshot().users.len() >= 2
        });
        // Twelve seconds of silence also reads as an answer.
        wait_for("the server to say what its GIF service is", || {
            alice.gif_service().is_some()
        });
        let service = alice.gif_service().expect("said");
        let fetch: Arc<dyn crate::embed::Fetch> = Arc::new(crate::embed::Web);
        if !service.support.available {
            assert!(crate::gif::Plan::of(Some(&service), None, Arc::clone(&fetch)).is_none());
            let refused = wait(service.source.trending(1)).expect_err("no provider key");
            assert_eq!(refused.why, Why::Unavailable);
        }
        let stand_in = StandIn::start();
        let klipy = Klipy::at(&stand_in.api(), KEY, fetch);
        let picked = wait(klipy.search("party", 1)).expect("a page").gifs[0].clone();
        let room = Conversation::Channel(alice.snapshot().current_channel.expect("a channel"));
        alice.send_gif(room, picked.url.clone(), None);
        let seen = |engine: &RealEngine| {
            engine.messages(room).iter().any(|message| {
                crate::rich::Rich::parse(&message.html).web_pictures == [picked.url.to_string()]
            })
        };
        wait_for("bob to read the GIF by its address", || seen(&bob));
        let bytes =
            crate::embed::Fetch::fetch(&crate::embed::Web, &picked.url, crate::embed::PICTURE_MOST)
                .recv_blocking()
                .expect("an answer")
                .expect("the GIF");
        let decoder =
            image::codecs::gif::GifDecoder::new(std::io::Cursor::new(bytes)).expect("a GIF");
        let frames = image::AnimationDecoder::into_frames(decoder).count();
        assert!(frames >= 2, "an animation, of {frames} frames");
        for (engine, dir) in [(alice, alice_dir), (bob, bob_dir)] {
            engine.shutdown();
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}
