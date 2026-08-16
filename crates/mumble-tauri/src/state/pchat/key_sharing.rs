//! Key sharing consent, key-possession challenges, and key holder
//! management (report, query, takeover).

use std::sync::{Arc, Mutex};

use tracing::{debug, info, warn};

use mumble_protocol::client::ClientHandle;
use mumble_protocol::command;
use mumble_protocol::proto::mumble_tcp;

use mumble_protocol::persistent::PchatProtocol;

use crate::state::types;
use crate::state::SharedState;

use super::persistence::delete_persisted_archive_key;

// -- Archive key ownership --------------------------------------------

/// Whether this client should mint the `FancyV1FullArchive` key for `channel_id`
/// itself, rather than being given it.
///
/// The archive key is HKDF over **our own identity seed** and the channel id
/// (`derive_archive_key`), so it is stable for one identity and unreachable for
/// any other. Deriving is therefore how the *originator* mints a key, and how
/// it recovers that same key after a restart -- and it is exactly wrong for
/// anyone joining a channel that already has one, because the key they invent
/// is not the key the messages are sealed under.
///
/// That was the bug: every client derived on join, so each held a different
/// key, every peer's ciphertext failed to open with `aead::Error` while
/// `has_key` was true, and the joiner then reported *itself* as a holder --
/// which made `check_key_share_for_channel` skip it and withdrew the consent
/// prompt that would have supplied the real key. Both ends looked healthy and
/// nothing readable passed between them.
///
/// The deciding question is "is this key mine to mint", answered without
/// waiting on anything, because a creator that pauses here is a creator that
/// cannot encrypt its own first message:
///
/// * a recorded originator settles it outright (this is the restart case);
/// * a known holder settles it the other way -- ask them, via the key-exchange
///   consent flow, rather than inventing a second key;
/// * otherwise being *alone in the channel* is what distinguishes creating a
///   channel, or reviving an abandoned one, from joining somebody else's.
pub(crate) fn should_mint_archive_key(state: &SharedState, channel_id: u32) -> bool {
    let Some(pchat) = state.pchat_ctx.pchat.as_ref() else {
        return false;
    };
    if pchat
        .key_manager
        .has_key(channel_id, PchatProtocol::FancyV1FullArchive)
    {
        return false;
    }
    let own = pchat.own_cert_hash.as_str();
    if let Some(originator) = pchat.key_manager.get_channel_originator(channel_id) {
        return originator == own;
    }
    if pchat
        .key_manager
        .key_holders(channel_id)
        .iter()
        .any(|holder| holder != own)
    {
        return false;
    }
    !state
        .users
        .values()
        .any(|u| u.channel_id == channel_id && u.hash.as_deref() != Some(own))
}

// -- Key announce -------------------------------------------------------

/// Announce our E2EE public keys, for relay to whoever shares our channel.
///
/// Sent at connect, on every archive-channel join, and in reply to a stranger's
/// announce - see `handle_proto_key_announce` for why all three are needed.
pub(crate) async fn send_key_announce(shared: &Arc<Mutex<SharedState>>, channel_id: u32) {
    let (announce_proto, cert, handle) = {
        let state = shared.lock().ok();
        if let Some(ref s) = state {
            if let Some(ref p) = s.pchat_ctx.pchat {
                let wire = p
                    .key_manager
                    .build_key_announce(&p.own_cert_hash, super::now_millis());
                let mut proto = super::wire_key_announce_to_proto(&wire);
                // The canon routes and authorises an announce per channel, so
                // the sender names the room it is announcing into. Without it
                // the frame is addressed at channel 0 and reaches whoever is
                // standing in the root instead of the people in the room whose
                // key is at stake.
                proto.channel_id = Some(channel_id);
                (
                    Some(proto),
                    Some(p.own_cert_hash.clone()),
                    s.conn.client_handle.clone(),
                )
            } else {
                (None, None, None)
            }
        } else {
            (None, None, None)
        }
    };

    if let (Some(proto), Some(cert), Some(handle)) = (announce_proto, cert, handle) {
        if let Err(e) = handle
            .send(command::SendPchatKeyAnnounce { announce: proto })
            .await
        {
            warn!("failed to send key-announce: {e}");
        } else {
            info!(cert_hash = %cert, "sent pchat key-announce");
        }
    }
}

// -- Peer holder reports and queries -----------------------------------

