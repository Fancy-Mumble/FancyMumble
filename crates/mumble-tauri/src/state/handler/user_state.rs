use std::sync::{Arc, Mutex};

use mumble_protocol::command;
use mumble_protocol::persistent::KeyTrustLevel;
use mumble_protocol::persistent::PchatProtocol;
use mumble_protocol::proto::mumble_tcp;
use tracing::info;

use super::{HandleMessage, HandlerContext};
use crate::state::types::{
    blob_marker, CurrentChannelPayload, ServerLogEntry, UserEntry, VoiceState,
    PRESENCE_HIDDEN_CHANNEL,
};
use crate::state::{pchat, SharedState};

impl HandleMessage for mumble_tcp::UserState {
    fn handle(&self, ctx: &HandlerContext) {
        let Some(session) = self.session else { return };

        // Phase 1: apply the update under the lock, collecting the outcomes
        // the (unlocked) side effects below need.
        let outcome = match ctx.shared.lock().ok().as_mut() {
            Some(state) => compute_user_state_update(self, state, session),
            None => UserStateOutcome::default(),
        };

        // Phase 2: side effects, all outside the lock (Tauri IPC + follow-up
        // queries would otherwise risk deadlock).
        emit_activity_logs(
            ctx,
            outcome.is_synced,
            &outcome.user_name,
            outcome.is_new_user,
            outcome.move_channel_name,
            outcome.old_snapshot,
            &outcome.new_snapshot,
        );

        if outcome.is_synced {
            // A move into the sentinel channel is a presence-hide (the user went
            // into a channel we can't see), not a real channel we can act on -
            // skip the pchat key-share/holder queries it would otherwise trigger.
            if let Some(ch) = outcome
                .remote_channel_move
                .filter(|&c| c != PRESENCE_HIDDEN_CHANNEL)
            {
                handle_remote_channel_move(&ctx.shared, ch);
            }
        }

        if outcome.own_channel_changed {
            if let Some(ch) = self.channel_id {
                handle_own_channel_change(ctx, ch);
            }
        }

        if outcome.is_synced {
            // Avatars and comments are both fetched lazily on first view
            // (`get_user_texture` / `get_user_comment`), so a post-sync update
            // just records the existence markers (above) and notifies the UI.
            ctx.emit_empty("state-changed");
        }
    }
}

/// What the locked `UserState` update produced, for the unlocked side
/// effects in `handle` to act on.
#[derive(Default)]
struct UserStateOutcome {
    is_synced: bool,
    own_channel_changed: bool,
    remote_channel_move: Option<u32>,
    is_new_user: bool,
    user_name: String,
    old_snapshot: Option<MuteDeafSnapshot>,
    new_snapshot: MuteDeafSnapshot,
    move_channel_name: Option<String>,
}

/// Apply one `UserState` to the shared state under the caller's lock:
/// upsert the user, reconcile our own self-mute, record the name, and apply
/// any channel move. Returns the outcomes the unlocked follow-up needs.
fn compute_user_state_update(
    msg: &mumble_tcp::UserState,
    state: &mut SharedState,
    session: u32,
) -> UserStateOutcome {
    let resolver = state.pchat_ctx.hash_name_resolver.clone();
    let is_new_user = !state.users.contains_key(&session);

    let old_snapshot = state.users.get(&session).map(|u| MuteDeafSnapshot {
        mute: u.mute,
        deaf: u.deaf,
        self_mute: u.self_mute,
        self_deaf: u.self_deaf,
    });

    // Captured before the mutable `users` borrow so we can reconcile our own
    // self-mute against the authoritative local voice state.
    let own_session = state.conn.own_session;
    let own_voice_state = state.audio.voice_state;

    let user = state
        .users
        .entry(session)
        .or_insert_with(|| UserEntry::new(session));
    apply_user_state_fields(user, msg);

    // The server resets session self-mute to false on a fresh (re)connect, so
    // a stale initial UserState can arrive AFTER the client's reconnect
    // mute-restore and wrongly clear it. The local voice_state is
    // authoritative for our own mic: once we've (re)muted (voice_state ==
    // Muted), re-assert self_mute on our own user so a late/stale UserState
    // can't flip us to "unmuted".
    if Some(session) == own_session && own_voice_state == VoiceState::Muted {
        user.self_mute = true;
    }

    if let (Some(ref hash), name) = (&user.hash, &user.name) {
        maybe_record_name(&resolver, hash, name);
    }

    let (user_name, new_snapshot) = snapshot_user(user);

    // Apply channel move and drop the borrow on `user` before touching
    // state.current_channel.
    let channel_move = msg.channel_id.map(|ch| {
        let prev = user.channel_id;
        user.channel_id = ch;
        (ch, prev)
    });

    let (own_channel_changed, remote_channel_move) = if let Some((ch, prev)) = channel_move {
        set_channel_outcome(
            state.conn.own_session,
            session,
            ch,
            prev,
            is_new_user,
            &mut state.current_channel,
        )
    } else {
        (false, None)
    };

    let move_channel_name = msg
        .channel_id
        .filter(|_| !is_new_user)
        .and_then(|ch| state.channels.get(&ch))
        .map(|c| c.name.clone());

    UserStateOutcome {
        is_synced: state.conn.synced,
        own_channel_changed,
        remote_channel_move,
        is_new_user,
        user_name,
        old_snapshot,
        new_snapshot,
        move_channel_name,
    }
}

