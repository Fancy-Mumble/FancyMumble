//! Editable server-settings types cached from a `FancyServerSettings` broadcast
//! and surfaced to the admin "Server Settings" panel.

use serde::Serialize;

/// One editable server setting (schema + current value), cached from a
/// `FancyServerSettings` broadcast and surfaced to the admin "Server Settings"
/// panel.  `type` drives the client's form-control factory.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ServerSetting {
    /// Config key (core keys, or `plugin.<name>.<key>` for plugin settings).
    pub key: String,
    /// Input type: `string` | `text` | `bool` | `int` | `enum` | `country` |
    /// `password`.
    #[serde(rename = "type")]
    pub r#type: String,
    /// Group/section the setting belongs to.
    pub group: String,
    /// Human-readable label.
    pub label: String,
    /// Current value (string-encoded).  Omitted for secret settings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// Allowed values for `enum` types.
    #[serde(default)]
    pub options: Vec<String>,
    /// Whether the value is a secret (masked, write-only).
    #[serde(default)]
    pub secret: bool,
    /// Optional one-line help text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
}

/// Editable server-settings snapshot advertised by the server to admins.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct ServerSettingsSnapshot {
    /// All editable settings (core + currently-loaded plugins).
    pub settings: Vec<ServerSetting>,
    /// Monotonic revision so stale broadcasts can be dropped.
    pub revision: u64,
}
