//! Tauri commands for server plugin administration and the
//! plugins.fancy-mumble.com marketplace.
//!
//! The four `request_*` / `set_*` / `install_*` / `uninstall_*`
//! commands proxy directly to the connected Mumble server and rely on
//! the server-side admin permission check (Write on root channel).
//!
//! The two `fetch_marketplace_*` commands talk to the marketplace REST
//! API documented in `crates/mumble-protocol/doc/marketplace-api.md`.

use serde::{Deserialize, Serialize};

use crate::state::AppState;

const DEFAULT_MARKETPLACE_BASE: &str = "https://plugins.fancy-mumble.com/api/v1";

fn marketplace_base() -> String {
    std::env::var("FANCY_MARKETPLACE_BASE")
        .unwrap_or_else(|_| DEFAULT_MARKETPLACE_BASE.to_string())
}

// --- Server-side commands -------------------------------------------------

/// Admin: request the current plugin inventory from the connected server.
/// The reply arrives asynchronously as a `plugin-admin-list` Tauri event.
#[tauri::command]
pub(crate) async fn request_server_plugins(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.request_server_plugins().await
}

/// Admin: enable or disable a plugin on the server.  Result arrives as
/// a `plugin-admin-ack` Tauri event.
#[tauri::command]
pub(crate) async fn set_server_plugin_enabled(
    state: tauri::State<'_, AppState>,
    plugin_name: String,
    enabled: bool,
) -> Result<(), String> {
    state
        .set_server_plugin_enabled(plugin_name, enabled)
        .await
}

/// Admin: install (or upgrade) a plugin from the marketplace.
#[tauri::command]
pub(crate) async fn install_server_plugin(
    state: tauri::State<'_, AppState>,
    marketplace_id: String,
    version: Option<String>,
    manifest_url: String,
    expected_sha256: Option<String>,
) -> Result<(), String> {
    state
        .install_server_plugin(marketplace_id, version, manifest_url, expected_sha256)
        .await
}

/// Admin: uninstall a plugin from the server.
#[tauri::command]
pub(crate) async fn uninstall_server_plugin(
    state: tauri::State<'_, AppState>,
    plugin_name: String,
) -> Result<(), String> {
    state.uninstall_server_plugin(plugin_name).await
}

// --- Marketplace HTTP -----------------------------------------------------

/// One released version entry inside a `MarketplacePlugin`.
#[derive(Debug, Serialize, Deserialize)]
pub struct PluginVersionEntry {
    pub version: String,
    #[serde(default)]
    pub released_at: Option<String>,
    #[serde(default)]
    pub yanked: bool,
    #[serde(default)]
    pub min_server_version: Option<String>,
    #[serde(default)]
    pub min_fancy_server_version: Option<String>,
    #[serde(default)]
    pub changelog: Option<String>,
}

/// One entry in the marketplace search result list.  Mirrors the
/// `MarketplacePlugin` schema documented in
/// `doc/marketplace-api.md` (the JSON is forwarded as-is).
#[derive(Debug, Serialize, Deserialize)]
pub struct MarketplacePlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub manifest_url: Option<String>,
    #[serde(default)]
    pub downloads: Option<u64>,
    #[serde(default)]
    pub rating: Option<f32>,
    #[serde(default)]
    pub official: bool,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub readme: Option<String>,
    #[serde(default)]
    pub versions: Vec<PluginVersionEntry>,
}

/// Paginated index returned by `GET /plugins`.
#[derive(Debug, Serialize, Deserialize)]
pub struct MarketplaceIndex {
    pub plugins: Vec<MarketplacePlugin>,
    pub total: u64,
    pub page: u32,
    pub per_page: u32,
}

fn resolve_marketplace_base(override_url: Option<&str>) -> String {
    if let Some(base) = override_url {
        if !base.is_empty() {
            return base.trim_end_matches('/').to_owned();
        }
    }
    marketplace_base()
}

/// Search the marketplace.  `query` is matched against id / name /
/// description.  Empty string returns the featured / most-downloaded
/// set.  `page` is 1-based.
/// In debug builds `base_url` overrides the configured marketplace base
/// (used by the dev-mode URL switcher in the admin UI).
#[tauri::command]
pub(crate) async fn fetch_marketplace_index(
    query: Option<String>,
    page: Option<u32>,
    base_url: Option<String>,
) -> Result<MarketplaceIndex, String> {
    let url = format!(
        "{}/plugins?query={}&page={}",
        resolve_marketplace_base(base_url.as_deref()),
        urlencoding_safe(query.as_deref().unwrap_or("")),
        page.unwrap_or(1)
    );
    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Marketplace request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Marketplace returned HTTP {}", resp.status()));
    }
    resp.json::<MarketplaceIndex>()
        .await
        .map_err(|e| format!("Failed to parse marketplace response: {e}"))
}

/// Fetch detailed metadata for a single marketplace plugin (used to
/// resolve `manifest_url` + `expected_sha256` before sending an install
/// request to the server).
/// In debug builds `base_url` overrides the configured marketplace base.
#[tauri::command]
pub(crate) async fn fetch_marketplace_plugin(
    plugin_id: String,
    base_url: Option<String>,
) -> Result<MarketplacePlugin, String> {
    let url = format!(
        "{}/plugins/{}",
        resolve_marketplace_base(base_url.as_deref()),
        urlencoding_safe(&plugin_id)
    );
    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Marketplace request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Marketplace returned HTTP {}", resp.status()));
    }
    resp.json::<MarketplacePlugin>()
        .await
        .map_err(|e| format!("Failed to parse marketplace response: {e}"))
}

/// Bare-bones URL component encoding.  Avoids pulling in another dep
/// just for the percent-escape of the four characters we actually need.
fn urlencoding_safe(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{b:02X}"));
            }
        }
    }
    out
}
