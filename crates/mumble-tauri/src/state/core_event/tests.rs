//! The wire format of every event, pinned: the frontend listens for these
//! exact names and shapes.

use std::collections::HashMap;

use super::*;

fn wire(server: Option<ServerId>, kind: CoreEvent) -> (&'static str, serde_json::Value) {
    let (name, payload) = Event { server, kind }.into_wire().unwrap();
    (name, serde_json::from_str(payload.get()).unwrap())
}

/// A variant that wraps a payload must write out exactly that payload:
/// it is what the untyped emit it replaced sent.
fn assert_carries<P: Serialize + Clone>(
    name: &str,
    payload: &P,
    variant: impl FnOnce(P) -> CoreEvent,
) {
    assert_eq!(
        wire(None, variant(payload.clone())),
        (name, serde_json::to_value(payload).unwrap())
    );
}

/// A variant whose JSON wraps its value in a one-field object.
fn assert_carries_keyed<P: Serialize + Clone>(
    name: &str,
    key: &str,
    payload: &P,
    variant: impl FnOnce(P) -> CoreEvent,
) {
    assert_eq!(
        wire(None, variant(payload.clone())),
        (name, serde_json::json!({ key: payload }))
    );
}

/// The frontend listens for these exact names and shapes. A typed variant
/// must write out exactly what the untyped emit it replaced did.
#[test]
fn typed_events_keep_their_wire_format() {
    use serde_json::json;

    assert_eq!(
        wire(None, CoreEvent::Connecting),
        ("status-changed", json!("connecting"))
    );
    assert_eq!(
        wire(None, CoreEvent::Connected),
        ("server-connected", json!(null))
    );
    assert_eq!(
        wire(None, CoreEvent::StateChanged),
        ("state-changed", json!(null))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::UserTalking {
                session: 7,
                talking: true
            }
        ),
        ("user-talking", json!([7, true]))
    );
    assert_eq!(
        wire(None, CoreEvent::VoiceStateChanged(VoiceState::Inactive)),
        ("voice-state-changed", json!("inactive"))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::CurrentChannelChanged(CurrentChannelPayload { channel_id: 3 })
        ),
        ("current-channel-changed", json!({ "channel_id": 3 }))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::NewMessage(NewMessagePayload {
                channel_id: 3,
                sender_session: Some(9),
            })
        ),
        (
            "new-message",
            json!({ "channel_id": 3, "sender_session": 9 })
        )
    );
    assert_eq!(
        wire(None, CoreEvent::NewDm(NewDmPayload { session: 9 })),
        ("new-dm", json!({ "session": 9 }))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::UnreadChanged(UnreadPayload {
                unreads: HashMap::from([(3, 2)]),
            })
        ),
        ("unread-changed", json!({ "unreads": { "3": 2 } }))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::DmUnreadChanged(DmUnreadPayload {
                unreads: HashMap::from([(9, 1)]),
            })
        ),
        ("dm-unread-changed", json!({ "unreads": { "9": 1 } }))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::Disconnected(DisconnectedPayload {
                server_id: Some("srv-1".to_owned()),
                reason: None,
            })
        ),
        (
            "server-disconnected",
            json!({ "serverId": "srv-1", "reason": null })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::ConnectionRejected(RejectedPayload {
                server_id: None,
                reason: "wrong password".to_owned(),
                reject_type: Some(3),
            })
        ),
        (
            "connection-rejected",
            json!({ "serverId": null, "reason": "wrong password", "reject_type": 3 })
        )
    );
}

#[test]
fn persistent_chat_history_events_keep_their_wire_format() {
    use serde_json::json;

    assert_eq!(
        wire(
            None,
            CoreEvent::PchatHistoryLoading(PchatHistoryLoadingPayload {
                channel_id: 3,
                loading: true,
            })
        ),
        (
            "pchat-history-loading",
            json!({ "channel_id": 3, "loading": true })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PchatFetchComplete(PchatFetchCompletePayload {
                channel_id: 3,
                has_more: true,
                total_stored: 40,
            })
        ),
        (
            "pchat-fetch-complete",
            json!({ "channel_id": 3, "has_more": true, "total_stored": 40 })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PchatSendRejected(PchatSendRejectedPayload {
                message_ids: vec!["m1".to_owned()],
                reason: None,
            })
        ),
        (
            "pchat-send-rejected",
            json!({ "message_ids": ["m1"], "reason": null })
        )
    );
}

