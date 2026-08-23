use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mumble_protocol::command;
use mumble_protocol::persistent::{KeyTrustLevel, PchatProtocol};
use mumble_protocol::proto::mumble_tcp;
use tracing::{debug, info, warn};

use super::{HandleMessage, HandlerContext};
use crate::state::local_cache::CachedReaction;
use crate::state::pchat::{self, PchatState};
use crate::state::types::{
    ChatMessage, ConnectionStatus, CurrentChannelPayload, ReactionFetchResponsePayload,
    StoredReactionPayload,
};
use crate::state::SharedState;

impl HandleMessage for mumble_tcp::ServerSync {
    fn handle(&self, ctx: &HandlerContext) {
        let Some((_sessions, initial_channel)) = ctx.apply_sync_state(self) else {
            return;
        };
        ctx.emit_empty("server-connected");

        #[cfg(target_os = "android")]
        ctx.start_android_service(initial_channel);

        if let Some(ch) = initial_channel {
            ctx.emit(
                "current-channel-changed",
                CurrentChannelPayload { channel_id: ch },
            );
        }

        ctx.request_channel_descriptions();
        ctx.request_channel_permissions();
        ctx.register_push_subscribe();
        ctx.request_livery();
        ctx.init_pchat();
    }
}

// ---------------------------------------------------------------------------
// ServerSync helpers on HandlerContext
// ---------------------------------------------------------------------------

impl HandlerContext {
    /// Apply the `ServerSync` fields to `SharedState` and return the
    /// collected user sessions plus the initial channel assignment.
    fn apply_sync_state(&self, msg: &mumble_tcp::ServerSync) -> Option<(Vec<u32>, Option<u32>)> {
        let Ok(mut state) = self.shared.lock() else {
            return None;
        };
        state.conn.status = ConnectionStatus::Connected;
        state.conn.own_session = msg.session;
        state.conn.synced = true;
        state.server.max_bandwidth = msg.max_bandwidth;
        state.server.welcome_text = msg.welcome_text.clone();

        if let Some(perms) = msg.permissions {
            let perms_u32 = perms as u32;
            state.server.root_permissions = Some(perms_u32);
            info!(
                permissions_hex = format!("0x{perms_u32:08X}"),
                "ServerSync root channel permissions (stored as fallback)"
            );
            if let Some(ch) = state.channels.get_mut(&0) {
                ch.permissions = Some(perms_u32);
            }
        } else {
            debug!("ServerSync has no permissions field");
        }

        let initial_channel = msg
            .session
            .and_then(|s| state.users.get(&s))
            .map(|u| u.channel_id);
        if let Some(ch) = initial_channel {
            state.current_channel = Some(ch);
        }

        let sessions = state.users.keys().copied().collect();
        Some((sessions, initial_channel))
    }

    /// Start the Android foreground service and register FCM push token.
    #[cfg(target_os = "android")]
    fn start_android_service(&self, initial_channel: Option<u32>) {
        use tauri::Manager;
        let (app_handle, host, channel_name) = {
            let state = self.shared.lock().ok();
            state
                .map(|s| {
                    let ch_name = initial_channel
                        .and_then(|ch| s.channels.get(&ch))
                        .map(|c| c.name.clone());
                    (
                        s.conn.tauri_app_handle.clone(),
                        s.server.host.clone(),
                        ch_name,
                    )
                })
                .unwrap_or_default()
        };
        let Some(app) = app_handle else { return };

        if let Some(handle) =
            app.try_state::<crate::platform::android::connection_service::ConnectionServiceHandle>()
        {
            crate::platform::android::connection_service::start_service(&handle, &host);
            if let Some(ref ch_name) = channel_name {
                crate::platform::android::connection_service::update_service_channel(
                    &handle, &host, ch_name,
                );
            }
        }

        self.register_fcm_token(&app);
    }

