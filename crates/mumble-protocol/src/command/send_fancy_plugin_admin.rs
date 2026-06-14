//! Admin-only commands for server plugin management.
//!
//! These mirror the protobuf messages declared in `Mumble.proto`
//! (wire IDs 146, 148, 149, 150).  All four require Write permission
//! on the root channel; that gate is enforced by the server.

use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Admin -> Server: request the current plugin inventory.
#[derive(Debug, Default)]
pub struct RequestFancyPluginAdminList;

impl CommandAction for RequestFancyPluginAdminList {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyPluginAdminListRequest(
                mumble_tcp::FancyPluginAdminListRequest {},
            )],
            ..Default::default()
        }
    }
}

/// Admin -> Server: enable or disable a plugin by name.
#[derive(Debug, Clone)]
pub struct SendFancyPluginAdminSetEnabled {
    /// Plugin identifier as reported by the server's inventory.
    pub plugin_name: String,
    /// `true` to enable (and hot-load if supported), `false` to disable.
    pub enabled: bool,
}

impl CommandAction for SendFancyPluginAdminSetEnabled {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyPluginAdminSetEnabled(
                mumble_tcp::FancyPluginAdminSetEnabled {
                    plugin_name: self.plugin_name.clone(),
                    enabled: self.enabled,
                },
            )],
            ..Default::default()
        }
    }
}

/// Admin -> Server: install a plugin from the marketplace.
#[derive(Debug, Clone)]
pub struct SendFancyPluginAdminInstall {
    /// Stable marketplace ID (e.g. `"fancy-greeter"`).
    pub marketplace_id: String,
    /// Specific version to install; `None` selects latest.
    pub version: Option<String>,
    /// Fully-qualified URL of the marketplace manifest JSON.
    pub manifest_url: String,
    /// Hex-encoded SHA-256 of the manifest the client saw; `None` to skip.
    pub expected_sha256: Option<String>,
}

impl CommandAction for SendFancyPluginAdminInstall {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyPluginAdminInstall(
                mumble_tcp::FancyPluginAdminInstall {
                    marketplace_id: self.marketplace_id.clone(),
                    version: self.version.clone(),
                    manifest_url: self.manifest_url.clone(),
                    expected_sha256: self.expected_sha256.clone(),
                },
            )],
            ..Default::default()
        }
    }
}

/// Admin -> Server: remove a plugin from disk and unload it.
#[derive(Debug, Clone)]
pub struct SendFancyPluginAdminUninstall {
    /// Plugin identifier as reported by the server's inventory.
    pub plugin_name: String,
}

impl CommandAction for SendFancyPluginAdminUninstall {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyPluginAdminUninstall(
                mumble_tcp::FancyPluginAdminUninstall {
                    plugin_name: self.plugin_name.clone(),
                },
            )],
            ..Default::default()
        }
    }
}
