//! The engine, as a library.
//!
//! What a view that is not the Tauri application links against: a handle to
//! start the engine, the commands a client needs to be a client, and the
//! engine's events as plain values. Deliberately small - connecting, the
//! channel tree, who is where, text chat and voice - and it grows with what
//! such a view actually draws.
//!
//! Everything here is a thin, typed layer over the same `state/` the Tauri
//! commands call; nothing is implemented twice.

use std::path::PathBuf;
use std::sync::Arc;

use crate::state::core_event::{CoreEvent, Event};
use crate::state::host::{
    AppDirs, EventSink, Host, HostParts, NoBackgroundService, NoSignalInterceptor, Notifier,
};
use crate::state::pchat::IdentityStore;
use crate::state::types::{
    AclEntryInput, AclGroupInput, AclInput, BanEntryInput, ChannelEntry, ChatMessage,
    ConnectionStatus, RegisteredUserUpdate, UserEntry, VoiceState,
};
use crate::state::types::{AclPayload, PageRequest, SearchFilter};
use crate::state::{AppState, Credentials, LinkEmbed, WhisperEntry};
use mumble_protocol::state::PchatProtocol;

/// Where the engine keeps its files.
#[derive(Debug, Clone)]
pub struct EngineDirs {
    /// Certificates, identities and message keys. Created on demand.
    pub data: PathBuf,
    /// Files the system may delete, if the platform has such a place.
    pub cache: Option<PathBuf>,
}

/// Where the connection to the server stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Connection {
    /// Not connected.
    Disconnected,
    /// A connection attempt is under way.
    Connecting,
    /// Connected and synchronised.
    Connected,
}

/// The local voice state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Voice {
    /// Voice is off: nothing is captured and nothing is heard.
    Off,
    /// Hearing and transmitting.
    On,
    /// Hearing, with the microphone muted.
    Muted,
}

/// Something that happened in the engine. Each says what to read again.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum EngineEvent {
    /// A connection attempt has started.
    Connecting,
    /// The server accepted the connection and sent its initial state.
    Connected,
    /// The session ended, by either side.
    Disconnected {
        /// Why, when the engine knows.
        reason: Option<String>,
    },
    /// The server refused the connection or removed the user.
    Rejected {
        /// The server's words.
        reason: String,
    },
    /// Channels, users or their properties changed.
    StateChanged,
    /// The local user is now in another channel.
    CurrentChannelChanged,
    /// A user started or stopped talking.
    UserTalking {
        /// The session that is talking, or has stopped.
        session: u32,
        /// Whether it is talking now.
        talking: bool,
    },
    /// The local voice state changed.
    VoiceChanged,
    /// A channel received, changed or lost a message.
    NewMessage {
        /// The channel.
        channel: u32,
    },
    /// A direct message arrived from, or was sent to, this user.
    NewDirectMessage {
        /// The other party's session.
        session: u32,
    },
    /// The counts of unread messages changed.
    UnreadChanged,
    /// Something happened that the user should hear of while they are
    /// looking elsewhere: show a system notification.
    Notify {
        /// Who or what it is about.
        title: String,
        /// What happened, as plain text.
        body: String,
    },
    /// Ask for the user's attention without interrupting them.
    Attention,
    /// The server refused something the user asked for: entering a channel,
    /// sending a message that is too long.
    Denied {
        /// The server's words, where it gave any.
        reason: Option<String>,
    },
    /// Somebody is writing in a channel. Said again every few seconds for
    /// as long as they are; nothing says when they stop.
    Typing {
        /// The channel they are writing in.
        channel: u32,
        /// Who is writing.
        session: u32,
    },
    /// A reaction was put on a message, or taken off it.
    Reaction {
        /// The channel the message is in.
        channel: u32,
        /// The reaction.
        reaction: ReactionInfo,
        /// Whether it was put on; `false` when it was taken off.
        added: bool,
    },
    /// The local user started whispering, or stopped.
    Whispering(bool),
    /// Who is asking for the key of an encrypted channel changed: read
    /// [`EngineHandle::key_requests`] again.
    KeyRequests {
        /// The channel.
        channel: u32,
    },
    /// Somebody else put a poll to a channel.
    Poll(PollInfo),
    /// Somebody else answered a poll.
    PollVote(PollVoteInfo),
    /// How far each reader of a channel has read: said when one of them
    /// reads on, and in answer to [`EngineHandle::request_readers`].
    Readers {
        /// The channel.
        channel: u32,
        /// Its readers; one who has read nothing is not among them.
        readers: Vec<ReaderInfo>,
    },
    /// The server looked behind links asked about with
    /// [`EngineHandle::link_previews`].
    LinkPreviews(Vec<LinkPreview>),
    /// The server answered [`EngineHandle::request_acl`].
    Acl(AclInfo),
    /// The server answered [`EngineHandle::request_bans`].
    Bans(Vec<BanInfo>),
    /// The server answered [`EngineHandle::request_registered`].
    Registered(Vec<RegisteredInfo>),
    /// The server answered [`EngineHandle::request_user_stats`].
    UserStats(UserStats),
    /// The reactions a channel's messages already carried, read from the
    /// server's store.
    Reactions {
        /// The channel.
        channel: u32,
        /// Every reaction on its messages.
        reactions: Vec<ReactionInfo>,
    },
}

/// What a server says of itself once connected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerDetails {
    /// The host connected to.
    pub host: String,
    /// The port connected to.
    pub port: u16,
    /// How many users are on it.
    pub users: u32,
    /// How many it admits, where it said.
    pub max_users: Option<u32>,
    /// The server software's release, where it said.
    pub release: Option<String>,
    /// The system it runs on, where it said.
    pub os: Option<String>,
    /// The protocol version it speaks, where it said.
    pub protocol: Option<String>,
    /// The most a client may send, in bits a second, where it said.
    pub max_bandwidth: Option<u32>,
    /// Whether it speaks the Fancy extensions.
    pub fancy: bool,
}

/// What a server knows of one user's connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserStats {
    /// Whose.
    pub session: u32,
    /// The round trip over TCP, in milliseconds.
    pub tcp_ping_ms: u32,
    /// The round trip over UDP, in milliseconds; zero when voice is
    /// tunnelled.
    pub udp_ping_ms: u32,
    /// How long they have been connected, in seconds.
    pub online_secs: Option<u32>,
    /// How long since they last did anything, in seconds.
    pub idle_secs: Option<u32>,
    /// Their client's version.
    pub version: Option<String>,
    /// The system their client runs on.
    pub os: Option<String>,
    /// Their address; a server tells only an administrator.
    pub address: Option<String>,
}

/// Who a whisper goes to instead of the channel the speaker is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhisperTarget {
    /// One user, wherever they are.
    User(u32),
    /// Everybody in a channel: a shout.
    Channel(u32),
}

impl WhisperTarget {
    fn entries(self) -> Vec<WhisperEntry> {
        let blank = WhisperEntry {
            sessions: Vec::new(),
            channel_id: None,
            group: None,
            links: false,
            children: false,
        };
        vec![match self {
            Self::User(session) => WhisperEntry {
                sessions: vec![session],
                ..blank
            },
            Self::Channel(channel) => WhisperEntry {
                channel_id: Some(channel),
                ..blank
            },
        }]
    }
}

/// The one slot this API whispers at. A view with one whisper key has one
/// target at a time.
const WHISPER_SLOT: u8 = 1;

/// What to change about a channel; what is `None` is left as it is.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelChange {
    /// Its name.
    pub name: Option<String>,
    /// What is said about it, as plain text; empty says nothing.
    pub description: Option<String>,
    /// The password it is entered with; empty lets anybody in.
    pub password: Option<String>,
}

/// What becomes of the messages of a channel being created.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum History {
    /// Gone when they have been read: stock Mumble.
    #[default]
    None,
    /// Kept by the server, under its own key, for whoever joins later.
    OnServer,
    /// Kept by the server sealed with a key it does not have. Those in
    /// the channel pass the key on to those who join, when they agree to.
    EndToEnd,
}

/// Somebody who joined an encrypted channel and asks for its key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyRequestInfo {
    /// Who: their certificate's hash, which names them to an answer.
    pub hash: String,
    /// Their name.
    pub name: String,
}

/// A file shared in a message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentInfo {
    /// The file's name.
    pub filename: String,
    /// Its size in bytes, where the sender said.
    pub size: Option<u64>,
    /// What the server keeps it under: what
    /// [`EngineHandle::save_shared_file`] is asked for it by.
    pub key: Option<String>,
    /// A link anyone holding it can fetch the file from, where it has one.
    pub url: Option<String>,
}

/// The mark a shared file is written into a message as: a comment, so a
/// client that does not know it draws nothing.
const FILE_MARK: &str = "<!-- FANCY_FILE:";
const MARK_END: &str = " -->";

/// The files shared in the message `html`, in order.
pub fn attachments_in(html: &str) -> Vec<AttachmentInfo> {
    use base64::Engine as _;
    let mut found = Vec::new();
    let mut rest = html;
    while let Some(at) = rest.find(FILE_MARK) {
        rest = &rest[at + FILE_MARK.len()..];
        let Some(end) = rest.find(MARK_END) else {
            break;
        };
        let stated = base64::engine::general_purpose::STANDARD
            .decode(&rest[..end])
            .ok()
            .and_then(|json| serde_json::from_slice::<serde_json::Value>(&json).ok());
        rest = &rest[end..];
        let Some(stated) = stated else {
            continue;
        };
        let text = |name: &str| {
            stated
                .get(name)
                .and_then(serde_json::Value::as_str)
                .filter(|text| !text.is_empty())
                .map(str::to_owned)
        };
        let (key, url) = (text("key"), text("url"));
        // A mark that names no file, or no way to it, is not a file.
        if let Some(filename) = text("filename").filter(|_| key.is_some() || url.is_some()) {
            found.push(AttachmentInfo {
                filename,
                size: stated.get("sizeBytes").and_then(serde_json::Value::as_u64),
                key,
                url,
            });
        }
    }
    found
}

