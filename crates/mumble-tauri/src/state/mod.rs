//! Shared application state for the Tauri backend.
//!
//! The state is decomposed into sub-modules by domain:
//!
//! - [`types`]              - serializable value types, event payloads, config structs.
//! - [`connection`]         - `connect()` / `disconnect()` lifecycle.
//! - [`audio`]              - voice pipeline management (enable, mute, deafen, outbound loop).
//! - [`event_handler`]      - `EventHandler` bridge from mumble-protocol to Tauri events.
//! - [`messaging`]          - channel / DM / group messaging, unread tracking.
//! - [`channels`]           - channel browse, join, listen, create, update, delete.
//! - [`admin`]              - server administration actions.
//! - [`profile`]            - user comment and avatar management.
//! - [`protocol_commands`]  - protocol-level commands (plugin data, reactions, etc.).
//! - [`query`]              - read-only accessors (status, users, server info, etc.).
//! - [`offload_ops`]        - content offloading to encrypted temp files.

mod admin;
pub(crate) mod audio;
mod audio_tasks;
mod calibration;
mod channels;
mod connection;
mod device;
mod emotes;
pub(crate) mod link;
mod voice_replay;
pub use emotes::{AddEmoteRequest, AddEmoteResponse, RemoveEmoteRequest};
mod event_handler;
mod file_server;
pub use file_server::{
    AdminDeleteDocumentRequest, AdminDeleteRequest, AdminListRequest, AdminPreviewRequest,
    DownloadBytesRequest, DownloadRequest, PrivateStorageRequest, UploadBinaryRequest,
    UploadBytesRequest, UploadRequest, UploadResponse,
};
mod handler;
pub(crate) use handler::{LiverySnapshot, data_uri, to_snapshot};
mod account;
mod account_seal;
mod audit;
pub(crate) mod canon_emotes;
pub(crate) mod hash_names;
mod invites;
pub(crate) mod local_cache;
pub(crate) mod media_server;
mod messaging;
pub mod offload;
mod offload_ops;
mod onboarding;
mod overlay_query;
pub(crate) mod pchat;
mod plugin_admin;
/// Discord Rich Presence listener. Desktop only: it hosts the Discord IPC
/// endpoint, which has no Android equivalent.
#[cfg(not(target_os = "android"))]
pub(crate) mod presence;
pub(crate) mod preview_cache;
mod profile;
pub(crate) mod protocol_commands;
mod query;
mod read_sync;
#[allow(dead_code, reason = "recording module is work-in-progress")]
pub(crate) mod recording;
pub(crate) mod records;
mod registry;
mod search;
mod server_settings;
mod sessions;
mod shared_handle;
pub(crate) mod starling_files;
pub mod types;
mod voice_decode;
pub(crate) mod voice_message;
pub(crate) mod whisper;

// Re-export everything that lib.rs needs.
pub(crate) use connection::Credentials;
pub(crate) use event_handler::show_desktop_notification;
pub(crate) use registry::{HashLookup, UserHashMatch};
pub use sessions::{ServerId, SessionMeta};
pub use types::{
    AudioDevice, AudioSettings, ChannelEntry, ChatMessage, ConnectionStatus, DebugStats,
    MessagePage, PageRequest, PhotoEntry, SearchResult, ServerConfig, ServerInfo, UserEntry,
    VoiceState,
};
pub(crate) use whisper::WhisperEntry;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU8, AtomicU32};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use offload::OffloadStore;

use mumble_protocol::audio::mixer::{AudioMixer, JitterConfig, SpeakerBuffers, SpeakerVolumes};
use mumble_protocol::client::ClientHandle;
use mumble_protocol::persistent::PchatProtocol;

use types::*;

/// Parse a frontend pchat mode string into the protobuf i32 value.
pub(crate) fn parse_pchat_protocol_str(s: &str) -> PchatProtocol {
    match s {
        "fancy_v1_full_archive" => PchatProtocol::FancyV1FullArchive,
        "server_managed" => PchatProtocol::ServerManaged,
        "signal_v1" => PchatProtocol::SignalV1,
        _ => PchatProtocol::None,
    }
}

// --- Sub-state structs --------------------------------------------

/// Audio pipeline state: device settings, volume handles, mixer,
/// playback, outbound capture, and test tasks.
#[derive(Default)]
pub(super) struct AudioPipelineState {
    pub settings: AudioSettings,
    pub voice_state: VoiceState,
    /// The voice target stamped on every outbound packet: `0` is normal
    /// speech into the current channel, `1..=30` a slot registered with
    /// `VoiceTarget` - a whisper or a shout.
    ///
    /// Shared with the encoding loop instead of read through the lock. It
    /// changes twice per whisper - once on the key down, once on the key up -
    /// and is read once per 20 ms frame, and a frame-rate lock on `SharedState`
    /// is exactly what moving decoding off the event loop was for.
    pub voice_target: Arc<AtomicU8>,
    /// What each whisper slot holds on the server, by slot.
    ///
    /// The frontend re-registers every target whenever the roster moves, and
    /// nearly all of those ask for what the slot already holds; this is what
    /// makes the repeat free. Per connection, because the slots are: a
    /// reconnect gets a fresh `SharedState` and an empty map.
    pub whisper_slots: HashMap<u8, Vec<WhisperEntry>>,
    /// Channels the server refused a whisper or shout into, from
    /// `PermissionDenied`. A registration touching a channel clears it first,
    /// so what remains is what the server still refuses.
    pub whisper_denied: std::collections::BTreeSet<u32>,
    /// Whether the whisper key is what put the mic live.
    ///
    /// A whisper transmits while held whatever the activation mode is, so it
    /// engages push-to-talk on the way in. Releasing it must only undo that
    /// where it did it: in voice-activity mode the user was already talking,
    /// and muting them on the key up would be the shortcut turning their mic
    /// off.
    pub whisper_held_ptt: bool,
    /// The decoder thread of the live connection, when there is one.
    ///
    /// It holds the mixer while it runs; `mixer` below is the fallback for a
    /// connection that has no sink installed (see [`voice_decode::start`]).
    pub decode: Option<voice_decode::DecodeHandle>,
    pub mixer: Option<AudioMixer>,
    /// The buffers the mixer feeds, kept here because a recording drains them
    /// and cannot reach into the decoder thread to ask.
    pub speaker_buffers: Option<SpeakerBuffers>,
    pub mixing_playback: Option<Box<dyn crate::audio::MixingPlayback>>,
    pub outbound_task_handle: Option<tokio::task::JoinHandle<()>>,
    /// Bumped by every start and stop of the outbound loop. A start records
    /// it before building the pipeline and installs the loop only if nothing
    /// moved it on since - see [`AudioPipelineState::install_outbound`].
    outbound_generation: u64,
    pub input_volume_handle: Option<Arc<AtomicU32>>,
    pub output_volume_handle: Option<Arc<AtomicU32>>,
    pub speaker_volumes: SpeakerVolumes,
    pub mic_test_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    pub latency_test_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    pub voice_replay_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    pub voice_replay_stop: Option<tokio::sync::watch::Sender<bool>>,
    pub recording_handle: Option<recording::RecordingHandle>,
    pub talking_sessions: HashSet<u32>,
}