    /// Send the FCM device token to the server for push notifications.
    #[cfg(target_os = "android")]
    fn register_fcm_token(&self, app: &tauri::AppHandle) {
        use tauri::Manager;
        let Some(fcm) = app.try_state::<crate::platform::android::fcm_service::FcmPluginHandle>()
        else {
            info!("FCM: FcmPluginHandle not available (not Android?)");
            return;
        };
        info!("FCM: FcmPluginHandle found, requesting device token");
        let Some(token) = crate::platform::android::fcm_service::get_token(&fcm) else {
            warn!("FCM: no device token available, skipping push registration");
            return;
        };
        info!(
            len = token.len(),
            "FCM: device token obtained, sending push registration"
        );
        let client_handle = self
            .shared
            .lock()
            .ok()
            .and_then(|s| s.conn.client_handle.clone());
        let Some(handle) = client_handle else {
            warn!("FCM: no client handle, cannot send push registration");
            return;
        };
        let _push_register_task = tokio::spawn(async move {
            match handle
                .send(command::SendFancyPushRegister {
                    token,
                    muted_channels: vec![],
                })
                .await
            {
                Ok(()) => info!("FCM: push registration sent to server"),
                Err(e) => warn!("FCM: failed to send push registration: {e}"),
            }
        });
    }

    // NOTE: user texture + comment blobs are deliberately NOT bulk-fetched on
    // sync.  Both are large and rarely displayed, so they are fetched lazily
    // per-user on first view (`get_user_texture` / `get_user_comment`); the
    // serialised `texture_size` / `comment_size` markers tell the frontend which
    // users have one.  This keeps the backend from holding a blob for every
    // connected user.

    /// Request description blobs for channels whose descriptions were
    /// omitted during the initial sync (only a hash was sent).
    ///
    /// A few at a time, waiting for each batch to land before asking for the
    /// next. Asking for all of them in one `RequestBlob` is what the server
    /// answers in one burst, and a tree whose descriptions carry inline artwork
    /// answers with megabytes: against a real server (36 channels, 5.75 MiB of
    /// descriptions) that burst passed the gateway's per-client control budget
    /// and the connection was reset a few hundred milliseconds after
    /// `ServerSync` — the client killed by the reply it asked for. Paced, the
    /// same fetch costs a few round trips and cannot outrun any budget.
    ///
    /// Re-deriving what is still missing each round is what makes it also a
    /// retry: a server that answers only part of a batch (its own reply cap) is
    /// asked again for the rest on the next pass.
    fn request_channel_descriptions(&self) {
        /// Channels per `RequestBlob`. Descriptions are unbounded in principle
        /// and a few hundred KiB in practice, so a handful in flight stays well
        /// inside a 4 MiB budget while still costing far fewer round trips than
        /// one at a time.
        const BATCH: usize = 4;
        /// How long a batch is given before the fetch gives up on it. Generous:
        /// it is a whole-tree transfer on a slow link, not a UI interaction.
        const BATCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
        /// How long a *partly* answered batch waits for the rest. A server that
        /// has already replied and then goes quiet has said what it will say --
        /// its own reply cap -- and the remainder belongs in the next request,
        /// not in the rest of this timeout.
        const QUIET_AFTER_PROGRESS: std::time::Duration = std::time::Duration::from_secs(1);
        const POLL: std::time::Duration = std::time::Duration::from_millis(50);

        /// Channels that announced a description but have not received one.
        fn pending(shared: &Mutex<SharedState>) -> Vec<u32> {
            shared
                .lock()
                .ok()
                .map(|s| {
                    s.channels
                        .values()
                        .filter(|ch| ch.description.is_empty() && ch.description_hash.is_some())
                        .map(|ch| ch.id)
                        .collect()
                })
                .unwrap_or_default()
        }

        /// Wait for a requested batch to arrive, and answer how much of it did
        /// not. Returns early once the batch is whole, and once a batch that
        /// was answered in part has gone quiet.
        async fn settle(shared: &Mutex<SharedState>, batch: &[u32]) -> usize {
            let missing = |ids: &[u32]| {
                let still = pending(shared);
                ids.iter().filter(|id| still.contains(id)).count()
            };
            let deadline = tokio::time::Instant::now() + BATCH_TIMEOUT;
            let mut outstanding = batch.len();
            let mut quiet = std::time::Duration::ZERO;
            while tokio::time::Instant::now() < deadline {
                tokio::time::sleep(POLL).await;
                let left = missing(batch);
                if left == 0 {
                    return 0;
                }
                if left < outstanding {
                    outstanding = left;
                    quiet = std::time::Duration::ZERO;
                    continue;
                }
                quiet += POLL;
                if outstanding < batch.len() && quiet >= QUIET_AFTER_PROGRESS {
                    break;
                }
            }
            missing(batch)
        }

        if pending(&self.shared).is_empty() {
            return;
        }
        let shared = Arc::clone(&self.shared);
        // The connection this fetch belongs to. A reconnect raises the epoch,
        // and a fetch that outlived its connection would otherwise keep pacing
        // requests alongside the new connection's own fetch -- two paced
        // fetches being exactly the unpaced burst this avoids. Same guard the
        // event handler uses on a reused `SharedState`.
        let epoch = self.shared.lock().map(|s| s.conn.epoch).unwrap_or_default();
        let _desc_blob_task = tokio::spawn(async move {
            loop {
                let mut batch = pending(&shared);
                if batch.is_empty() {
                    break;
                }
                batch.sort_unstable();
                batch.truncate(BATCH);

                // Taken per round rather than held: a disconnect drops the
                // handle, and this task must end with the connection that
                // started it rather than fetch into a dead socket.
                let Some(handle) = shared
                    .lock()
                    .ok()
                    .filter(|s| s.conn.epoch == epoch)
                    .and_then(|s| s.conn.client_handle.clone())
                else {
                    break;
                };
                if handle
                    .send(command::RequestBlob {
                        session_texture: Vec::new(),
                        session_comment: Vec::new(),
                        channel_description: batch.clone(),
                        user_id_comment: Vec::new(),
                    })
                    .await
                    .is_err()
                {
                    break;
                }

                // A round that moved nothing means the server is not going to
                // answer these — a description too large for it to send, or a
                // server that does not serve the blob at all. Stopping keeps
                // that from becoming an endless re-request loop; anything still
                // missing simply renders empty.
                if settle(&shared, &batch).await == batch.len() {
                    debug!(
                        channels = ?batch,
                        "no channel descriptions arrived for a batch; giving up on the rest"
                    );
                    break;
                }
            }
        });
    }

