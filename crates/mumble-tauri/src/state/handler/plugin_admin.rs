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

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct PluginAdminEntryPayload {
    pub plugin_name: String,
    pub version: String,
    pub enabled: bool,
    pub loaded: bool,
    pub path: Option<String>,
    pub info_json: Option<String>,
    pub marketplace_id: Option<String>,
    pub installed_at: Option<u64>,
    pub builtin: bool,
    /// Why the server could not load it. Only Starling reports this.
    pub load_error: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct PluginAdminListPayload {
    pub plugins: Vec<PluginAdminEntryPayload>,
    pub plugins_dir: Option<String>,
    /// Plugin ABI version the connected server's host was compiled
    /// against.  The UI compares this with a marketplace plugin's
    /// required ABI version to gate installs.
    pub host_abi_version: Option<u32>,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct PluginAdminAckPayload {
    pub plugin_name: Option<String>,
    pub ok: bool,
    pub error: Option<String>,
    pub request_id: Option<String>,
    pub verb: Option<String>,
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
                load_error: None,
            })
            .collect();
        ctx.emit(
            "plugin-admin-list",
            PluginAdminListPayload {
                plugins,
                plugins_dir: self.plugins_dir.clone(),
                host_abi_version: self.host_abi_version,
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