impl AudioPipelineState {
    /// Attach a connection's decoder thread, handing over a running mixer.
    ///
    /// Voice is normally enabled long after the thread exists, but a mixer
    /// built before it would otherwise sit here while the thread decodes into
    /// nothing - silence with no error anywhere.
    pub(super) fn attach_decode(&mut self, decode: voice_decode::DecodeHandle) {
        if let Some(mixer) = self.mixer.take() {
            decode.install(mixer);
        }
        self.decode = Some(decode);
    }

    /// Start decoding into `mixer`, wherever the decoding happens.
    pub(super) fn install_mixer(&mut self, mixer: AudioMixer, buffers: SpeakerBuffers) {
        self.speaker_buffers = Some(buffers);
        match self.decode {
            Some(ref decode) => {
                decode.install(mixer);
                self.mixer = None;
            }
            None => self.mixer = Some(mixer),
        }
    }

    /// Stop decoding and release the mixer.
    pub(super) fn uninstall_mixer(&mut self) {
        self.mixer = None;
        self.speaker_buffers = None;
        if let Some(ref decode) = self.decode {
            decode.uninstall();
        }
    }

    /// Free a departed user's decoder and sample buffer.
    pub(super) fn remove_speaker(&mut self, session: u32) {
        if let Some(ref mut mixer) = self.mixer {
            mixer.remove_speaker(session);
        }
        if let Some(ref decode) = self.decode {
            decode.remove_speaker(session);
        }
    }

    /// Retune every speaker's jitter buffer.
    pub(super) fn set_jitter(&mut self, cfg: JitterConfig) {
        if let Some(ref mut mixer) = self.mixer {
            mixer.set_jitter(cfg);
        }
        if let Some(ref decode) = self.decode {
            decode.set_jitter(cfg);
        }
    }

    /// Stop the outbound loop and retire any start still building one.
    pub(super) fn stop_outbound(&mut self) {
        self.outbound_generation += 1;
        if let Some(handle) = self.outbound_task_handle.take() {
            handle.abort();
        }
        // A mic that has stopped is not whispering. Without this a lost key-up
        // - the window loses focus mid-press on some compositors, and the
        // release never arrives - would leave the target set, and the next
        // thing said in the channel would go to the whisper's audience
        // instead.
        self.voice_target
            .store(0, std::sync::atomic::Ordering::Relaxed);
        self.whisper_held_ptt = false;
    }

    /// Claim the right to install the next outbound loop. Building one can
    /// take a while (a denoiser model loads in the order of a second), and
    /// this happens outside the lock, so the claim is what a later start or
    /// stop invalidates.
    pub(super) fn begin_outbound(&mut self) -> u64 {
        self.outbound_generation += 1;
        self.outbound_generation
    }

    /// Install the loop a start claimed at `generation` produced.
    ///
    /// Whatever was stored before is aborted, so two loops never run at once:
    /// two of them interleave their packets on the wire, which every listener
    /// hears as crackling. If a newer start or a stop has moved the generation
    /// on, this loop is the stale one: it is aborted instead and `false`
    /// returned, so a mute cannot be undone by a restart it overtook.
    pub(super) fn install_outbound(
        &mut self,
        generation: u64,
        handle: tokio::task::JoinHandle<()>,
    ) -> bool {
        if generation != self.outbound_generation {
            handle.abort();
            return false;
        }
        if let Some(old) = self.outbound_task_handle.replace(handle) {
            old.abort();
        }
        true
    }
}

/// Server-reported metadata: version info, config limits, and connection details.
#[derive(Default)]
pub(super) struct ServerMetadata {
    pub fancy_version: Option<u64>,
    /// Which wire numbering the server speaks (None/0 = the epoch-0 layout).
    pub fancy_protocol: Option<u32>,
    pub version_info: ServerVersionInfo,
    pub host: String,
    pub port: u16,
    pub max_users: Option<u32>,
    pub max_bandwidth: Option<u32>,
    pub opus: bool,
    pub config: ServerConfig,
    pub welcome_text: Option<String>,
    pub root_permissions: Option<u32>,
}

/// User-level preference flags.
#[derive(Default, Clone)]
pub(super) struct AppPreferences {
    pub notifications_enabled: bool,
    pub disable_dual_path: bool,
    pub app_focused: bool,
}

/// Persistent-chat context: key management, identity, and pending operations.
#[derive(Default)]
pub(super) struct PchatContext {
    pub pchat: Option<pchat::PchatState>,
    pub seed: Option<[u8; 32]>,
    pub identity_dir: Option<std::path::PathBuf>,
    pub pending_key_shares: Vec<PendingKeyShare>,
    pub key_holders: HashMap<u32, Vec<KeyHolderEntry>>,
    pub hash_name_resolver: Option<Arc<dyn hash_names::HashNameResolver>>,
    pub pending_delete_acks: Vec<PendingDeleteAck>,
}

/// Maximum number of in-memory messages retained per thread (channel or DM).
/// Older messages remain available through the persistent local cache and
/// can be loaded on demand via `fetch_older_messages`.  Capping the working
/// set keeps long-running sessions from accumulating unbounded memory and
/// prevents the UI from re-rendering ever-growing lists.
pub(super) const MAX_MESSAGES_PER_THREAD: usize = 500;

/// Append a message to a thread's `Vec<ChatMessage>` while enforcing the
/// `MAX_MESSAGES_PER_THREAD` cap by dropping the oldest entries.
pub(super) fn push_capped(messages: &mut Vec<ChatMessage>, msg: ChatMessage) {
    messages.push(msg);
    if messages.len() > MAX_MESSAGES_PER_THREAD {
        let drop_count = messages.len() - MAX_MESSAGES_PER_THREAD;
        let _ = messages.drain(..drop_count);
    }
}

/// Message storage: channel and DM messages with unread counts.
#[derive(Default)]
pub(super) struct MessageStore {
    pub by_channel: HashMap<u32, Vec<ChatMessage>>,
    /// Per-channel bookkeeping for [`ThreadWindow`].
    ///
    /// Beside the rows rather than wrapping them: `by_channel` is read in
    /// sixty-odd places and every one of them wants a plain slice.
    pub windows: HashMap<u32, ThreadWindow>,
    pub by_dm: HashMap<u32, Vec<ChatMessage>>,
    pub channel_unread: HashMap<u32, u32>,
    pub dm_unread: HashMap<u32, u32>,
    pub selected_dm_user: Option<u32>,
}

