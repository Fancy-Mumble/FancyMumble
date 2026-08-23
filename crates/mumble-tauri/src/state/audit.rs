//! Audit-log methods on `AppState`.
//!
//! - `get_audit_config` snapshots the cached configuration schema.
//! - `query_audit_log` sends a `FancyAuditQuery`; the response arrives
//!   asynchronously as an `audit-response` event (live-tail entries as
//!   `audit-event`).
//! - `save_audit_config` (audit admin) sends changed settings; the server
//!   applies them, records the change in the audit log itself, and
//!   re-broadcasts the stamped `FancyAuditConfig` snapshot.

use mumble_protocol::command;
use mumble_protocol::proto::mumble_tcp;

use super::types::{AuditConfigSnapshot, AuditQueryArgs, ServerSetting};
use super::AppState;

impl AppState {
    /// Snapshot the cached audit configuration, if any.
    pub fn get_audit_config(&self) -> Option<AuditConfigSnapshot> {
        let snapshot = self.inner.snapshot();
        let guard = snapshot.lock().ok()?;
        guard.audit_config.clone()
    }

    /// What the open server says it looks like, if it has said.
    ///
    /// Read on mount as well as pushed, so a reload or a late-mounting pack
    /// paints branding it already has rather than waiting for the next change.
    pub fn get_livery(&self) -> Option<crate::state::LiverySnapshot> {
        let snapshot = self.inner.snapshot();
        let guard = snapshot.lock().ok()?;
        guard.livery.clone()
    }

    /// Change the livery over this connection.
    ///
    /// No credential travels with it: the server authorises against the session
    /// the frame arrives on, and answers a caller without `Write` on the root
    /// channel with a `PermissionDenied` rather than silence.
    pub async fn update_livery(
        &self,
        fields: Vec<String>,
        values: mumble_protocol::proto::fancy::domain::LiveryDoc,
    ) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;
        handle
            .send(command::UpdateLivery { fields, values })
            .await
            .map_err(|e| format!("Failed to send the livery change: {e}"))
    }

    /// Ask the server for a short-lived operator credential, scoped to
    /// `scopes`. The answer arrives asynchronously as an `operator-ticket`
    /// event; this resolves once the request is away, the same contract
    /// [`Self::update_livery`] has.
    pub async fn request_operator_ticket(&self, scopes: Vec<String>) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;
        handle
            .send(command::RequestOperatorTicket { scopes })
            .await
            .map_err(|e| format!("Failed to request an operator ticket: {e}"))
    }

    /// Send an audit query / live-tail subscription / chain verification.
    pub async fn query_audit_log(&self, args: AuditQueryArgs) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;

        handle
            .send(command::SendFancyAuditQuery {
                query: encode_query(&args),
            })
            .await
            .map_err(|e| format!("Failed to send audit query: {e}"))?;
        Ok(())
    }

    /// Audit-admin path: send changed audit configuration to the server.
    /// Only the `key` and `value` of each setting are sent; the rest of the
    /// schema is owned by the audit plugin.
    pub async fn save_audit_config(&self, changed: Vec<ServerSetting>) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;

        let settings = changed.iter().map(encode_setting).collect();
        handle
            .send(command::SendFancyAuditConfigUpdate { settings })
            .await
            .map_err(|e| format!("Failed to send audit config: {e}"))?;
        Ok(())
    }
}

fn encode_query(a: &AuditQueryArgs) -> mumble_tcp::FancyAuditQuery {
    mumble_tcp::FancyAuditQuery {
        query_id: a.query_id.clone(),
        categories: a.categories.clone(),
        source: a.source.clone(),
        severity: a.severity.clone(),
        actor_user_id: a.actor_user_id,
        target_user_id: a.target_user_id,
        channel_id: a.channel_id,
        text: a.text.clone(),
        since_ms: a.since_ms,
        until_ms: a.until_ms,
        limit: a.limit,
        before_id: a.before_id,
        subscribe: a.subscribe,
        sql: a.sql.clone(),
        verify_chain: a.verify_chain,
    }
}

fn encode_setting(s: &ServerSetting) -> mumble_tcp::Setting {
    mumble_tcp::Setting {
        key: Some(s.key.clone()),
        value: s.value.clone(),
        // Schema fields are owned by the audit plugin; an update only
        // carries the changed key + value.
        r#type: None,
        group: None,
        label: None,
        options: Vec::new(),
        secret: None,
        help: None,
    }
}