/// The mark a reply names the message it answers with.
const QUOTE_MARK: &str = "<!-- FANCY_QUOTE:";

/// The id of the message that the message `html` is a reply to.
pub fn reply_target(html: &str) -> Option<&str> {
    let after = &html[html.find(QUOTE_MARK)? + QUOTE_MARK.len()..];
    let id = &after[..after.find(MARK_END)?];
    (!id.is_empty()).then_some(id)
}

/// `text` as the message that answers the message `to`.
fn reply_html(to: &str, text: &str) -> String {
    // The id goes into a comment: nothing in it may end one.
    let to = to
        .chars()
        .filter(|c| !matches!(c, '<' | '>'))
        .collect::<String>()
        .replace("--", "");
    format!("{QUOTE_MARK}{to}{MARK_END}{text}")
}

/// `html`, escaped text, with every `@Name` of somebody on the server made
/// the mention a Fancy client draws as one and tells them of; `@everyone`
/// and `@here` likewise. Another client reads the `@Name` it always was.
///
/// A mention starts a word and ends one: `mail@Rin.example` names nobody,
/// and with a Rin and a Rina on the server `@Rina` is Rina.
fn with_mentions(html: &str, users: &[(u32, String)]) -> String {
    if !html.contains('@') {
        return html.to_owned();
    }
    // Names as they stand in the escaped text, longest first.
    let mut names: Vec<(String, String)> = users
        .iter()
        .filter(|(_, name)| !name.is_empty())
        .map(|(session, name)| {
            (
                escape_html(name),
                format!(r#"class="mention mention-user" data-mention-session="{session}""#),
            )
        })
        .chain(["everyone", "here"].map(|all| {
            (
                all.to_owned(),
                format!(r#"class="mention mention-{all}" data-mention-{all}="1""#),
            )
        }))
        .collect();
    names.sort_by_key(|(name, _)| std::cmp::Reverse(name.len()));

    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(at) = rest.find('@') {
        let starts_word = rest[..at]
            .chars()
            .next_back()
            .or_else(|| out.chars().next_back())
            .is_none_or(|before| !before.is_alphanumeric());
        out.push_str(&rest[..at]);
        let after = &rest[at + 1..];
        let named = names.iter().find(|(name, _)| {
            starts_word
                && after.starts_with(name.as_str())
                && after[name.len()..]
                    .chars()
                    .next()
                    .is_none_or(|next| !next.is_alphanumeric())
        });
        match named {
            Some((name, attributes)) => {
                out.push_str(&format!("<span {attributes}>@{name}</span>"));
                rest = &after[name.len()..];
            }
            None => {
                out.push('@');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The message that shares a file kept under `key`: the mark every Fancy
/// client draws a card from, and beside it a line for a client that draws
/// a comment as nothing.
fn file_message(filename: &str, size: u64, key: &str, expires_at: u64) -> String {
    use base64::Engine as _;
    let stated = serde_json::json!({
        "url": "",
        "filename": filename,
        "sizeBytes": size,
        "mode": "session",
        "expiresAt": (expires_at > 0).then_some(expires_at),
        "key": key,
    });
    format!(
        "{FILE_MARK}{}{MARK_END}<!-- FANCY_LEGACY -->{} ({size} bytes), shared as a file<!-- /FANCY_LEGACY -->",
        base64::engine::general_purpose::STANDARD.encode(stated.to_string()),
        escape_html(filename),
    )
}

/// A poll put to a channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PollInfo {
    /// The channel it was put to.
    pub channel: u32,
    /// What names it to a vote.
    pub id: String,
    /// What is asked.
    pub question: String,
    /// The answers to choose from.
    pub options: Vec<String>,
    /// Whether more than one answer may be chosen.
    pub multiple: bool,
    /// Who asked.
    pub creator: u32,
    /// Their name, where the server gave it.
    pub creator_name: Option<String>,
}

/// One user's answer to a poll: all of it, replacing what they answered
/// before.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PollVoteInfo {
    /// The channel the poll was put to.
    pub channel: u32,
    /// The poll.
    pub poll: String,
    /// The answers chosen, as places among the poll's options.
    pub selected: Vec<u32>,
    /// Who answered.
    pub voter: u32,
}

/// How far somebody has read a channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReaderInfo {
    /// Who: their certificate's hash, which outlives a session.
    pub hash: String,
    /// Their name.
    pub name: String,
    /// The newest message they have read.
    pub read_up_to: String,
}

/// A message that matched a search.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundMessage {
    /// The part of the message that matched, as plain text.
    pub text: String,
    /// Who sent it.
    pub sender_name: String,
    /// Where it was said, in words: `in #Gaming`, `DM with enot`.
    pub place: String,
    /// The channel it was said in, or
    pub channel: Option<u32>,
    /// the other party of the direct conversation it was said in.
    pub direct: Option<u32>,
    /// When it was sent, in Unix epoch milliseconds, where known.
    pub sent_at_ms: Option<u64>,
}

/// What a server found behind a link: enough for a small card.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkPreview {
    /// The link as it stands in the message: what to file the card under.
    pub url: String,
    /// The page's title.
    pub title: Option<String>,
    /// What the page says of itself.
    pub description: Option<String>,
    /// The site's name.
    pub site: Option<String>,
    /// A small picture for the card, as an encoded image. Fetched by the
    /// server: showing it contacts nobody.
    pub thumbnail: Option<Vec<u8>>,
}

impl LinkPreview {
    fn from_embed(url: String, embed: LinkEmbed) -> Self {
        use base64::Engine as _;
        let thumbnail = [embed.thumbnail, embed.image]
            .into_iter()
            .flatten()
            .find_map(|media| media.preview)
            .and_then(|preview| {
                let (_, encoded) = preview.data_url.split_once(";base64,")?;
                base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .ok()
            });
        let said = |text: Option<String>| text.filter(|text| !text.trim().is_empty());
        Self {
            url,
            title: said(embed.title),
            description: said(embed.description).or_else(|| said(embed.summary)),
            site: said(embed.site_name).or_else(|| embed.provider.map(|provider| provider.name)),
            thumbnail,
        }
    }
}

/// Who may do what in a channel: its groups and its rules.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AclInfo {
    /// The channel.
    pub channel: u32,
    /// Whether the parent channel's rules apply here too.
    pub inherit: bool,
    /// The groups rules can name.
    pub groups: Vec<AclGroupInfo>,
    /// The rules, in the order they are applied: a later one overrides an
    /// earlier one.
    pub rules: Vec<AclRuleInfo>,
}

/// A group of users a rule can name. Everything here goes back to the
/// server with [`EngineHandle::set_acl`], so a view that changes only the
/// rules hands the groups back as it got them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AclGroupInfo {
    /// The group's name.
    pub name: String,
    /// Whether it comes from a parent channel.
    pub inherited: bool,
    /// Whether it takes the parent's members.
    pub inherit: bool,
    /// Whether sub-channels take it.
    pub inheritable: bool,
    /// The accounts added here.
    pub add: Vec<u32>,
    /// The accounts taken out here.
    pub remove: Vec<u32>,
    /// The accounts it has from the parent.
    pub inherited_members: Vec<u32>,
    /// How a Fancy server has the group drawn: its colour,
    pub color: Option<String>,
    /// its icon,
    pub icon: Option<Vec<u8>>,
    /// its style,
    pub style_preset: Option<String>,
    /// and whatever else it says of it.
    pub metadata: std::collections::HashMap<String, String>,
}

/// One rule: for a group or one account, what is allowed and what denied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AclRuleInfo {
    /// Whether it applies in this channel.
    pub apply_here: bool,
    /// Whether it applies in the channels under it.
    pub apply_subs: bool,
    /// Whether it comes from a parent channel: it cannot be changed here.
    pub inherited: bool,
    /// The account it is for, or
    pub user: Option<u32>,
    /// the group.
    pub group: Option<String>,
    /// The permissions allowed, as Mumble's bits.
    pub grant: u32,
    /// The permissions denied.
    pub deny: u32,
}

impl From<AclPayload> for AclInfo {
    fn from(acl: AclPayload) -> Self {
        Self {
            channel: acl.channel_id,
            inherit: acl.inherit_acls,
            groups: acl
                .groups
                .into_iter()
                .map(|group| AclGroupInfo {
                    name: group.name,
                    inherited: group.inherited,
                    inherit: group.inherit,
                    inheritable: group.inheritable,
                    add: group.add,
                    remove: group.remove,
                    inherited_members: group.inherited_members,
                    color: group.color,
                    icon: group.icon,
                    style_preset: group.style_preset,
                    metadata: group.metadata,
                })
                .collect(),
            rules: acl
                .acls
                .into_iter()
                .map(|rule| AclRuleInfo {
                    apply_here: rule.apply_here,
                    apply_subs: rule.apply_subs,
                    inherited: rule.inherited,
                    user: rule.user_id,
                    group: rule.group,
                    grant: rule.grant,
                    deny: rule.deny,
                })
                .collect(),
        }
    }
}