#[test]
fn persistent_chat_key_events_keep_their_wire_format() {
    use serde_json::json;

    use crate::state::types::{KeyHolderEntry, PendingKeyShare};

    assert_eq!(
        wire(
            None,
            CoreEvent::PchatKeyHoldersChanged(KeyHoldersChangedPayload {
                channel_id: 3,
                holders: vec![KeyHolderEntry {
                    cert_hash: "abc".to_owned(),
                    name: "Ada".to_owned(),
                    is_online: true,
                }],
            })
        ),
        (
            "pchat-key-holders-changed",
            json!({
                "channel_id": 3,
                "holders": [{ "cert_hash": "abc", "name": "Ada", "is_online": true }],
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PchatKeyShareRequested(KeyShareRequestPayload {
                channel_id: 3,
                peer_name: "Ada".to_owned(),
                peer_cert_hash: "abc".to_owned(),
            })
        ),
        (
            "pchat-key-share-request",
            json!({ "channel_id": 3, "peer_name": "Ada", "peer_cert_hash": "abc" })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PchatKeyShareRequestsChanged(KeyShareRequestsChangedPayload {
                channel_id: 3,
                pending: vec![
                    PendingKeyShare {
                        channel_id: 3,
                        peer_cert_hash: "abc".to_owned(),
                        peer_name: "Ada".to_owned(),
                        request_id: None,
                    },
                    PendingKeyShare {
                        channel_id: 3,
                        peer_cert_hash: "def".to_owned(),
                        peer_name: "Bob".to_owned(),
                        request_id: Some("r1".to_owned()),
                    },
                ],
            })
        ),
        (
            "pchat-key-share-requests-changed",
            json!({
                "channel_id": 3,
                "pending": [
                    { "channel_id": 3, "peer_cert_hash": "abc", "peer_name": "Ada" },
                    {
                        "channel_id": 3,
                        "peer_cert_hash": "def",
                        "peer_name": "Bob",
                        "request_id": "r1",
                    },
                ],
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PchatKeyRevoked(PchatKeyRevokedPayload { channel_id: 3 })
        ),
        ("pchat-key-revoked", json!({ "channel_id": 3 }))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PchatKeyRestored(PchatKeyRevokedPayload { channel_id: 3 })
        ),
        ("pchat-key-restored", json!({ "channel_id": 3 }))
    );
}

#[test]
fn persistent_chat_reaction_events_keep_their_wire_format() {
    use serde_json::json;

    use crate::state::types::StoredReactionPayload;

    assert_eq!(
        wire(
            None,
            CoreEvent::PchatReactionDelivered(ReactionDeliverPayload {
                channel_id: 3,
                message_id: "m1".to_owned(),
                emoji: "+1".to_owned(),
                action: "add".to_owned(),
                sender_hash: "abc".to_owned(),
                sender_name: "Ada".to_owned(),
                timestamp: 17,
            })
        ),
        (
            "pchat-reaction-deliver",
            json!({
                "channel_id": 3,
                "message_id": "m1",
                "emoji": "+1",
                "action": "add",
                "sender_hash": "abc",
                "sender_name": "Ada",
                "timestamp": 17,
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PchatReactionsFetched(ReactionFetchResponsePayload {
                channel_id: 3,
                reactions: vec![StoredReactionPayload {
                    message_id: "m1".to_owned(),
                    emoji: "+1".to_owned(),
                    sender_hash: "abc".to_owned(),
                    sender_name: "Ada".to_owned(),
                    timestamp: 17,
                }],
            })
        ),
        (
            "pchat-reaction-fetch-response",
            json!({
                "channel_id": 3,
                "reactions": [{
                    "message_id": "m1",
                    "emoji": "+1",
                    "sender_hash": "abc",
                    "sender_name": "Ada",
                    "timestamp": 17,
                }],
            })
        )
    );
}

#[test]
fn persistent_chat_pin_events_keep_their_wire_format() {
    use serde_json::json;

    use crate::state::types::StoredPinPayload;

    assert_eq!(
        wire(
            None,
            CoreEvent::PchatPinDelivered(PinDeliverPayload {
                channel_id: 3,
                message_id: "m1".to_owned(),
                pinned: true,
                pinner_hash: "abc".to_owned(),
                pinner_name: "Ada".to_owned(),
                timestamp: 17,
            })
        ),
        (
            "pchat-pin-deliver",
            json!({
                "channel_id": 3,
                "message_id": "m1",
                "pinned": true,
                "pinner_hash": "abc",
                "pinner_name": "Ada",
                "timestamp": 17,
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PchatPinsFetched(PinFetchResponsePayload {
                channel_id: 3,
                pins: vec![StoredPinPayload {
                    message_id: "m1".to_owned(),
                    pinner_hash: "abc".to_owned(),
                    pinner_name: "Ada".to_owned(),
                    timestamp: 17,
                }],
            })
        ),
        (
            "pchat-pin-fetch-response",
            json!({
                "channel_id": 3,
                "pins": [{
                    "message_id": "m1",
                    "pinner_hash": "abc",
                    "pinner_name": "Ada",
                    "timestamp": 17,
                }],
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PchatSignalBridgeError(SignalBridgeErrorPayload {
                message: "no library".to_owned(),
            })
        ),
        (
            "pchat-signal-bridge-error",
            json!({ "message": "no library" })
        )
    );
}

#[test]
fn file_events_keep_their_wire_format() {
    use serde_json::json;

    let shared = || SharedFile {
        key: "k1".to_owned(),
        channel_id: 3,
        owner: 9,
        filename: "a.png".to_owned(),
        size: 512,
        shared_at_ms: 17,
        public: false,
    };
    let shared_json = json!({
        "key": "k1",
        "channelId": 3,
        "owner": 9,
        "filename": "a.png",
        "size": 512,
        "sharedAtMs": 17,
        "public": false,
    });
    assert_eq!(
        wire(None, CoreEvent::FileShared(shared())),
        ("starling-file-shared", shared_json.clone())
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::FileListing(ChannelFiles {
                channel_id: 3,
                files: vec![shared()],
            })
        ),
        (
            "starling-file-listing",
            json!({ "channelId": 3, "files": [shared_json] })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::FileRequestRefused(RefusedRequest {
                request_id: "r1".to_owned(),
                reason: "no".to_owned(),
            })
        ),
        (
            "starling-file-refused",
            json!({ "requestId": "r1", "reason": "no" })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::VoiceSupport(VoiceSupportPayload {
                request_id: "r1".to_owned(),
                available: true,
                max_seconds: 60,
                max_bytes: 1024,
            })
        ),
        (
            "voice-support",
            json!({
                "requestId": "r1",
                "available": true,
                "maxSeconds": 60,
                "maxBytes": 1024,
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::UploadProgress(UploadProgressPayload {
                upload_id: "u1".to_owned(),
                bytes_sent: 5,
                total_bytes: 10,
            })
        ),
        (
            "upload-progress",
            json!({ "uploadId": "u1", "bytesSent": 5, "totalBytes": 10 })
        )
    );
}

#[test]
fn managed_file_and_emote_events_keep_their_wire_format() {
    use serde_json::json;

    use crate::state::handler::files::{ManagedFile, StorageStats};

    assert_eq!(
        wire(
            None,
            CoreEvent::FilesManaged(ManagedFiles {
                request_id: "r1".to_owned(),
                files: vec![ManagedFile {
                    key: "k1".to_owned(),
                    channel_id: 3,
                    filename: "a.png".to_owned(),
                    mime_type: "image/png".to_owned(),
                    size: 512,
                    mode: "public",
                    shared_at_ms: 17,
                    expires_at: None,
                    downloaded_at_ms: Some(18),
                    share_url: "https://x/k1".to_owned(),
                    uploader_account: None,
                    uploader_name: Some("Ada".to_owned()),
                    uploader_cert: None,
                    uploader_online: true,
                }],
                storage: Some(StorageStats {
                    used_bytes: 1,
                    max_total_bytes: 2,
                    max_upload_bytes: 3,
                    file_count: 4,
                }),
            })
        ),
        (
            "starling-files-managed",
            json!({
                "requestId": "r1",
                "files": [{
                    "key": "k1",
                    "channelId": 3,
                    "filename": "a.png",
                    "mimeType": "image/png",
                    "size": 512,
                    "mode": "public",
                    "sharedAtMs": 17,
                    "expiresAt": null,
                    "downloadedAtMs": 18,
                    "shareUrl": "https://x/k1",
                    "uploaderAccount": null,
                    "uploaderName": "Ada",
                    "uploaderCert": null,
                    "uploaderOnline": true,
                }],
                "storage": {
                    "usedBytes": 1,
                    "maxTotalBytes": 2,
                    "maxUploadBytes": 3,
                    "fileCount": 4,
                },
            })
        )
    );
    // An array, so it is never stamped with a session.
    assert_eq!(
        wire(
            Some(ServerId::new()),
            CoreEvent::ServerEmotesChanged(vec![CanonEmote {
                shortcode: "wave".to_owned(),
                url: "https://x/wave".to_owned(),
                alias_emoji: "w".to_owned(),
                description: "hi".to_owned(),
            }])
        ),
        (
            "server-emotes-changed",
            json!([{
                "shortcode": "wave",
                "url": "https://x/wave",
                "aliasEmoji": "w",
                "description": "hi",
            }])
        )
    );
}

#[test]
fn audit_events_keep_their_wire_format() {
    use serde_json::json;

    let entry = || AuditEntryPayload {
        id: 4,
        ts: 17,
        source: "core".to_owned(),
        category: "ban".to_owned(),
        severity: "info".to_owned(),
        actor_user_id: Some(1),
        ..AuditEntryPayload::default()
    };
    let entry_json = json!({
        "id": 4,
        "ts": 17,
        "source": "core",
        "category": "ban",
        "severity": "info",
        "actorUserId": 1,
    });
    assert_eq!(
        wire(None, CoreEvent::AuditEvent(entry())),
        ("audit-event", json!({ "entry": entry_json.clone() }))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::AuditResponse(AuditResponsePayload {
                query_id: Some("q1".to_owned()),
                entries: vec![entry()],
                has_more: true,
                next_before_id: Some(3),
                error: None,
                chain_ok: Some(true),
                chain_height: Some(9),
                chain_error: None,
            })
        ),
        (
            "audit-response",
            json!({
                "queryId": "q1",
                "entries": [entry_json],
                "hasMore": true,
                "nextBeforeId": 3,
                "error": null,
                "chainOk": true,
                "chainHeight": 9,
                "chainError": null,
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::AuditConfig(AuditConfigSnapshot {
                revision: 2,
                advanced_sql_available: true,
                chain_height: 9,
                ..AuditConfigSnapshot::default()
            })
        ),
        (
            "audit-config",
            json!({
                "config": {
                    "settings": [],
                    "revision": 2,
                    "advancedSqlAvailable": true,
                    "chainHeight": 9,
                },
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::AuditSnapshot(AuditSnapshotPayload {
                entry_id: "e1".to_owned(),
                query_id: "q1".to_owned(),
                found: true,
                kind: "comment".to_owned(),
                data_url: None,
                text: Some("hi".to_owned()),
                original_size: 2,
                stored_size: 2,
            })
        ),
        (
            "audit-snapshot",
            json!({
                "entryId": "e1",
                "queryId": "q1",
                "found": true,
                "kind": "comment",
                "text": "hi",
                "originalSize": 2,
                "storedSize": 2,
            })
        )
    );
}

#[test]
fn admin_events_keep_their_wire_format() {
    use serde_json::json;

    // Arrays, so a session is never stamped onto them.
    let server = Some(ServerId::new());
    assert_eq!(
        wire(
            server,
            CoreEvent::BanList(vec![BanEntryPayload {
                address: "10.0.0.1".to_owned(),
                mask: 32,
                name: "Ada".to_owned(),
                hash: "abc".to_owned(),
                reason: "spam".to_owned(),
                start: "2026-01-01".to_owned(),
                duration: 60,
            }])
        ),
        (
            "ban-list",
            json!([{
                "address": "10.0.0.1",
                "mask": 32,
                "name": "Ada",
                "hash": "abc",
                "reason": "spam",
                "start": "2026-01-01",
                "duration": 60,
            }])
        )
    );
    assert_eq!(
        wire(
            server,
            CoreEvent::RegisteredUsers(vec![RegisteredUserPayload {
                user_id: 1,
                name: "Ada".to_owned(),
                last_seen: None,
                last_channel: Some(3),
                texture_size: Some(512),
                comment: None,
                comment_hash: None,
            }])
        ),
        (
            "user-list",
            json!([{ "user_id": 1, "name": "Ada", "last_channel": 3, "texture_size": 512 }])
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::UserComment(UserCommentPayload {
                user_id: 1,
                comment: "hi".to_owned(),
            })
        ),
        ("user-comment", json!({ "user_id": 1, "comment": "hi" }))
    );
}

#[test]
fn access_events_keep_their_wire_format() {
    use serde_json::json;

    use crate::state::types::{AclEntryPayload, AclGroupPayload};

    assert_eq!(
        wire(
            None,
            CoreEvent::Acl(AclPayload {
                channel_id: 3,
                inherit_acls: true,
                groups: vec![AclGroupPayload {
                    name: "admin".to_owned(),
                    inherited: false,
                    inherit: true,
                    inheritable: true,
                    add: vec![1],
                    remove: Vec::new(),
                    inherited_members: Vec::new(),
                    color: None,
                    icon: None,
                    style_preset: None,
                    metadata: HashMap::new(),
                }],
                acls: vec![AclEntryPayload {
                    apply_here: true,
                    apply_subs: false,
                    inherited: false,
                    user_id: None,
                    group: Some("admin".to_owned()),
                    grant: 1,
                    deny: 0,
                }],
            })
        ),
        (
            "acl",
            json!({
                "channel_id": 3,
                "inherit_acls": true,
                "groups": [{
                    "name": "admin",
                    "inherited": false,
                    "inherit": true,
                    "inheritable": true,
                    "add": [1],
                    "remove": [],
                    "inherited_members": [],
                }],
                "acls": [{
                    "apply_here": true,
                    "apply_subs": false,
                    "inherited": false,
                    "group": "admin",
                    "grant": 1,
                    "deny": 0,
                }],
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::OperatorTicket(OperatorTicket {
                token: "t".to_owned(),
                granted_scopes: vec!["plugins:read".to_owned()],
                expires_at_ms: 17,
                base_url: "https://x".to_owned(),
                denied_reason: String::new(),
            })
        ),
        (
            "operator-ticket",
            json!({
                "ticket": {
                    "token": "t",
                    "grantedScopes": ["plugins:read"],
                    "expiresAtMs": 17,
                    "baseUrl": "https://x",
                },
            })
        )
    );
}

#[test]
fn plugin_events_keep_their_wire_format() {
    use serde_json::json;

    assert_eq!(
        wire(
            None,
            CoreEvent::PluginMessage(PluginMessagePayload {
                plugin_name: "polls".to_owned(),
                plugin_slot: Some(2),
                payload_type: "vote".to_owned(),
                payload: b"hi".to_vec(),
                target_sessions: vec![9],
                channel_id: None,
                sender_session: Some(9),
                sender_name: None,
            })
        ),
        (
            "plugin-message",
            json!({
                "pluginName": "polls",
                "pluginSlot": 2,
                "payloadType": "vote",
                "payload": "aGk=",
                "targetSessions": [9],
                "channelId": null,
                "senderSession": 9,
                "senderName": null,
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PluginData(PluginDataPayload {
                sender_session: Some(9),
                data: b"hi".to_vec(),
                data_id: "fancy-plugin-info".to_owned(),
            })
        ),
        (
            "plugin-data",
            json!({ "sender_session": 9, "data": "aGk=", "data_id": "fancy-plugin-info" })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PluginRegistry(vec![PluginRegistryEntryPayload {
                plugin_name: "polls".to_owned(),
                version: "1.0".to_owned(),
                plugin_slot: Some(2),
                info_json: None,
            }])
        ),
        (
            "plugin-registry",
            json!({
                "plugins": [{
                    "pluginName": "polls",
                    "version": "1.0",
                    "pluginSlot": 2,
                    "infoJson": null,
                }],
            })
        )
    );
}

#[test]
fn plugin_admin_events_keep_their_wire_format() {
    use serde_json::json;

    use crate::state::handler::plugin_admin::PluginAdminEntryPayload;

    assert_eq!(
        wire(
            None,
            CoreEvent::PluginAdminList(PluginAdminListPayload {
                plugins: vec![PluginAdminEntryPayload {
                    plugin_name: "polls".to_owned(),
                    version: "1.0".to_owned(),
                    enabled: true,
                    loaded: false,
                    path: None,
                    info_json: None,
                    marketplace_id: Some("m1".to_owned()),
                    installed_at: Some(17),
                    builtin: false,
                    load_error: Some("abi".to_owned()),
                }],
                plugins_dir: Some("/plugins".to_owned()),
                host_abi_version: Some(3),
            })
        ),
        (
            "plugin-admin-list",
            json!({
                "plugins": [{
                    "plugin_name": "polls",
                    "version": "1.0",
                    "enabled": true,
                    "loaded": false,
                    "path": null,
                    "info_json": null,
                    "marketplace_id": "m1",
                    "installed_at": 17,
                    "builtin": false,
                    "load_error": "abi",
                }],
                "plugins_dir": "/plugins",
                "host_abi_version": 3,
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PluginAdminAck(PluginAdminAckPayload {
                plugin_name: Some("polls".to_owned()),
                ok: false,
                error: Some("no".to_owned()),
                request_id: None,
                verb: Some("install"),
            })
        ),
        (
            "plugin-admin-ack",
            json!({
                "plugin_name": "polls",
                "ok": false,
                "error": "no",
                "request_id": null,
                "verb": "install",
            })
        )
    );
}

#[test]
fn server_events_keep_their_wire_format() {
    use serde_json::json;

    assert_eq!(
        wire(None, CoreEvent::ServerConfigChanged),
        ("server-config", json!(null))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::ServerVersion(ServerVersionPayload {
                fancy_version: Some(7),
                fancy_protocol: None,
            })
        ),
        (
            "server-version",
            json!({ "fancy_version": 7, "fancy_protocol": null })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::ServerLog(ServerLogEntry {
                timestamp_ms: 17,
                message: "Ada connected".to_owned(),
            })
        ),
        (
            "server-log",
            json!({ "timestamp_ms": 17, "message": "Ada connected" })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PingLatency(LatencyPayload { rtt_ms: 12.0 })
        ),
        ("ping-latency", json!({ "rtt_ms": 12.0 }))
    );
    assert_eq!(
        wire(
            Some(ServerId::new()),
            CoreEvent::CustomReactionsConfig(vec![CustomReactionPayload {
                shortcode: "wave".to_owned(),
                display: "w".to_owned(),
                label: None,
            }])
        ),
        (
            "custom-reactions-config",
            json!([{ "shortcode": "wave", "display": "w" }])
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::AudioTransportChanged(AudioTransportPayload {
                udp_active: true,
                cipher: Some("aes"),
            })
        ),
        (
            "audio-transport-changed",
            json!({ "udp_active": true, "cipher": "aes" })
        )
    );
    let stats = || crate::state::types::PacketStats {
        good: 1,
        late: 2,
        lost: 3,
        resync: 4,
    };
    let stats_json = json!({ "good": 1, "late": 2, "lost": 3, "resync": 4 });
    assert_eq!(
        wire(
            None,
            CoreEvent::CryptoStats(CryptoStatsPayload {
                from_client: stats(),
                to_client: stats(),
            })
        ),
        (
            "crypto-stats",
            json!({ "from_client": stats_json.clone(), "to_client": stats_json })
        )
    );
}

#[test]
fn bulky_server_events_carry_their_payload_unchanged() {
    assert_carries(
        "user-stats",
        &UserStatsPayload {
            session: 9,
            tcp_packets: 4,
            opus: Some(true),
            ..UserStatsPayload::default()
        },
        CoreEvent::UserStats,
    );
    assert_carries_keyed(
        "server-settings",
        "settings",
        &ServerSettingsSnapshot {
            settings: vec![crate::state::types::ServerSetting {
                key: "motd".to_owned(),
                ..Default::default()
            }],
            revision: 3,
        },
        CoreEvent::ServerSettings,
    );
    assert_carries_keyed(
        "server-livery",
        "livery",
        &LiverySnapshot {
            version: 2,
            digest: "ab".to_owned(),
            display_name: Some("Home".to_owned()),
            ..LiverySnapshot::default()
        },
        CoreEvent::ServerLivery,
    );
}

#[test]
fn permission_events_keep_their_wire_format() {
    use serde_json::json;

    use crate::state::types::CustodianPinPayloadInner;

    assert_eq!(
        wire(
            None,
            CoreEvent::PermissionDenied(PermissionDeniedPayload {
                deny_type: Some(1),
                reason: None,
                permission: Some(1),
                channel_id: Some(0),
            })
        ),
        (
            "permission-denied",
            json!({ "deny_type": 1, "reason": null })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::ChannelDenied(ChannelDeniedPayload { channel_id: 3 })
        ),
        ("channel-denied", json!({ "channel_id": 3 }))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::ListenDenied(ListenDeniedPayload { channel_id: 3 })
        ),
        ("listen-denied", json!({ "channel_id": 3 }))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::CustodianPinChanged(CustodianPinPayload {
                channel_id: 3,
                pin: CustodianPinPayloadInner {
                    pinned: vec!["abc".to_owned()],
                    confirmed: true,
                    pending_update: None,
                },
            })
        ),
        (
            "custodian-pin-changed",
            json!({
                "channel_id": 3,
                "pin": { "pinned": ["abc"], "confirmed": true, "pendingUpdate": null },
            })
        )
    );
}

#[test]
fn messaging_events_keep_their_wire_format() {
    use serde_json::json;

    use crate::state::handler::read_receipt::ReadStatePayload;

    assert_eq!(
        wire(
            None,
            CoreEvent::TypingIndicator(TypingIndicatorPayload {
                session: 9,
                channel_id: 3,
            })
        ),
        ("typing-indicator", json!({ "session": 9, "channel_id": 3 }))
    );
    assert_eq!(
        wire(None, CoreEvent::DmEdited(NewDmPayload { session: 9 })),
        ("dm-edited", json!({ "session": 9 }))
    );
    assert_eq!(
        wire(None, CoreEvent::DmSynced(NewDmPayload { session: 9 })),
        ("dm-synced", json!({ "session": 9 }))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::ReadReceipts(ReadReceiptDeliverPayload {
                channel_id: 3,
                read_states: vec![ReadStatePayload {
                    cert_hash: "abc".to_owned(),
                    name: "Ada".to_owned(),
                    is_online: true,
                    last_read_message_id: "m1".to_owned(),
                    timestamp: 17,
                }],
                query_message_id: None,
            })
        ),
        (
            "read-receipt-deliver",
            json!({
                "channel_id": 3,
                "read_states": [{
                    "cert_hash": "abc",
                    "name": "Ada",
                    "is_online": true,
                    "last_read_message_id": "m1",
                    "timestamp": 17,
                }],
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::LinkPreviews(LinkPreviewResponsePayload {
                request_id: "r1".to_owned(),
                embeds: Vec::new(),
                requested_urls: vec!["https://x".to_owned()],
            })
        ),
        (
            "link-preview-response",
            json!({ "request_id": "r1", "embeds": [], "requested_urls": ["https://x"] })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::WebRtcSignal(WebRtcSignalPayload {
                sender_session: Some(9),
                target_session: None,
                signal_type: 2,
                payload: "sdp".to_owned(),
            })
        ),
        (
            "webrtc-signal",
            json!({
                "sender_session": 9,
                "target_session": null,
                "signal_type": 2,
                "payload": "sdp",
            })
        )
    );
}

#[test]
fn shared_surface_events_keep_their_wire_format() {
    use serde_json::json;

    use crate::state::handler::watch_sync::WatchSyncEvent;

    assert_eq!(
        wire(
            None,
            CoreEvent::DrawStroke(DrawStrokePayload {
                sender_session: 9,
                channel_id: 3,
                stroke_id: "s1".to_owned(),
                color: 255,
                width: 2.0,
                width_frac: None,
                points: vec![0.5, 1.0],
                is_end: true,
                is_clear: false,
                clear_all: false,
            })
        ),
        (
            "draw-stroke",
            json!({
                "senderSession": 9,
                "channelId": 3,
                "strokeId": "s1",
                "color": 255,
                "width": 2.0,
                "widthFrac": null,
                "points": [0.5, 1.0],
                "isEnd": true,
                "isClear": false,
                "clearAll": false,
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::WatchSync(WatchSyncPayload {
                session_id: Some("w1".to_owned()),
                actor: Some(9),
                event: WatchSyncEvent::Join { session: Some(9) },
            })
        ),
        (
            "watch-sync",
            json!({
                "sessionId": "w1",
                "actor": 9,
                "event": { "type": "join", "session": 9 },
            })
        )
    );
}

#[test]
fn poll_and_forum_events_keep_their_wire_format() {
    use serde_json::json;

    assert_eq!(
        wire(
            None,
            CoreEvent::Poll(PollPayload {
                channel_id: 3,
                poll_id: "p1".to_owned(),
                question: "Lunch?".to_owned(),
                options: vec!["yes".to_owned()],
                multiple: false,
                creator_session: 9,
                creator_name: None,
                created_at: None,
            })
        ),
        (
            "fancy-poll",
            json!({
                "channelId": 3,
                "pollId": "p1",
                "question": "Lunch?",
                "options": ["yes"],
                "multiple": false,
                "creatorSession": 9,
                "creatorName": null,
                "createdAt": null,
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::PollVote(PollVotePayload {
                channel_id: 3,
                poll_id: "p1".to_owned(),
                selected: vec![0],
                voter_session: 9,
                voter_name: Some("Ada".to_owned()),
            })
        ),
        (
            "fancy-poll-vote",
            json!({
                "channelId": 3,
                "pollId": "p1",
                "selected": [0],
                "voterSession": 9,
                "voterName": "Ada",
            })
        )
    );
    let post = ForumPostPayload {
        channel_id: 3,
        post_id: "f1".to_owned(),
        thread_id: "t1".to_owned(),
        title: Some("Hello".to_owned()),
        body: None,
        author_hash: None,
        author_session: Some(9),
        author_name: None,
        created_at: Some(17),
        edited_at: None,
        deleted: false,
        reply_count: 2,
    };
    let post_json = json!({
        "channelId": 3,
        "postId": "f1",
        "threadId": "t1",
        "title": "Hello",
        "body": null,
        "authorHash": null,
        "authorSession": 9,
        "authorName": null,
        "createdAt": 17,
        "editedAt": null,
        "deleted": false,
        "replyCount": 2,
    });
    assert_eq!(
        wire(None, CoreEvent::ForumPost(post.clone())),
        ("fancy-forum-post", post_json.clone())
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::ForumPosts(ForumFetchResponsePayload {
                channel_id: 3,
                thread_id: None,
                posts: vec![post],
                has_more: true,
            })
        ),
        (
            "fancy-forum-fetch-response",
            json!({ "channelId": 3, "threadId": null, "posts": [post_json], "hasMore": true })
        )
    );
}

#[test]
fn scheduled_message_events_keep_their_wire_format() {
    use serde_json::json;

    assert_eq!(
        wire(
            None,
            CoreEvent::ScheduledMessages(vec![ScheduledMessagePayload {
                schedule_id: "s1".to_owned(),
                channel_ids: vec![3],
                tree_ids: Vec::new(),
                message: Some("hi".to_owned()),
                deliver_at: Some(17),
                creator_session: None,
                creator_hash: None,
                creator_name: None,
                created_at: None,
                status: 0,
            }])
        ),
        (
            "fancy-scheduled-message-list",
            json!({
                "messages": [{
                    "scheduleId": "s1",
                    "channelIds": [3],
                    "treeIds": [],
                    "message": "hi",
                    "deliverAt": 17,
                    "creatorSession": null,
                    "creatorHash": null,
                    "creatorName": null,
                    "createdAt": null,
                    "status": 0,
                }],
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::ScheduledMessageAck(ScheduledMessageAckPayload {
                schedule_id: Some("s1".to_owned()),
                status: 1,
                reason: None,
            })
        ),
        (
            "fancy-scheduled-message-ack",
            json!({ "scheduleId": "s1", "status": 1, "reason": null })
        )
    );
}

#[test]
fn gif_events_keep_their_wire_format() {
    use serde_json::json;

    use crate::state::handler::gifs::GifResult;

    assert_eq!(
        wire(
            None,
            CoreEvent::GifPage(GifPagePayload {
                request_id: "r1".to_owned(),
                results: vec![GifResult {
                    id: "g1".to_owned(),
                    title: "wave".to_owned(),
                    url: "https://x/g1".to_owned(),
                    preview: "https://x/g1s".to_owned(),
                    width: 4,
                    height: 3,
                    preview_width: 2,
                    preview_height: 1,
                    mime: "image/gif".to_owned(),
                }],
                page: 1,
                has_next: false,
                provider: "klipy".to_owned(),
            })
        ),
        (
            "gif-search-page",
            json!({
                "request_id": "r1",
                "results": [{
                    "id": "g1",
                    "title": "wave",
                    "url": "https://x/g1",
                    "preview": "https://x/g1s",
                    "width": 4,
                    "height": 3,
                    "preview_width": 2,
                    "preview_height": 1,
                    "mime": "image/gif",
                }],
                "page": 1,
                "has_next": false,
                "provider": "klipy",
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::GifSearchRefused(GifRefusedPayload {
                request_id: "r1".to_owned(),
                reason: "slow down".to_owned(),
                retry_after_ms: 500,
                kind: "rateLimited",
            })
        ),
        (
            "gif-search-refused",
            json!({
                "request_id": "r1",
                "reason": "slow down",
                "retry_after_ms": 500,
                "kind": "rateLimited",
            })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::GifSupport(GifSupportPayload {
                request_id: "r1".to_owned(),
                available: true,
                media_base: "https://x".to_owned(),
                provider: "klipy".to_owned(),
            })
        ),
        (
            "gif-support",
            json!({
                "request_id": "r1",
                "available": true,
                "media_base": "https://x",
                "provider": "klipy",
            })
        )
    );
}

#[test]
fn account_events_keep_their_wire_format() {
    use serde_json::json;

    assert_eq!(
        wire(
            None,
            CoreEvent::AccountAck(AccountAck {
                action: 2,
                ok: true,
                error: None,
                totp_secret: None,
                totp_uri: None,
            })
        ),
        ("account-ack", json!({ "action": 2, "ok": true }))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::AccountRecordChanged(RecordChanged {
                key: "settings".to_owned(),
                value: Some("{}".to_owned()),
                found: true,
                updated_at_ms: 17,
            })
        ),
        (
            "account-record-changed",
            json!({ "key": "settings", "value": "{}", "found": true, "updatedAtMs": 17 })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::Invites(InvitesPayload::Revoked {
                request_id: "r1".to_owned(),
                code: "abc".to_owned(),
            })
        ),
        (
            "invites",
            json!({ "kind": "revoked", "requestId": "r1", "code": "abc" })
        )
    );
    assert_carries_keyed(
        "account-settings",
        "settings",
        &AccountSettings {
            registered: true,
            name: Some("Ada".to_owned()),
            ..AccountSettings::default()
        },
        CoreEvent::AccountSettings,
    );
    assert_carries_keyed(
        "onboarding-config",
        "config",
        &OnboardingConfig {
            enabled: true,
            revision: 4,
            ..OnboardingConfig::default()
        },
        CoreEvent::OnboardingConfig,
    );
    assert_carries_keyed(
        "onboarding-response",
        "response",
        &Some(OnboardingResponse {
            config_revision: 4,
            ..OnboardingResponse::default()
        }),
        CoreEvent::OnboardingResponse,
    );
    assert_eq!(
        wire(None, CoreEvent::OnboardingResponse(None)),
        ("onboarding-response", json!({ "response": null }))
    );
}

#[test]
fn voice_events_keep_their_wire_format() {
    use serde_json::json;

    use crate::state::whisper::WhisperRefusal;

    assert_eq!(
        wire(
            None,
            CoreEvent::MicAmplitude(MicAmplitudePayload {
                rms: 0.5,
                peak: 1.0,
            })
        ),
        ("mic-amplitude", json!({ "rms": 0.5, "peak": 1.0 }))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::VoiceActivationCalibrated(VoiceActivationCalibrationPayload {
                vad_threshold: 0.5,
                noise_gate_close_ratio: 0.25,
                hold_frames: 8,
                max_gain_db: 12.0,
            })
        ),
        (
            "voice-activation-calibrated",
            json!({
                "vad_threshold": 0.5,
                "noise_gate_close_ratio": 0.25,
                "hold_frames": 8,
                "max_gain_db": 12.0,
            })
        )
    );
    assert_eq!(
        wire(None, CoreEvent::VoiceReplayState(VoiceReplayState::Idle)),
        ("voice-replay-state", json!({ "phase": "idle" }))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::VoiceReplayState(VoiceReplayState::Playing {
                elapsed_ms: 5,
                total_ms: 10,
            })
        ),
        (
            "voice-replay-state",
            json!({ "phase": "playing", "elapsed_ms": 5, "total_ms": 10 })
        )
    );
    assert_eq!(
        wire(
            Some(ServerId::new()),
            CoreEvent::UserVoiceContext {
                session: 9,
                context: 2,
            }
        ),
        ("user-voice-context", json!([9, 2]))
    );
    assert_eq!(
        wire(None, CoreEvent::WhisperState(true)),
        ("whisper-state", json!(true))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::WhisperDenials(WhisperDenials {
                denied_channels: vec![3],
                latest: Some(WhisperRefusal {
                    channel_id: 3,
                    reason: None,
                }),
            })
        ),
        (
            "whisper-denials",
            json!({
                "deniedChannels": [3],
                "latest": { "channelId": 3, "reason": null },
            })
        )
    );
}

#[test]
fn recorder_and_capture_events_keep_their_wire_format() {
    use serde_json::json;

    assert_eq!(
        wire(None, CoreEvent::CaptureError(None)),
        ("capture-error", json!(null))
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::CaptureError(Some(CaptureState {
                kind: "device_busy".to_owned(),
                message: "in use".to_owned(),
                holders: vec!["obs".to_owned()],
            }))
        ),
        (
            "capture-error",
            json!({ "kind": "device_busy", "message": "in use", "holders": ["obs"] })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::VoiceMessageState(RecorderState::Recording {
                elapsed_ms: 5,
                level: 0.5,
            })
        ),
        (
            "voice-message-state",
            json!({ "state": "recording", "elapsedMs": 5, "level": 0.5 })
        )
    );
    assert_eq!(
        wire(
            None,
            CoreEvent::VoiceMessageState(RecorderState::Failed {
                reason: "no mic".to_owned(),
            })
        ),
        (
            "voice-message-state",
            json!({ "state": "failed", "reason": "no mic" })
        )
    );
}

#[cfg(not(target_os = "android"))]
#[test]
fn the_presence_event_keeps_its_wire_format() {
    use serde_json::json;

    use crate::state::presence::PresenceStatus;

    assert_eq!(
        wire(
            None,
            CoreEvent::RichPresenceChanged(PresenceSnapshot {
                status: PresenceStatus {
                    enabled: true,
                    bridge_state: None,
                    slot: Some(0),
                },
                entries: Vec::new(),
            })
        ),
        (
            "rich-presence-changed",
            json!({
                "status": { "enabled": true, "bridgeState": null, "slot": 0 },
                "entries": [],
            })
        )
    );
}

#[test]
fn an_object_payload_is_stamped_with_its_session() {
    let server = ServerId::new();
    let (_, payload) = wire(
        Some(server),
        CoreEvent::NewMessage(NewMessagePayload {
            channel_id: 3,
            sender_session: None,
        }),
    );
    assert_eq!(payload["serverId"], serde_json::json!(server.to_string()));
    assert_eq!(payload["channel_id"], 3);

    // A payload that already names its server keeps what it says.
    let (_, payload) = wire(
        Some(server),
        CoreEvent::Disconnected(DisconnectedPayload {
            server_id: Some("other".to_owned()),
            reason: None,
        }),
    );
    assert_eq!(payload["serverId"], "other");
}

#[test]
fn a_stamped_payload_stays_one_well_formed_object() {
    let server = ServerId::new();
    let stamped = with_server_id(r#"{"channel_id":3}"#.to_owned(), server);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&stamped).unwrap(),
        serde_json::json!({ "serverId": server.to_string(), "channel_id": 3 })
    );
    let stamped = with_server_id("{}".to_owned(), server);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&stamped).unwrap(),
        serde_json::json!({ "serverId": server.to_string() })
    );
    // Not an object after all: nothing to add a field to.
    assert_eq!(with_server_id("[1]".to_owned(), server), "[1]");
}

#[test]
fn a_payload_that_is_not_an_object_is_left_alone() {
    let server = ServerId::new();
    assert_eq!(
        wire(Some(server), CoreEvent::StateChanged).1,
        serde_json::json!(null)
    );
    assert_eq!(
        wire(
            Some(server),
            CoreEvent::UserTalking {
                session: 1,
                talking: false
            }
        )
        .1,
        serde_json::json!([1, false])
    );
}

#[test]
fn stamps_missing_server_id() {
    let mut payload = serde_json::json!({ "channelId": 1 });
    stamp_server_id(&mut payload, "srv-1");
    assert_eq!(payload["serverId"], "srv-1");
}

#[test]
fn replaces_a_null_server_id_but_keeps_a_real_one() {
    let mut payload = serde_json::json!({ "serverId": null });
    stamp_server_id(&mut payload, "srv-1");
    assert_eq!(payload["serverId"], "srv-1");

    let mut payload = serde_json::json!({ "serverId": "kept" });
    stamp_server_id(&mut payload, "srv-1");
    assert_eq!(payload["serverId"], "kept");
}

#[test]
fn leaves_non_objects_untouched() {
    let mut payload = serde_json::json!(["a", "b"]);
    stamp_server_id(&mut payload, "srv-1");
    assert_eq!(payload, serde_json::json!(["a", "b"]));
}