    /// Request permissions for all known channels so the UI can disable
    /// actions the user is not allowed to perform.
    fn request_channel_permissions(&self) {
        let channel_ids: Vec<u32> = self
            .shared
            .lock()
            .ok()
            .map(|s| s.channels.keys().copied().collect())
            .unwrap_or_default();

        let shared = Arc::clone(&self.shared);
        let _permissions_task = tokio::spawn(async move {
            let handle = shared
                .lock()
                .ok()
                .and_then(|s| s.conn.client_handle.clone());
            if let Some(handle) = handle {
                for ch_id in channel_ids {
                    let _ = handle
                        .send(command::PermissionQuery { channel_id: ch_id })
                        .await;
                }
            }
        });
    }

    /// Register live push subscriptions so the server routes `TextMessage`
    /// from channels with `SubscribePush` permission to this client.
    fn register_push_subscribe(&self) {
        let (handle, is_fancy) = {
            let state = self.shared.lock().ok();
            state
                .map(|s| {
                    (
                        s.conn.client_handle.clone(),
                        s.server.fancy_version.is_some(),
                    )
                })
                .unwrap_or_default()
        };
        if !is_fancy {
            debug!("push subscribe: skipped (non-fancy server)");
            return;
        }
        let Some(handle) = handle else {
            warn!("push subscribe: no client handle");
            return;
        };
        info!("push subscribe: sending FancySubscribePush registration");
        let _subscribe_task = tokio::spawn(async move {
            match handle
                .send(command::SendFancySubscribePush {
                    muted_channels: vec![],
                })
                .await
            {
                Ok(()) => info!("push subscribe: registration sent to server"),
                Err(e) => warn!("push subscribe: failed to send registration: {e}"),
            }
        });
    }

    /// Ask the server what it looks like.
    ///
    /// Sent after sync rather than during the handshake, because it is
    /// presentation: nothing about connecting waits on it, and a server that
    /// never answers leaves the client on its own colours.
    ///
    /// The keys already cached are named, so a reconnect to a server whose
    /// banner has not changed carries the document and no artwork at all.
    fn request_livery(&self) {
        let (handle, is_fancy, have_keys) = {
            let state = self.shared.lock().ok();
            state
                .map(|s| {
                    (
                        s.conn.client_handle.clone(),
                        s.server.fancy_version.is_some(),
                        s.livery_art.keys().cloned().collect::<Vec<_>>(),
                    )
                })
                .unwrap_or_default()
        };
        if !is_fancy {
            debug!("livery: skipped (non-fancy server)");
            return;
        }
        let Some(handle) = handle else {
            warn!("livery: no client handle");
            return;
        };
        let _livery_task = tokio::spawn(async move {
            match handle.send(command::RequestLivery { have_keys }).await {
                Ok(()) => debug!("livery: requested"),
                Err(e) => warn!("livery: failed to request: {e}"),
            }
        });
    }