/// One entry of the server's ban list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BanInfo {
    /// The banned address.
    pub address: String,
    /// How many leading bits of the address count: 32 or 128 is that one
    /// address, less is a network.
    pub mask: u32,
    /// The name the banned user had.
    pub name: String,
    /// The banned certificate's hash, where there was one.
    pub hash: String,
    /// Why, in the banner's words.
    pub reason: String,
    /// When it started, as the server writes it.
    pub start: String,
    /// How long it lasts, in seconds; zero is for good.
    pub duration_secs: u32,
}

/// One account registered on the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisteredInfo {
    /// The account's id.
    pub id: u32,
    /// Its name.
    pub name: String,
    /// When it was last on, as the server writes it.
    pub last_seen: Option<String>,
    /// The channel it was last in.
    pub last_channel: Option<u32>,
}

/// One user's reaction to one message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReactionInfo {
    /// The message reacted to.
    pub message: String,
    /// The emoji, or a server emote's `:shortcode:`.
    pub emoji: String,
    /// Whose reaction: their certificate's hash, which outlives a session.
    pub by: String,
    /// Their name when they reacted.
    pub by_name: String,
}

impl EngineEvent {
    /// The engine's event as this API reports it, or `None` for the many a
    /// minimal view has no use for yet.
    fn from_core(event: CoreEvent) -> Option<Self> {
        Some(match event {
            CoreEvent::Connecting => Self::Connecting,
            CoreEvent::Connected => Self::Connected,
            CoreEvent::Disconnected(payload) => Self::Disconnected {
                reason: payload.reason,
            },
            CoreEvent::ConnectionRejected(payload) => Self::Rejected {
                reason: payload.reason,
            },
            CoreEvent::StateChanged => Self::StateChanged,
            CoreEvent::CurrentChannelChanged(_) => Self::CurrentChannelChanged,
            CoreEvent::UserTalking { session, talking } => Self::UserTalking { session, talking },
            CoreEvent::VoiceStateChanged(_) => Self::VoiceChanged,
            CoreEvent::NewMessage(payload) => Self::NewMessage {
                channel: payload.channel_id,
            },
            CoreEvent::NewDm(payload) => Self::NewDirectMessage {
                session: payload.session,
            },
            CoreEvent::UnreadChanged(_) | CoreEvent::DmUnreadChanged(_) => Self::UnreadChanged,
            CoreEvent::PermissionDenied(payload) => Self::Denied {
                reason: payload.reason.filter(|reason| !reason.is_empty()),
            },
            CoreEvent::ListenDenied(_) => Self::Denied {
                reason: Some("The server does not let you listen to that channel.".to_owned()),
            },
            CoreEvent::PchatPinDelivered(payload) => Self::NewMessage {
                channel: payload.channel_id,
            },
            CoreEvent::PchatPinsFetched(payload) => Self::NewMessage {
                channel: payload.channel_id,
            },
            CoreEvent::TypingIndicator(payload) => Self::Typing {
                channel: payload.channel_id,
                session: payload.session,
            },
            CoreEvent::PchatReactionDelivered(payload) => Self::Reaction {
                channel: payload.channel_id,
                added: payload.action != "remove",
                reaction: ReactionInfo {
                    message: payload.message_id,
                    emoji: payload.emoji,
                    by: payload.sender_hash,
                    by_name: payload.sender_name,
                },
            },
            CoreEvent::PchatReactionsFetched(payload) => Self::Reactions {
                channel: payload.channel_id,
                reactions: payload
                    .reactions
                    .into_iter()
                    .map(|stored| ReactionInfo {
                        message: stored.message_id,
                        emoji: stored.emoji,
                        by: stored.sender_hash,
                        by_name: stored.sender_name,
                    })
                    .collect(),
            },
            // A pin, an edit or a deletion read back from the store changes
            // messages already on screen.
            CoreEvent::PchatFetchComplete(payload) => Self::NewMessage {
                channel: payload.channel_id,
            },
            other => return Self::answer_from_core(other),
        })
    }

    /// The rest of [`Self::from_core`]: what a server answers when asked.
    fn answer_from_core(event: CoreEvent) -> Option<Self> {
        Some(match event {
            CoreEvent::WhisperState(active) => Self::Whispering(active),
            // Only a refusal is news; a list that merely shrank is not.
            CoreEvent::WhisperDenials(denials) => {
                Self::Denied {
                    reason: Some(denials.latest?.reason.unwrap_or_else(|| {
                        "The server does not let you whisper there.".to_owned()
                    })),
                }
            }
            CoreEvent::PchatKeyShareRequested(payload) => Self::KeyRequests {
                channel: payload.channel_id,
            },
            CoreEvent::PchatKeyShareRequestsChanged(payload) => Self::KeyRequests {
                channel: payload.channel_id,
            },
            CoreEvent::Poll(payload) => Self::Poll(PollInfo {
                channel: payload.channel_id,
                id: payload.poll_id,
                question: payload.question,
                options: payload.options,
                multiple: payload.multiple,
                creator: payload.creator_session,
                creator_name: payload.creator_name,
            }),
            CoreEvent::PollVote(payload) => Self::PollVote(PollVoteInfo {
                channel: payload.channel_id,
                poll: payload.poll_id,
                selected: payload.selected,
                voter: payload.voter_session,
            }),
            CoreEvent::ReadReceipts(payload) => Self::Readers {
                channel: payload.channel_id,
                readers: payload
                    .read_states
                    .into_iter()
                    .filter(|state| !state.last_read_message_id.is_empty())
                    .map(|state| ReaderInfo {
                        hash: state.cert_hash,
                        name: state.name,
                        read_up_to: state.last_read_message_id,
                    })
                    .collect(),
            },
            CoreEvent::LinkPreviews(payload) => Self::LinkPreviews(
                payload
                    .requested_urls
                    .into_iter()
                    .zip(payload.embeds)
                    .map(|(url, embed)| LinkPreview::from_embed(url, embed))
                    .collect(),
            ),
            CoreEvent::Acl(acl) => Self::Acl(acl.into()),
            CoreEvent::BanList(bans) => Self::Bans(
                bans.into_iter()
                    .map(|ban| BanInfo {
                        address: ban.address,
                        mask: ban.mask,
                        name: ban.name,
                        hash: ban.hash,
                        reason: ban.reason,
                        start: ban.start,
                        duration_secs: ban.duration,
                    })
                    .collect(),
            ),
            CoreEvent::RegisteredUsers(users) => Self::Registered(
                users
                    .into_iter()
                    .map(|user| RegisteredInfo {
                        id: user.user_id,
                        name: user.name,
                        last_seen: user.last_seen,
                        last_channel: user.last_channel,
                    })
                    .collect(),
            ),
            CoreEvent::UserStats(payload) => Self::UserStats(UserStats {
                session: payload.session,
                tcp_ping_ms: whole_ms(payload.tcp_ping_avg),
                udp_ping_ms: whole_ms(payload.udp_ping_avg),
                online_secs: payload.onlinesecs,
                idle_secs: payload.idlesecs,
                os: match (payload.os, payload.os_version) {
                    (Some(os), Some(version)) if !version.is_empty() => {
                        Some(format!("{os} {version}"))
                    }
                    (os, _) => os,
                },
                version: payload.version,
                address: payload.address,
            }),
            _ => return None,
        })
    }
}

/// One channel of the server's tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelInfo {
    /// The channel's id on its server.
    pub id: u32,
    /// The parent channel; `None` for the root.
    pub parent: Option<u32>,
    /// The channel's name.
    pub name: String,
    /// Where the channel sorts among its siblings.
    pub position: i32,
    /// Whether the server keeps what is said here, for those who come
    /// later.
    pub keeps_history: bool,
    /// Whether what is kept is sealed with a key the server does not
    /// have: only those in the channel who were given it can read it.
    pub encrypted: bool,
}

impl From<ChannelEntry> for ChannelInfo {
    fn from(channel: ChannelEntry) -> Self {
        Self {
            id: channel.id,
            parent: channel.parent_id,
            name: channel.name,
            position: channel.position,
            keeps_history: channel
                .pchat_protocol
                .is_some_and(|protocol| protocol != PchatProtocol::None),
            encrypted: matches!(
                channel.pchat_protocol,
                Some(PchatProtocol::FancyV1FullArchive | PchatProtocol::SignalV1)
            ),
        }
    }
}

/// One connected user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserInfo {
    /// The user's session id.
    pub session: u32,
    /// The user's name.
    pub name: String,
    /// The channel the user is in.
    pub channel: u32,
    /// Muted, by themselves or by the server.
    pub muted: bool,
    /// Deafened, by themselves or by the server.
    pub deafened: bool,
    /// Present when the user has a picture; changes when the picture does.
    /// The picture itself is fetched with [`EngineHandle::user_avatar`].
    pub avatar: Option<u32>,
    /// Whether the user is heard over everybody else in their channel.
    pub priority_speaker: bool,
}

impl From<UserEntry> for UserInfo {
    fn from(user: UserEntry) -> Self {
        Self {
            session: user.session,
            name: user.name,
            channel: user.channel_id,
            muted: user.self_mute || user.mute || user.suppress,
            deafened: user.self_deaf || user.deaf,
            avatar: user.texture_marker.filter(|size| *size > 0),
            priority_speaker: user.priority_speaker,
        }
    }
}

