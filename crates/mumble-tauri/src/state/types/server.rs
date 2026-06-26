//! Server-side metadata serialised to the frontend: the activity log, server
//! config / version info, the aggregate server-info payload and debug stats.

use serde::Serialize;

// --- Server activity log ------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ServerLogEntry {
    pub timestamp_ms: u64,
    pub message: String,
}

impl ServerLogEntry {
    pub fn now(message: String) -> Self {
        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        Self {
            timestamp_ms,
            message,
        }
    }
}

// --- Server config ------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ServerConfig {
    pub max_message_length: u32,
    pub max_image_message_length: u32,
    pub allow_html: bool,
    pub webrtc_sfu_available: bool,
    /// Optional override for the Fancy Mumble REST API base URL,
    /// advertised by the server in `ServerConfig::fancy_rest_api_url`.
    /// `None` (or empty) means clients should fall back to whatever the
    /// individual plugin (e.g. file-server) reports in its plugin-data
    /// config. Useful when the HTTP interface is behind a reverse proxy.
    pub fancy_rest_api_url: Option<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            // Mumble defaults per the protocol spec.
            max_message_length: 5000,
            max_image_message_length: 131072,
            allow_html: true,
            webrtc_sfu_available: false,
            fancy_rest_api_url: None,
        }
    }
}

/// Version and configuration metadata announced by the server during handshake.
/// Assembled from `Version`, `ServerSync`, and `ServerConfig` messages.
#[derive(Debug, Default, Clone, Serialize)]
pub struct ServerVersionInfo {
    /// Server release string (e.g. "Mumble 1.5.517").
    pub release: Option<String>,
    /// Server operating system (e.g. "Linux", "Windows").
    pub os: Option<String>,
    /// Server OS version string.
    pub os_version: Option<String>,
    /// Legacy protocol version v1 encoding: (major << 16) | (minor << 8) | patch.
    pub version_v1: Option<u32>,
    /// Protocol version v2 encoding.
    pub version_v2: Option<u64>,
    /// Fancy Mumble extension version (None = standard server).
    pub fancy_version: Option<u64>,
}

/// Full server info payload sent to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct ServerInfo {
    /// Host the client connected to.
    pub host: String,
    /// Port the client connected to.
    pub port: u16,
    /// Number of users currently on the server.
    pub user_count: u32,
    /// Maximum users allowed by the server (from `ServerConfig`).
    pub max_users: Option<u32>,
    /// Human-readable protocol version string.
    pub protocol_version: Option<String>,
    /// Fancy Mumble extension version.
    pub fancy_version: Option<u64>,
    /// Server release string.
    pub release: Option<String>,
    /// Server operating system.
    pub os: Option<String>,
    /// Maximum bandwidth allowed by the server (bits/s).
    pub max_bandwidth: Option<u32>,
    /// Whether Opus codec is supported.
    pub opus: bool,
}

// --- Debug stats ---------------------------------------------------

/// Debug statistics for the developer info panel.
#[derive(Debug, Clone, Serialize)]
pub struct DebugStats {
    /// Number of channel messages in memory.
    pub channel_message_count: usize,
    /// Number of DM messages in memory.
    pub dm_message_count: usize,
    /// Total messages (channel + DM).
    pub total_message_count: usize,
    /// Number of messages currently offloaded to disk.
    pub offloaded_count: usize,
    /// Number of channels known to the client.
    pub channel_count: usize,
    /// Number of users connected to the server.
    pub user_count: usize,
    /// Internal connection epoch counter.
    pub connection_epoch: u64,
    /// Current voice state as a string.
    pub voice_state: String,
    /// Seconds since the app was started.
    pub uptime_seconds: u64,
}
