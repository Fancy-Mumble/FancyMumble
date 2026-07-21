/**
 * Audit Log viewer (audit spec section 10.2).
 *
 * Layout: the main search sits on top and scopes everything; below it the body
 * is a flex row of the active sub-page (Dashboard tiles+charts, or the Results
 * table) and a collapsible "quick filters" rail on the right. The rail and the
 * query text stay bound both ways (spec 10.3); anything starting with
 * SELECT/WITH routes to advanced SQL mode (spec 10.4) when the server offers
 * it, which hides the rail since pills can't express SQL.
 *
 * The Configuration sub-page is a sibling rendered by {@link ./AuditLogTab}.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  RefreshIcon,
  SearchIcon,
} from "../../icons";
import { useAppStore } from "../../store";
import type { AuditEntry } from "../../types";
import { TID } from "../../testids";
import DashboardChart from "./DashboardChart";
import { QueryAutocomplete } from "./QueryAutocomplete";
import { SqlEditor } from "./SqlEditor";
import type { AuditSuggestContext } from "./auditSuggest";
import {
  AuditQueryError,
  EMPTY_FILTERS,
  isSqlQuery,
  lowerToQueryArgs,
  parseAuditQuery,
  serializeAuditQuery,
  type AuditFilterState,
} from "./auditQuery";
import { Field, SelectInput, TextInput } from "../../components/elements/TextInput";
import { Toggle } from "../settings/SharedControls";
import { useAuditStore, AUDIT_PAGE_LIMIT } from "./auditStore";
import {
  PREF_ENDLESS,
  PREF_RAIL_OPEN,
  readBoolPref,
  writeBoolPref,
} from "./auditPrefs";
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

/**
 * The categories the server actually emits (namespaced), from the audit
 * plugin's toggle Parts (`audit/src/toggles.rs` `Part::as_str`). These are the
 * exact strings stored on each entry, so chips and `category = …` match them
 * verbatim; custom ones still appear from results.
 */
