//! Plugin admin and marketplace methods on `AppState`.
//!
//! Two transports behind one set of calls, and the frontend hears the same
//! `plugin-admin-list` / `plugin-admin-ack` events from both.
//!
//! * An epoch-0 Fancy server takes typed plugin-admin messages on the control
//!   channel, enforces admin permission itself, and answers asynchronously with
//!   `FancyPluginAdminAck` / `FancyPluginAdminList` (`handler/plugin_admin.rs`).
//! * An epoch-1 server (Starling) carries none of those: the canon has no home
//!   for them and the codec drops them silently. Plugin administration is an
//!   operator action there, so these calls mint a session ticket for the
//!   `plugins:*` scopes and use the operator API's `/v1/plugins`.

use std::time::Duration;

use mumble_protocol::command;
use mumble_protocol::fancy_codec::FANCY_PROTOCOL_EPOCH;
use serde::Deserialize;
use tauri::Emitter as _;

use super::AppState;
use super::handler::operator_ticket::OperatorTicket;
use super::handler::plugin_admin::{
    PluginAdminAckPayload, PluginAdminEntryPayload, PluginAdminListPayload,
};
use super::types::{PluginDataPayload, PluginRegistryEntryPayload};
use crate::commands::operator_http;

/// How long to wait for the server to answer a ticket request.
const TICKET_TIMEOUT: Duration = Duration::from_secs(8);

/// A list, an enable or an uninstall.
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

/// An install: the server downloads the manifest and the build before it
/// answers, each allowed a minute.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(150);