/// How much of a thread's archive this client is holding, and which way it can
/// still grow.
///
/// The rows themselves stay in `by_channel`; this is the bookkeeping that turns
/// them from "everything we happen to have" into a **contiguous range** with
/// known edges. Everything downstream depends on that contiguity: pages are
/// concatenated at an edge rather than merged and re-sorted, so the range is
/// only meaningful if there is no hole in it.
#[derive(Debug, Default, Clone, Copy)]
pub(super) struct ThreadWindow {
    /// The server holds messages older than the oldest row here.
    pub more_before: bool,
    /// The server holds messages newer than the newest row here.
    ///
    /// False means the range reaches the live tail, and that is what makes it
    /// safe to append an arriving message. While it is true an arrival must be
    /// **dropped** rather than appended: putting it after a row it does not
    /// actually follow is how a hole gets into the range, and the hole is
    /// invisible until somebody scrolls into it.
    pub more_after: bool,
    /// Which way the fetch this client is waiting on walks.
    ///
    /// The epoch-0 `PchatFetchResponse` does not echo the direction it was
    /// asked in, and the same `has_more` means "older still exist" or "newer
    /// still exist" depending on which way the request went. The asker is the
    /// only one who knows, so it records it here.
    pub fetching: FetchWalk,
}

/// Which end of the archive the fetch in flight is asking about.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) enum FetchWalk {
    /// The newest page, which is what opening a channel asks for. Its answer
    /// *is* the tail, so it is joined there rather than at whichever edge of
    /// the range the caller happened to be standing on.
    #[default]
    Newest,
    /// Older than a cursor: a page for the head of the range.
    Older,
    /// Newer than a cursor: a page for the tail of the range.
    Newer,
}

impl MessageStore {
    /// The window for `channel`, defaulting to "we hold the tail and nothing
    /// older is known to exist".
    ///
    /// The default matters: a channel nobody has fetched yet reads as complete
    /// rather than as having a gap, which is what keeps a plain volatile
    /// channel out of all of this.
    pub(super) fn window(&self, channel: u32) -> ThreadWindow {
        self.windows.get(&channel).copied().unwrap_or_default()
    }

    /// Record which way the fetch now in flight for `channel` is walking.
    pub(super) fn note_fetch(&mut self, channel: u32, walk: FetchWalk) {
        self.windows.entry(channel).or_default().fetching = walk;
    }

    /// Seed a thread with rows restored from the local cache.
    ///
    /// `older_left_behind` is the cache saying it holds more than it handed
    /// over; recorded as a gap at the head so the reader is offered the way
    /// back to it instead of being shown a short thread as a complete one.
    pub(super) fn restore_cached(
        &mut self,
        channel: u32,
        rows: Vec<ChatMessage>,
        older_left_behind: bool,
    ) {
        if rows.is_empty() {
            return;
        }
        self.by_channel.entry(channel).or_default().extend(rows);
        if older_left_behind {
            self.windows.entry(channel).or_default().more_before = true;
        }
    }

    /// Join the newest page of a thread onto the range, at the tail.
    ///
    /// A fetch that names no cursor asks for the live tail, and the answer
    /// belongs at the tail whatever the range already holds. Joined as a
    /// backward walk instead -- which is what it used to get, a cursorless
    /// request looking like one -- the newest messages were *prepended*, so a
    /// channel whose local cache had been restored opened on the oldest thing
    /// this client held while the latest sat above it, off the top of the
    /// thread.
    ///
    /// The held rows survive when the page joins onto them cleanly: its first
    /// row is one of theirs, so everything from there on is the page's own,
    /// fresher copy and what lies before it is untouched history. A page that
    /// does not overlap them is a different matter -- there is no way to tell
    /// whether anything belongs between the two without inventing an order for
    /// rows whose only common clock is the sender's -- so the range becomes the
    /// page, and the gap is recorded rather than papered over.
    pub(super) fn join_tail(&mut self, channel: u32, page: Vec<ChatMessage>, more: bool) {
        if page.is_empty() {
            // An empty tail says nothing about what is held: a channel whose
            // history the server does not keep answers this way, and its local
            // cache is the only copy there is. Taking the page as the range
            // would throw that away.
            self.windows.entry(channel).or_default().more_after = false;
            return;
        }
        let rows = self.by_channel.entry(channel).or_default();
        let joined_at = page[0].message_id.as_deref().and_then(|head| {
            rows.iter()
                .position(|m| m.message_id.as_deref() == Some(head))
        });
        let dropped = match joined_at {
            Some(at) => {
                rows.truncate(at);
                false
            }
            None => {
                let had_rows = !rows.is_empty();
                rows.clear();
                had_rows
            }
        };
        let kept_older = !rows.is_empty();
        rows.extend(page);
        let window = self.windows.entry(channel).or_default();
        window.more_after = false;
        if !kept_older {
            // Nothing older is held any more, so what the server said about
            // rows before the page is the whole answer -- unless rows were
            // dropped to keep the range contiguous, which is a gap either way.
            window.more_before = more || dropped;
        }
        // Otherwise the rows still held are older than the page, and what lies
        // before *them* is already recorded.
    }

    /// Append a message that has just arrived live.
    ///
    /// Returns whether it was taken. A thread whose tail this client has
    /// dropped refuses it, because appending would place the message after a
    /// row it does not follow. The message is not lost: it is in the server's
    /// archive, and the reader gets it when they scroll back down and the tail
    /// is fetched again.
    pub(super) fn append_live(&mut self, channel: u32, message: ChatMessage) -> bool {
        if self.window(channel).more_after {
            return false;
        }
        let rows = self.by_channel.entry(channel).or_default();
        rows.push(message);
        // Trimming the *head* here is safe only because this is the tail end of
        // the range. It is what `push_capped` always did; the difference is
        // that dropping the oldest row now has to be recorded, or the next page
        // of history would be concatenated onto a range that has quietly moved.
        if rows.len() > MAX_MESSAGES_PER_THREAD {
            let over = rows.len() - MAX_MESSAGES_PER_THREAD;
            let _ = rows.drain(..over);
            self.windows.entry(channel).or_default().more_before = true;
        }
        true
    }

