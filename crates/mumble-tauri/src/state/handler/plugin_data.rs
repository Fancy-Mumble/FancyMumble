use mumble_protocol::proto::mumble_tcp;
use tracing::debug;

use super::{HandleMessage, HandlerContext};
use crate::state::types::PluginDataPayload;

/// `data_id`s of server-originated broadcasts that arrive once after
/// `ServerSync` and are never resent.  They are cached so the frontend
/// can resync after a Vite HMR full reload (see `get_plugin_broadcasts`).
const REPLAYABLE_BROADCAST_IDS: &[&str] = &[
    "fancy-file-server-config",
    "fancy-live-doc-config",
    "fancy-plugin-info",
    "fancy-server-emotes",
];

/// Broadcast `data_id`s where multiple distinct payloads coexist (one
/// envelope per plugin), so the cache must keep every unique payload
/// rather than collapsing to the latest.
const MULTI_BROADCAST_IDS: &[&str] = &["fancy-plugin-info"];

// Legacy receive path: modern Fancy traffic arrives natively as `PluginMessage`
// (wire id 200), but server-originated broadcasts and pre-`PluginMessage` peers
// still deliver data through the deprecated `PluginDataTransmission` fields, so
// this handler must read them.
#[allow(
    deprecated,
    reason = "legacy PluginData receive path; modern clients use PluginMessage"
)]
impl HandleMessage for mumble_tcp::PluginDataTransmission {
    fn handle(&self, ctx: &HandlerContext) {
        let data_id = self.data_id.as_deref().unwrap_or("");
        debug!(
            sender = ?self.sender_session,
            data_id,
            data_len = self.data.as_ref().map(Vec::len).unwrap_or(0),
            "plugin data received"
        );

        let payload = PluginDataPayload {
            sender_session: self.sender_session,
            data: self.data.clone().unwrap_or_default(),
            data_id: data_id.to_owned(),
        };

        if REPLAYABLE_BROADCAST_IDS.contains(&data_id) {
            if let Ok(mut state) = ctx.shared.lock() {
                cache_broadcast(&mut state.plugin_broadcasts, &payload);
            }
        }

        ctx.emit("plugin-data", payload);
    }
}

/// Insert `payload` into the broadcast cache, replacing any prior
/// payload that the frontend treats as latest-wins.  Multi broadcasts
/// (one envelope per plugin) keep every distinct payload, deduped only
/// against byte-identical resends.
fn cache_broadcast(cache: &mut Vec<PluginDataPayload>, payload: &PluginDataPayload) {
    if MULTI_BROADCAST_IDS.contains(&payload.data_id.as_str()) {
        let already_cached = cache
            .iter()
            .any(|p| p.data_id == payload.data_id && p.data == payload.data);
        if already_cached {
            return;
        }
    } else {
        cache.retain(|p| p.data_id != payload.data_id);
    }
    cache.push(payload.clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(data_id: &str, data: &[u8]) -> PluginDataPayload {
        PluginDataPayload {
            sender_session: None,
            data: data.to_vec(),
            data_id: data_id.to_owned(),
        }
    }

    #[test]
    fn latest_wins_replaces_prior_payload() {
        let mut cache = Vec::new();
        cache_broadcast(&mut cache, &payload("fancy-file-server-config", b"v1"));
        cache_broadcast(&mut cache, &payload("fancy-file-server-config", b"v2"));
        assert_eq!(cache.len(), 1);
        assert_eq!(cache[0].data, b"v2");
    }

    #[test]
    fn multi_broadcast_keeps_distinct_payloads_and_dedups_resends() {
        let mut cache = Vec::new();
        cache_broadcast(&mut cache, &payload("fancy-plugin-info", b"plugin-a"));
        cache_broadcast(&mut cache, &payload("fancy-plugin-info", b"plugin-b"));
        cache_broadcast(&mut cache, &payload("fancy-plugin-info", b"plugin-a"));
        assert_eq!(cache.len(), 2);
        assert_eq!(cache[0].data, b"plugin-a");
        assert_eq!(cache[1].data, b"plugin-b");
    }

    #[test]
    fn distinct_broadcast_ids_coexist() {
        let mut cache = Vec::new();
        cache_broadcast(&mut cache, &payload("fancy-file-server-config", b"fs"));
        cache_broadcast(&mut cache, &payload("fancy-live-doc-config", b"ld"));
        assert_eq!(cache.len(), 2);
    }
}
