//! Generic plugin envelope handler.
//!
//! Receives [`mumble_tcp::PluginMessage`] and [`mumble_tcp::PluginRegistry`]
//! envelopes from the server-side plugin host and forwards them to the
//! frontend as opaque Tauri events.  The Tauri backend is intentionally
//! agnostic to individual plugin schemas: payload bytes are forwarded
//! verbatim and the frontend chooses how to decode them (typically JSON
//! for FancyMumble plugins).

use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;
use tracing::debug;

use super::{HandleMessage, HandlerContext};

/// Tauri event payload for an inbound `PluginMessage`.
///
/// The `payload` field is the raw bytes the sending plugin chose; the
/// frontend decodes them based on `plugin_name` + `payload_type`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PluginMessagePayload {
    plugin_name: String,
    plugin_slot: Option<u32>,
    payload_type: String,
    payload: Vec<u8>,
    target_sessions: Vec<u32>,
    channel_id: Option<u32>,
    sender_session: Option<u32>,
    sender_name: Option<String>,
}

impl HandleMessage for mumble_tcp::PluginMessage {
    fn handle(&self, ctx: &HandlerContext) {
        let Some(plugin_name) = self.plugin_name.clone() else {
            debug!("PluginMessage dropped: missing plugin_name");
            return;
        };
        if plugin_name.is_empty() {
            debug!("PluginMessage dropped: empty plugin_name");
            return;
        }
        let payload_type = self.payload_type.clone().unwrap_or_default();
        debug!(
            plugin = %plugin_name,
            payload_type = %payload_type,
            len = self.payload.as_ref().map_or(0, Vec::len),
            "received PluginMessage"
        );
        ctx.emit(
            "plugin-message",
            PluginMessagePayload {
                plugin_name,
                plugin_slot: self.plugin_slot,
                payload_type,
                payload: self.payload.clone().unwrap_or_default(),
                target_sessions: self.target_sessions.clone(),
                channel_id: self.channel_id,
                sender_session: self.sender_session,
                sender_name: self.sender_name.clone(),
            },
        );
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PluginRegistryEntryPayload {
    plugin_name: String,
    version: String,
    plugin_slot: Option<u32>,
    info_json: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PluginRegistryPayload {
    plugins: Vec<PluginRegistryEntryPayload>,
}

impl HandleMessage for mumble_tcp::PluginRegistry {
    fn handle(&self, ctx: &HandlerContext) {
        let plugins: Vec<_> = self
            .plugins
            .iter()
            .map(|p| PluginRegistryEntryPayload {
                plugin_name: p.plugin_name.clone(),
                version: p.version.clone(),
                plugin_slot: p.plugin_slot,
                info_json: p.info_json.clone(),
            })
            .collect();
        debug!(count = plugins.len(), "received PluginRegistry");
        ctx.emit("plugin-registry", PluginRegistryPayload { plugins });
    }
}
