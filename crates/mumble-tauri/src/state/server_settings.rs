//! Editable server-settings methods on `AppState`.
//!
//! - `get_server_settings` snapshots the cached schema for the active session.
//! - `request_server_settings` asks the server for it, for the epoch-1 server
//!   that answers a question rather than broadcasting after `ServerSync`.
//! - `save_server_settings` (admin) sends changed settings to the server, which
//!   validates root-channel Write permission, applies them at runtime, and
//!   re-broadcasts the updated snapshot.

use mumble_protocol::command;
use mumble_protocol::proto::mumble_tcp;

use super::types::{ServerSetting, ServerSettingsSnapshot};
use super::AppState;

impl AppState {
    /// Snapshot the cached editable server settings, if any.
    pub fn get_server_settings(&self) -> Option<ServerSettingsSnapshot> {
        let snapshot = self.inner.snapshot();
        let guard = snapshot.lock().ok()?;
        guard.server_settings.clone()
    }

    /// Ask the server for the settings an operator may change at run time.
    ///
    /// Answered asynchronously on the `server-settings` Tauri event, which is
    /// the same path the epoch-0 broadcast arrives on: a caller waits for the
    /// event rather than for this future, which resolves once the frame is
    /// queued. A server that will not answer - no such feature, or a session
    /// without root `Write` - answers with silence.
    pub async fn request_server_settings(&self) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;

        handle
            .send(command::RequestServerSettings)
            .await
            .map_err(|e| format!("Failed to request server settings: {e}"))?;
        Ok(())
    }

    /// Admin path: send changed settings to the server to apply at runtime.
    /// Only the `key` and `value` of each setting are sent; the rest of the
    /// schema is owned by the server.
    pub async fn save_server_settings(&self, changed: Vec<ServerSetting>) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;

        let settings = changed.iter().map(encode_setting).collect();
        handle
            .send(command::SendFancyServerSettingsUpdate { settings })
            .await
            .map_err(|e| format!("Failed to send server settings: {e}"))?;
        Ok(())
    }
}

fn encode_setting(s: &ServerSetting) -> mumble_tcp::Setting {
    mumble_tcp::Setting {
        key: Some(s.key.clone()),
        value: s.value.clone(),
        // Schema fields are owned by the server; an update only carries the
        // changed key + value.
        r#type: None,
        group: None,
        label: None,
        options: Vec::new(),
        secret: None,
        help: None,
    }
}