/// One chat message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageInfo {
    /// Who sent it; `None` once that user has left.
    pub sender: Option<u32>,
    /// The sender's name at the time.
    pub sender_name: String,
    /// The message as plain text. A message that is only a picture or a
    /// file says what was sent.
    pub text: String,
    /// The message as it was sent: HTML.
    pub html: String,
    /// When it was sent, in Unix epoch milliseconds, where known.
    pub sent_at_ms: Option<u64>,
    /// Whether the local user sent it.
    pub own: bool,
    /// What names the message to an edit, a reaction or a deletion. Only a
    /// Fancy server hands these out.
    pub id: Option<String>,
    /// Whether it was changed after it was sent.
    pub edited: bool,
    /// Whether it is pinned in its channel.
    pub pinned: bool,
    /// Whether the server refused it: nobody else has seen it.
    pub failed: bool,
}

impl From<ChatMessage> for MessageInfo {
    fn from(message: ChatMessage) -> Self {
        Self {
            sender: message.sender_session,
            sender_name: message.sender_name,
            text: fancy_utils::html::message_preview(&message.body),
            html: message.body,
            sent_at_ms: message.timestamp,
            own: message.is_own,
            id: message.message_id,
            edited: message.edited_at.is_some(),
            pinned: message.pinned,
            failed: message.send_failed,
        }
    }
}

/// The newest messages of a conversation.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MessageWindow {
    /// The messages, oldest first.
    pub messages: Vec<MessageInfo>,
    /// Whether there are older ones: held here, or kept by the server.
    pub earlier: bool,
}

/// What a server answered when asked, without connecting, whether it is up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PingInfo {
    /// Whether anything answered at that address.
    pub online: bool,
    /// Round trip, in milliseconds.
    pub latency_ms: Option<u32>,
    /// Users connected right now.
    pub users: Option<u32>,
    /// The most the server admits.
    pub max_users: Option<u32>,
    /// The server's version, as it reports it.
    pub version: Option<String>,
}

/// One of the servers the engine is on, or was and may be again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionInfo {
    /// What names the session to [`EngineHandle::activate_session`].
    pub id: String,
    /// The server's host name.
    pub host: String,
    /// The server's port.
    pub port: u16,
    /// The name the user is there under.
    pub username: String,
    /// Where its connection stands.
    pub connection: Connection,
    /// Whether it is the one every other call here is about.
    pub active: bool,
}

/// A microphone or a speaker the system offers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioDeviceInfo {
    /// The device's name; what [`EngineHandle::select_devices`] takes.
    pub name: String,
    /// Whether it is the system's default.
    pub is_default: bool,
}

/// The audio devices the system offers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AudioDevices {
    /// Microphones.
    pub inputs: Vec<AudioDeviceInfo>,
    /// Speakers.
    pub outputs: Vec<AudioDeviceInfo>,
}

/// How the microphone is used.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VoiceSettings {
    /// Transmit only while the push-to-talk key is held, instead of
    /// whenever the microphone hears something.
    pub push_to_talk: bool,
    /// How loud the microphone must be before it counts as speech, from
    /// 0.0 to 1.0. Not used with push to talk.
    pub activation_threshold: f32,
    /// Whether background noise is filtered out.
    pub noise_suppression: bool,
    /// Whether quiet speech is brought up to a common level.
    pub automatic_gain: bool,
    /// How loud the microphone is sent: 1.0 as captured, 0.0 silent.
    pub input_volume: f32,
    /// How loud everybody is played: 1.0 as sent, 0.0 silent.
    pub output_volume: f32,
    /// How many bits a second voice is encoded at.
    pub bitrate_bps: u32,
    /// Whether voice travels with everything else over TCP, for a network
    /// that loses or blocks UDP. Slower to arrive.
    pub voice_over_tcp: bool,
}

/// Who to connect as, and where.
#[derive(Debug, Clone, Default)]
pub struct ConnectTarget {
    /// The server's host name or address.
    pub host: String,
    /// The server's port.
    pub port: u16,
    /// The name to arrive under.
    pub username: String,
    /// The identity (client certificate) to present, by its label. It is
    /// created if it does not exist yet. `None` connects without one.
    pub certificate: Option<String>,
    /// The server's password, if it has one.
    pub password: Option<String>,
}

/// Where the engine's events go, and where its files live.
struct Embedder {
    on_event: Box<dyn Fn(EngineEvent) + Send + Sync>,
    dirs: EngineDirs,
}

impl EventSink for Embedder {
    fn emit(&self, event: Event) {
        if let Some(event) = EngineEvent::from_core(event.kind) {
            (self.on_event)(event);
        }
    }
}

impl Notifier for Embedder {
    fn request_user_attention(&self) {
        (self.on_event)(EngineEvent::Attention);
    }

    fn show_notification(&self, title: &str, body: &str, _: Option<&[u8]>, _: Option<u32>) {
        (self.on_event)(EngineEvent::Notify {
            title: title.to_owned(),
            body: body.to_owned(),
        });
    }
}

impl AppDirs for Embedder {
    fn app_data_dir(&self) -> Result<PathBuf, String> {
        Ok(self.dirs.data.clone())
    }

    fn cache_dir(&self) -> Option<PathBuf> {
        self.dirs.cache.clone()
    }
}

/// A running engine.
///
/// Cheap to clone; every clone is the same engine.
#[derive(Clone)]
pub struct EngineHandle {
    state: AppState,
    data_dir: PathBuf,
}

impl std::fmt::Debug for EngineHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EngineHandle")
            .field("data_dir", &self.data_dir)
            .finish_non_exhaustive()
    }
}

impl EngineHandle {
    /// Start an engine that keeps its files in `dirs`, runs its background
    /// work on `runtime` and reports to `on_event`.
    ///
    /// `on_event` is called from the engine's own threads and must not
    /// block: hand the event to the view's thread and return.
    pub fn start(
        dirs: EngineDirs,
        runtime: tokio::runtime::Handle,
        on_event: impl Fn(EngineEvent) + Send + Sync + 'static,
    ) -> Self {
        // Idempotent; only the first provider installed is used.
        let _ = rustls::crypto::ring::default_provider().install_default();
        crate::state::runtime::adopt(runtime);
        let data_dir = dirs.data.clone();
        let embedder = Arc::new(Embedder {
            on_event: Box::new(on_event),
            dirs,
        });
        let state = AppState::new();
        state.set_host(Host::new(HostParts {
            events: embedder.clone(),
            dirs: embedder.clone(),
            notifier: embedder,
            background: Arc::new(NoBackgroundService),
            signals: Arc::new(NoSignalInterceptor),
        }));
        Self { state, data_dir }
    }

    /// Connect to a server. Returns once the attempt is under way; how it
    /// goes arrives as events.
    ///
    /// # Errors
    ///
    /// When the identity cannot be created or the attempt cannot start.
    pub async fn connect(&self, target: ConnectTarget) -> Result<(), String> {
        if let Some(label) = target.certificate.as_deref() {
            IdentityStore::new(self.data_dir.clone()).generate_cert(label)?;
        }
        self.state
            .connect(
                target.host,
                target.port,
                target.username,
                target.certificate,
                Credentials {
                    password: target.password,
                    ..Credentials::default()
                },
            )
            .await
    }

    /// The labels of the certificates held, in order.
    pub fn certificates(&self) -> Vec<String> {
        IdentityStore::new(self.data_dir.clone()).list_labels()
    }

    /// Delete the certificate `label` and its keys. Registrations made
    /// with it are lost with it.
    ///
    /// # Errors
    ///
    /// When its files could not be removed.
    pub fn delete_certificate(&self, label: &str) -> Result<(), String> {
        IdentityStore::new(self.data_dir.clone()).delete(label)
    }

    /// Write the certificate `label`, private key included, to the file
    /// `to`.
    ///
    /// # Errors
    ///
    /// When there is no such certificate, or the file could not be written.
    pub fn export_certificate(&self, label: &str, to: &std::path::Path) -> Result<(), String> {
        IdentityStore::new(self.data_dir.clone()).export(label, to)
    }

    /// Take in a certificate exported to the file `from`; says the label
    /// it is held under.
    ///
    /// # Errors
    ///
    /// When the file is not an exported certificate.
    pub fn import_certificate(&self, from: &std::path::Path) -> Result<String, String> {
        IdentityStore::new(self.data_dir.clone()).import(from)
    }

    /// Leave the server.
    ///
    /// # Errors
    ///
    /// When the session could not be torn down cleanly.
    pub async fn disconnect(&self) -> Result<(), String> {
        self.state.disconnect().await
    }

    /// Leave the server of the session `id`, whichever one is active.
    ///
    /// # Errors
    ///
    /// When `id` names no session, or it could not be torn down cleanly.
    pub async fn disconnect_session(&self, id: &str) -> Result<(), String> {
        let id = id.parse().map_err(|_| "no such session".to_owned())?;
        self.state.disconnect_session(id).await
    }

    /// Where the connection stands.
    pub fn connection(&self) -> Connection {
        match self.state.status() {
            ConnectionStatus::Disconnected => Connection::Disconnected,
            ConnectionStatus::Connecting => Connection::Connecting,
            ConnectionStatus::Connected => Connection::Connected,
        }
    }

    /// The local user's session, once connected.
    pub fn own_session(&self) -> Option<u32> {
        self.state.get_own_session()
    }

    /// The channel the local user is in.
    pub fn current_channel(&self) -> Option<u32> {
        self.state.current_channel()
    }

    /// Every channel of the server.
    pub fn channels(&self) -> Vec<ChannelInfo> {
        self.state.channels().into_iter().map(Into::into).collect()
    }