const KNOWN_CATEGORIES = [
  "audit.ban", "audit.kick", "audit.mute_deafen_suppress", "audit.move",
  "audit.acl", "audit.channel", "audit.register", "audit.config",
  "audit.plugin_admin", "audit.plugin_action", "audit.pchat_moderation",
  "audit.access",
  "signal.report", "signal.mute", "signal.block", "signal.hide",
  "signal.deafen_from", "signal.raw_edges",
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

function toCsv(entries: readonly AuditEntry[]): string {
  const cols = [
    "id", "ts", "source", "category", "severity", "actorName", "actorUserId",
    "targetName", "targetUserId", "channelId", "reason", "detailJson",
  ] as const;
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const rows = entries.map((e) => cols.map((c) => esc(e[c])).join(","));
  return [cols.join(","), ...rows].join("\n");
}

/** Bucket entries into a time series (hourly under 3 days span, else daily). */
function timeSeries(entries: readonly AuditEntry[]): { labels: string[]; counts: number[] } {
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
function categoryBreakdown(entries: readonly AuditEntry[], topN: number): { labels: string[]; counts: number[] } {
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

/** Sub-page rendered in the viewer's main column (Configuration is a sibling). */
export type AuditView = "dashboard" | "results";

interface AuditViewerProps {
  /** Whether the server offers advanced SQL mode (sandbox self-test passed). */
  readonly advancedSqlAvailable: boolean;
  /** Which sub-page to show in the main column. */
  readonly view: AuditView;
  /** Fired when a search runs so the container can reveal the results page. */
  readonly onRan: () => void;
}

/** Rows per page when paginating (endless scrolling off). */
const PAGE_SIZE = 25;
/** How long to coalesce keystrokes in the rail's text filters before querying. */
const FILTER_DEBOUNCE_MS = 350;

export function AuditViewer({ advancedSqlAvailable, view, onRan }: AuditViewerProps) {
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
  const [railOpen, setRailOpen] = useState(() => readBoolPref(PREF_RAIL_OPEN, true));
  const [endless, setEndless] = useState(() => readBoolPref(PREF_ENDLESS, false));
  /** Current page of the loaded buffer (pagination mode only). */
  const [page, setPage] = useState(0);

  const toggleRail = () =>
    setRailOpen((open) => {
      writeBoolPref(PREF_RAIL_OPEN, !open);
      return !open;
    });

  const changeEndless = (next: boolean) => {
    writeBoolPref(PREF_ENDLESS, next);
    setEndless(next);
    setPage(0);
  };

  const sqlMode = advancedSqlAvailable && isSqlQuery(queryText);

  const resolveUser = useCallback(
    (name: string): number | undefined => {
      const lower = name.toLowerCase();
      const u = users.find((x) => x.name.toLowerCase() === lower);
      return u?.user_id ?? undefined;
    },
    [users],
  );

  const catChips = useMemo(() => {
    const present = new Set(entries.map((e) => e.category).filter(Boolean));
    return [...new Set([...KNOWN_CATEGORIES, ...present])];
  }, [entries]);

  /** Run `f` against the server, leaving the visible sub-page alone. */
  const executeQuery = useCallback(
    async (f: AuditFilterState) => {
      setSelected(null);
      setPage(0);
      try {
        await runQuery(lowerToQueryArgs(f, resolveUser, AUDIT_PAGE_LIMIT, catChips));
        setParseError(null);
      } catch (e) {
        setParseError(e instanceof AuditQueryError ? e.message : String(e));
      }
    },
    [runQuery, resolveUser, catChips],
  );

  // Open on an unfiltered list rather than an empty table waiting for a click.
  // Guarded on the store so returning from Configuration doesn't re-query.
  const lastArgs = useAuditStore((s) => s.lastArgs);
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current || lastArgs !== null) return;
    bootstrapped.current = true;
    void executeQuery(EMPTY_FILTERS);
  }, [lastArgs, executeQuery]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  /**
   * A quick filter changed: rewrite the canonical query text and apply it
   * immediately. Discrete controls (selects, chips) fire at once; free-text
   * fields coalesce keystrokes so typing doesn't issue a query per character.
   */
  const updateFilters = (patch: Partial<AuditFilterState>, immediate = true) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    setQueryText(serializeAuditQuery(next));
    setParseError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (immediate) {
      void executeQuery(next);
    } else {
      debounceRef.current = setTimeout(() => void executeQuery(next), FILTER_DEBOUNCE_MS);
    }
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
    // Searching is a request to see results - surface that page immediately.
    onRan();
    if (sqlMode) {
      setSelected(null);
      setPage(0);
      try {
        await runQuery({ sql: queryText });
        setParseError(null);
      } catch (e) {
        setParseError(e instanceof AuditQueryError ? e.message : String(e));
      }
      return;
    }
    // The text box is authoritative when it parses; otherwise pills win.
    let f = filters;
    try {
      f = parseAuditQuery(queryText);
      setFilters(f);
    } catch {
      /* keep pill state */
    }
    await executeQuery(f);
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

  const channels = useAppStore((s) => s.channels);
  const channelName = useCallback(
    (id?: number) => (id == null ? undefined : channels.find((c) => c.id === id)?.name),
    [channels],
  );

  /** Live value domains for the search autocomplete. */
  const suggestContext = useMemo<AuditSuggestContext>(
    () => ({
      categories: catChips,
      userNames: users.map((u) => u.name),
      channels: channels.map((c) => ({ id: c.id, name: c.name })),
    }),
    [catChips, users, channels],
  );

  return (
    <div className={styles.viewer}>
      {/* -- Main search: top, full width ------------------------------ */}
      <div className={styles.searchBar}>
        {sqlMode ? (
          <SqlEditor
            value={queryText}
            onChange={setQueryText}
            placeholder={t("audit.sqlPlaceholder", { defaultValue: "SELECT ... FROM audit_entries WHERE ..." })}
          />
        ) : (
          <QueryAutocomplete
            value={queryText}
            onChange={setQueryText}
            onCommit={onTextCommit}
            onRun={() => void run()}
            context={suggestContext}
            placeholder={t("audit.queryPlaceholder", {
              defaultValue: advancedSqlAvailable
                ? 'category ~ kick and ts > now-7d   (or start with SELECT for SQL)'
                : 'category ~ kick and ts > now-7d',
            })}
          />
        )}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          data-testid={TID.auditRunQuery}
          disabled={loading}
          onClick={() => void run()}
        >
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

      {/* -- Body: active sub-page + collapsible quick-filter rail ------ */}
      <div className={styles.body}>
        <div className={styles.main}>
          {view === "dashboard" ? (
            <AuditDashboard
              kpis={kpis}
              hasMore={hasMore}
              hasEntries={entries.length > 0}
              timeChart={timeChart}
              categoryChart={categoryChart}
              severityChart={severityChart}
            />
          ) : (
            <AuditResults
              entries={entries}
              loading={loading}
              loadingMore={loadingMore}
              hasMore={hasMore}
              onLoadMore={() => void loadMore()}
              selected={selected}
              onSelect={setSelected}
              channelName={channelName}
              endless={endless}
              page={page}
              onPageChange={setPage}
            />
          )}
        </div>

        {!sqlMode && (
          <AuditFilterRail
            open={railOpen}
            onToggle={toggleRail}
            filters={filters}
            onChange={updateFilters}
            categories={catChips}
            endless={endless}
            onEndlessChange={changeEndless}
          />
        )}
      </div>
    </div>
  );
}

// -- Dashboard sub-page --------------------------------------------

interface AuditDashboardProps {
  readonly kpis: {
    total: number;
    last24h: number;
    flagged: number;
    reports: number;
    distinctActors: number;
  };
  readonly hasMore: boolean;
  readonly hasEntries: boolean;
  readonly timeChart: object;
  readonly categoryChart: object;
  readonly severityChart: object;
}

/** KPI tiles + charts, all scoped to the currently loaded result set. */
function AuditDashboard({
  kpis,
  hasMore,
  hasEntries,
  timeChart,
  categoryChart,
  severityChart,
}: AuditDashboardProps) {
  const { t } = useTranslation("settings");
  return (
    <>
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

      {hasEntries ? (
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
      ) : (
        <div className={styles.emptyCard}>
          {t("audit.noEntries", { defaultValue: "No entries. Run a search, or wait for the live tail." })}
        </div>
      )}
    </>
  );
}

// -- Results sub-page ----------------------------------------------

interface AuditResultsProps {
  readonly entries: readonly AuditEntry[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly hasMore: boolean;
  readonly onLoadMore: () => void;
  readonly selected: AuditEntry | null;
  readonly onSelect: (entry: AuditEntry | null) => void;
  readonly channelName: (id?: number) => string | undefined;
  /** Endless scrolling (true) or paged navigation (false). */
  readonly endless: boolean;
  readonly page: number;
  readonly onPageChange: (page: number) => void;
}

/** The results table plus the detail drawer for the selected row. */
function AuditResults({
  entries,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  selected,
  onSelect,
  channelName,
  endless,
  page,
  onPageChange,
}: AuditResultsProps) {
  const { t } = useTranslation("settings");

  // Pagination slices the already-loaded buffer; running past its end pulls the
  // next keyset page from the server.
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const atLastPage = page >= pageCount - 1;
  const visible = endless ? entries : entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const goNext = () => {
    if (!atLastPage) {
      onPageChange(page + 1);
    } else if (hasMore) {
      onLoadMore();
      onPageChange(page + 1);
    }
  };

  /** Endless mode: pull the next page as the scroll approaches the bottom. */
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    if (!endless || !hasMore || loadingMore) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) onLoadMore();
  };

  return (
    <>
      {selected && (
        <div className={styles.drawer} data-testid={TID.auditDetailDrawer}>
          <div className={styles.drawerHead}>
            <span className={`${styles.badge} ${severityClass(selected.severity)}`}>{selected.severity}</span>
            <span className={`${styles.badge} ${sourceClass(selected.source)}`}>{selected.source}</span>
            <span className={styles.drawerTitle}>
              #{selected.id} · {selected.category}
            </span>
            <button type="button" className={styles.btn} onClick={() => onSelect(null)}>
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

      <div className={styles.tableWrap} onScroll={onScroll}>
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
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  {loading || loadingMore
                    ? t("audit.loading", { defaultValue: "Loading…" })
                    : t("audit.noEntries", { defaultValue: "No entries. Run a search, or wait for the live tail." })}
                </td>
              </tr>
            )}
            {visible.map((e) => (
              <tr
                key={e.id}
                className={styles.row}
                data-testid={TID.auditRow}
                data-entry-id={e.id}
                onClick={() => onSelect(e)}
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
        {endless ? (
          <>
            {/* Fallback for when the table is too short to scroll. */}
            {hasMore && (
              <button type="button" className={styles.btn} disabled={loadingMore} onClick={onLoadMore}>
                <RefreshIcon width={14} height={14} />
                {loadingMore
                  ? t("audit.loading", { defaultValue: "Loading…" })
                  : t("audit.loadMore", { defaultValue: "Load more" })}
              </button>
            )}
            {!hasMore && entries.length > 0 && (
              <span className={styles.countNote}>
                {t("audit.endOfResults", { defaultValue: "End of results" })}
              </span>
            )}
          </>
        ) : (
          <div className={styles.pager}>
            <button
              type="button"
              className={styles.btn}
              disabled={page === 0}
              data-testid={TID.auditPagePrev}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeftIcon width={14} height={14} />
              {t("audit.prevPage", { defaultValue: "Previous" })}
            </button>
            <span className={styles.countNote}>
              {t("audit.pageOf", {
                defaultValue: "Page {{page}} of {{pages}}",
                page: page + 1,
                pages: pageCount,
              })}
              {hasMore ? "+" : ""}
            </span>
            <button
              type="button"
              className={styles.btn}
              disabled={atLastPage && !hasMore}
              data-testid={TID.auditPageNext}
              onClick={goNext}
            >
              {t("audit.nextPage", { defaultValue: "Next" })}
              <ChevronRightIcon width={14} height={14} />
            </button>
          </div>
        )}
        <span className={styles.countNote}>
          {t("audit.countNote", {
            defaultValue: "{{count}} entries loaded",
            count: entries.length,
          })}
        </span>
      </div>
    </>
  );
}

// -- Quick-filter ("EZ search") rail --------------------------------

interface AuditFilterRailProps {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly filters: AuditFilterState;
  /** `immediate: false` debounces (used by the free-text fields). */
  readonly onChange: (patch: Partial<AuditFilterState>, immediate?: boolean) => void;
  readonly categories: readonly string[];
  readonly endless: boolean;
  readonly onEndlessChange: (endless: boolean) => void;
}

/**
 * Collapsible right-hand rail of point-and-click filters. Every control writes
 * back through `onChange`, which re-serialises the canonical query text and
 * runs the query straight away, so the rail and the main search box never
 * drift apart and results update as you click.
 */
function AuditFilterRail({
  open,
  onToggle,
  filters,
  onChange,
  categories,
  endless,
  onEndlessChange,
}: AuditFilterRailProps) {
  const { t } = useTranslation("settings");
  return (
    <aside
      className={`${styles.rail}${open ? "" : ` ${styles.railCollapsed}`}`}
      data-open={open}
      data-testid={TID.auditFilterRail}
    >
      <div className={styles.railHead}>
        {open && (
          <span className={styles.railTitle}>
            {t("audit.quickFilters", { defaultValue: "Quick filters" })}
          </span>
        )}
        <button
          type="button"
          className={styles.railToggle}
          data-testid={TID.auditFilterRailToggle}
          aria-expanded={open}
          onClick={onToggle}
          title={
            open
              ? t("audit.collapseFilters", { defaultValue: "Collapse quick filters" })
              : t("audit.expandFilters", { defaultValue: "Expand quick filters" })
          }
        >
          {open ? <ChevronRightIcon width={16} height={16} /> : <ChevronLeftIcon width={16} height={16} />}
        </button>
      </div>

      {open && (
        <div className={styles.railBody}>
          <Field label={t("audit.filterSince", { defaultValue: "Since" })}>
            <SelectInput
              size="small"
              value={filters.since}
              onChange={(e) => onChange({ since: e.target.value })}
            >
              {SINCE_OPTIONS.map((o) => (
                <option key={o || "all"} value={o}>
                  {o === "" ? t("audit.sinceAll", { defaultValue: "all time" }) : o}
                </option>
              ))}
            </SelectInput>
          </Field>

          <Field label={t("audit.filterSource", { defaultValue: "Source" })}>
            <SelectInput
              size="small"
              value={filters.source}
              onChange={(e) => onChange({ source: e.target.value })}
            >
              <option value="">{t("audit.any", { defaultValue: "any" })}</option>
              <option value="server">server</option>
              <option value="client">client</option>
              <option value="plugin">plugin</option>
            </SelectInput>
          </Field>

          <Field label={t("audit.filterSeverity", { defaultValue: "Severity" })}>
            <SelectInput
              size="small"
              value={filters.severity}
              onChange={(e) => onChange({ severity: e.target.value })}
            >
              <option value="">{t("audit.any", { defaultValue: "any" })}</option>
              <option value="info">info</option>
              <option value="notice">notice</option>
              <option value="warning">warning</option>
              <option value="critical">critical</option>
            </SelectInput>
          </Field>

          <Field label={t("audit.filterActor", { defaultValue: "Actor" })}>
            <TextInput
              size="small"
              value={filters.actor}
              placeholder={t("audit.userPlaceholder", { defaultValue: "name or id" })}
              onChange={(e) => onChange({ actor: e.target.value }, false)}
            />
          </Field>

          <Field label={t("audit.filterTarget", { defaultValue: "Target" })}>
            <TextInput
              size="small"
              value={filters.target}
              placeholder={t("audit.userPlaceholder", { defaultValue: "name or id" })}
              onChange={(e) => onChange({ target: e.target.value }, false)}
            />
          </Field>

          <Field label={t("audit.filterText", { defaultValue: "Text" })}>
            <TextInput
              size="small"
              value={filters.text}
              onChange={(e) => onChange({ text: e.target.value }, false)}
            />
          </Field>

          <div className={styles.railGroup}>
            <span className={styles.pillLabel}>{t("audit.filterCategory", { defaultValue: "Categories" })}</span>
            <div className={styles.railChips}>
              {categories.map((c) => {
                const on = filters.categories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    className={`${styles.catChip}${on ? "" : ` ${styles.catChipOff}`}`}
                    aria-pressed={on}
                    onClick={() =>
                      onChange({
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
          </div>

          <div className={styles.railDivider} />

          <div className={styles.railGroup}>
            <span className={styles.pillLabel}>{t("audit.resultsLabel", { defaultValue: "Results" })}</span>
            <div className={styles.railSwitchRow}>
              <Toggle
                checked={endless}
                onChange={() => onEndlessChange(!endless)}
                testId={TID.auditEndlessToggle}
                ariaLabel={t("audit.endlessScroll", { defaultValue: "Endless scrolling" })}
              />
              <span className={styles.railSwitchLabel}>
                {t("audit.endlessScroll", { defaultValue: "Endless scrolling" })}
              </span>
            </div>
            <span className={styles.railHint}>
              {endless
                ? t("audit.endlessOn", { defaultValue: "Loads more as you scroll." })
                : t("audit.endlessOff", { defaultValue: "Paged, 25 rows at a time." })}
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}
