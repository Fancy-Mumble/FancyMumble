//! Server-info & ping commands.

use crate::state::server_ping::PingResult;
use crate::state::{AppState, ServerConfig, ServerInfo};

#[tauri::command]
pub(crate) fn get_server_config(state: tauri::State<'_, AppState>) -> ServerConfig {
    state.server_config()
}

/// Get aggregated server info (version, host, users, codec, etc.).
#[tauri::command]
pub(crate) fn get_server_info(state: tauri::State<'_, AppState>) -> ServerInfo {
    state.server_info()
}

/// Get the server welcome text (HTML) received during handshake.
#[tauri::command]
pub(crate) fn get_welcome_text(state: tauri::State<'_, AppState>) -> Option<String> {
    state.welcome_text()
}

/// What the open server says it looks like, or `None` when it has said nothing.
#[tauri::command]
pub(crate) fn get_livery(
    state: tauri::State<'_, AppState>,
) -> Option<crate::state::LiverySnapshot> {
    state.get_livery()
}

/// Ping a Mumble server to measure latency and retrieve server info.
#[tauri::command]
pub(crate) async fn ping_server(host: String, port: u16) -> PingResult {
    crate::state::server_ping::ping_server(&host, port).await
}

/// The name the resolver has for an address, for the User Information sheet.
///
/// `None` when there is no PTR record - the resolver hands the address back
/// in that case, which is not a name. The lookup blocks, so it runs on the
/// blocking pool rather than on the runtime.
#[tauri::command]
pub(crate) async fn reverse_dns(address: String) -> Result<Option<String>, String> {
    let ip: std::net::IpAddr = address.trim().parse().map_err(|e| format!("{e}"))?;
    tokio::task::spawn_blocking(move || {
        dns_lookup::lookup_addr(&ip)
            .ok()
            .filter(|name| name.parse::<std::net::IpAddr>().is_err())
    })
    .await
    .map_err(|e| e.to_string())
}