    /// Every connected user.
    pub fn users(&self) -> Vec<UserInfo> {
        self.state.users().into_iter().map(Into::into).collect()
    }

    /// The picture of the user `session`, as the encoded image they
    /// uploaded; `None` if they have none. Asks the server on first use.
    pub async fn user_avatar(&self, session: u32) -> Option<Vec<u8>> {
        self.state.user_texture_or_fetch(session).await
    }

    /// The messages of `channel`, oldest first.
    pub fn messages(&self, channel: u32) -> Vec<MessageInfo> {
        self.state
            .messages(channel)
            .into_iter()
            .map(Into::into)
            .collect()
    }

    /// The newest `limit` messages of `channel`. What a view shows: a long
    /// channel costs what is on screen, not what was ever said. In a
    /// channel whose messages the server keeps, the engine lets go of what
    /// lies far outside the window; it can be fetched again.
    pub fn messages_tail(&self, channel: u32, limit: usize) -> MessageWindow {
        let page = self.state.messages_page(&PageRequest {
            channel_id: channel,
            offset_from_tail: 0,
            limit: limit.clamp(1, MAX_WINDOW),
        });
        MessageWindow {
            messages: page.rows.into_iter().map(Into::into).collect(),
            earlier: page.more_before,
        }
    }

    /// The newest `limit` direct messages exchanged with `session`.
    pub fn direct_messages_tail(&self, session: u32, limit: usize) -> MessageWindow {
        let (messages, earlier) = self.state.dm_messages_tail(session, limit);
        MessageWindow {
            messages: messages.into_iter().map(Into::into).collect(),
            earlier,
        }
    }

