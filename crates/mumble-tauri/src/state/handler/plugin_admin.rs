//! Inbound handlers for plugin admin messages.
//!
//! The server sends two flavours of message: `FancyPluginAdminList`
//! (snapshot of the inventory, also broadcast on change) and
//! `FancyPluginAdminAck` (per-action status reply).  Both are routed to
//! frontend events so the Admin > Server Plugins panel can re-render.

use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;
use tracing::debug;

use super::{HandleMessage, HandlerContext};

#[derive(Serialize, Clone)]
struct PluginAdminEntryPayload {
    plugin_name: String,
    version: String,
    enabled: bool,
    loaded: bool,
    path: Option<String>,
    info_json: Option<String>,
    marketplace_id: Option<String>,
    installed_at: Option<u64>,
    builtin: bool,
}

#[derive(Serialize, Clone)]
struct PluginAdminListPayload {
    plugins: Vec<PluginAdminEntryPayload>,
    plugins_dir: Option<String>,
}

#[derive(Serialize, Clone)]
struct PluginAdminAckPayload {
    plugin_name: Option<String>,
    ok: bool,
    error: Option<String>,
    request_id: Option<String>,
    verb: Option<String>,
}

fn verb_to_str(v: i32) -> &'static str {
    match v {
        0 => "list",
        1 => "set_enabled",
        2 => "install",
        3 => "uninstall",
        _ => "unknown",
    }
}

impl HandleMessage for mumble_tcp::FancyPluginAdminList {
    fn handle(&self, ctx: &HandlerContext) {
        debug!(count = self.plugins.len(), "received FancyPluginAdminList");
        let plugins = self
            .plugins
            .iter()
            .map(|p| PluginAdminEntryPayload {
                plugin_name: p.plugin_name.clone(),
                version: p.version.clone(),
                enabled: p.enabled,
                loaded: p.loaded.unwrap_or(p.enabled),
                path: p.path.clone(),
                info_json: p.info_json.clone(),
                marketplace_id: p.marketplace_id.clone(),
                installed_at: p.installed_at,
                builtin: p.builtin.unwrap_or(false),
            })
            .collect();
        ctx.emit(
            "plugin-admin-list",
            PluginAdminListPayload {
                plugins,
                plugins_dir: self.plugins_dir.clone(),
            },
        );
    }
}

impl HandleMessage for mumble_tcp::FancyPluginAdminAck {
    fn handle(&self, ctx: &HandlerContext) {
        debug!(ok = self.ok, "received FancyPluginAdminAck");
        ctx.emit(
            "plugin-admin-ack",
            PluginAdminAckPayload {
                plugin_name: self.plugin_name.clone(),
                ok: self.ok,
                error: self.error.clone(),
                request_id: self.request_id.clone(),
                verb: self.verb.map(|v| verb_to_str(v).to_string()),
            },
        );
    }
}