/// Where to send an operator API call, and the ticket to send with it.
struct Operator {
    base: String,
    token: String,
}

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
        if self.plugin_admin_via_operator_api()? {
            let operator = self.plugin_operator("plugins:read").await?;
            let url = format!("{}/v1/plugins", operator.base);
            let response = operator_http::client(CALL_TIMEOUT)?
                .get(&url)
                .bearer_auth(&operator.token)
                .send()
                .await
                .map_err(|error| format!("request failed: {error}"))?;
            let listed = list_from_operator_json(&operator_http::body(response, &url).await?)?;
            self.emit_plugin_admin("plugin-admin-list", listed);
            return Ok(());
        }
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
        if self.plugin_admin_via_operator_api()? {
            let operator = self.plugin_operator("plugins:write").await?;
            let url = plugin_url(&operator.base, &plugin_name)?;
            let response = operator_http::client(CALL_TIMEOUT)?
                .patch(&url)
                .bearer_auth(&operator.token)
                .json(&serde_json::json!({ "enabled": enabled }))
                .send()
                .await
                .map_err(|error| format!("request failed: {error}"))?;
            let _ = operator_http::body(response, &url).await?;
            self.emit_plugin_admin("plugin-admin-ack", succeeded("set_enabled", plugin_name));
            return Ok(());
        }
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
        if self.plugin_admin_via_operator_api()? {
            let operator = self.plugin_operator("plugins:write").await?;
            let url = format!("{}/v1/plugins", operator.base);
            let response = operator_http::client(INSTALL_TIMEOUT)?
                .post(&url)
                .bearer_auth(&operator.token)
                .json(&serde_json::json!({
                    "marketplace_id": marketplace_id,
                    "version": version.unwrap_or_default(),
                    "manifest_url": manifest_url,
                    "expected_sha256": expected_sha256.unwrap_or_default(),
                }))
                .send()
                .await
                .map_err(|error| format!("request failed: {error}"))?;
            let text = operator_http::body(response, &url).await?;
            // The name the plugin gave itself, which the inventory keys on.
            let installed = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|answer| {
                    answer
                        .pointer("/plugin/name")
                        .and_then(serde_json::Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .unwrap_or(marketplace_id);
            self.emit_plugin_admin("plugin-admin-ack", succeeded("install", installed));
            return Ok(());
        }
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
    pub async fn uninstall_server_plugin(&self, plugin_name: String) -> Result<(), String> {
        if self.plugin_admin_via_operator_api()? {
            let operator = self.plugin_operator("plugins:write").await?;
            let url = plugin_url(&operator.base, &plugin_name)?;
            let response = operator_http::client(CALL_TIMEOUT)?
                .delete(&url)
                .bearer_auth(&operator.token)
                .send()
                .await
                .map_err(|error| format!("request failed: {error}"))?;
            let _ = operator_http::body(response, &url).await?;
            self.emit_plugin_admin("plugin-admin-ack", succeeded("uninstall", plugin_name));
            return Ok(());
        }
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

    /// Whether the connected server numbers its wire as epoch 1, where plugin
    /// administration is the operator API's.
    fn plugin_admin_via_operator_api(&self) -> Result<bool, String> {
        let session = self.inner.snapshot();
        let state = session.lock().map_err(|e| e.to_string())?;
        Ok(state.server.fancy_protocol == Some(FANCY_PROTOCOL_EPOCH))
    }

    /// A ticket for `scope` from the connected server, and where to use it.
    async fn plugin_operator(&self, scope: &str) -> Result<Operator, String> {
        let scopes = vec![scope.to_owned()];
        // The waiter goes in before the request goes out, or a fast reply
        // could arrive with nobody waiting for it.
        let (handle, reply) = {
            let session = self.inner.snapshot();
            let mut state = session.lock().map_err(|e| e.to_string())?;
            let handle = state.conn.client_handle.clone().ok_or("Not connected")?;
            (handle, state.operator_tickets.expect(scopes.clone()))
        };
        handle
            .send(command::RequestOperatorTicket { scopes })
            .await
            .map_err(|error| format!("Failed to request an operator ticket: {error}"))?;
        let ticket = tokio::time::timeout(TICKET_TIMEOUT, reply)
            .await
            .map_err(|_| "the server did not answer the operator ticket request in time".to_owned())?
            .map_err(|_| "the connection closed before the server answered".to_owned())?;
        operator_from_ticket(ticket, scope)
    }

    fn emit_plugin_admin<S: serde::Serialize + Clone>(&self, event: &str, payload: S) {
        if let Some(app) = self.app_handle() {
            let _ = app.emit(event, payload);
        }
    }
}

/// The ticket, if it grants `scope` somewhere this client can present it.
fn operator_from_ticket(ticket: OperatorTicket, scope: &str) -> Result<Operator, String> {
    if !ticket.granted_scopes.iter().any(|granted| granted == scope) {
        return Err(if ticket.denied_reason.is_empty() {
            format!(
                "the server did not grant {scope}; managing server plugins needs Write on the root channel"
            )
        } else {
            format!("the server did not grant {scope}: {}", ticket.denied_reason)
        });
    }
    if ticket.base_url.trim().is_empty() {
        return Err(
            "this server's operator API has no public address, so its plugins cannot be managed \
             from a client; the operator needs to set [services.operator-api].public_url"
                .to_owned(),
        );
    }
    Ok(Operator {
        base: operator_http::base(&ticket.base_url)?,
        token: ticket.token,
    })
}

/// `{base}/v1/plugins/{name}`, with the name escaped as one path segment.
fn plugin_url(base: &str, plugin_name: &str) -> Result<String, String> {
    let mut url = reqwest::Url::parse(base)
        .map_err(|error| format!("the operator API address is not a URL: {error}"))?;
    let _ = url
        .path_segments_mut()
        .map_err(|()| "the operator API address cannot take a path".to_owned())?
        .pop_if_empty()
        .extend(["v1", "plugins", plugin_name]);
    Ok(url.into())
}

fn succeeded(verb: &str, plugin_name: String) -> PluginAdminAckPayload {
    PluginAdminAckPayload {
        plugin_name: Some(plugin_name),
        ok: true,
        error: None,
        request_id: None,
        verb: Some(verb.to_owned()),
    }
}

/// `GET /v1/plugins`, as the operator API answers it.
#[derive(Debug, Deserialize)]
struct OperatorPluginList {
    plugins: Vec<OperatorPlugin>,
    plugins_dir: Option<String>,
    host_abi_version: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct OperatorPlugin {
    name: String,
    #[serde(default)]
    version: String,
    enabled: bool,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    info_json: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    installed_at_ms: Option<u64>,
    #[serde(default)]
    builtin: bool,
    #[serde(default)]
    load_error: Option<String>,
}

/// The operator API's plugin list, in the shape the control channel delivers.
fn list_from_operator_json(text: &str) -> Result<PluginAdminListPayload, String> {
    let listed: OperatorPluginList = serde_json::from_str(text)
        .map_err(|error| format!("the operator API's plugin list was not understood: {error}"))?;
    Ok(PluginAdminListPayload {
        plugins: listed
            .plugins
            .into_iter()
            .map(|plugin| PluginAdminEntryPayload {
                marketplace_id: plugin.source.as_deref().and_then(marketplace_id),
                plugin_name: plugin.name,
                version: plugin.version,
                enabled: plugin.enabled,
                loaded: plugin.enabled,
                path: plugin.path.filter(|path| !path.is_empty()),
                info_json: plugin.info_json.filter(|json| !json.is_empty()),
                installed_at: plugin.installed_at_ms,
                builtin: plugin.builtin,
                load_error: plugin.load_error,
            })
            .collect(),
        plugins_dir: listed.plugins_dir,
        host_abi_version: listed.host_abi_version,
    })
}

/// `marketplace:fancy-greeter@0.3.0` is `fancy-greeter`.
fn marketplace_id(source: &str) -> Option<String> {
    let rest = source.strip_prefix("marketplace:")?;
    let id = rest.rsplit_once('@').map_or(rest, |(id, _)| id);
    (!id.is_empty()).then(|| id.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ticket(granted: &[&str], base_url: &str, denied: &str) -> OperatorTicket {
        OperatorTicket {
            token: "secret".to_owned(),
            granted_scopes: granted.iter().map(|scope| (*scope).to_owned()).collect(),
            expires_at_ms: 0,
            base_url: base_url.to_owned(),
            denied_reason: denied.to_owned(),
        }
    }

    #[test]
    fn the_operator_list_arrives_as_the_control_channel_list() {
        let listed = list_from_operator_json(
            r#"{"plugins":[
                {"id":"fancy-greeter","name":"fancy-greeter","version":"0.3.0","enabled":false,
                 "wasm":false,"path":"/srv/plugins/libfancy_greeter.so","info_json":"{}",
                 "source":"marketplace:fancy-greeter@0.3.0","installed_at_ms":1757750000000,
                 "builtin":false,"load_error":null},
                {"id":"broken","name":"broken","version":"","enabled":false,"wasm":false,
                 "path":"/srv/plugins/libbroken.so","info_json":"{}","source":null,
                 "installed_at_ms":null,"builtin":false,"load_error":"ABI 2, host has 4"}
            ],"plugins_dir":"/srv/plugins","host_abi_version":4}"#,
        )
        .expect("parses");
        assert_eq!(listed.host_abi_version, Some(4));
        assert_eq!(listed.plugins_dir.as_deref(), Some("/srv/plugins"));
        let greeter = &listed.plugins[0];
        assert_eq!(greeter.marketplace_id.as_deref(), Some("fancy-greeter"));
        assert_eq!(greeter.installed_at, Some(1_757_750_000_000));
        assert!(!greeter.loaded);
        let broken = &listed.plugins[1];
        assert_eq!(broken.marketplace_id, None);
        assert_eq!(broken.load_error.as_deref(), Some("ABI 2, host has 4"));
    }

    #[test]
    fn a_source_names_its_marketplace_id() {
        assert_eq!(marketplace_id("marketplace:fancy-greeter@0.3.0").as_deref(), Some("fancy-greeter"));
        assert_eq!(marketplace_id("marketplace:fancy-greeter").as_deref(), Some("fancy-greeter"));
        assert_eq!(marketplace_id("files:blob/x.so"), None);
        assert_eq!(marketplace_id("marketplace:@1"), None);
    }

    #[test]
    fn a_plugin_name_is_one_path_segment() {
        assert_eq!(
            plugin_url("https://ops.example.org", "fancy-greeter").unwrap(),
            "https://ops.example.org/v1/plugins/fancy-greeter"
        );
        assert_eq!(
            plugin_url("https://example.org/operator", "../accounts").unwrap(),
            "https://example.org/operator/v1/plugins/..%2Faccounts"
        );
    }

    #[test]
    fn a_ticket_that_cannot_be_used_says_why() {
        // No `expect_err`: that would need `Debug` on a type holding a token.
        let Err(denied) =
            operator_from_ticket(ticket(&[], "", "no requested scope is covered"), "plugins:write")
        else {
            panic!("a denied ticket was usable");
        };
        assert!(denied.contains("no requested scope is covered"), "{denied}");

        let Err(other_scope) = operator_from_ticket(
            ticket(&["server-config:write"], "https://ops.example.org", ""),
            "plugins:write",
        ) else {
            panic!("a livery ticket was usable for plugins");
        };
        assert!(other_scope.contains("Write on the root channel"), "{other_scope}");

        let Err(nowhere) =
            operator_from_ticket(ticket(&["plugins:write"], "", ""), "plugins:write")
        else {
            panic!("a ticket with no address was usable");
        };
        assert!(nowhere.contains("public_url"), "{nowhere}");

        let Ok(usable) = operator_from_ticket(
            ticket(&["plugins:write"], "https://ops.example.org/", ""),
            "plugins:write",
        ) else {
            panic!("a granted ticket was refused");
        };
        assert_eq!(usable.base, "https://ops.example.org");
        assert_eq!(usable.token, "secret");
    }
}