    /// Attach a page of older messages to the head of the range.
    ///
    /// `more` is what the server said about rows beyond the page.
    pub(super) fn extend_older(&mut self, channel: u32, mut page: Vec<ChatMessage>, more: bool) {
        let rows = self.by_channel.entry(channel).or_default();
        let held: HashSet<&str> = rows
            .iter()
            .filter_map(|m| m.message_id.as_deref())
            .collect();
        page.retain(|m| m.message_id.as_deref().is_none_or(|id| !held.contains(id)));
        // Prepended in the order the page arrived, never sorted. The server
        // returns a contiguous run and this range is contiguous, so joining
        // them at the edge preserves the order both already had -- whereas
        // sorting by timestamp would order the whole thread by the *sender's*
        // clock, which is attacker-controlled and puts a message with a skewed
        // clock in the wrong place for good.
        page.append(rows);
        *rows = page;
        self.windows.entry(channel).or_default().more_before = more;
    }

    /// Attach a page of newer messages to the tail of the range.
    pub(super) fn extend_newer(&mut self, channel: u32, page: Vec<ChatMessage>, more: bool) {
        let rows = self.by_channel.entry(channel).or_default();
        let held: HashSet<&str> = rows
            .iter()
            .filter_map(|m| m.message_id.as_deref())
            .collect();
        let fresh: Vec<ChatMessage> = page
            .into_iter()
            .filter(|m| m.message_id.as_deref().is_none_or(|id| !held.contains(id)))
            .collect();
        rows.extend(fresh);
        self.windows.entry(channel).or_default().more_after = more;
    }

    /// Drop rows from the edge the reader is moving away from.
    ///
    /// `keep_from` and `keep_to` are indices into the current range that must
    /// survive; everything outside them goes, and whichever edge was trimmed is
    /// marked so it can be fetched back. Only ever called for a thread whose
    /// source can re-serve what is dropped -- for a volatile channel there is
    /// nowhere to fetch from, so nothing is evicted.
    pub(super) fn evict_outside(&mut self, channel: u32, keep_from: usize, keep_to: usize) {
        let Some(rows) = self.by_channel.get_mut(&channel) else {
            return;
        };
        let keep_to = keep_to.min(rows.len());
        if keep_from >= keep_to {
            return;
        }
        let dropped_tail = rows.len() - keep_to;
        let dropped_head = keep_from;
        if dropped_tail == 0 && dropped_head == 0 {
            return;
        }
        rows.truncate(keep_to);
        let _ = rows.drain(..dropped_head);
        let window = self.windows.entry(channel).or_default();
        window.more_before |= dropped_head > 0;
        window.more_after |= dropped_tail > 0;
    }
}

/// Connection lifecycle state.
#[derive(Default)]
pub(super) struct ConnectionFields {
    pub status: ConnectionStatus,
    pub epoch: u64,
    pub client_handle: Option<ClientHandle>,
    pub connect_task_handle: Option<tokio::task::JoinHandle<()>>,
    pub event_loop_handle: Option<tokio::task::JoinHandle<()>>,
    pub synced: bool,
    pub own_session: Option<u32>,
    pub own_name: String,
    pub user_initiated_disconnect: bool,
    pub tauri_app_handle: Option<AppHandle>,
}

// --- Shared interior state (composed) -----------------------------

#[derive(Default)]
pub(super) struct SharedState {
    pub conn: ConnectionFields,
    pub server: ServerMetadata,
    pub users: HashMap<u32, UserEntry>,
    pub channels: HashMap<u32, ChannelEntry>,
    /// Avatar bytes for registered (offline) users, keyed by `user_id`.
    /// Populated from `UserList` responses; the bulk `user-list` event ships
    /// only size markers and the frontend fetches each avatar on demand via
    /// `get_registered_user_texture`. Cleared on disconnect with the rest of
    /// the per-session state.
    pub registered_user_textures: HashMap<u32, Vec<u8>>,
    pub selected_channel: Option<u32>,
    pub current_channel: Option<u32>,
    pub permanently_listened: HashSet<u32>,
    pub push_subscribed_channels: HashSet<u32>,
    pub msgs: MessageStore,
    pub audio: AudioPipelineState,
    pub pchat_ctx: PchatContext,
    pub prefs: AppPreferences,
    pub offload_store: Option<OffloadStore>,
    /// Multi-server: stable id of the connection this state belongs to.
    /// Set when the session is registered, cleared on teardown.
    pub server_id: Option<ServerId>,
    /// Certificate label used for this connection (if any), kept so
    /// `list_servers` can surface it without re-querying the connect args.
    pub cert_label: Option<String>,
    /// Latest onboarding config broadcast by the server (`None` until a
    /// `FancyOnboardingConfig` arrives, e.g. on legacy servers).
    pub onboarding: Option<OnboardingConfig>,
    /// Local user's onboarding response, fetched on demand.
    pub onboarding_response: Option<OnboardingResponse>,
    /// Latest editable server-settings snapshot (`None` until a
    /// `FancyServerSettings` arrives; only admins receive it).
    pub server_settings: Option<ServerSettingsSnapshot>,
    /// Latest own-account snapshot (`None` until a `FancyAccountSettings`
    /// arrives in response to an account query/update).
    pub account_settings: Option<AccountSettings>,
    /// Latest audit-plugin configuration snapshot (`None` until a
    /// `FancyAuditConfig` arrives; only audit admins receive it).
    pub audit_config: Option<AuditConfigSnapshot>,
    /// What the open server says it looks like, or `None` for the great
    /// majority that say nothing.
    pub livery: Option<LiverySnapshot>,
    /// Livery artwork as `data:` URIs, keyed by the content hash that names it.
    ///
    /// Separate from the document because it outlives it: a live change pushes
    /// a document with no art at all, and the point of keying on a content hash
    /// is that unchanged artwork is never sent twice.
    pub livery_art: HashMap<String, String>,
    /// Art keys a fetch has already been sent for, so a document naming one the
    /// server cannot produce is asked about once rather than in a loop.
    ///
    /// Keyed on the content hash like the cache itself, so re-uploading a
    /// picture that failed to arrive is a new key and gets a new attempt.
    pub livery_art_asked: HashSet<String>,
    /// Cached snapshot of the most recent `PluginRegistry` the server
    /// has broadcast.  The protobuf message is delivered once after
    /// `ServerSync` and never resent, so we cache it here to let the
    /// frontend resync after an HMR reload via `get_plugin_registry`.
    pub plugin_registry: Vec<PluginRegistryEntryPayload>,
    /// Cached server-originated `plugin-data` broadcasts (file-server
    /// config, live-doc config, plugin info, server emotes).  These are
    /// sent once after `ServerSync` and never resent, so we cache them
    /// to let the frontend resync after an HMR reload via
    /// `get_plugin_broadcasts` instead of forcing a full reconnect.
    pub plugin_broadcasts: Vec<PluginDataPayload>,
    /// Backend requests waiting on an operator ticket from this server.
    pub operator_tickets: handler::operator_ticket::TicketWaiters,
    /// File requests waiting on a signed URL from a canon server, and whether
    /// this one does files at all. Empty for a server running the plugin,
    /// which never sends a frame this reads.
    pub starling_files: starling_files::StarlingFiles,
    /// In-flight reads and writes of this account's own record store, and
    /// whether this server keeps one at all.
    pub records: records::Records,
    /// Whoever is waiting on this server's emote set.
    pub canon_emotes: canon_emotes::CanonEmotes,
    /// The link cards this client has already been given, and the ones it is
    /// still waiting on.
    ///
    /// Not per-connection, and that is the point: previews were session state
    /// before, so rejoining a channel re-asked for every link in its history.
    /// See [`preview_cache`].
    pub previews: preview_cache::Previews,
}

