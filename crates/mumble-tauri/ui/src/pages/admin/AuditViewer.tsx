/**
 * Audit Log viewer half (audit spec section 10.2).
 *
 * Kibana-style dashboard over the audit entries: the search scopes
 * everything - KPI tiles, charts and the results table re-render together.
 * The dual-mode search (spec 10.3) keeps the filter pills and the query text
 * bound both ways; anything starting with SELECT/WITH routes to advanced
 * SQL mode (server-enforced sandbox, spec 10.4) when the server offers it.
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DownloadIcon, RefreshIcon, SearchIcon } from "../../icons";
import { useAppStore } from "../../store";
import type { AuditEntry } from "../../types";
import { TID } from "../../testids";
import DashboardChart from "./DashboardChart";
import {
  AuditQueryError,
  EMPTY_FILTERS,
  isSqlQuery,
  lowerToQueryArgs,
  parseAuditQuery,
  serializeAuditQuery,
  type AuditFilterState,
} from "./auditQuery";
import { useAuditStore, AUDIT_PAGE_LIMIT } from "./auditStore";
import styles from "./AuditLogTab.module.css";

/** Validated categorical palette (dark surface; six-checks pass). */
const PALETTE = ["#3987e5", "#008300", "#d55181", "#c98500", "#199e70", "#d95926"];
/** Severity status colors (paired with a text label, never color alone). */
const SEVERITY_COLORS: Record<string, string> = {
  info: "#6da7ec",
  notice: "#2ecf98",
  warning: "#c98500",
  critical: "#e66767",
};

const TICK_COLOR = "#9aa3ad";
const GRID_COLOR = "rgba(128,128,128,0.15)";
const SURFACE = "#22262e";

/** Categories offered as quick chips (custom ones appear from results). */
const KNOWN_CATEGORIES = [
  "ban", "kick", "mute", "move", "acl", "channel", "register",
  "config", "plugin", "pchat", "audit.access", "flag", "signal.report",
];

const SINCE_OPTIONS = ["", "1h", "24h", "7d", "30d"] as const;

function severityClass(sev: string): string {
  switch (sev) {
    case "critical": return styles.sevCritical;
    case "warning": return styles.sevWarning;
    case "notice": return styles.sevNotice;
    default: return styles.sevInfo;
  }
}

function sourceClass(src: string): string {
  switch (src) {
    case "client": return styles.srcClient;
    case "plugin": return styles.srcPlugin;
    default: return styles.srcServer;
  }
}