    /// Ask the server for up to `limit` messages of `channel` older than
    /// the message `before`; they join the channel's messages and are
    /// announced as an [`EngineEvent::NewMessage`]. Only a channel whose
    /// messages the server keeps has any.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn fetch_earlier(
        &self,
        channel: u32,
        before: Option<String>,
        limit: u32,
    ) -> Result<(), String> {
        self.state
            .fetch_older_messages(channel, before, limit)
            .await
    }

    /// The messages held that match `query`, best first, a couple of
    /// dozen at the most. Only what this client holds is searched.
    pub fn search_messages(&self, query: &str) -> Vec<FoundMessage> {
        self.state
            .super_search(query, SearchFilter::Messages, None)
            .into_iter()
            .filter_map(|found| {
                let message = found.message?;
                let (channel, direct) = if message.dm {
                    (None, found.id)
                } else {
                    (found.id, None)
                };
                Some(FoundMessage {
                    text: found.title,
                    sender_name: message.sender_name,
                    place: message.context,
                    channel,
                    direct,
                    sent_at_ms: message.timestamp,
                })
            })
            .collect()
    }

    /// How many messages of `channel` are held. Cheap: for asking whether
    /// [`Self::messages`] is worth reading again.
    pub fn message_count(&self, channel: u32) -> usize {
        self.state.message_count(channel)
    }

    /// How many direct messages with `session` are held; as cheap as
    /// [`Self::message_count`].
    pub fn direct_message_count(&self, session: u32) -> usize {
        self.state.dm_message_count(session)
    }

    /// The direct messages exchanged with the user `session`, oldest first.
    pub fn direct_messages(&self, session: u32) -> Vec<MessageInfo> {
        self.state
            .dm_messages(session)
            .into_iter()
            .map(Into::into)
            .collect()
    }

    /// Open the direct conversation with `session`, marking it read.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub fn open_direct(&self, session: u32) -> Result<(), String> {
        self.state.select_dm_user(session)?;
        self.state.mark_dm_read(session);
        Ok(())
    }

    /// Send `text` to the user `session` as a plain-text direct message.
    ///
    /// # Errors
    ///
    /// When not connected, or the message could not be sent.
    pub async fn send_direct_text(&self, session: u32, text: &str) -> Result<(), String> {
        self.state.send_dm(session, self.composed(text)).await
    }

    /// `text` as the message it is sent as: escaped, its line breaks kept,
    /// and on a Fancy server the people it names mentioned.
    fn composed(&self, text: &str) -> String {
        let html = escape_html(text);
        if !html.contains('@') || !self.fancy() {
            return html;
        }
        let users: Vec<(u32, String)> = self
            .state
            .users()
            .into_iter()
            .map(|user| (user.session, user.name))
            .collect();
        with_mentions(&html, &users)
    }

    /// Send `text` to `channel` as a reply to the message `to`. A client
    /// that knows replies draws what is answered above it; another draws
    /// the text alone.
    ///
    /// # Errors
    ///
    /// When not connected, or the message could not be sent.
    pub async fn reply_text(&self, channel: u32, to: &str, text: &str) -> Result<(), String> {
        self.state
            .send_message(channel, reply_html(to, &self.composed(text)))
            .await
    }

    /// Send `text` to the user `session` as a reply to the message `to`.
    ///
    /// # Errors
    ///
    /// When not connected, or the message could not be sent.
    pub async fn reply_direct_text(
        &self,
        session: u32,
        to: &str,
        text: &str,
    ) -> Result<(), String> {
        self.state
            .send_dm(session, reply_html(to, &self.composed(text)))
            .await
    }

    /// Send `html` to `channel` as it stands: for what plain text cannot
    /// say, a picture above all. The server's limits apply.
    ///
    /// # Errors
    ///
    /// When not connected, or the message could not be sent.
    pub async fn send_html(&self, channel: u32, html: String) -> Result<(), String> {
        self.state.send_message(channel, html).await
    }

    /// Send `html` to the user `session` as it stands.
    ///
    /// # Errors
    ///
    /// When not connected, or the message could not be sent.
    pub async fn send_direct_html(&self, session: u32, html: String) -> Result<(), String> {
        self.state.send_dm(session, html).await
    }

    /// The longest message carrying a picture the server takes, in bytes;
    /// zero when it sets no limit.
    pub fn picture_limit(&self) -> usize {
        self.state.server_config().max_image_message_length as usize
    }

    /// Unread messages per channel; channels with none are absent.
    pub fn unread_channels(&self) -> std::collections::HashMap<u32, u32> {
        self.state.unread_counts()
    }

    /// Unread direct messages per user session; users with none are absent.
    pub fn unread_directs(&self) -> std::collections::HashMap<u32, u32> {
        self.state.dm_unread_counts()
    }

    /// Mark `channel` read, because the user is looking at it.
    pub fn mark_channel_read(&self, channel: u32) {
        self.state.mark_read(channel);
    }

    /// Mark the direct conversation with `session` read.
    pub fn mark_direct_read(&self, session: u32) {
        self.state.mark_dm_read(session);
    }

    /// Move into `channel`, without changing which conversation is open.
    ///
    /// # Errors
    ///
    /// When not connected, or the server refuses.
    pub async fn join_channel(&self, channel: u32) -> Result<(), String> {
        self.state.join_channel(channel, None).await
    }

    /// Move into `channel` and open its conversation.
    ///
    /// # Errors
    ///
    /// When not connected, or the server refuses.
    pub async fn enter_channel(&self, channel: u32) -> Result<(), String> {
        self.state.join_channel(channel, None).await?;
        self.state.select_channel(channel).await
    }

    /// Open the conversation of `channel` without moving into it: marks it
    /// read and fetches its stored history where the server keeps one.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn open_conversation(&self, channel: u32) -> Result<(), String> {
        self.state.select_channel(channel).await
    }

    /// Send `text` to `channel` as a plain-text message.
    ///
    /// # Errors
    ///
    /// When not connected, or the message could not be sent.
    pub async fn send_text(&self, channel: u32, text: &str) -> Result<(), String> {
        self.state.send_message(channel, self.composed(text)).await
    }

    /// Whether the server speaks the Fancy extensions: messages there have
    /// ids, and can be edited, reacted to and deleted.
    pub fn fancy(&self) -> bool {
        self.state.server_info().fancy_version.is_some()
    }

    /// The local user's certificate hash on this server: what a reaction
    /// of theirs is signed with.
    pub fn own_hash(&self) -> Option<String> {
        let own = self.state.get_own_session()?;
        self.state
            .users()
            .into_iter()
            .find(|user| user.session == own)
            .and_then(|user| user.hash)
    }

    /// Replace the text of the local user's message `id` in `channel`.
    ///
    /// # Errors
    ///
    /// When not connected, or the server is not a Fancy one.
    pub async fn edit_text(&self, channel: u32, id: &str, text: &str) -> Result<(), String> {
        self.state
            .edit_message(channel, id.to_owned(), self.composed(text))
            .await
    }

    /// Delete the messages `ids` of `channel` from the server's store.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn delete_messages(&self, channel: u32, ids: Vec<String>) -> Result<(), String> {
        self.state
            .delete_pchat_messages(channel, ids.clone(), None, None, None)
            .await?;
        // The server said yes; this side's copy goes too.
        self.state.forget_local_messages(channel, ids);
        Ok(())
    }

    /// Put `emoji` on the message `id` of `channel`, or with `add` false
    /// take it off again.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn react(
        &self,
        channel: u32,
        id: &str,
        emoji: &str,
        add: bool,
    ) -> Result<(), String> {
        let action = if add { "add" } else { "remove" };
        self.state
            .send_reaction(channel, id.to_owned(), emoji.to_owned(), action.to_owned())
            .await
    }

    /// Pin the message `id` of `channel` for everyone, or with `pinned`
    /// false take the pin off.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn pin(&self, channel: u32, id: &str, pinned: bool) -> Result<(), String> {
        self.state
            .pin_message(channel, id.to_owned(), !pinned)
            .await
    }

    /// The channels the local user hears without being in them.
    pub fn listening(&self) -> Vec<u32> {
        self.state.listened_channels()
    }

    /// Start hearing `channel` without being in it, or stop. Says which
    /// it now is.
    ///
    /// # Errors
    ///
    /// When the server's permissions rule it out.
    pub async fn toggle_listen(&self, channel: u32) -> Result<bool, String> {
        self.state.toggle_listen(channel).await
    }

    /// What the server says of itself.
    pub fn server(&self) -> ServerDetails {
        let info = self.state.server_info();
        ServerDetails {
            host: info.host,
            port: info.port,
            users: info.user_count,
            max_users: info.max_users,
            release: info.release,
            os: info.os,
            protocol: info.protocol_version,
            max_bandwidth: info.max_bandwidth,
            fancy: info.fancy_version.is_some(),
        }
    }

    /// Ask the server what it knows of `session`'s connection; the answer
    /// is an [`EngineEvent::UserStats`].
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn request_user_stats(&self, session: u32) -> Result<(), String> {
        self.state.request_user_stats(session).await
    }

    /// Share the file at `path` with `channel`: upload it to the server
    /// and send the message that names it. For those in the channel only.
    ///
    /// # Errors
    ///
    /// When the file cannot be read, the server keeps no files, or it
    /// refuses this one.
    pub async fn share_file(&self, channel: u32, path: &std::path::Path) -> Result<(), String> {
        let filename = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .ok_or("that is not a file")?;
        let shared = self
            .state
            .starling_upload_file(
                path.to_string_lossy().into_owned(),
                channel,
                None,
                String::new(),
                mumble_protocol::proto::fancy::files::Visibility::Session,
                0,
                String::new(),
                None,
            )
            .await?;
        self.state
            .send_message(
                channel,
                file_message(&filename, shared.size, &shared.key, shared.expires_at),
            )
            .await
    }

    /// Fetch the shared file kept under `key` and write it to `to`; says
    /// how many bytes were written.
    ///
    /// # Errors
    ///
    /// When the server no longer has it, or the file cannot be written.
    pub async fn save_shared_file(&self, key: &str, to: &std::path::Path) -> Result<u64, String> {
        self.state
            .starling_download_to_file(key.to_owned(), to.to_string_lossy().into_owned(), None)
            .await
    }

    /// Who is asking for the key of the encrypted channel `channel`.
    pub fn key_requests(&self, channel: u32) -> Vec<KeyRequestInfo> {
        self.state
            .pending_key_shares(channel)
            .into_iter()
            .map(|pending| KeyRequestInfo {
                hash: pending.peer_cert_hash,
                name: pending.peer_name,
            })
            .collect()
    }

    /// Give the key of `channel` to the one asking for it under `hash`,
    /// or with `share` false turn them down.
    ///
    /// # Errors
    ///
    /// When nobody is asking under that hash, or the key could not be
    /// sent.
    pub async fn answer_key_request(
        &self,
        channel: u32,
        hash: &str,
        share: bool,
    ) -> Result<(), String> {
        if share {
            self.state.approve_key_share(channel, hash.to_owned()).await
        } else {
            self.state.dismiss_key_share(channel, hash)
        }
    }

    /// Put a poll to `channel`; says the id it goes by. The server passes
    /// it on to everybody else there and does not send it back: the
    /// caller already has it.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn create_poll(
        &self,
        channel: u32,
        question: String,
        options: Vec<String>,
        multiple: bool,
    ) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.state
            .send_fancy_poll(
                channel,
                id.clone(),
                question,
                options,
                multiple,
                chrono::Utc::now().to_rfc3339(),
            )
            .await?;
        Ok(id)
    }

    /// Answer the poll `poll` of `channel` with the options at `selected`,
    /// replacing what was answered before. Not sent back either.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn vote(&self, channel: u32, poll: &str, selected: Vec<u32>) -> Result<(), String> {
        self.state
            .send_fancy_poll_vote(channel, poll.to_owned(), selected)
            .await
    }

    /// Say that the local user has read `channel` up to the message `id`.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn mark_read_up_to(&self, channel: u32, id: &str) -> Result<(), String> {
        self.state.send_read_receipt(channel, id.to_owned()).await
    }

    /// Ask how far everybody has read `channel`; the answer is an
    /// [`EngineEvent::Readers`].
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn request_readers(&self, channel: u32) -> Result<(), String> {
        self.state.query_read_receipts(channel).await
    }

    /// What is behind `urls`. The cards this client already holds come
    /// back at once; the server is asked about the rest, and answers in an
    /// [`EngineEvent::LinkPreviews`]. Only a Fancy server looks.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn link_previews(&self, urls: Vec<String>) -> Result<Vec<LinkPreview>, String> {
        let request = uuid::Uuid::new_v4().to_string();
        Ok(self
            .state
            .request_link_preview(urls, request)
            .await?
            .into_iter()
            .map(|hit| LinkPreview::from_embed(hit.requested_url, hit.embed))
            .collect())
    }

    /// Ask the server who may do what in `channel`; the answer is an
    /// [`EngineEvent::Acl`], or a refusal.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn request_acl(&self, channel: u32) -> Result<(), String> {
        self.state.request_acl(channel).await
    }

    /// Replace the groups and rules of a channel with those of `acl`.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn set_acl(&self, acl: AclInfo) -> Result<(), String> {
        self.state
            .update_acl(AclInput {
                channel_id: acl.channel,
                inherit_acls: acl.inherit,
                groups: acl
                    .groups
                    .into_iter()
                    .map(|group| AclGroupInput {
                        name: group.name,
                        inherited: group.inherited,
                        inherit: group.inherit,
                        inheritable: group.inheritable,
                        add: group.add,
                        remove: group.remove,
                        inherited_members: group.inherited_members,
                        color: group.color,
                        icon: group.icon,
                        style_preset: group.style_preset,
                        metadata: group.metadata,
                    })
                    .collect(),
                acls: acl
                    .rules
                    .into_iter()
                    .map(|rule| AclEntryInput {
                        apply_here: rule.apply_here,
                        apply_subs: rule.apply_subs,
                        inherited: rule.inherited,
                        user_id: rule.user,
                        group: rule.group,
                        grant: rule.grant,
                        deny: rule.deny,
                    })
                    .collect(),
            })
            .await
    }

    /// Ask the server for its ban list; the answer is an
    /// [`EngineEvent::Bans`], or a refusal.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn request_bans(&self) -> Result<(), String> {
        self.state.request_ban_list().await
    }

    /// Replace the server's ban list with `bans`.
    ///
    /// # Errors
    ///
    /// When not connected, or an address is not one.
    pub async fn set_bans(&self, bans: Vec<BanInfo>) -> Result<(), String> {
        let bans = bans
            .into_iter()
            .map(|ban| BanEntryInput {
                address: ban.address,
                mask: ban.mask,
                name: ban.name,
                hash: ban.hash,
                reason: ban.reason,
                start: ban.start,
                duration: ban.duration_secs,
            })
            .collect();
        self.state.update_ban_list(bans).await
    }

    /// Ask the server for its registered accounts; the answer is an
    /// [`EngineEvent::Registered`], or a refusal.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn request_registered(&self) -> Result<(), String> {
        self.state.request_user_list().await
    }

    /// Rename the registered account `id`, or with `name` `None` remove
    /// its registration.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn change_registered(&self, id: u32, name: Option<String>) -> Result<(), String> {
        self.state
            .update_user_list(vec![RegisteredUserUpdate { user_id: id, name }])
            .await
    }

    /// Have `session` heard over everybody else in their channel, or not.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn set_priority_speaker(&self, session: u32, priority: bool) -> Result<(), String> {
        self.state.set_priority_speaker(session, priority).await
    }

    /// Say that the local user is writing in `channel`. To be said again
    /// every few seconds while they are.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn typing(&self, channel: u32) -> Result<(), String> {
        self.state.send_typing_indicator(channel).await
    }

    /// The local voice state.
    pub fn voice(&self) -> Voice {
        match self.state.voice_state() {
            VoiceState::Inactive => Voice::Off,
            VoiceState::Active => Voice::On,
            VoiceState::Muted => Voice::Muted,
        }
    }

    /// Whether the local user is deafened.
    pub fn deafened(&self) -> bool {
        self.state.self_deafened()
    }

    /// The microphone button: turns voice on when it is off, and mutes or
    /// unmutes when it is on.
    ///
    /// # Errors
    ///
    /// When not connected, or the audio devices cannot be opened.
    pub async fn toggle_microphone(&self) -> Result<(), String> {
        match self.state.voice_state() {
            VoiceState::Inactive => self.state.enable_voice().await,
            VoiceState::Active | VoiceState::Muted => self.state.toggle_mute().await,
        }
    }

    /// Deafen or undeafen.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn toggle_deafen(&self) -> Result<(), String> {
        self.state.toggle_deafen().await
    }

    /// The microphones and speakers the system offers.
    ///
    /// Blocking - enumeration can stall on a driver - so call it off the
    /// view's thread.
    pub fn audio_devices() -> AudioDevices {
        #[cfg(not(target_os = "android"))]
        {
            let info = |device: crate::state::types::AudioDevice| AudioDeviceInfo {
                name: device.name,
                is_default: device.is_default,
            };
            AudioDevices {
                inputs: crate::state::audio_devices::inputs()
                    .into_iter()
                    .map(info)
                    .collect(),
                outputs: crate::state::audio_devices::outputs()
                    .into_iter()
                    .map(info)
                    .collect(),
            }
        }
        #[cfg(target_os = "android")]
        AudioDevices::default()
    }

    /// The chosen microphone and speaker, by name; `None` is the system's
    /// default.
    pub fn selected_devices(&self) -> (Option<String>, Option<String>) {
        let settings = self.state.audio_settings();
        (settings.selected_device, settings.selected_output_device)
    }

    /// Use the microphone `input` and the speaker `output`, by name; `None`
    /// is the system's default. Takes effect at once if voice is on.
    ///
    /// # Errors
    ///
    /// When a chosen device cannot be opened.
    pub fn select_devices(
        &self,
        input: Option<String>,
        output: Option<String>,
    ) -> Result<(), String> {
        let mut settings = self.state.audio_settings();
        settings.selected_device = input;
        settings.selected_output_device = output;
        self.state.apply_audio_settings(settings)
    }

    /// Every server the engine is on. Connecting to another adds one and
    /// makes it the active one.
    pub fn sessions(&self) -> Vec<SessionInfo> {
        let active = self.state.registry.active_id();
        self.state
            .registry
            .list_meta()
            .into_iter()
            .map(|session| SessionInfo {
                active: active == Some(session.id),
                id: session.id.to_string(),
                host: session.host,
                port: session.port,
                username: session.username,
                connection: match session.status {
                    ConnectionStatus::Disconnected => Connection::Disconnected,
                    ConnectionStatus::Connecting => Connection::Connecting,
                    ConnectionStatus::Connected => Connection::Connected,
                },
            })
            .collect()
    }

    /// Make the session `id` the one every other call here is about; voice
    /// moves with it.
    ///
    /// # Errors
    ///
    /// When `id` names no session.
    pub async fn activate_session(&self, id: &str) -> Result<(), String> {
        let id = id.parse().map_err(|_| "no such session".to_owned())?;
        self.state.switch_active_with_voice(id).await
    }

    /// Tell the engine whether the user is looking at the application. While
    /// they are not, arriving messages count as unread and raise
    /// [`EngineEvent::Notify`].
    pub fn set_focused(&self, focused: bool) {
        self.state.set_app_focused(focused);
    }

    /// The server's welcome message, as HTML, once connected.
    pub fn welcome(&self) -> Option<String> {
        self.state
            .welcome_text()
            .filter(|text| !text.trim().is_empty())
    }

    /// The comment of the user `session`, as HTML; `None` if they have
    /// none. Asks the server on first use.
    pub async fn user_comment(&self, session: u32) -> Option<String> {
        self.state.user_comment_or_fetch(session).await
    }

    /// The description of `channel`, as HTML; `None` if it has none, or it
    /// has not arrived yet.
    pub fn channel_description(&self, channel: u32) -> Option<String> {
        self.state
            .channel_description(channel)
            .filter(|text| !text.trim().is_empty())
    }

    /// Move into `channel`, presenting `password`.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn join_channel_with_password(
        &self,
        channel: u32,
        password: String,
    ) -> Result<(), String> {
        self.state.join_channel(channel, Some(password)).await
    }

    /// How loud the user `session` is played here: 0.0 is silent, 1.0 as
    /// sent, 2.0 twice as loud. Local only; nobody else is told.
    pub fn set_user_volume(&self, session: u32, volume: f32) {
        self.state.set_user_volume(session, volume);
    }

    /// Remove the user `session` from the server.
    ///
    /// # Errors
    ///
    /// When not connected. A refusal arrives as [`EngineEvent::Denied`].
    pub async fn kick(&self, session: u32, reason: Option<String>) -> Result<(), String> {
        self.state.kick_user(session, reason).await
    }

    /// Remove the user `session` and ban them from returning.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn ban(&self, session: u32, reason: Option<String>) -> Result<(), String> {
        self.state.ban_user(session, reason).await
    }

    /// Mute or unmute the user `session` for everyone.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn server_mute(&self, session: u32, muted: bool) -> Result<(), String> {
        self.state.mute_user(session, muted).await
    }

    /// Deafen or undeafen the user `session` for everyone.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn server_deafen(&self, session: u32, deafened: bool) -> Result<(), String> {
        self.state.deafen_user(session, deafened).await
    }

    /// Move the user `session` into `channel`.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn move_user(&self, session: u32, channel: u32) -> Result<(), String> {
        self.state.move_user(session, channel).await
    }

    /// Register the user `session` on the server under their certificate.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn register(&self, session: u32) -> Result<(), String> {
        self.state.register_user(session).await
    }

    /// Create the channel `name` under `parent`, keeping its messages as
    /// `history` says; only a Fancy server keeps any.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn create_channel(
        &self,
        parent: u32,
        name: String,
        history: History,
    ) -> Result<(), String> {
        self.state
            .create_channel(
                parent,
                name,
                None,
                None,
                None,
                None,
                match history {
                    History::None => None,
                    History::OnServer => Some("server_managed".to_owned()),
                    History::EndToEnd => Some("fancy_v1_full_archive".to_owned()),
                },
                None,
                None,
                None,
                None,
                None,
                None,
                Vec::new(),
                Vec::new(),
            )
            .await
    }

    /// Rename `channel`.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn rename_channel(&self, channel: u32, name: String) -> Result<(), String> {
        self.change_channel(
            channel,
            ChannelChange {
                name: Some(name),
                ..ChannelChange::default()
            },
        )
        .await
    }

    /// Change what `change` names about `channel`, and leave the rest.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn change_channel(&self, channel: u32, change: ChannelChange) -> Result<(), String> {
        self.state
            .update_channel(
                channel,
                None,
                change.name,
                change.description.as_deref().map(escape_html),
                None,
                None,
                None,
                None,
                None,
                None,
                change.password,
                None,
                None,
                None,
                Vec::new(),
                Vec::new(),
            )
            .await
    }

    /// Delete `channel`, and everything under it.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn delete_channel(&self, channel: u32) -> Result<(), String> {
        self.state.delete_channel(channel).await
    }

    /// Set the local user's comment: what others read about them.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn set_comment(&self, text: &str) -> Result<(), String> {
        self.state.set_user_comment(escape_html(text)).await
    }

    /// Set the local user's picture, from an encoded image; empty removes it.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn set_avatar(&self, image: Vec<u8>) -> Result<(), String> {
        self.state.set_user_texture(image).await
    }

    /// How the microphone is used.
    pub fn voice_settings(&self) -> VoiceSettings {
        let settings = self.state.audio_settings();
        VoiceSettings {
            push_to_talk: settings.push_to_talk,
            activation_threshold: settings.vad_threshold,
            noise_suppression: settings.noise_suppression,
            automatic_gain: settings.auto_gain,
            input_volume: settings.input_volume,
            output_volume: settings.output_volume,
            bitrate_bps: u32::try_from(settings.bitrate_bps).unwrap_or(0),
            voice_over_tcp: settings.force_tcp_audio,
        }
    }

    /// Change how the microphone is used. Takes effect at once if voice is
    /// on.
    ///
    /// # Errors
    ///
    /// When the capture pipeline could not be restarted.
    pub fn set_voice_settings(&self, voice: VoiceSettings) -> Result<(), String> {
        let mut settings = self.state.audio_settings();
        settings.push_to_talk = voice.push_to_talk;
        settings.vad_threshold = voice.activation_threshold.clamp(0.0, 1.0);
        settings.noise_suppression = voice.noise_suppression;
        settings.auto_gain = voice.automatic_gain;
        settings.input_volume = voice.input_volume.clamp(0.0, MAX_VOLUME);
        settings.output_volume = voice.output_volume.clamp(0.0, MAX_VOLUME);
        settings.bitrate_bps =
            i32::try_from(voice.bitrate_bps.clamp(MIN_BITRATE, MAX_BITRATE)).unwrap_or(i32::MAX);
        settings.force_tcp_audio = voice.voice_over_tcp;
        self.state.apply_audio_settings(settings)
    }

    /// Tell the server ahead of time who a whisper will go to, so that
    /// the first syllable of one is not lost; `None` forgets the target.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn prepare_whisper(&self, target: Option<WhisperTarget>) -> Result<(), String> {
        let entries = target.map(WhisperTarget::entries).unwrap_or_default();
        self.state
            .whisper_register(WHISPER_SLOT, entries)
            .await
            .map(|_| ())
    }

    /// The whisper key went down: speak to `target` and to nobody else,
    /// whatever the microphone was doing.
    ///
    /// # Errors
    ///
    /// When not connected, or the microphone cannot be opened.
    pub async fn whisper_start(&self, target: WhisperTarget) -> Result<(), String> {
        self.state
            .whisper_start(WHISPER_SLOT, target.entries())
            .await
    }

    /// The whisper key came up: back to the channel, and to what the
    /// microphone was doing before.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn whisper_end(&self) -> Result<(), String> {
        self.state.whisper_end().await
    }

    /// The push-to-talk key went down (`held`) or came up.
    ///
    /// # Errors
    ///
    /// When not connected, or the microphone cannot be opened.
    pub async fn push_to_talk(&self, held: bool) -> Result<(), String> {
        if held {
            self.state.push_to_talk_start().await
        } else {
            self.state.push_to_talk_end().await
        }
    }

    /// Ask the server at `host:port` whether it is up, without connecting.
    pub async fn ping(host: &str, port: u16) -> PingInfo {
        let answer = crate::state::server_ping::ping_server(host, port).await;
        PingInfo {
            online: answer.online,
            latency_ms: answer.latency_ms,
            users: answer.user_count,
            max_users: answer.max_user_count,
            version: answer.server_version,
        }
    }

    /// Write out what the engine holds only in memory. Call before exiting.
    pub fn shutdown(&self) {
        self.state.flush_pchat_state();
        self.state.shutdown_offload_store();
    }
}

