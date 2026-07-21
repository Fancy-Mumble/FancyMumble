/** Audit-log types: entries, query args, config snapshot and the events that
 *  deliver them (see the audit design doc, server repo docs/audit-log.md). */

import type { ServerSetting } from "./serversettings";

/** Entry origin: authoritative server action, reported client claim, or a
 *  plugin-initiated privileged call. The UI must render these differently
 *  and never conflate a subjective signal with a moderator action. */
export type AuditSource = "server" | "client" | "plugin";

/** Severity levels, in ascending order. */
export const AUDIT_SEVERITIES = ["info", "notice", "warning", "critical"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

/** One audit entry as delivered by the backend. Identity fields are
 *  server-side snapshots taken at record time. */
export interface AuditEntry {
  /** Monotonic per-server id; the keyset-pagination cursor. */
  id: number;
  /** Unix epoch milliseconds. */
  ts: number;
  source: AuditSource | string;
  category: string;
  severity: AuditSeverity | string;
  actorUserId?: number;
  actorHash?: string;
  actorName?: string;
  targetUserId?: number;
  targetHash?: string;
  targetName?: string;
  channelId?: number;
  reason?: string;
  /** Category-specific structured payload (JSON text). */
  detailJson?: string;
  /** Id of a related earlier entry (an unban points at its ban). */
  relatesTo?: number;
  /** Hex-encoded chain hash of this entry. */
  entryHash?: string;
}

/** Structured filters sent to `query_audit_log` (lowered from the filter
 *  builder or the simple-mode DSL; `sql` carries advanced mode verbatim). */
export interface AuditQueryArgs {
  queryId?: string;
  categories?: string[];
  source?: string;
  severity?: string;
  actorUserId?: number;
  targetUserId?: number;
  channelId?: number;
  text?: string;
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
  beforeId?: number;
  subscribe?: boolean;
  sql?: string;
  verifyChain?: boolean;
}

/** Payload of the `audit-response` event. Entries are newest-first. */
export interface AuditResponse {
  queryId?: string;
  entries: AuditEntry[];
  hasMore: boolean;
  nextBeforeId?: number;
  /** Human-readable rejection (bad SQL, advanced mode unavailable, ...). */
  error?: string;
  /** Chain verification result (only when verifyChain was requested). */
  chainOk?: boolean;
  chainHeight?: number;
  chainError?: string;
}

/** Payload of the `audit-event` live-tail push. */
export interface AuditEventPayload {
  entry: AuditEntry;
}

/** Audit configuration snapshot (schema-driven, like server settings). */
export interface AuditConfigSnapshot {
  settings: ServerSetting[];
  revision: number;
  /** Whether advanced SQL mode passed its startup sandbox self-test. */
  advancedSqlAvailable: boolean;
  /** Current hash-chain height. */
  chainHeight: number;
  /** JSON schema of queryable views + enum domains for autocomplete. */
  sqlSchemaJson?: string;
}

/** Payload of the `audit-config` event. */
export interface AuditConfigEvent {
  config: AuditConfigSnapshot;
}