    /// Initialise `PchatState`, restore cached data, and spawn the async
    /// key-announce + history-fetch task.
    fn init_pchat(&self) {
        let (seed, cert_hash, handle, is_fancy, id_dir) = {
            let state = self.shared.lock().ok();
            if let Some(ref s) = state {
                let own_hash = s
                    .conn
                    .own_session
                    .and_then(|sess| s.users.get(&sess))
                    .and_then(|u| u.hash.clone());
                (
                    s.pchat_ctx.seed,
                    own_hash,
                    s.conn.client_handle.clone(),
                    s.server.fancy_version.is_some(),
                    s.pchat_ctx.identity_dir.clone(),
                )
            } else {
                (None, None, None, false, None)
            }
        };

        debug!(
            has_seed = seed.is_some(),
            has_cert_hash = cert_hash.is_some(),
            has_handle = handle.is_some(),
            is_fancy = is_fancy,
            "pchat init check"
        );

        let (Some(seed), Some(cert_hash), Some(_handle), true) =
            (seed, cert_hash, handle, is_fancy)
        else {
            info!("pchat not initialised (no seed, cert hash, or non-fancy server)");
            return;
        };

        let mut pchat_state = match PchatState::new(seed, cert_hash.clone(), id_dir) {
            Ok(s) => s,
            Err(e) => {
                warn!("failed to init pchat: {e}");
                return;
            }
        };

        pchat_state.restore_archive_keys();
        let (cached_messages, cached_reactions) = pchat_state.load_local_cache();

        info!(cert_hash = %cert_hash, "pchat initialised");

        if let Ok(mut state) = self.shared.lock() {
            state.pchat_ctx.pchat = Some(pchat_state);
            for (ch_id, msgs) in cached_messages {
                if !msgs.is_empty() {
                    state.msgs.by_channel.entry(ch_id).or_default().extend(msgs);
                }
            }
        }

        self.emit_cached_reactions(cached_reactions);
        self.spawn_key_announce_and_channel_init();
    }

    /// Emit `pchat-reaction-fetch-response` events for each channel so the
    /// frontend can populate reaction pills for messages restored from disk.
    fn emit_cached_reactions(&self, cached_reactions: HashMap<u32, Vec<CachedReaction>>) {
        for (ch_id, reactions) in cached_reactions {
            if reactions.is_empty() {
                continue;
            }
            let payloads: Vec<StoredReactionPayload> = reactions
                .into_iter()
                .map(|r| StoredReactionPayload {
                    message_id: r.message_id,
                    emoji: r.emoji,
                    sender_hash: r.sender_hash,
                    sender_name: r.sender_name,
                    timestamp: r.timestamp,
                })
                .collect();
            self.emit(
                "pchat-reaction-fetch-response",
                ReactionFetchResponsePayload {
                    channel_id: ch_id,
                    reactions: payloads,
                },
            );
        }
    }

    /// Spawn the async task that sends `key-announce` and then initialises
    /// the encrypted channel (key derivation/exchange + history fetch).
    fn spawn_key_announce_and_channel_init(&self) {
        let shared = Arc::clone(&self.shared);
        let _key_announce_task = tokio::spawn(async move {
            // The channel we land in on connect; an archive room we join later
            // announces again on the way in.
            let landing = shared
                .lock()
                .ok()
                .and_then(|s| s.current_channel)
                .unwrap_or(0);
            pchat::send_key_announce(&shared, landing).await;

            let (ch, mode) = resolve_initial_channel(&shared);
            debug!(channel = ?ch, mode = ?mode, "pchat: initial channel/mode resolved");

            if let (Some(ch), Some(mode)) = (ch, mode) {
                if mode.is_encrypted() {
                    init_encrypted_channel(&shared, ch, mode).await;
                }
            }
        });
    }
}

// ---------------------------------------------------------------------------
// PchatState helpers
// ---------------------------------------------------------------------------

impl PchatState {
    /// Re-load archive keys that were persisted to disk from a previous
    /// session.
    fn restore_archive_keys(&mut self) {
        let Some(ref dir) = self.identity_dir else {
            return;
        };
        let persisted = pchat::load_persisted_archive_keys(dir);
        for (ch, key, originator) in persisted {
            self.key_manager
                .store_archive_key(ch, key, KeyTrustLevel::Verified);
            if let Some(orig) = originator {
                self.key_manager.set_channel_originator(ch, orig);
            }
            info!(channel_id = ch, "restored persisted archive key");
        }
    }