/// Fold a peer's holder report in: it holds a key for `channel_id`.
///
/// Additive, not a replacement. murmur's `PchatKeyHoldersList` was the whole
/// list and could be swapped in wholesale; a relayed report is one peer
/// speaking for itself, and forgetting the others on its account would drop
/// exactly the holders who happened to be quiet.
pub(crate) fn handle_proto_key_holder_report(
    shared: &Arc<Mutex<SharedState>>,
    msg: &mumble_tcp::PchatKeyHolderReport,
) {
    let channel_id = msg.channel_id.unwrap_or(0);
    let Some(cert_hash) = msg.cert_hash.clone().filter(|h| !h.is_empty()) else {
        return;
    };
    let payload = {
        let Ok(mut state) = shared.lock() else { return };
        let Some(ref mut pchat) = state.pchat_ctx.pchat else {
            return;
        };
        if cert_hash == pchat.own_cert_hash {
            return;
        }
        pchat
            .key_manager
            .record_key_holder(channel_id, cert_hash.clone());
        debug!(channel_id, holder = %cert_hash, "peer reported itself a key holder");

        let name = state
            .users
            .values()
            .find(|u| u.hash.as_deref() == Some(cert_hash.as_str()))
            .map(|u| u.name.clone())
            .unwrap_or_else(|| cert_hash.chars().take(8).collect());
        let entry = types::KeyHolderEntry {
            cert_hash: cert_hash.clone(),
            name,
            is_online: true,
        };
        let holders = state.pchat_ctx.key_holders.entry(channel_id).or_default();
        if !holders.iter().any(|h| h.cert_hash == cert_hash) {
            holders.push(entry);
        }

        // A holder is not offered the key again.
        state
            .pchat_ctx
            .pending_key_shares
            .retain(|p| !(p.channel_id == channel_id && p.peer_cert_hash == cert_hash));

        state.conn.tauri_app_handle.as_ref().map(|app| {
            (
                app.clone(),
                types::KeyHoldersChangedPayload {
                    channel_id,
                    holders: state
                        .pchat_ctx
                        .key_holders
                        .get(&channel_id)
                        .cloned()
                        .unwrap_or_default(),
                },
            )
        })
    };
    if let Some((app, payload)) = payload {
        use tauri::Emitter;
        let _ = app.emit("pchat-key-holders-changed", payload);
    }
}

/// Answer a peer asking who holds the key: with our report, if we do.
pub(crate) fn handle_proto_key_holders_query(
    shared: &Arc<Mutex<SharedState>>,
    msg: &mumble_tcp::PchatKeyHoldersQuery,
) {
    let channel_id = msg.channel_id.unwrap_or(0);
    // `send_key_holder_report` declines on its own when there is no key.
    send_key_holder_report(shared, channel_id);
}

// -- Key challenge ----------------------------------------------------

pub(crate) fn handle_proto_key_challenge(
    shared: &Arc<Mutex<SharedState>>,
    msg: &mumble_tcp::PchatKeyChallenge,
) {
    let channel_id = msg.channel_id.unwrap_or(0);
    let challenge = msg.challenge.as_deref().unwrap_or_default();

    if challenge.is_empty() {
        warn!(channel_id, "received empty challenge from server, ignoring");
        return;
    }

    let (handle, proof) = {
        let s = shared.lock().ok();
        let h = s.as_ref().and_then(|s| s.conn.client_handle.clone());
        let proof = s
            .as_ref()
            .and_then(|s| s.pchat_ctx.pchat.as_ref())
            .and_then(|p| p.key_manager.compute_challenge_proof(channel_id, challenge));
        (h, proof)
    };

    match (handle, proof) {
        (Some(handle), Some(proof)) => {
            debug!(channel_id, "responding to key-possession challenge");
            let _challenge_response_task = tokio::spawn(async move {
                let response = mumble_tcp::PchatKeyChallengeResponse {
                    channel_id: Some(channel_id),
                    proof: Some(proof.to_vec()),
                };
                if let Err(e) = handle
                    .send(command::SendPchatKeyChallengeResponse { response })
                    .await
                {
                    warn!(channel_id, "failed to send challenge response: {e}");
                }
            });
        }
        (_, None) => {
            warn!(
                channel_id,
                "no archive key for channel, cannot respond to challenge"
            );
        }
        (None, _) => {
            warn!("no client handle, cannot respond to challenge");
        }
    }
}

// -- Key challenge result ---------------------------------------------

