//! Inbound handlers for the audit-log protocol (`FancyAuditResponse`,
//! `FancyAuditEvent`, `FancyAuditConfig`).
//!
//! Query responses and live-tail events are pure relays to the frontend
//! store; the configuration snapshot is additionally cached in shared state
//! (like the editable server settings) so the admin panel can resync after
//! an HMR reload without waiting for a re-broadcast.

use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;

use super::server_settings::decode_setting;
use super::{HandleMessage, HandlerContext};
use crate::state::types::{AuditConfigSnapshot, AuditEntryPayload};

pub(crate) fn decode_entry(p: &mumble_tcp::AuditEntry) -> AuditEntryPayload {
    AuditEntryPayload {
        id: p.id.unwrap_or(0),
        ts: p.ts.unwrap_or(0),
        source: p.source.clone().unwrap_or_default(),
        category: p.category.clone().unwrap_or_default(),
        severity: p.severity.clone().unwrap_or_else(|| "info".to_owned()),
        actor_user_id: p.actor_user_id,
        actor_hash: p.actor_hash.clone(),
        actor_name: p.actor_name.clone(),
        target_user_id: p.target_user_id,
        target_hash: p.target_hash.clone(),
        target_name: p.target_name.clone(),
        channel_id: p.channel_id,
        reason: p.reason.clone(),
        detail_json: p.detail_json.clone(),
        relates_to: p.relates_to,
        entry_hash: p
            .entry_hash
            .as_ref()
            .filter(|h| !h.is_empty())
            .map(|h| h.iter().map(|b| format!("{b:02x}")).collect()),
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AuditResponsePayload {
    query_id: Option<String>,
    entries: Vec<AuditEntryPayload>,
    has_more: bool,
    next_before_id: Option<u64>,
    error: Option<String>,
    chain_ok: Option<bool>,
    chain_height: Option<u64>,
    chain_error: Option<String>,
}

impl HandleMessage for mumble_tcp::FancyAuditResponse {
    fn handle(&self, ctx: &HandlerContext) {
        ctx.emit(
            "audit-response",
            AuditResponsePayload {
                query_id: self.query_id.clone(),
                entries: self.entries.iter().map(decode_entry).collect(),
                has_more: self.has_more.unwrap_or(false),
                next_before_id: self.next_before_id,
                error: self.error.clone().filter(|e| !e.is_empty()),
                chain_ok: self.chain_ok,
                chain_height: self.chain_height,
                chain_error: self.chain_error.clone().filter(|e| !e.is_empty()),
            },
        );
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AuditEventPayload {
    entry: AuditEntryPayload,
}

impl HandleMessage for mumble_tcp::FancyAuditEvent {
    fn handle(&self, ctx: &HandlerContext) {
        // An event without an entry carries no state; drop it.
        let Some(entry) = self.entry.as_ref() else {
            return;
        };
        ctx.emit(
            "audit-event",
            AuditEventPayload {
                entry: decode_entry(entry),
            },
        );
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AuditConfigPayload {
    config: AuditConfigSnapshot,
}

impl HandleMessage for mumble_tcp::FancyAuditConfig {
    fn handle(&self, ctx: &HandlerContext) {
        let snapshot = AuditConfigSnapshot {
            settings: self.settings.iter().map(decode_setting).collect(),
            revision: self.revision.unwrap_or(0),
            advanced_sql_available: self.advanced_sql_available.unwrap_or(false),
            chain_height: self.chain_height.unwrap_or(0),
            sql_schema_json: self.sql_schema_json.clone().filter(|s| !s.is_empty()),
        };

        if let Ok(mut state) = ctx.shared.lock() {
            // Only accept newer (or equal) revisions so a stale broadcast
            // can't clobber a fresher local view after an admin edit.
            let accept = state
                .audit_config
                .as_ref()
                .is_none_or(|prev| snapshot.revision >= prev.revision);
            if !accept {
                return;
            }
            state.audit_config = Some(snapshot.clone());
        }

        ctx.emit("audit-config", AuditConfigPayload { config: snapshot });
    }
}