fn apply_user_state_fields(user: &mut UserEntry, proto: &mumble_tcp::UserState) {
    if let Some(ref name) = proto.name {
        user.name = name.clone();
    }
    // Avatar: the existence/version marker comes from the server's
    // `texture_hash` (advertised on sync, before any bytes are fetched); the
    // bytes are stored only when actually delivered (post `RequestBlob`).  This
    // keeps idle avatars off the heap - the backend holds a blob only for users
    // a client has lazily fetched via `get_user_texture`.
    if let Some(ref hash) = proto.texture_hash {
        user.texture_marker = (!hash.is_empty()).then(|| blob_marker(hash));
        if hash.is_empty() {
            user.texture = None;
        }
    }
    if let Some(ref texture) = proto.texture {
        if texture.is_empty() {
            user.texture = None;
            if proto.texture_hash.is_none() {
                user.texture_marker = None;
            }
        } else {
            user.texture = Some(texture.clone());
            if user.texture_marker.is_none() {
                user.texture_marker = Some(blob_marker(texture));
            }
        }
    }
    // Comment/bio: same lazy treatment as the avatar - record existence via the
    // marker (from `comment_hash`), store the text only when delivered.
    if let Some(ref hash) = proto.comment_hash {
        user.comment_marker = (!hash.is_empty()).then(|| blob_marker(hash));
        if hash.is_empty() {
            user.comment = None;
        }
    }
    if let Some(ref comment) = proto.comment {
        if comment.is_empty() {
            user.comment = None;
            if proto.comment_hash.is_none() {
                user.comment_marker = None;
            }
        } else {
            user.comment = Some(comment.clone());
            if user.comment_marker.is_none() {
                user.comment_marker = Some(blob_marker(comment.as_bytes()));
            }
        }
    }
    if let Some(mute) = proto.mute {
        user.mute = mute;
    }
    if let Some(deaf) = proto.deaf {
        user.deaf = deaf;
    }
    if let Some(suppress) = proto.suppress {
        user.suppress = suppress;
    }
    if let Some(self_mute) = proto.self_mute {
        user.self_mute = self_mute;
    }
    if let Some(self_deaf) = proto.self_deaf {
        user.self_deaf = self_deaf;
    }
    // Deafened implies muted: a deafened user cannot transmit. The server may
    // broadcast self_deaf to peers without (re)sending self_mute - e.g. the
    // connect-time deafen - which would otherwise leave peers showing an
    // invalid "deafened-but-not-muted" state out of sync with the local UI.
    // Enforce the invariant from whichever flag is currently set.
    if user.self_deaf {
        user.self_mute = true;
    }
    if let Some(priority) = proto.priority_speaker {
        user.priority_speaker = priority;
    }
    if let Some(ref hash) = proto.hash {
        user.hash = Some(hash.clone());
    }
    if !proto.client_features.is_empty() {
        user.client_features = proto.client_features.clone();
    }
    if let Some(uid) = proto.user_id {
        user.user_id = Some(uid);
    }
}

fn snapshot_user(user: &UserEntry) -> (String, MuteDeafSnapshot) {
    (
        user.name.clone(),
        MuteDeafSnapshot {
            mute: user.mute,
            deaf: user.deaf,
            self_mute: user.self_mute,
            self_deaf: user.self_deaf,
        },
    )
}