impl SharedState {
    /// Drop everything that described the server we were just talking to.
    ///
    /// Both ends a session can stop at run through here: the kick, which
    /// arrives as a `UserRemove` naming our own session, and the socket simply
    /// closing under us. The second one used to clear the connection and the
    /// audio and stop there, leaving the roster, the tree, the messages and
    /// `own_session` in place, so a client whose link dropped went on
    /// answering `get_state` with the population of a server it was no longer
    /// attached to. The frontend resets itself on the same event and hides
    /// that, right up until something re-reads the backend - a tab switch, a
    /// reload, a debounced `state-changed` - and the dead server comes back
    /// half-populated.
    pub(super) fn clear_session_data(&mut self) {
        self.users.clear();
        self.channels.clear();
        self.registered_user_textures.clear();
        self.msgs.by_channel.clear();
        self.msgs.channel_unread.clear();
        self.permanently_listened.clear();
        self.selected_channel = None;
        self.current_channel = None;
        self.conn.own_session = None;
        self.conn.synced = false;
        self.server.config = ServerConfig::default();
        self.server.fancy_version = None;
        self.server.version_info = ServerVersionInfo::default();
        self.server.max_users = None;
        self.server.max_bandwidth = None;
        self.server.opus = false;
        self.server.root_permissions = None;
        // The outstanding *questions* go, because their answers are not coming.
        // The cards stay: they are this client's own copy, and dropping them
        // here is what made every rejoin re-ask for the whole history.
        self.previews.forget_pending();
    }
}

// --- Tauri-managed application state ------------------------------

/// Central state managed by Tauri and shared across all commands.
pub struct AppState {
    /// Atomically-swappable handle to the currently-active session's
    /// [`SharedState`].  Existing call sites continue to spell
    /// `state.inner.snapshot().lock()`; under the hood the lock targets whichever
    /// session is active at lock time.
    pub(crate) inner: shared_handle::SharedHandle,
    /// Multi-server registry mapping `ServerId -> Arc<Mutex<SharedState>>`,
    /// plus which session is currently active.  Each connected server
    /// has its own backing `SharedState` so per-server data (channels,
    /// users, messages, audio) stays isolated.
    pub(crate) registry: registry::Registry,
    /// Default empty `SharedState` selected when no server is connected,
    /// so commands can always lock something and observe a sensible
    /// disconnected view instead of failing.
    default_inner: Arc<Mutex<SharedState>>,
    app_handle: Mutex<Option<AppHandle>>,
    start_time: Instant,
    http_client: reqwest::Client,
    pub(super) upload_cancels: Mutex<HashMap<String, CancellationToken>>,
    /// The voice message being recorded, if one is. App-wide rather than per
    /// session: there is one microphone, whichever server the clip is for.
    pub(super) voice_message: Mutex<Option<voice_message::Recording>>,
    /// The loopback origin shared media is played from, once something has
    /// asked for a URL. Started on demand rather than at boot: most sessions
    /// never look at a video, and an unused listener is still an open port.
    pub(crate) media_server: tokio::sync::Mutex<Option<media_server::MediaServer>>,
    /// Held while one object's download URL is being asked for.
    ///
    /// A player opens several connections at once, and every one of them wants
    /// the same URL before any of them has it. Without this they each ask the
    /// server separately, which is both wasteful and - on a rate-limited
    /// control plane - how the answer stops coming at all.
    pub(crate) download_url_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Image sources pending pickup by freshly-opened image popout windows.
    /// Keyed by random id; each entry is consumed once by `take_popout_image`.
    pub(crate) popout_images: Mutex<HashMap<String, crate::commands::popout::PopoutImagePayload>>,
    /// Stream-share contexts pending pickup by freshly-opened stream popout windows.
    /// Keyed by random id; each entry is consumed once by `take_popout_stream`.
    pub(crate) popout_streams: Mutex<HashMap<String, crate::commands::popout::PopoutStreamPayload>>,
    /// DM popout payloads pending pickup by freshly-opened DM popout windows.
    /// Keyed by random id; each entry is consumed once by `take_popout_dm`.
    pub(crate) popout_dms: Mutex<HashMap<String, crate::commands::popout::PopoutDmPayload>>,
    /// Live stream-popout windows, keyed by window label
    /// (`popout-stream-<id>`).  Value is the broadcaster session, used to
    /// emit `stream-popout-state opened:false` when the OS destroys the
    /// window (any close path - Alt+F4, X button, context menu, app exit).
    #[cfg(not(target_os = "android"))]
    pub(crate) popout_stream_sessions: Mutex<HashMap<String, u32>>,
    /// Channel/session context for the (single) drawing-overlay window.
    /// Read by the overlay via `take_drawing_overlay_context` once it
    /// has spawned. `None` while no overlay is open.
    pub(crate) draw_overlay_context:
        Mutex<Option<crate::commands::draw_overlay::DrawOverlayContext>>,
    /// Background task that follows the shared window's screen rect
    /// (Windows only) and repositions the desktop overlay accordingly.
    /// Aborted when the overlay closes.
    #[cfg(not(target_os = "android"))]
    pub(crate) draw_overlay_tracker: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// Discord Rich Presence listener, idle until the user enables it.
    #[cfg(not(target_os = "android"))]
    pub(crate) presence: presence::PresenceManager,
    /// Game-overlay configuration, detector task and last verdict. Inert
    /// until the user turns the overlay on.
    pub(crate) game_overlay: crate::commands::game_overlay::GameOverlayState,
    /// Whether the local microphone is transmitting right now.
    ///
    /// `SharedState::audio::talking_sessions` holds only *remote* speakers -
    /// the local user's talking is emitted straight to the frontend and never
    /// recorded - so anything in Rust that asks "is anyone talking" has to ask
    /// here as well. An atomic rather than a field on `SharedState` because
    /// the writer is the outbound audio loop, and taking that lock on an
    /// utterance edge is how the mixer ends up dropping samples.
    pub(crate) local_talking: std::sync::atomic::AtomicBool,
    /// Unix epoch milliseconds of the most recent moment the local microphone
    /// was transmitting.
    ///
    /// The bool alone is not enough for anything that polls: "yes" is true only
    /// while a packet is in flight, and a two-word reply is over long before a
    /// half-second tick comes round to look. This is the edge that cannot be
    /// missed, so pollers ask how long ago rather than whether right now.
    pub(crate) local_talking_at: std::sync::atomic::AtomicU64,
}

