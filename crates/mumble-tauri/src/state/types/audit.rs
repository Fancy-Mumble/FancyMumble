//! Audit-log types surfaced to the admin "Audit Log" panel.
//!
//! Entries come from `FancyAuditResponse` pages / `FancyAuditEvent` live-tail
//! pushes; the configuration snapshot from `FancyAuditConfig` reuses the
//! generic [`ServerSetting`] schema rows so the audit plugin owns the schema.

use serde::Serialize;

use super::ServerSetting;

/// One audit entry as delivered to the frontend (camelCase over IPC).
/// Identity fields are server-side snapshots taken at record time.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntryPayload {
    /// Monotonic per-server id; the keyset-pagination cursor.
    pub id: u64,
    /// Unix epoch milliseconds.
    pub ts: u64,
    /// `server` (authoritative) | `client` (reported claim) | `plugin`.
    pub source: String,
    pub category: String,
    /// `info` | `notice` | `warning` | `critical`.
    pub severity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_user_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_user_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Category-specific structured payload, passed through verbatim.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail_json: Option<String>,
    /// Id of a related earlier entry (an unban points at its ban).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relates_to: Option<u64>,
    /// Hex-encoded chain hash of this entry, for display / verification.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_hash: Option<String>,
}

/// Structured filters of an audit query, mirrored from the frontend.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditQueryArgs {
    /// Correlation id echoed on the response.
    pub query_id: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    pub source: Option<String>,
    pub severity: Option<String>,
    pub actor_user_id: Option<u32>,
    pub target_user_id: Option<u32>,
    pub channel_id: Option<u32>,
    pub text: Option<String>,
    pub since_ms: Option<u64>,
    pub until_ms: Option<u64>,
    pub limit: Option<u32>,
    pub before_id: Option<u64>,
    /// Keep a live tail open for entries matching this filter.
    pub subscribe: Option<bool>,
    /// Advanced mode: full read-only SELECT (server-enforced sandbox).
    pub sql: Option<String>,
    /// Run the hash-chain verification and report on the response.
    pub verify_chain: Option<bool>,
}

/// Audit configuration snapshot advertised by the server to audit admins.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditConfigSnapshot {
    /// Per-part toggles / retention / OTLP settings (schema-driven rows).
    pub settings: Vec<ServerSetting>,
    /// Monotonic revision so stale broadcasts can be dropped.
    pub revision: u64,
    /// Whether advanced SQL mode passed its startup sandbox self-test.
    pub advanced_sql_available: bool,
    /// Current hash-chain height (config-half status card).
    pub chain_height: u64,
    /// JSON schema of queryable views + enum domains for autocomplete.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sql_schema_json: Option<String>,
}