/// Handle a `PchatKeyChallengeResult` from the server.
///
/// If `passed == true`, our key is verified and we are accepted as a holder.
/// If `passed == false`, we hold a wrong key: remove it from memory and disk.
pub(crate) fn handle_proto_key_challenge_result(
    shared: &Arc<Mutex<SharedState>>,
    msg: &mumble_tcp::PchatKeyChallengeResult,
) {
    let channel_id = msg.channel_id.unwrap_or(0);
    let passed = msg.passed.unwrap_or(false);

    if passed {
        debug!(channel_id, "key-possession challenge passed");
        return;
    }

    warn!(
        channel_id,
        "key-possession challenge FAILED - discarding archive key"
    );

    let (identity_dir, app, share_requests_emit) = {
        let mut s = shared.lock().ok();
        let dir = s
            .as_ref()
            .and_then(|s| s.pchat_ctx.pchat.as_ref())
            .and_then(|p| p.identity_dir.clone());
        let app_handle = s.as_ref().and_then(|s| s.conn.tauri_app_handle.clone());
        // Remove all keying material for the channel from memory.
        let mut should_emit_shares = false;
        if let Some(ref mut s) = s {
            if let Some(ref mut pchat) = s.pchat_ctx.pchat {
                pchat.key_manager.remove_channel(channel_id);
            }
            let before_len = s.pchat_ctx.pending_key_shares.len();
            s.pchat_ctx
                .pending_key_shares
                .retain(|p| p.channel_id != channel_id);
            should_emit_shares = s.pchat_ctx.pending_key_shares.len() != before_len;
        }
        let share_requests_emit = if should_emit_shares {
            app_handle.as_ref().map(|app| {
                (
                    app.clone(),
                    types::KeyShareRequestsChangedPayload {
                        channel_id,
                        pending: vec![],
                    },
                )
            })
        } else {
            None
        };
        (dir, app_handle, share_requests_emit)
    };

    // Emit outside the lock to avoid deadlock with Tauri IPC.
    if let Some((app, payload)) = share_requests_emit {
        use tauri::Emitter;
        let _ = app.emit("pchat-key-share-requests-changed", payload);
    }

    if let Some(dir) = identity_dir {
        delete_persisted_archive_key(&dir, channel_id);
    }

    if let Some(app) = app {
        use tauri::Emitter;
        let _ = app.emit(
            "pchat-key-revoked",
            types::PchatKeyRevokedPayload { channel_id },
        );
    }
}

// -- Key holder report ------------------------------------------------

/// Extract state needed for a key holder report and verify we hold a
/// usable key before reporting.
fn prepare_key_holder_report(
    shared: &Arc<Mutex<SharedState>>,
    channel_id: u32,
) -> Option<(ClientHandle, mumble_tcp::PchatKeyHolderReport)> {
    let (handle, hash) = {
        let mut s = shared.lock().ok();
        let h = s.as_ref().and_then(|s| s.conn.client_handle.clone());
        let hash = s
            .as_ref()
            .and_then(|s| s.pchat_ctx.pchat.as_ref().map(|p| p.own_cert_hash.clone()));

        let mode = s
            .as_ref()
            .and_then(|s| s.channels.get(&channel_id).and_then(|c| c.pchat_protocol));
        if let (Some(ref s), Some(mode)) = (&s, mode) {
            if let Some(ref pchat) = s.pchat_ctx.pchat {
                if !pchat.key_manager.has_key(channel_id, mode) {
                    warn!(
                        channel_id,
                        ?mode,
                        "not reporting as key holder: no usable key"
                    );
                    return None;
                }
            }
        }

        if let (Some(ref mut s), Some(ref hash)) = (&mut s, &hash) {
            if let Some(ref mut pchat) = s.pchat_ctx.pchat {
                pchat
                    .key_manager
                    .record_key_holder(channel_id, hash.clone());
            }
        }
        (h, hash)
    };
    match (handle, hash) {
        (Some(handle), Some(hash)) => {
            let report = mumble_tcp::PchatKeyHolderReport {
                channel_id: Some(channel_id),
                cert_hash: Some(hash),
                takeover_mode: None,
            };
            Some((handle, report))
        }
        _ => None,
    }
}

/// Report that we hold the E2EE key for a channel (async variant).
pub(crate) async fn send_key_holder_report_async(
    shared: &Arc<Mutex<SharedState>>,
    channel_id: u32,
) {
    if let Some((handle, report)) = prepare_key_holder_report(shared, channel_id) {
        if let Err(e) = handle
            .send(command::SendPchatKeyHolderReport { report })
            .await
        {
            warn!(channel_id, "failed to report key holder: {e}");
        } else {
            debug!(channel_id, "reported self as key holder");
        }
    }
}