fn emit_activity_logs(
    ctx: &HandlerContext,
    is_synced: bool,
    user_name: &str,
    is_new_user: bool,
    move_channel_name: Option<String>,
    old_snapshot: Option<MuteDeafSnapshot>,
    new_snapshot: &MuteDeafSnapshot,
) {
    if !is_synced || user_name.is_empty() {
        return;
    }
    let mut logs: Vec<ServerLogEntry> = Vec::new();
    if is_new_user {
        logs.push(ServerLogEntry::now(format!("{user_name} connected")));
    }
    if let Some(ch_name) = move_channel_name {
        logs.push(ServerLogEntry::now(format!(
            "{user_name} moved to {ch_name}"
        )));
    }
    build_mute_deaf_log(user_name, old_snapshot, new_snapshot, &mut logs);
    for entry in logs {
        ctx.emit("server-log", entry);
    }
}

fn handle_remote_channel_move(shared: &Arc<Mutex<SharedState>>, ch: u32) {
    pchat::check_key_share_for_channel(shared, ch);
    pchat::query_key_holders(shared, ch);

    let is_signal_v1 = shared
        .lock()
        .ok()
        .and_then(|s| s.channels.get(&ch).and_then(|c| c.pchat_protocol))
        == Some(PchatProtocol::SignalV1);
    if is_signal_v1 {
        pchat::send_signal_distribution(shared, ch);
    }
}

fn handle_own_channel_change(ctx: &HandlerContext, ch: u32) {
    ctx.emit(
        "current-channel-changed",
        CurrentChannelPayload { channel_id: ch },
    );

    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let info = ctx.shared.lock().ok().and_then(|s| {
            let channel_name = s.channels.get(&ch).map(|c| c.name.clone())?;
            let host = s.server.host.clone();
            let app = s.conn.tauri_app_handle.clone()?;
            Some((app, host, channel_name))
        });
        if let Some((app, host, channel_name)) = info {
            if let Some(handle) =
                app.try_state::<crate::platform::android::connection_service::ConnectionServiceHandle>()
            {
                crate::platform::android::connection_service::update_service_channel(&handle, &host, &channel_name);
            }
        }
    }

    ensure_pchat_history(&ctx.shared, ch);
}

/// Kick off the persistent-chat init (key challenge + history fetch) for `ch`
/// exactly once. Shared by the own-channel-change path (on join) and the
/// friend-chat *peek* path - reading a 1:1 private room without joining it:
/// the server gates pchat fetch/delivery on the key challenge + Enter
/// permission, not on channel membership, so the history and live messages
/// arrive without a voice move. Idempotent via `should_fetch_pchat_history`.
pub(crate) fn ensure_pchat_history(shared: &Arc<Mutex<SharedState>>, ch: u32) {
    if should_fetch_pchat_history(shared, ch) {
        mark_channel_fetched(shared, ch);
        let shared = Arc::clone(shared);
        let _pchat_init_task = tokio::spawn(pchat_init_task(shared, ch));
    }
}

fn maybe_record_name(
    resolver: &Option<Arc<dyn crate::state::hash_names::HashNameResolver>>,
    hash: &str,
    name: &str,
) {
    if hash.is_empty() || name.is_empty() {
        return;
    }
    if let Some(ref r) = resolver {
        r.record(hash, name);
    }
}

#[derive(Default)]
struct MuteDeafSnapshot {
    mute: bool,
    deaf: bool,
    self_mute: bool,
    self_deaf: bool,
}

fn build_mute_deaf_log(
    name: &str,
    old: Option<MuteDeafSnapshot>,
    new: &MuteDeafSnapshot,
    logs: &mut Vec<ServerLogEntry>,
) {
    let Some(old) = old else { return };
    if name.is_empty() {
        return;
    }
    // Server-side mute/deaf (admin action).
    if old.mute != new.mute {
        let action = if new.mute { "muted" } else { "unmuted" };
        logs.push(ServerLogEntry::now(format!(
            "{name} was {action} by the server"
        )));
    }
    if old.deaf != new.deaf {
        let action = if new.deaf { "deafened" } else { "undeafened" };
        logs.push(ServerLogEntry::now(format!(
            "{name} was {action} by the server"
        )));
    }
    // Self-mute/deaf.
    if old.self_mute != new.self_mute {
        let action = if new.self_mute { "muted" } else { "unmuted" };
        logs.push(ServerLogEntry::now(format!("{name} self-{action}")));
    }
    if old.self_deaf != new.self_deaf {
        let action = if new.self_deaf {
            "deafened"
        } else {
            "undeafened"
        };
        logs.push(ServerLogEntry::now(format!("{name} self-{action}")));
    }
}

