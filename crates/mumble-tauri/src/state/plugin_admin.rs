//! Plugin admin and marketplace methods on `AppState`.
//!
//! All `request_*` / `set_*` / `install_*` / `uninstall_*` calls below
//! relay a typed protobuf message to the connected server.  The server
//! enforces admin permissions and replies asynchronously with
//! `FancyPluginAdminAck` / `FancyPluginAdminList`, both surfaced as
//! frontend events by the handlers in `handler/plugin_admin.rs`.

use mumble_protocol::command;

use super::types::{PluginDataPayload, PluginRegistryEntryPayload};
use super::AppState;

impl AppState {
    /// Snapshot the cached `PluginRegistry` for the active session.
    /// Returns an empty vec if the server has not sent the registry
    /// yet (or if there is no active session).  Used by the UI to
    /// recover the registry after an HMR reload, since the
    /// `plugin-registry` Tauri event only fires once per connect.
    pub fn get_plugin_registry(&self) -> Vec<PluginRegistryEntryPayload> {
        let snapshot = self.inner.snapshot();
        let Ok(guard) = snapshot.lock() else {
            return Vec::new();
        };
        guard.plugin_registry.clone()
    }

    /// Snapshot the cached server-originated `plugin-data` broadcasts
    /// (file-server config, live-doc config, plugin info, server
    /// emotes) for the active session.  Used by the UI to re-hydrate
    /// after an HMR reload, since those broadcasts are delivered once
    /// per connect and never resent.
    pub fn get_plugin_broadcasts(&self) -> Vec<PluginDataPayload> {
        let snapshot = self.inner.snapshot();
        let Ok(guard) = snapshot.lock() else {
            return Vec::new();
        };
        guard.plugin_broadcasts.clone()
    }

    /// Admin: request the current plugin inventory from the server.
    pub async fn request_server_plugins(&self) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;
        handle
            .send(command::RequestFancyPluginAdminList)
            .await
            .map_err(|e| e.to_string())
    }

    /// Admin: enable or disable a plugin on the server.
    pub async fn set_server_plugin_enabled(
        &self,
        plugin_name: String,
        enabled: bool,
    ) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;
        handle
            .send(command::SendFancyPluginAdminSetEnabled {
                plugin_name,
                enabled,
            })
            .await
            .map_err(|e| e.to_string())
    }

    /// Admin: install (or upgrade) a plugin from the marketplace.
    pub async fn install_server_plugin(
        &self,
        marketplace_id: String,
        version: Option<String>,
        manifest_url: String,
        expected_sha256: Option<String>,
    ) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;
        handle
            .send(command::SendFancyPluginAdminInstall {
                marketplace_id,
                version,
                manifest_url,
                expected_sha256,
            })
            .await
            .map_err(|e| e.to_string())
    }

    /// Admin: remove a plugin from disk and unload it.
    pub async fn uninstall_server_plugin(
        &self,
        plugin_name: String,
    ) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;
        handle
            .send(command::SendFancyPluginAdminUninstall { plugin_name })
            .await
            .map_err(|e| e.to_string())
    }
}