/// Report that we hold the E2EE key for a channel (fire-and-forget).
pub(crate) fn send_key_holder_report(shared: &Arc<Mutex<SharedState>>, channel_id: u32) {
    if let Some((handle, report)) = prepare_key_holder_report(shared, channel_id) {
        let _key_holder_report_task = tokio::spawn(async move {
            if let Err(e) = handle
                .send(command::SendPchatKeyHolderReport { report })
                .await
            {
                warn!(channel_id, "failed to report key holder: {e}");
            } else {
                debug!(channel_id, "reported self as key holder");
            }
        });
    }
}

// -- Key takeover -----------------------------------------------------

/// Request a key-ownership takeover for a channel (requires `KeyOwner`
/// permission).
///
/// The takeover makes us the channel's sole key authority, and the server
/// immediately re-challenges us to prove possession. After a failed key
/// challenge the local keying material was purged, so without a key the
/// post-takeover challenge could never be answered and the channel stayed
/// dead. Re-derive our deterministic archive key (and clear the revoked
/// state) BEFORE reporting, so the fresh challenge verifies against it.
pub(crate) fn send_key_takeover(
    shared: &Arc<Mutex<SharedState>>,
    channel_id: u32,
    mode: mumble_tcp::pchat_key_holder_report::KeyTakeoverMode,
) {
    let (handle, hash, app, persist_info) = {
        let mut s = shared.lock().ok();
        let h = s.as_ref().and_then(|s| s.conn.client_handle.clone());
        let app = s.as_ref().and_then(|s| s.conn.tauri_app_handle.clone());
        let mut hash = None;
        let mut persist_info = None;
        if let Some(ref mut s) = s {
            if let Some(ref mut p) = s.pchat_ctx.pchat {
                hash = Some(p.own_cert_hash.clone());
                if !p
                    .key_manager
                    .has_key(channel_id, PchatProtocol::FancyV1FullArchive)
                {
                    let key = mumble_protocol::persistent::encryption::derive_archive_key(
                        &p.seed, channel_id,
                    );
                    p.key_manager.store_archive_key(
                        channel_id,
                        key,
                        mumble_protocol::persistent::KeyTrustLevel::Verified,
                    );
                    p.key_manager
                        .set_channel_originator(channel_id, p.own_cert_hash.clone());
                    persist_info = p.identity_dir.clone().map(|dir| (dir, key));
                }
            }
        }
        (h, hash, app, persist_info)
    };
    let Some(handle) = handle else { return };
    let Some(hash) = hash else { return };

    if let Some((dir, key)) = persist_info {
        super::persistence::persist_archive_key(&dir, channel_id, &key, Some(&hash));
        // The channel had no key (post-purge takeover): tell the UI the key
        // is re-established so the revoked banner clears once verified.
        if let Some(app) = app {
            use tauri::Emitter;
            let _ = app.emit(
                "pchat-key-restored",
                types::PchatKeyRevokedPayload { channel_id },
            );
        }
    }

    let report = mumble_tcp::PchatKeyHolderReport {
        channel_id: Some(channel_id),
        cert_hash: Some(hash),
        takeover_mode: Some(mode as i32),
    };

    let _task = tokio::spawn(async move {
        if let Err(e) = handle
            .send(command::SendPchatKeyHolderReport { report })
            .await
        {
            warn!(channel_id, "failed to send key takeover: {e}");
        } else {
            debug!(channel_id, "sent key takeover");
        }
    });
}

// -- Key holders query ------------------------------------------------

/// Ask the server for the latest key holders of a channel.
pub(crate) fn query_key_holders(shared: &Arc<Mutex<SharedState>>, channel_id: u32) {
    let handle = {
        let Ok(state) = shared.lock() else { return };
        state.conn.client_handle.clone()
    };
    let Some(handle) = handle else { return };
    let query = mumble_tcp::PchatKeyHoldersQuery {
        channel_id: Some(channel_id),
    };
    let _query_task = tokio::spawn(async move {
        if let Err(e) = handle
            .send(command::SendPchatKeyHoldersQuery { query })
            .await
        {
            warn!(channel_id, "failed to query key holders: {e}");
        }
    });
}