fn set_channel_outcome(
    own_session: Option<u32>,
    session: u32,
    ch: u32,
    prev_channel: u32,
    is_new_user: bool,
    current_channel: &mut Option<u32>,
) -> (bool, Option<u32>) {
    if own_session == Some(session) {
        *current_channel = Some(ch);
        (true, None)
    } else if is_new_user || ch != prev_channel {
        (false, Some(ch))
    } else {
        (false, None)
    }
}

fn should_fetch_pchat_history(shared: &Arc<Mutex<SharedState>>, ch: u32) -> bool {
    let Ok(s) = shared.lock() else { return false };
    let mode = s.channels.get(&ch).and_then(|c| c.pchat_protocol);
    let already_fetched = s
        .pchat_ctx
        .pchat
        .as_ref()
        .is_some_and(|p| p.fetched_channels.contains(&ch));
    s.pchat_ctx.pchat.is_some() && mode.is_some_and(|m| m.is_encrypted()) && !already_fetched
}

fn mark_channel_fetched(shared: &Arc<Mutex<SharedState>>, ch: u32) {
    let Ok(mut state) = shared.lock() else { return };
    if let Some(ref mut pchat) = state.pchat_ctx.pchat {
        let _ = pchat.fetched_channels.insert(ch);
    }
}

fn maybe_derive_archive_key_for_join(
    shared: &Arc<Mutex<SharedState>>,
    ch: u32,
) -> Option<(std::path::PathBuf, [u8; 32], String)> {
    let Ok(mut s) = shared.lock() else {
        return None;
    };
    let p = s.pchat_ctx.pchat.as_mut()?;
    if p.key_manager.has_key(ch, PchatProtocol::FancyV1FullArchive) {
        return None;
    }
    let cert = p.own_cert_hash.clone();
    let key = mumble_protocol::persistent::encryption::derive_archive_key(&p.seed, ch);
    p.key_manager
        .store_archive_key(ch, key, KeyTrustLevel::Verified);
    p.key_manager.set_channel_originator(ch, cert.clone());
    info!(channel_id = ch, cert_hash = %cert, "derived archive key immediately on join");
    p.identity_dir.clone().map(|dir| (dir, key, cert))
}

fn derive_channel_key_as_originator(
    shared: &Arc<Mutex<SharedState>>,
    ch: u32,
) -> Option<(std::path::PathBuf, [u8; 32], String)> {
    let Ok(mut s) = shared.lock() else {
        return None;
    };
    let mode = s.channels.get(&ch).and_then(|c| c.pchat_protocol);
    let p = s.pchat_ctx.pchat.as_mut()?;
    let cert = p.own_cert_hash.clone();
    match mode {
        Some(PchatProtocol::FancyV1FullArchive) => {
            let key = mumble_protocol::persistent::encryption::derive_archive_key(&p.seed, ch);
            p.key_manager
                .store_archive_key(ch, key, KeyTrustLevel::Verified);
            p.key_manager.set_channel_originator(ch, cert.clone());
            info!(channel_id = ch, cert_hash = %cert, "derived archive key (originator)");
            p.identity_dir.clone().map(|dir| (dir, key, cert))
        }
        Some(PchatProtocol::SignalV1) => {
            if !p.ensure_signal_bridge() {
                pchat::emit_signal_bridge_error(
                    shared,
                    "Signal bridge library could not be loaded. End-to-end encryption is unavailable.",
                );
            }
            info!(channel_id = ch, "signal bridge ensured on join (fallback)");
            None
        }
        _ => None,
    }
}

async fn pchat_init_task(shared: Arc<Mutex<SharedState>>, ch: u32) {
    pchat::emit_history_loading(&shared, ch, true);

    let mode = shared
        .lock()
        .ok()
        .and_then(|s| s.channels.get(&ch).and_then(|c| c.pchat_protocol));

    if !run_pchat_mode_init(&shared, ch, mode).await {
        return; // mode init already emitted the loading-finished signal
    }
    derive_channel_key_if_needed(&shared, ch).await;
    send_join_pchat_fetch(&shared, ch).await;
}