function fmtTime(ts: number): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function download(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(entries: AuditEntry[]): string {
  const cols = [
    "id", "ts", "source", "category", "severity", "actorName", "actorUserId",
    "targetName", "targetUserId", "channelId", "reason", "detailJson",
  ] as const;
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const rows = entries.map((e) => cols.map((c) => esc(e[c])).join(","));
  return [cols.join(","), ...rows].join("\n");
}

/** Bucket entries into a time series (hourly under 3 days span, else daily). */
function timeSeries(entries: AuditEntry[]): { labels: string[]; counts: number[] } {
  if (entries.length === 0) return { labels: [], counts: [] };
  const times = entries.map((e) => e.ts).filter(Boolean);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const hourly = max - min <= 3 * 86_400_000;
  const bucketMs = hourly ? 3_600_000 : 86_400_000;
  const buckets = new Map<number, number>();
  for (const t of times) {
    const b = Math.floor(t / bucketMs) * bucketMs;
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const fmt = (t: number) => {
    const d = new Date(t);
    return hourly
      ? `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`
      : `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return { labels: keys.map(fmt), counts: keys.map((k) => buckets.get(k) ?? 0) };
}

/** Top-N categories + "other" fold (fixed palette order, never cycled). */
function categoryBreakdown(entries: AuditEntry[], topN: number): { labels: string[]; counts: number[] } {
  const byCat = new Map<string, number>();
  for (const e of entries) byCat.set(e.category || "?", (byCat.get(e.category || "?") ?? 0) + 1);
  const sorted = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN).reduce((n, [, c]) => n + c, 0);
  const labels = top.map(([k]) => k);
  const counts = top.map(([, c]) => c);
  if (rest > 0) {
    labels.push("other");
    counts.push(rest);
  }
  return { labels, counts };
}

interface AuditViewerProps {
  /** Whether the server offers advanced SQL mode (sandbox self-test passed). */
  readonly advancedSqlAvailable: boolean;
}

export function AuditViewer({ advancedSqlAvailable }: AuditViewerProps) {
  const { t } = useTranslation("settings");
  const users = useAppStore((s) => s.users);
  const entries = useAuditStore((s) => s.entries);
  const hasMore = useAuditStore((s) => s.hasMore);
  const loading = useAuditStore((s) => s.loading);
  const loadingMore = useAuditStore((s) => s.loadingMore);
  const serverError = useAuditStore((s) => s.error);
  const live = useAuditStore((s) => s.live);
  const runQuery = useAuditStore((s) => s.runQuery);
  const loadMore = useAuditStore((s) => s.loadMore);
  const setLive = useAuditStore((s) => s.setLive);

  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_FILTERS);
  const [queryText, setQueryText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const sqlMode = advancedSqlAvailable && isSqlQuery(queryText);

  const resolveUser = useCallback(
    (name: string): number | undefined => {
      const lower = name.toLowerCase();
      const u = users.find((x) => x.name.toLowerCase() === lower);
      return u?.user_id ?? undefined;
    },
    [users],
  );

  /** Pills changed: update state and rewrite the canonical query text. */
  const updateFilters = (patch: Partial<AuditFilterState>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    setQueryText(serializeAuditQuery(next));
    setParseError(null);
  };

  /** Query text edited: reparse into pills (unless it's SQL). */
  const onTextCommit = (text: string) => {
    if (isSqlQuery(text)) return;
    try {
      setFilters(parseAuditQuery(text));
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof AuditQueryError ? e.message : String(e));
    }
  };

  const run = async () => {
    setSelected(null);
    try {
      if (sqlMode) {
        await runQuery({ sql: queryText });
      } else {
        // The text box is authoritative when it parses; otherwise pills win.
        let f = filters;
        try {
          f = parseAuditQuery(queryText);
          setFilters(f);
          setParseError(null);
        } catch {
          /* keep pill state */
        }
        await runQuery(lowerToQueryArgs(f, resolveUser, AUDIT_PAGE_LIMIT));
      }
    } catch (e) {
      setParseError(e instanceof AuditQueryError ? e.message : String(e));
    }
  };

  // -- Dashboard aggregates (scoped by the loaded result set) --------
  const dayAgo = Date.now() - 86_400_000;
  const kpis = useMemo(() => {
    const distinctActors = new Set(
      entries.map((e) => e.actorHash ?? e.actorName ?? String(e.actorUserId ?? "")).filter(Boolean),
    );
    return {
      total: entries.length,
      last24h: entries.filter((e) => e.ts >= dayAgo).length,
      flagged: entries.filter((e) => e.severity === "warning" || e.severity === "critical").length,
      reports: entries.filter((e) => e.category === "signal.report").length,
      distinctActors: distinctActors.size,
    };
  }, [entries, dayAgo]);

  const timeChart = useMemo(() => {
    const { labels, counts } = timeSeries(entries);
    return {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data: counts,
          backgroundColor: PALETTE[0],
          borderRadius: 4,
          maxBarThickness: 18,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { intersect: false } },
        scales: {
          x: { ticks: { color: TICK_COLOR, maxTicksLimit: 8 }, grid: { display: false } },
          y: { ticks: { color: TICK_COLOR, precision: 0 }, grid: { color: GRID_COLOR } },
        },
      },
    };
  }, [entries]);

  const categoryChart = useMemo(() => {
    const { labels, counts } = categoryBreakdown(entries, 5);
    return {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data: counts,
          backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderRadius: 4,
          maxBarThickness: 16,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: TICK_COLOR, precision: 0 }, grid: { color: GRID_COLOR } },
          y: { ticks: { color: TICK_COLOR }, grid: { display: false } },
        },
      },
    };
  }, [entries]);

  const severityChart = useMemo(() => {
    const bySev = new Map<string, number>();
    for (const e of entries) bySev.set(e.severity || "info", (bySev.get(e.severity || "info") ?? 0) + 1);
    const labels = ["info", "notice", "warning", "critical"].filter((s) => bySev.has(s));
    return {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: labels.map((s) => bySev.get(s) ?? 0),
          backgroundColor: labels.map((s) => SEVERITY_COLORS[s]),
          borderColor: SURFACE,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: "bottom", labels: { color: TICK_COLOR, boxWidth: 12 } } },
      },
    };
  }, [entries]);

  const catChips = useMemo(() => {
    const present = new Set(entries.map((e) => e.category).filter(Boolean));
    return [...new Set([...KNOWN_CATEGORIES, ...present])];
  }, [entries]);

  const channels = useAppStore((s) => s.channels);
  const channelName = useCallback(
    (id?: number) => (id == null ? undefined : channels.find((c) => c.id === id)?.name),
    [channels],
  );

  return (
    <div className={styles.panel}>
      {/* -- Search ---------------------------------------------------- */}
      <div className={styles.toolbar}>
        {sqlMode ? (
          <textarea
            className={styles.sqlEditor}
            data-testid={TID.auditQueryInput}
            value={queryText}
            spellCheck={false}
            placeholder={t("audit.sqlPlaceholder", { defaultValue: "SELECT ... FROM audit_entries WHERE ..." })}
            onChange={(e) => setQueryText(e.target.value)}
          />
        ) : (
          <input
            type="text"
            className={styles.queryInput}
            data-testid={TID.auditQueryInput}
            value={queryText}
            spellCheck={false}
            placeholder={t("audit.queryPlaceholder", {
              defaultValue: advancedSqlAvailable
                ? 'category = "ban" and ts > now-7d   (or start with SELECT for SQL)'
                : 'category = "ban" and ts > now-7d',
            })}
            onChange={(e) => setQueryText(e.target.value)}
            onBlur={(e) => onTextCommit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onTextCommit(queryText);
                void run();
              }
            }}
          />
        )}
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} data-testid={TID.auditRunQuery} disabled={loading} onClick={() => void run()}>
          <SearchIcon width={14} height={14} />
          {loading
            ? t("audit.searching", { defaultValue: "Searching…" })
            : t("audit.search", { defaultValue: "Search" })}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnLive}`}
          data-live={live}
          data-testid={TID.auditLiveToggle}
          onClick={() => void setLive(!live)}
          title={t("audit.liveTailHelp", { defaultValue: "Stream new matching entries as they happen" })}
        >
          <span className={styles.liveDot} />
          {t("audit.liveTail", { defaultValue: "Live" })}
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={entries.length === 0}
          onClick={() => download("audit-log.csv", "text/csv", toCsv(entries))}
        >
          <DownloadIcon width={14} height={14} /> CSV
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={entries.length === 0}
          onClick={() => download("audit-log.json", "application/json", JSON.stringify(entries, null, 2))}
        >
          <DownloadIcon width={14} height={14} /> JSON
        </button>
      </div>
      {(parseError ?? serverError) && (
        <div className={styles.queryError} data-testid={TID.auditQueryError}>
          {parseError ?? serverError}
        </div>
      )}

      {/* -- Filter pills (bound to the query text) --------------------- */}
      {!sqlMode && (
        <div className={styles.pillsRow}>
          <span className={styles.pillGroup}>
            <span className={styles.pillLabel}>{t("audit.filterSince", { defaultValue: "Since" })}</span>
            <select
              className={styles.pillSelect}
              value={filters.since}
              onChange={(e) => updateFilters({ since: e.target.value })}
            >
              {SINCE_OPTIONS.map((o) => (
                <option key={o || "all"} value={o}>
                  {o === "" ? t("audit.sinceAll", { defaultValue: "all time" }) : o}
                </option>
              ))}
            </select>
          </span>
          <span className={styles.pillGroup}>
            <span className={styles.pillLabel}>{t("audit.filterSource", { defaultValue: "Source" })}</span>
            <select
              className={styles.pillSelect}
              value={filters.source}
              onChange={(e) => updateFilters({ source: e.target.value })}
            >
              <option value="">{t("audit.any", { defaultValue: "any" })}</option>
              <option value="server">server</option>
              <option value="client">client</option>
              <option value="plugin">plugin</option>
            </select>
          </span>
          <span className={styles.pillGroup}>
            <span className={styles.pillLabel}>{t("audit.filterSeverity", { defaultValue: "Severity" })}</span>
            <select
              className={styles.pillSelect}
              value={filters.severity}
              onChange={(e) => updateFilters({ severity: e.target.value })}
            >
              <option value="">{t("audit.any", { defaultValue: "any" })}</option>
              <option value="info">info</option>
              <option value="notice">notice</option>
              <option value="warning">warning</option>
              <option value="critical">critical</option>
            </select>
          </span>
          <span className={styles.pillGroup}>
            <span className={styles.pillLabel}>{t("audit.filterActor", { defaultValue: "Actor" })}</span>
            <input
              className={styles.pillInput}
              value={filters.actor}
              placeholder={t("audit.userPlaceholder", { defaultValue: "name or id" })}
              onChange={(e) => updateFilters({ actor: e.target.value })}
            />
          </span>
          <span className={styles.pillGroup}>
            <span className={styles.pillLabel}>{t("audit.filterTarget", { defaultValue: "Target" })}</span>
            <input
              className={styles.pillInput}
              value={filters.target}
              placeholder={t("audit.userPlaceholder", { defaultValue: "name or id" })}
              onChange={(e) => updateFilters({ target: e.target.value })}
            />
          </span>
          <span className={styles.pillGroup}>
            <span className={styles.pillLabel}>{t("audit.filterText", { defaultValue: "Text" })}</span>
            <input
              className={styles.pillInput}
              value={filters.text}
              onChange={(e) => updateFilters({ text: e.target.value })}
            />
          </span>
        </div>
      )}
      {!sqlMode && (
        <div className={styles.pillsRow}>
          {catChips.map((c) => {
            const on = filters.categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                className={`${styles.catChip}${on ? "" : ` ${styles.catChipOff}`}`}
                onClick={() =>
                  updateFilters({
                    categories: on
                      ? filters.categories.filter((x) => x !== c)
                      : [...filters.categories, c],
                  })
                }
              >
                {c}
              </button>
            );
          })}
        </div>
      )}

      {/* -- KPI tiles -------------------------------------------------- */}
      <div className={styles.kpiRow} data-testid={TID.auditKpiRow}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{kpis.last24h}</span>
          <span className={styles.statLabel}>{t("audit.kpiActions24h", { defaultValue: "Actions (24h)" })}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{kpis.flagged}</span>
          <span className={styles.statLabel}>{t("audit.kpiFlagged", { defaultValue: "Warnings & critical" })}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{kpis.reports}</span>
          <span className={styles.statLabel}>{t("audit.kpiReports", { defaultValue: "User reports" })}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{kpis.distinctActors}</span>
          <span className={styles.statLabel}>{t("audit.kpiActors", { defaultValue: "Distinct actors" })}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{kpis.total}{hasMore ? "+" : ""}</span>
          <span className={styles.statLabel}>{t("audit.kpiLoaded", { defaultValue: "Entries loaded" })}</span>
          <span className={styles.statSub}>{t("audit.kpiScope", { defaultValue: "in current results" })}</span>
        </div>
      </div>

      {/* -- Charts ----------------------------------------------------- */}
      {entries.length > 0 && (
        <div className={styles.chartsRow}>
          <div className={styles.chartCard}>
            <span className={styles.chartTitle}>{t("audit.chartOverTime", { defaultValue: "Events over time" })}</span>
            <div className={styles.chartBody}>
              <DashboardChart config={timeChart} ariaLabel="Audit events over time" />
            </div>
          </div>
          <div className={styles.chartCard}>
            <span className={styles.chartTitle}>{t("audit.chartByCategory", { defaultValue: "By category" })}</span>
            <div className={styles.chartBody}>
              <DashboardChart config={categoryChart} ariaLabel="Audit events by category" />
            </div>
          </div>
          <div className={styles.chartCard}>
            <span className={styles.chartTitle}>{t("audit.chartBySeverity", { defaultValue: "By severity" })}</span>
            <div className={styles.chartBody}>
              <DashboardChart config={severityChart} ariaLabel="Audit events by severity" />
            </div>
          </div>
        </div>
      )}

      {/* -- Detail drawer ---------------------------------------------- */}
      {selected && (
        <div className={styles.drawer} data-testid={TID.auditDetailDrawer}>
          <div className={styles.drawerHead}>
            <span className={`${styles.badge} ${severityClass(selected.severity)}`}>{selected.severity}</span>
            <span className={`${styles.badge} ${sourceClass(selected.source)}`}>{selected.source}</span>
            <span className={styles.drawerTitle}>
              #{selected.id} · {selected.category}
            </span>
            <button type="button" className={styles.btn} onClick={() => setSelected(null)}>
              {t("audit.close", { defaultValue: "Close" })}
            </button>
          </div>
          <div className={styles.kvGrid}>
            <span className={styles.kvKey}>{t("audit.colTime", { defaultValue: "Time" })}</span>
            <span className={styles.kvVal}>{fmtTime(selected.ts)}</span>
            <span className={styles.kvKey}>{t("audit.colActor", { defaultValue: "Actor" })}</span>
            <span className={styles.kvVal}>
              {selected.actorName ?? "-"}
              {selected.actorUserId != null ? ` (#${selected.actorUserId})` : ""}
            </span>
            <span className={styles.kvKey}>{t("audit.colTarget", { defaultValue: "Target" })}</span>
            <span className={styles.kvVal}>
              {selected.targetName ?? "-"}
              {selected.targetUserId != null ? ` (#${selected.targetUserId})` : ""}
            </span>
            <span className={styles.kvKey}>{t("audit.colChannel", { defaultValue: "Channel" })}</span>
            <span className={styles.kvVal}>
              {selected.channelId != null
                ? channelName(selected.channelId) ?? `#${selected.channelId}`
                : "-"}
            </span>
            <span className={styles.kvKey}>{t("audit.colReason", { defaultValue: "Reason" })}</span>
            <span className={styles.kvVal}>
              {selected.reason || (
                <span className={styles.noReason}>{t("audit.noReason", { defaultValue: "no reason given" })}</span>
              )}
            </span>
            {selected.relatesTo != null && (
              <>
                <span className={styles.kvKey}>{t("audit.relatesTo", { defaultValue: "Related entry" })}</span>
                <span className={styles.kvVal}>#{selected.relatesTo}</span>
              </>
            )}
          </div>
          {selected.detailJson && (
            <pre className={styles.detailJson}>
              {(() => {
                try {
                  return JSON.stringify(JSON.parse(selected.detailJson), null, 2);
                } catch {
                  return selected.detailJson;
                }
              })()}
            </pre>
          )}
          {selected.entryHash && <span className={styles.hash}>chain: {selected.entryHash}</span>}
        </div>
      )}

      {/* -- Results table ---------------------------------------------- */}
      <div className={styles.tableWrap}>
        <table className={styles.table} data-testid={TID.auditTable}>
          <thead>
            <tr>
              <th>{t("audit.colTime", { defaultValue: "Time" })}</th>
              <th>{t("audit.colSeverity", { defaultValue: "Severity" })}</th>
              <th>{t("audit.colSource", { defaultValue: "Source" })}</th>
              <th>{t("audit.colCategory", { defaultValue: "Category" })}</th>
              <th>{t("audit.colActor", { defaultValue: "Actor" })}</th>
              <th>{t("audit.colTarget", { defaultValue: "Target" })}</th>
              <th>{t("audit.colChannel", { defaultValue: "Channel" })}</th>
              <th>{t("audit.colReason", { defaultValue: "Reason" })}</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  {loading
                    ? t("audit.loading", { defaultValue: "Loading…" })
                    : t("audit.noEntries", { defaultValue: "No entries. Run a search, or wait for the live tail." })}
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr
                key={e.id}
                className={styles.row}
                data-testid={TID.auditRow}
                data-entry-id={e.id}
                onClick={() => setSelected(e)}
              >
                <td className={styles.tdTime}>{fmtTime(e.ts)}</td>
                <td><span className={`${styles.badge} ${severityClass(e.severity)}`}>{e.severity}</span></td>
                <td><span className={`${styles.badge} ${sourceClass(e.source)}`}>{e.source}</span></td>
                <td>{e.category}</td>
                <td>{e.actorName ?? (e.actorUserId != null ? `#${e.actorUserId}` : "-")}</td>
                <td>{e.targetName ?? (e.targetUserId != null ? `#${e.targetUserId}` : "-")}</td>
                <td>{e.channelId != null ? channelName(e.channelId) ?? `#${e.channelId}` : "-"}</td>
                <td className={styles.tdReason}>
                  {e.reason || <span className={styles.noReason}>{t("audit.noReason", { defaultValue: "no reason given" })}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.footerRow}>
        {hasMore && (
          <button type="button" className={styles.btn} disabled={loadingMore} onClick={() => void loadMore()}>
            <RefreshIcon width={14} height={14} />
            {loadingMore
              ? t("audit.loading", { defaultValue: "Loading…" })
              : t("audit.loadMore", { defaultValue: "Load more" })}
          </button>
        )}
        <span className={styles.countNote}>
          {t("audit.countNote", {
            defaultValue: "{{count}} entries loaded",
            count: entries.length,
          })}
        </span>
      </div>
    </div>
  );
}