/// `text` as the HTML that shows exactly that text.
///
/// Chat bodies are HTML on the wire, so text a person typed has to have the
/// three characters that mean something in HTML written out, or `1 < 2`
/// arrives as the start of a tag - and its line breaks written as breaks.
/// The loudest a volume goes: twice as captured or as sent.
const MAX_VOLUME: f32 = 2.0;
/// What Opus is asked to encode voice at, at the least and at the most.
const MIN_BITRATE: u32 = 8_000;
const MAX_BITRATE: u32 = 192_000;

/// The most messages a view is handed at once, whatever it asks for.
const MAX_WINDOW: usize = 10_000;

/// A measured time in whole milliseconds; nonsense reads as zero.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to what a u32 holds first"
)]
fn whole_ms(measured: f32) -> u32 {
    if measured.is_finite() {
        measured.round().clamp(0.0, 86_400_000.0) as u32
    } else {
        0
    }
}

fn escape_html(text: &str) -> String {
    let mut html = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => html.push_str("&amp;"),
            '<' => html.push_str("&lt;"),
            '>' => html.push_str("&gt;"),
            // HTML folds a line break into a space; a typed one is meant.
            '\n' => html.push_str("<br>"),
            other => html.push(other),
        }
    }
    html
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::state::types::{
        CurrentChannelPayload, DisconnectedPayload, NewMessagePayload, RejectedPayload,
    };

    #[test]
    fn a_name_after_an_at_sign_becomes_a_mention() {
        let users = [
            (3, "Rin".to_owned()),
            (7, "Rina".to_owned()),
            (9, "A&B".to_owned()),
        ];
        let said = |text: &str| with_mentions(&escape_html(text), &users);
        assert_eq!(
            said("hi @Rin!"),
            r#"hi <span class="mention mention-user" data-mention-session="3">@Rin</span>!"#
        );
        // The longer name wins, and a name has to end where the word does.
        assert!(said("@Rina").contains(r#"data-mention-session="7""#));
        assert_eq!(said("@Rinaldo"), "@Rinaldo");
        // It has to start a word, too.
        assert_eq!(said("mail@Rin.example"), "mail@Rin.example");
        assert!(
            said("@A&B").contains(">@A&amp;B</span>"),
            "a name is escaped as the text is"
        );
        assert_eq!(
            said("@everyone"),
            r#"<span class="mention mention-everyone" data-mention-everyone="1">@everyone</span>"#
        );
        assert_eq!(said("nobody @ all"), "nobody @ all");
        assert_eq!(said("plain"), "plain");
    }

    #[test]
    fn a_reply_names_what_it_answers_and_is_read_back() {
        let reply = reply_html("0191-abcd", "yes &amp; no");
        assert_eq!(reply, "<!-- FANCY_QUOTE:0191-abcd -->yes &amp; no");
        assert_eq!(reply_target(&reply), Some("0191-abcd"));
        assert_eq!(reply_target("no mark here"), None);
        assert_eq!(reply_target("<!-- FANCY_QUOTE: -->x"), None);
        // An id cannot close the comment it sits in.
        let sly = reply_html("a--><b>", "x");
        assert_eq!(reply_target(&sly), Some("ab"));
        assert!(!sly.contains("<b>"));
    }

    #[test]
    fn a_shared_file_is_read_back_out_of_the_message_that_shares_it() {
        let message = file_message("notes <1>.txt", 42, "k/1", 0);
        assert_eq!(
            attachments_in(&message),
            [AttachmentInfo {
                filename: "notes <1>.txt".to_owned(),
                size: Some(42),
                key: Some("k/1".to_owned()),
                url: None,
            }]
        );
        assert!(
            message.contains("notes &lt;1&gt;.txt"),
            "the line for other clients"
        );
        // Marks that name nothing, or are not marks, are passed over.
        assert!(attachments_in("plain <!-- FANCY_FILE:!!! --> text").is_empty());
        assert!(attachments_in("<!-- FANCY_FILE:e30= -->").is_empty());
        assert!(attachments_in("<!-- FANCY_FILE:unfinished").is_empty());
    }

    #[test]
    fn typed_text_survives_as_html() {
        assert_eq!(
            escape_html("1 < 2 && 3 > 2"),
            "1 &lt; 2 &amp;&amp; 3 &gt; 2"
        );
        assert_eq!(escape_html("plain"), "plain");
        assert_eq!(escape_html("one\ntwo"), "one<br>two");
        // Round trip: what is sent reads back as what was typed.
        assert_eq!(
            fancy_utils::html::message_preview(&escape_html("<b>not bold</b> & co")),
            "<b>not bold</b> & co"
        );
    }

    #[test]
    fn the_events_a_client_needs_are_reported() {
        let reported = |event| EngineEvent::from_core(event);
        assert_eq!(
            reported(CoreEvent::Connecting),
            Some(EngineEvent::Connecting)
        );
        assert_eq!(reported(CoreEvent::Connected), Some(EngineEvent::Connected));
        assert_eq!(
            reported(CoreEvent::StateChanged),
            Some(EngineEvent::StateChanged)
        );
        assert_eq!(
            reported(CoreEvent::Disconnected(DisconnectedPayload {
                server_id: None,
                reason: Some("bye".to_owned()),
            })),
            Some(EngineEvent::Disconnected {
                reason: Some("bye".to_owned())
            })
        );
        assert_eq!(
            reported(CoreEvent::ConnectionRejected(RejectedPayload {
                server_id: None,
                reason: "wrong password".to_owned(),
                reject_type: Some(3),
            })),
            Some(EngineEvent::Rejected {
                reason: "wrong password".to_owned()
            })
        );
        assert_eq!(
            reported(CoreEvent::CurrentChannelChanged(CurrentChannelPayload {
                channel_id: 3
            })),
            Some(EngineEvent::CurrentChannelChanged)
        );
        assert_eq!(
            reported(CoreEvent::UserTalking {
                session: 7,
                talking: true
            }),
            Some(EngineEvent::UserTalking {
                session: 7,
                talking: true
            })
        );
        assert_eq!(
            reported(CoreEvent::NewMessage(NewMessagePayload {
                channel_id: 3,
                sender_session: None,
            })),
            Some(EngineEvent::NewMessage { channel: 3 })
        );
        assert_eq!(
            reported(CoreEvent::PermissionDenied(
                crate::state::types::PermissionDeniedPayload {
                    deny_type: Some(1),
                    reason: Some(String::new()),
                }
            )),
            Some(EngineEvent::Denied { reason: None }),
            "an empty reason is no reason"
        );
        // One of the many this API does not carry yet.
        assert_eq!(reported(CoreEvent::ServerConfigChanged), None);
    }

    #[test]
    fn a_message_is_reported_as_its_visible_text() {
        let message = MessageInfo::from(ChatMessage {
            sender_session: Some(4),
            sender_name: "Ada".to_owned(),
            body: "<b>hi</b> &amp; bye".to_owned(),
            channel_id: 1,
            is_own: true,
            timestamp: Some(17),
            ..ChatMessage::default()
        });
        assert_eq!(message.text, "hi & bye");
        assert_eq!((message.sender, message.own), (Some(4), true));
        assert_eq!(message.sent_at_ms, Some(17));
    }

    #[test]
    fn muted_and_deafened_fold_the_server_and_the_user_together() {
        let mut user = UserEntry::new(4);
        user.suppress = true;
        user.deaf = true;
        let info = UserInfo::from(user);
        assert!(info.muted && info.deafened);
        assert!(!UserInfo::from(UserEntry::new(5)).muted);
    }

    #[tokio::test]
    async fn a_fresh_engine_is_disconnected_and_empty() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let engine = EngineHandle::start(
            EngineDirs {
                data: dir.path().to_path_buf(),
                cache: None,
            },
            tokio::runtime::Handle::current(),
            move |event| sink.lock().expect("the event log").push(event),
        );
        assert_eq!(engine.connection(), Connection::Disconnected);
        assert_eq!(engine.voice(), Voice::Off);
        assert!(engine.channels().is_empty() && engine.users().is_empty());
        assert!(engine.own_session().is_none() && engine.current_channel().is_none());
        assert!(engine.messages(0).is_empty());
        let mut voice = engine.voice_settings();
        assert!(!voice.push_to_talk, "voice activation is the default");
        voice.push_to_talk = true;
        voice.activation_threshold = 7.0;
        engine
            .set_voice_settings(voice)
            .expect("nothing to restart");
        let voice = engine.voice_settings();
        assert!(voice.push_to_talk);
        assert!(
            (voice.activation_threshold - 1.0).abs() < f32::EPSILON,
            "a threshold is held within its range"
        );
        assert_eq!(engine.selected_devices(), (None, None));
        engine
            .select_devices(None, Some("Somewhere".to_owned()))
            .expect("choosing a device while voice is off opens nothing");
        assert_eq!(
            engine.selected_devices(),
            (None, Some("Somewhere".to_owned()))
        );
        // Leaving when not on a server is not an error.
        assert!(engine.disconnect().await.is_ok());
        engine.shutdown();
    }
}