/// Mode-specific channel init (archive key report / Signal distribution).
/// Returns `false` if init failed terminally (Signal bridge unavailable),
/// in which case the loading signal is already cleared and the caller stops.
async fn run_pchat_mode_init(
    shared: &Arc<Mutex<SharedState>>,
    ch: u32,
    mode: Option<PchatProtocol>,
) -> bool {
    if mode == Some(PchatProtocol::FancyV1FullArchive) {
        if let Some((dir, key, cert)) = maybe_derive_archive_key_for_join(shared, ch) {
            pchat::persist_archive_key(&dir, ch, &key, Some(&cert));
        }
        pchat::send_key_holder_report_async(shared, ch).await;
    }

    if mode == Some(PchatProtocol::SignalV1) {
        if pchat::ensure_signal_bridge_unlocked(shared) {
            pchat::send_signal_distribution(shared, ch);
            pchat::send_key_holder_report_async(shared, ch).await;
        } else {
            pchat::emit_signal_bridge_error(
                shared,
                "Signal bridge library could not be loaded. End-to-end encryption is unavailable.",
            );
            pchat::emit_history_loading(shared, ch, false);
            return false;
        }
    }
    true
}

/// Whether the channel currently has a usable key for its pchat mode.
/// `false` when there is no pchat context or no mode set.
fn channel_has_key(shared: &Arc<Mutex<SharedState>>, ch: u32) -> bool {
    let s = shared.lock().ok();
    let Some(s) = s.as_ref() else { return false };
    let pchat_mode = s.channels.get(&ch).and_then(|c| c.pchat_protocol);
    s.pchat_ctx
        .pchat
        .as_ref()
        .is_some_and(|p| pchat_mode.is_some_and(|m| p.key_manager.has_key(ch, m)))
}

/// Whether we should originate a key: a pchat context and mode exist but the
/// channel has no key yet. Distinct from `!channel_has_key`, which is also
/// true when there is simply no pchat context/mode (nothing to originate).
fn channel_needs_key(shared: &Arc<Mutex<SharedState>>, ch: u32) -> bool {
    let s = shared.lock().ok();
    let Some(s) = s.as_ref() else { return false };
    let pchat_mode = s.channels.get(&ch).and_then(|c| c.pchat_protocol);
    s.pchat_ctx
        .pchat
        .as_ref()
        .and_then(|p| pchat_mode.map(|m| !p.key_manager.has_key(ch, m)))
        .unwrap_or(false)
}

/// Wait briefly for another member to distribute a key, then originate one
/// ourselves if none arrived (skipping the wait when a key already exists).
async fn derive_channel_key_if_needed(shared: &Arc<Mutex<SharedState>>, ch: u32) {
    if channel_has_key(shared, ch) {
        tracing::debug!(channel_id = ch, "pchat: key already exists, skipping 2s wait");
    } else {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }

    if !channel_needs_key(shared, ch) {
        return;
    }
    if let Some((dir, key, cert)) = derive_channel_key_as_originator(shared, ch) {
        pchat::persist_archive_key(&dir, ch, &key, Some(&cert));
    }
    pchat::send_key_holder_report_async(shared, ch).await;
}

/// Request recent history for the joined channel, arming a timeout that
/// clears the loading indicator if no delivery arrives.
async fn send_join_pchat_fetch(shared: &Arc<Mutex<SharedState>>, ch: u32) {
    let handle = shared.lock().ok().and_then(|s| s.conn.client_handle.clone());
    let fetch_sent = if let Some(handle) = handle {
        let fetch = mumble_tcp::PchatFetch {
            channel_id: Some(ch),
            before_id: None,
            limit: Some(50),
            after_id: None,
        };
        if let Err(e) = handle.send(command::SendPchatFetch { fetch }).await {
            tracing::warn!("send pchat-fetch failed: {e}");
            false
        } else {
            info!(channel_id = ch, "sent pchat-fetch on join");
            true
        }
    } else {
        false
    };

    if fetch_sent {
        let shared_timeout = Arc::clone(shared);
        let _timeout_task = tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
            pchat::emit_history_loading(&shared_timeout, ch, false);
        });
    } else {
        pchat::emit_history_loading(shared, ch, false);
    }
}