impl AppState {
    pub fn new() -> Self {
        let default_inner = Arc::new(Mutex::new(SharedState {
            prefs: AppPreferences {
                notifications_enabled: true,
                app_focused: true,
                ..Default::default()
            },
            ..Default::default()
        }));
        Self {
            registry: registry::Registry::default(),
            inner: shared_handle::SharedHandle::new(Arc::clone(&default_inner)),
            default_inner,
            app_handle: Mutex::new(None),
            start_time: Instant::now(),
            http_client: file_server::new_http_client(),
            upload_cancels: Mutex::new(HashMap::new()),
            voice_message: Mutex::new(None),
            media_server: tokio::sync::Mutex::new(None),
            download_url_locks: Mutex::new(HashMap::new()),
            popout_images: Mutex::new(HashMap::new()),
            popout_streams: Mutex::new(HashMap::new()),
            popout_dms: Mutex::new(HashMap::new()),
            #[cfg(not(target_os = "android"))]
            popout_stream_sessions: Mutex::new(HashMap::new()),
            draw_overlay_context: Mutex::new(None),
            #[cfg(not(target_os = "android"))]
            draw_overlay_tracker: Mutex::new(None),
            #[cfg(not(target_os = "android"))]
            presence: presence::PresenceManager::default(),
            game_overlay: crate::commands::game_overlay::GameOverlayState::default(),
            local_talking: std::sync::atomic::AtomicBool::new(false),
            local_talking_at: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// Build a fresh, empty per-session `SharedState` seeded with the
    /// global preferences and audio settings from the default session.
    /// Audio settings are copied so that persisted preferences (device,
    /// bitrate, denoiser, VAD threshold, …) apply to the very first
    /// voice call without requiring the settings page to be opened.
    pub(crate) fn fresh_session_state(&self) -> Arc<Mutex<SharedState>> {
        let (prefs, audio_settings) = self
            .default_inner
            .lock()
            .map(|s| (s.prefs.clone(), s.audio.settings.clone()))
            .unwrap_or_default();
        Arc::new(Mutex::new(SharedState {
            prefs,
            audio: AudioPipelineState {
                settings: audio_settings,
                ..Default::default()
            },
            ..Default::default()
        }))
    }

    /// Switch the currently-active session to `target`.  Updates both
    /// the registry's `active` pointer and the `inner` swap so commands
    /// without an explicit `serverId` start operating on the new session.
    pub(crate) fn switch_active_to(&self, target: ServerId) -> Result<(), String> {
        let arc = self
            .registry
            .session(target)
            .ok_or_else(|| format!("unknown server id: {target}"))?;
        self.registry.set_active(target)?;
        let _ = self.inner.swap(arc);
        Ok(())
    }

    /// Switch the active session to `target` and migrate any running
    /// voice pipeline along with it.  If voice was Active or Muted on
    /// the previously-active session, it is stopped there and started
    /// on the new active session in the same mode.  Voice always
    /// follows the active server.
    pub(crate) async fn switch_active_with_voice(&self, target: ServerId) -> Result<(), String> {
        use crate::state::types::VoiceState;

        let prev_arc = self.inner.snapshot();
        let target_arc = self
            .registry
            .session(target)
            .ok_or_else(|| format!("unknown server id: {target}"))?;

        if Arc::ptr_eq(&prev_arc, &target_arc) {
            return Ok(());
        }
        drop(target_arc);

        let prev_voice = prev_arc
            .lock()
            .map(|s| s.audio.voice_state)
            .unwrap_or_default();

        if prev_voice != VoiceState::Inactive {
            self.stop_audio_on(&prev_arc);
            if let Ok(mut s) = prev_arc.lock() {
                s.audio.voice_state = VoiceState::Inactive;
            }
        }

        self.switch_active_to(target)?;

        match prev_voice {
            VoiceState::Inactive => {}
            VoiceState::Active => {
                if let Err(e) = self.enable_voice().await {
                    tracing::warn!("voice migration: enable_voice on new active failed: {e}");
                }
            }
            VoiceState::Muted => {
                if let Err(e) = self.enable_voice_muted().await {
                    tracing::warn!("voice migration: enable_voice_muted on new active failed: {e}");
                }
            }
        }

        self.emit_voice_state();
        Ok(())
    }

    /// Reset `inner` to the empty default `SharedState` (used when the
    /// last session disconnects).
    pub(crate) fn reset_to_default(&self) {
        let _ = self.inner.swap(Arc::clone(&self.default_inner));
    }

    /// Inject the Tauri `AppHandle` during setup.
    pub fn set_app_handle(&self, handle: AppHandle) {
        *self
            .app_handle
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(handle);
    }

    pub(super) fn app_handle(&self) -> Option<AppHandle> {
        self.app_handle.lock().ok().and_then(|h| h.clone())
    }

    /// Cancel an in-progress upload by its `upload_id`.
    /// Returns `true` if a matching upload was found and cancelled.
    pub fn cancel_upload(&self, upload_id: &str) -> bool {
        if let Ok(mut map) = self.upload_cancels.lock()
            && let Some(token) = map.remove(upload_id)
        {
            token.cancel();
            return true;
        }
        false
    }

    /// Recompute `user_count` for every channel based on current users.
    fn refresh_user_counts(state: &mut SharedState) {
        for ch in state.channels.values_mut() {
            ch.user_count = 0;
        }
        for user in state.users.values() {
            if let Some(ch) = state.channels.get_mut(&user.channel_id) {
                ch.user_count += 1;
            }
        }
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "panic-on-failure is acceptable in test code"
)]
mod tests {
    use super::*;

    fn dummy_message(idx: usize) -> ChatMessage {
        ChatMessage {
            sender_session: Some(1),
            sender_name: "user".into(),
            sender_hash: None,
            body: format!("msg {idx}"),
            channel_id: 0,
            is_own: false,
            dm_session: None,
            message_id: Some(format!("id-{idx}")),
            timestamp: Some(idx as u64),
            is_legacy: false,
            send_failed: false,
            edited_at: None,
            pinned: false,
            pinned_by: None,
            pinned_at: None,
            plugin_name: None,
            plugin_components: None,
        }
    }

    #[test]
    fn push_capped_drops_oldest_when_full() {
        let mut buf: Vec<ChatMessage> = Vec::new();
        for i in 0..(MAX_MESSAGES_PER_THREAD + 5) {
            push_capped(&mut buf, dummy_message(i));
        }
        assert_eq!(buf.len(), MAX_MESSAGES_PER_THREAD);
        // Oldest 5 should have been drained; first remaining message is index 5.
        assert_eq!(buf.first().and_then(|m| m.timestamp), Some(5));
        assert_eq!(
            buf.last().and_then(|m| m.timestamp),
            Some((MAX_MESSAGES_PER_THREAD + 4) as u64),
        );
    }

    #[test]
    fn push_capped_below_limit_keeps_all() {
        let mut buf: Vec<ChatMessage> = Vec::new();
        for i in 0..10 {
            push_capped(&mut buf, dummy_message(i));
        }
        assert_eq!(buf.len(), 10);
        assert_eq!(buf.first().and_then(|m| m.timestamp), Some(0));
    }

    /// A named row, so a test can say which ids a page and a range share.
    fn row(id: &str, ts: u64) -> ChatMessage {
        ChatMessage {
            message_id: Some(id.into()),
            timestamp: Some(ts),
            ..dummy_message(0)
        }
    }

    fn ids(store: &MessageStore, channel: u32) -> Vec<String> {
        store
            .by_channel
            .get(&channel)
            .map(|rows| {
                rows.iter()
                    .filter_map(|m| m.message_id.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    }

    /// The bug: opening a channel showed the oldest messages this client had.
    ///
    /// The newest page has no cursor, which made it look like a walk backwards
    /// -- so it was *prepended* to the rows restored from the local cache, and
    /// the thread ended on the oldest of them.
    #[test]
    fn the_newest_page_joins_the_tail_not_the_head() {
        let mut store = MessageStore::default();
        store.restore_cached(7, vec![row("a", 1), row("b", 2), row("c", 3)], false);

        // The server's newest page overlaps the last cached row.
        store.join_tail(7, vec![row("c", 3), row("d", 4), row("e", 5)], false);

        assert_eq!(ids(&store, 7), ["a", "b", "c", "d", "e"]);
        let window = store.window(7);
        assert!(!window.more_after, "the tail page is the tail");
        assert!(
            !window.more_before,
            "the rows in front of the page were kept, so nothing is missing"
        );
    }

    #[test]
    fn a_tail_page_that_does_not_overlap_replaces_the_range() {
        let mut store = MessageStore::default();
        store.restore_cached(7, vec![row("a", 1), row("b", 2)], false);

        store.join_tail(7, vec![row("y", 9), row("z", 10)], false);

        assert_eq!(
            ids(&store, 7),
            ["y", "z"],
            "rows that cannot be joined without inventing an order are dropped"
        );
        assert!(
            store.window(7).more_before,
            "and the gap they left is recorded, or the reader is shown a short              thread as a complete one"
        );
    }

    /// A channel whose history the server does not keep answers the open fetch
    /// with nothing. Its local cache is the only copy there is.
    #[test]
    fn an_empty_tail_page_keeps_what_is_held() {
        let mut store = MessageStore::default();
        store.restore_cached(7, vec![row("a", 1), row("b", 2)], false);

        store.join_tail(7, Vec::new(), false);

        assert_eq!(ids(&store, 7), ["a", "b"]);
    }

    #[test]
    fn a_truncated_cache_restores_as_a_thread_with_a_head_to_page_to() {
        let mut store = MessageStore::default();
        store.restore_cached(7, vec![row("b", 2)], true);

        assert!(
            store.window(7).more_before,
            "the cache said it held more than it handed over"
        );
    }

    // Phase E: voice migration on active-session switch.
    //
    // We cover the safe branches that don't try to start a real audio
    // pipeline: unknown target, same-as-active no-op, and the
    // VoiceState::Inactive case where migration just performs the swap.

    fn register_idle_session(state: &AppState) -> ServerId {
        let id = ServerId::new();
        let arc = state.fresh_session_state();
        let _ = state.registry.register_active(id, arc);
        id
    }

    #[tokio::test]
    async fn switch_active_with_voice_unknown_target_errors() {
        let state = AppState::new();
        let _ = register_idle_session(&state);
        let bogus = ServerId::new();
        assert!(state.switch_active_with_voice(bogus).await.is_err());
    }

    #[tokio::test]
    async fn switch_active_with_voice_same_session_is_noop() {
        let state = AppState::new();
        let id = register_idle_session(&state);
        // Point `inner` at the registered session (registration alone
        // only updates the registry).
        state.switch_active_to(id).expect("ok");
        let prev = state.inner.snapshot();
        state.switch_active_with_voice(id).await.expect("ok");
        let next = state.inner.snapshot();
        assert!(Arc::ptr_eq(&prev, &next));
    }

    /// A stop that lands while a start is still building its pipeline
    /// retires that start: the loop it finally produces is aborted rather
    /// than installed, so a mute cannot be undone by the restart it overtook.
    #[tokio::test]
    async fn a_stop_during_a_build_retires_the_start() {
        let mut audio = AudioPipelineState::default();
        let claim = audio.begin_outbound();
        audio.stop_outbound();
        let stale = tokio::spawn(std::future::pending::<()>());
        assert!(!audio.install_outbound(claim, stale));
        assert!(audio.outbound_task_handle.is_none());

        // A fresh claim installs, and installing over a stored loop aborts it.
        let claim = audio.begin_outbound();
        let first = tokio::spawn(std::future::pending::<()>());
        let first_abort = first.abort_handle();
        assert!(audio.install_outbound(claim, first));
        let claim = audio.begin_outbound();
        assert!(audio.install_outbound(claim, tokio::spawn(std::future::pending::<()>())));
        tokio::task::yield_now().await;
        assert!(
            first_abort.is_finished(),
            "the replaced loop must be aborted"
        );
        audio.stop_outbound();
        assert!(audio.outbound_task_handle.is_none());
    }

    #[tokio::test]
    async fn switch_active_with_voice_inactive_just_swaps() {
        let state = AppState::new();
        let a = register_idle_session(&state);
        let b = register_idle_session(&state);
        // Most recently registered wins active in the registry.
        assert_eq!(state.registry.active_id(), Some(b));
        state.switch_active_to(b).expect("ok");
        state.switch_active_with_voice(a).await.expect("ok");
        assert_eq!(state.registry.active_id(), Some(a));
        let active_arc = state.registry.session(a).expect("a present");
        assert!(Arc::ptr_eq(&state.inner.snapshot(), &active_arc));
    }

    // Regression: disconnecting a non-active session must NOT touch
    // the active session's `inner` pointer, the active session's
    // SharedState, or the active session's audio pipeline.

    #[tokio::test]
    async fn disconnect_session_non_active_leaves_active_inner_intact() {
        let state = AppState::new();
        let active = register_idle_session(&state);
        let victim = register_idle_session(&state);
        state.switch_active_to(active).expect("ok");

        let active_arc_before = state.registry.session(active).expect("active");
        assert!(Arc::ptr_eq(&state.inner.snapshot(), &active_arc_before));

        state.disconnect_session(victim).await.expect("ok");

        // Victim removed from registry.
        assert!(state.registry.session(victim).is_none());
        // Active still active and `inner` still points at it.
        assert_eq!(state.registry.active_id(), Some(active));
        assert!(Arc::ptr_eq(&state.inner.snapshot(), &active_arc_before));
    }

    #[tokio::test]
    async fn disconnect_session_active_rebinds_inner_to_remaining() {
        let state = AppState::new();
        let other = register_idle_session(&state);
        let active = register_idle_session(&state);
        state.switch_active_to(active).expect("ok");

        state.disconnect_session(active).await.expect("ok");

        // Active gone, the remaining session takes over.
        assert!(state.registry.session(active).is_none());
        assert_eq!(state.registry.active_id(), Some(other));
        let other_arc = state.registry.session(other).expect("other present");
        assert!(Arc::ptr_eq(&state.inner.snapshot(), &other_arc));
    }

    #[tokio::test]
    async fn disconnect_session_last_resets_to_default() {
        let state = AppState::new();
        let only = register_idle_session(&state);
        state.switch_active_to(only).expect("ok");

        state.disconnect_session(only).await.expect("ok");

        assert!(state.registry.active_id().is_none());
        // `inner` must point at the empty default state.
        assert!(Arc::ptr_eq(&state.inner.snapshot(), &state.default_inner));
    }

    #[tokio::test]
    async fn disconnect_session_unknown_id_errors() {
        let state = AppState::new();
        let _active = register_idle_session(&state);
        let bogus = ServerId::new();
        assert!(state.disconnect_session(bogus).await.is_err());
    }
}

#[cfg(test)]
mod window_tests {
    use super::*;

    fn message(id: &str, at: u64) -> ChatMessage {
        ChatMessage {
            message_id: Some(id.to_owned()),
            timestamp: Some(at),
            ..ChatMessage::default()
        }
    }

    fn ids(store: &MessageStore, channel: u32) -> Vec<String> {
        store
            .by_channel
            .get(&channel)
            .map(|rows| rows.iter().filter_map(|m| m.message_id.clone()).collect())
            .unwrap_or_default()
    }

    #[test]
    fn a_thread_nobody_has_paged_is_complete_in_both_directions() {
        // The default has to read as "no gap", or every plain volatile channel
        // would look like it had history waiting behind it.
        let store = MessageStore::default();
        let window = store.window(4);
        assert!(!window.more_before);
        assert!(!window.more_after);
    }

    #[test]
    fn a_page_of_older_messages_joins_at_the_head_in_its_own_order() {
        // Not sorted: the page and the range are each contiguous runs in the
        // server's order, so joining them at the edge is what preserves it.
        let mut store = MessageStore::default();
        assert!(store.append_live(4, message("c", 30)));
        store.extend_older(4, vec![message("a", 10), message("b", 20)], true);

        assert_eq!(ids(&store, 4), ["a", "b", "c"]);
        assert!(store.window(4).more_before, "the server said there is more");
    }

    #[test]
    fn a_sender_with_a_skewed_clock_does_not_reorder_the_thread() {
        // What the old timestamp sort got wrong. The clock is the sender's,
        // and a message stamped in 1970 belongs where the archive put it, not
        // at the top of everybody's window.
        let mut store = MessageStore::default();
        assert!(store.append_live(4, message("first", 1_000)));
        assert!(store.append_live(4, message("skewed", 0)));
        assert!(store.append_live(4, message("third", 3_000)));

        assert_eq!(ids(&store, 4), ["first", "skewed", "third"]);
    }

    #[test]
    fn a_page_does_not_repeat_what_the_range_already_holds() {
        let mut store = MessageStore::default();
        assert!(store.append_live(4, message("b", 20)));
        store.extend_older(4, vec![message("a", 10), message("b", 20)], false);

        assert_eq!(ids(&store, 4), ["a", "b"]);
    }

    #[test]
    fn a_thread_detached_from_its_tail_refuses_an_arrival() {
        // The invariant the whole design rests on. Appending here would put the
        // message after a row it does not follow, and the hole is invisible
        // until somebody scrolls into it.
        let mut store = MessageStore::default();
        assert!(store.append_live(4, message("a", 10)));
        store.extend_newer(4, vec![message("b", 20)], true);
        assert!(store.window(4).more_after);

        assert!(
            !store.append_live(4, message("live", 30)),
            "an arrival must be refused while the tail is missing"
        );
        assert_eq!(ids(&store, 4), ["a", "b"]);
    }

    #[test]
    fn reaching_the_tail_again_lets_arrivals_land() {
        let mut store = MessageStore::default();
        assert!(store.append_live(4, message("a", 10)));
        store.extend_newer(4, vec![message("b", 20)], true);
        // The page that catches up says so by reporting no more.
        store.extend_newer(4, vec![message("c", 30)], false);

        assert!(store.append_live(4, message("live", 40)));
        assert_eq!(ids(&store, 4), ["a", "b", "c", "live"]);
    }

    #[test]
    fn evicting_the_far_edge_records_which_way_the_hole_is() {
        // Dropping rows silently is what would corrupt the range: the flags are
        // the only record that the edge moved.
        let mut store = MessageStore::default();
        for n in 0..10 {
            assert!(store.append_live(4, message(&format!("m{n}"), n)));
        }
        store.evict_outside(4, 3, 7);

        assert_eq!(ids(&store, 4), ["m3", "m4", "m5", "m6"]);
        let window = store.window(4);
        assert!(window.more_before, "rows were dropped from the head");
        assert!(window.more_after, "and from the tail");
    }

    #[test]
    fn evicting_nothing_leaves_the_range_attached_to_the_tail() {
        let mut store = MessageStore::default();
        for n in 0..4 {
            assert!(store.append_live(4, message(&format!("m{n}"), n)));
        }
        store.evict_outside(4, 0, 4);

        assert_eq!(ids(&store, 4).len(), 4);
        assert!(!store.window(4).more_after, "the tail is still held");
    }

    #[test]
    fn overflowing_the_cap_records_the_head_it_dropped() {
        // `push_capped` did this drop silently. The next page of history would
        // then be joined onto a range that had quietly moved, which is the same
        // hole by another route.
        let mut store = MessageStore::default();
        for n in 0..(MAX_MESSAGES_PER_THREAD + 5) {
            assert!(store.append_live(4, message(&format!("m{n}"), n as u64)));
        }

        assert_eq!(ids(&store, 4).len(), MAX_MESSAGES_PER_THREAD);
        assert!(store.window(4).more_before, "the oldest rows are gone");
        assert!(!store.window(4).more_after, "but the tail is still here");
    }
}