    /// Load the encrypted local message + reaction cache from disk.
    ///
    /// This is done *before* acquiring the shared lock because the AES-GCM
    /// decryption can take hundreds of milliseconds.
    fn load_local_cache(
        &mut self,
    ) -> (
        HashMap<u32, Vec<ChatMessage>>,
        HashMap<u32, Vec<CachedReaction>>,
    ) {
        let Some(ref mut cache) = self.local_cache else {
            return (HashMap::new(), HashMap::new());
        };

        let msgs = if let Err(e) = cache.load() {
            warn!("failed to load local message cache: {e}");
            HashMap::new()
        } else {
            let cached = cache.all_chat_messages();
            for (ch_id, msgs) in &cached {
                if !msgs.is_empty() {
                    info!(
                        channel_id = ch_id,
                        count = msgs.len(),
                        "restored cached messages"
                    );
                }
            }
            cached
        };

        if let Err(e) = cache.load_reactions() {
            warn!("failed to load local reaction cache: {e}");
        }
        let rxns = cache.all_reactions().clone();
        for (ch_id, reactions) in &rxns {
            if !reactions.is_empty() {
                info!(
                    channel_id = ch_id,
                    count = reactions.len(),
                    "restored cached reactions"
                );
            }
        }

        (msgs, rxns)
    }
}

// ---------------------------------------------------------------------------
// Async helpers (used inside tokio::spawn, no access to HandlerContext)
// ---------------------------------------------------------------------------

/// Look up the current channel and its pchat protocol mode.
fn resolve_initial_channel(
    shared: &Arc<Mutex<SharedState>>,
) -> (Option<u32>, Option<PchatProtocol>) {
    let s = shared.lock().ok();
    if let Some(ref s) = s {
        let ch = s.current_channel;
        let mode = ch.and_then(|c| s.channels.get(&c).and_then(|ce| ce.pchat_protocol));
        (ch, mode)
    } else {
        (None, None)
    }
}

/// Set up the encryption key for the initial channel and fetch message
/// history from the server.
async fn init_encrypted_channel(shared: &Arc<Mutex<SharedState>>, ch: u32, mode: PchatProtocol) {
    pchat::emit_history_loading(shared, ch, true);

    if !ensure_protocol_key(shared, ch, mode).await {
        return;
    }

    await_or_generate_key(shared, ch, mode).await;
    fetch_channel_history(shared, ch, mode).await;
}

/// Derive or distribute the protocol-specific key for the channel.
/// Returns `false` if the Signal bridge failed to load and the caller
/// should abort.
async fn ensure_protocol_key(
    shared: &Arc<Mutex<SharedState>>,
    ch: u32,
    mode: PchatProtocol,
) -> bool {
    if mode == PchatProtocol::FancyV1FullArchive {
        if let Ok(mut s) = shared.lock() {
            // Gated, and deliberately before the wait below: this used to mint
            // unconditionally, so `await_or_generate_key`'s 2s window for a
            // peer's key never had anything left to decide -- the key already
            // existed, and it was the wrong one.
            let mint = pchat::should_mint_archive_key(&s, ch);
            if let Some(ref mut p) = s.pchat_ctx.pchat {
                if mint {
                    let cert = p.own_cert_hash.clone();
                    let key =
                        mumble_protocol::persistent::encryption::derive_archive_key(&p.seed, ch);
                    p.key_manager
                        .store_archive_key(ch, key, KeyTrustLevel::Verified);
                    p.key_manager.set_channel_originator(ch, cert.clone());
                    info!(
                        channel_id = ch,
                        cert_hash = %cert,
                        "derived archive key immediately (no wait needed)"
                    );
                }
            }
        }
        pchat::send_key_holder_report_async(shared, ch).await;
    }

    if mode == PchatProtocol::SignalV1 {
        let bridge_ok = pchat::ensure_signal_bridge_unlocked(shared);
        if bridge_ok {
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

/// Wait for peers to provide a key, then self-generate one if still needed.
async fn await_or_generate_key(shared: &Arc<Mutex<SharedState>>, ch: u32, mode: PchatProtocol) {
    let already_has_key = shared
        .lock()
        .ok()
        .and_then(|s| {
            s.pchat_ctx
                .pchat
                .as_ref()
                .map(|p| p.key_manager.has_key(ch, mode))
        })
        .unwrap_or(false);

    if already_has_key {
        debug!(
            channel_id = ch,
            "pchat: key already exists, skipping 2s wait"
        );
    } else {
        debug!(
            channel_id = ch,
            ?mode,
            "pchat: waiting 2s for key-exchange before self-gen"
        );
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }

    let needs_key = shared
        .lock()
        .ok()
        .and_then(|s| {
            s.pchat_ctx
                .pchat
                .as_ref()
                .map(|p| !p.key_manager.has_key(ch, mode))
        })
        .unwrap_or(false);

    debug!(channel_id = ch, needs_key, "pchat: key check after 2s wait");
    if needs_key {
        self_generate_key(shared, ch);
        pchat::send_key_holder_report_async(shared, ch).await;
    }
}

/// Generate an encryption key locally when no peer provided one.
fn self_generate_key(shared: &Arc<Mutex<SharedState>>, ch: u32) {
    let mut signal_bridge_failed = false;

    if let Ok(mut s) = shared.lock() {
        let mode = s.channels.get(&ch).and_then(|c| c.pchat_protocol);
        // Even after waiting, minting is only right when no peer holds a key.
        let mint = pchat::should_mint_archive_key(&s, ch);
        if let Some(ref mut p) = s.pchat_ctx.pchat {
            let cert = p.own_cert_hash.clone();
            match mode {
                Some(PchatProtocol::FancyV1FullArchive) if mint => {
                    let key =
                        mumble_protocol::persistent::encryption::derive_archive_key(&p.seed, ch);
                    p.key_manager
                        .store_archive_key(ch, key, KeyTrustLevel::Verified);
                    p.key_manager.set_channel_originator(ch, cert.clone());
                    info!(channel_id = ch, cert_hash = %cert, "derived archive key on initial join");
                }
                Some(PchatProtocol::SignalV1) => {
                    signal_bridge_failed = !p.ensure_signal_bridge();
                    info!(
                        channel_id = ch,
                        "signal bridge ensured on initial join (fallback)"
                    );
                }
                _ => {}
            }
        }
    }
    // Emit outside the lock to avoid deadlock (emit_signal_bridge_error
    // also acquires the mutex).
    if signal_bridge_failed {
        pchat::emit_signal_bridge_error(
            shared,
            "Signal bridge library could not be loaded. End-to-end encryption is unavailable.",
        );
    }
}

/// Mark the channel as fetched and send the `PchatFetch` request, then
/// schedule a safety-net timeout to clear the loading indicator.
async fn fetch_channel_history(shared: &Arc<Mutex<SharedState>>, ch: u32, mode: PchatProtocol) {
    // SignalV1 keeps no server-side history by design (forward secrecy: a late
    // joiner must never read what was said before it joined, even once it has
    // every sender's key). Fetching here would ask the server for exactly that
    // history, and the server does return it - `pchat_message` stores SignalV1
    // ciphertext too, for redelivery to a member who was briefly offline, and
    // the fetch handler does not distinguish "was already a member" from "just
    // joined". Skipping the request is the guarantee; nothing downstream
    // re-checks it once fetched.
    if mode == PchatProtocol::SignalV1 {
        debug!(channel_id = ch, "pchat: skipping fetch for SignalV1 (no history by design)");
        pchat::emit_history_loading(shared, ch, false);
        return;
    }
    debug!(channel_id = ch, "pchat: about to send pchat-fetch");
    {
        let s = shared.lock().ok();
        if let Some(ref s) = s {
            if let Some(ref p) = s.pchat_ctx.pchat {
                let has = p.key_manager.has_key(ch, mode);
                debug!(
                    channel_id = ch,
                    has_key = has,
                    "pchat: key state before fetch"
                );
            }
        }
    }
    if let Ok(mut s) = shared.lock() {
        if let Some(ref mut p) = s.pchat_ctx.pchat {
            let _ = p.fetched_channels.insert(ch);
        }
    }
    let fetch = mumble_tcp::PchatFetch {
        channel_id: Some(ch),
        before_id: None,
        limit: Some(50),
        after_id: None,
    };
    let handle = shared
        .lock()
        .ok()
        .and_then(|s| s.conn.client_handle.clone());
    let fetch_sent = if let Some(handle) = handle {
        let _ = handle.send(command::SendPchatFetch { fetch }).await;
        info!(channel_id = ch, "sent initial pchat-fetch");
        true
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
