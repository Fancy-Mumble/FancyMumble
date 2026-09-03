/**
 * Admin › Audit log.
 *
 * Three sub-pages behind one search: a Dashboard of tiles and charts, the
 * Results table, and Configuration. The search sits above all of them and
 * scopes everything - the dashboard's numbers are aggregates *of the loaded
 * result set*, not of the whole log, which is why running a search is what
 * changes them.
 *
 * The quick-filter rail and the query text are bound both ways: clicking a
 * chip rewrites the canonical query, and editing the query re-derives the
 * chips. Anything starting with SELECT or WITH routes to advanced SQL mode
 * where the server offers it, which hides the rail - pills cannot express SQL.
 *
 * Both halves are gated server-side: ViewAudit and ConfigureAudit resolve to
 * root-channel Write today, the same gate every other admin page uses.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type UIEvent,
} from "react";
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import type {
  AuditConfigEvent,
  AuditEntry,
  AuditEventPayload,
  AuditResponse,
  ServerSetting,
} from "@core/types";
import {
  AuditQueryError,
  EMPTY_FILTERS,
  isSqlQuery,
  lowerToQueryArgs,
  parseAuditQuery,
  serializeAuditQuery,
  type AuditFilterState,
} from "@core/features/admin/auditQuery";
import type { AuditSuggestContext } from "@core/features/admin/auditSuggest";
import { AUDIT_PAGE_LIMIT, useAuditStore } from "@core/features/admin/auditStore";
import {
  PREF_ENDLESS,
  PREF_PAGE,
  PREF_RAIL_OPEN,
  readBoolPref,
  readEnumPref,
  writeBoolPref,
  writeEnumPref,
} from "@core/features/admin/auditPrefs";
import DashboardChart from "@standard/pages/admin/DashboardChart";
import { QueryAutocomplete } from "./QueryAutocomplete";
import { SqlEditor } from "./SqlEditor";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "@ui/icons";
import { NEBULA_MONO, NEBULA_RADIUS, radius } from "../../tokens";
import { Stack, StatusDot } from "../primitives";
import { Banner, EmptyState, Field, GroupTitle, SegmentedGroup, SettingsCard } from "../settings/controls";
import { AdminPage } from "./controls";

type AuditPage = "dashboard" | "results" | "config";
const AUDIT_PAGES = ["dashboard", "results", "config"] as const;

/**
 * The categories the server actually emits, from the audit plugin's toggle
 * Parts. These are the exact strings stored on each entry, so a chip and a
 * `category = …` clause match them verbatim; custom ones still show up from
 * whatever the results contain.
 */
const KNOWN_CATEGORIES = [
  "audit.ban",
  "audit.kick",
  "audit.mute_deafen_suppress",
  "audit.move",
  "audit.acl",
  "audit.channel",
  "audit.register",
  "audit.config",
  "audit.plugin_admin",
  "audit.plugin_action",
  "audit.pchat_moderation",
  "audit.access",
  "signal.report",
  "signal.mute",
  "signal.block",
  "signal.hide",
  "signal.deafen_from",
  "signal.raw_edges",
];

const SINCE_OPTIONS = ["", "1h", "24h", "7d", "30d"] as const;

/** Rows per page when paginating (endless scrolling off). */
const PAGE_SIZE = 25;
/** How long the rail's free-text fields coalesce keystrokes before querying. */
const FILTER_DEBOUNCE_MS = 350;

const fmtTime = (ts: number) => (ts ? new Date(ts).toLocaleString() : "-");

function download(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toCsv(entries: readonly AuditEntry[]): string {
  const columns = [
    "id",
    "ts",
    "source",
    "category",
    "severity",
    "actorName",
    "actorUserId",
    "targetName",
    "targetUserId",
    "channelId",
    "reason",
    "detailJson",
  ] as const;
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    columns.join(","),
    ...entries.map((entry) => columns.map((column) => escape(entry[column])).join(",")),
  ].join("\n");
}

/** Bucket entries into a time series - hourly under a three-day span, else daily. */
function timeSeries(entries: readonly AuditEntry[]): { labels: string[]; counts: number[] } {
  if (entries.length === 0) return { labels: [], counts: [] };
  const times = entries.map((entry) => entry.ts).filter(Boolean);
  const hourly = Math.max(...times) - Math.min(...times) <= 3 * 86_400_000;
  const bucketMs = hourly ? 3_600_000 : 86_400_000;
  const buckets = new Map<number, number>();
  for (const time of times) {
    const bucket = Math.floor(time / bucketMs) * bucketMs;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const label = (time: number) => {
    const date = new Date(time);
    return hourly
      ? `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`
      : `${date.getMonth() + 1}/${date.getDate()}`;
  };
  return { labels: keys.map(label), counts: keys.map((key) => buckets.get(key) ?? 0) };
}

/** Top-N categories with the remainder folded into "other". */
function categoryBreakdown(
  entries: readonly AuditEntry[],
  topN: number,
): { labels: string[]; counts: number[] } {
  const byCategory = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.category || "?";
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }
  const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN).reduce((total, [, count]) => total + count, 0);
  const labels = top.map(([key]) => key);
  const counts = top.map(([, count]) => count);
  if (rest > 0) {
    labels.push("other");
    counts.push(rest);
  }
  return { labels, counts };
}

export function AuditAdmin() {
  const { t } = useTranslation("settings");
  // The sub-page you left off on is remembered across sessions.
  const [page, setPageState] = useState<AuditPage>(() =>
    readEnumPref<AuditPage>(PREF_PAGE, "dashboard", AUDIT_PAGES),
  );
  const setPage = (next: AuditPage) => {
    writeEnumPref(PREF_PAGE, next);
    setPageState(next);
  };

  const config = useAuditStore((state) => state.config);
  const applyResponse = useAuditStore((state) => state.applyResponse);
  const applyEvent = useAuditStore((state) => state.applyEvent);
  const applyConfig = useAuditStore((state) => state.applyConfig);
  const loadConfig = useAuditStore((state) => state.loadConfig);

  useEffect(() => {
    void loadConfig();
    const subs = [
      listen<AuditResponse>("audit-response", (event) => applyResponse(event.payload)),
      listen<AuditEventPayload>("audit-event", (event) => applyEvent(event.payload.entry)),
      listen<AuditConfigEvent>("audit-config", (event) => applyConfig(event.payload.config)),
    ];
    return () => {
      for (const sub of subs) void sub.then((stop) => stop());
    };
  }, [loadConfig, applyResponse, applyEvent, applyConfig]);

  return (
    <Box data-testid={TID.auditTab}>
      <AdminPage
        wide
        title={t("adminTabs.auditLog", { defaultValue: "Audit log" })}
        toolbar={
          <Box data-testid={TID.auditSubTabs}>
            <SegmentedGroup
              ariaLabel={t("adminTabs.auditLog", { defaultValue: "Audit log" })}
              value={page}
              onChange={setPage}
              options={[
                { id: "dashboard", label: t("audit.pageDashboard", { defaultValue: "Dashboard" }) },
                { id: "results", label: t("audit.pageResults", { defaultValue: "Results" }) },
                { id: "config", label: t("audit.halfConfig", { defaultValue: "Configuration" }) },
              ]}
            />
          </Box>
        }
      >
        {page === "config" ? (
          <AuditConfig />
        ) : (
          <AuditViewer
            advancedSqlAvailable={config?.advancedSqlAvailable ?? false}
            view={page}
            onRan={() => setPage("results")}
          />
        )}
      </AdminPage>
    </Box>
  );
}

/** The search, the active sub-page, and the quick-filter rail beside it. */
function AuditViewer({
  advancedSqlAvailable,
  view,
  onRan,
}: Readonly<{ advancedSqlAvailable: boolean; view: "dashboard" | "results"; onRan: () => void }>) {
  const { t } = useTranslation("settings");
  const users = useAppStore((state) => state.users);
  const channels = useAppStore((state) => state.channels);
  const entries = useAuditStore((state) => state.entries);
  const hasMore = useAuditStore((state) => state.hasMore);
  const loading = useAuditStore((state) => state.loading);
  const loadingMore = useAuditStore((state) => state.loadingMore);
  const serverError = useAuditStore((state) => state.error);
  const live = useAuditStore((state) => state.live);
  const runQuery = useAuditStore((state) => state.runQuery);
  const loadMore = useAuditStore((state) => state.loadMore);
  const setLive = useAuditStore((state) => state.setLive);
  const lastArgs = useAuditStore((state) => state.lastArgs);

  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_FILTERS);
  const [queryText, setQueryText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [railOpen, setRailOpen] = useState(() => readBoolPref(PREF_RAIL_OPEN, true));
  const [endless, setEndless] = useState(() => readBoolPref(PREF_ENDLESS, false));
  const [pageIndex, setPageIndex] = useState(0);

  const sqlMode = advancedSqlAvailable && isSqlQuery(queryText);

  const resolveUser = useCallback(
    (name: string): number | undefined => {
      const lower = name.toLowerCase();
      return users.find((user) => user.name.toLowerCase() === lower)?.user_id ?? undefined;
    },
    [users],
  );

  const catChips = useMemo(() => {
    const present = new Set(entries.map((entry) => entry.category).filter(Boolean));
    return [...new Set([...KNOWN_CATEGORIES, ...present])];
  }, [entries]);

  const executeQuery = useCallback(
    async (next: AuditFilterState) => {
      setSelected(null);
      setPageIndex(0);
      try {
        await runQuery(lowerToQueryArgs(next, resolveUser, AUDIT_PAGE_LIMIT, catChips));
        setParseError(null);
      } catch (e) {
        setParseError(e instanceof AuditQueryError ? e.message : String(e));
      }
    },
    [runQuery, resolveUser, catChips],
  );

  // Open on an unfiltered list rather than an empty table waiting for a click.
  // Guarded on the store, so returning from Configuration does not re-query.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current || lastArgs !== null) return;
    bootstrapped.current = true;
    void executeQuery(EMPTY_FILTERS);
  }, [lastArgs, executeQuery]);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  /**
   * A quick filter changed: rewrite the canonical query text and apply it.
   * Discrete controls fire at once; free-text fields coalesce keystrokes so
   * typing does not issue a query per character.
   */
  const updateFilters = (patch: Partial<AuditFilterState>, immediate = true) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    setQueryText(serializeAuditQuery(next));
    setParseError(null);
    if (debounce.current) clearTimeout(debounce.current);
    if (immediate) void executeQuery(next);
    else debounce.current = setTimeout(() => void executeQuery(next), FILTER_DEBOUNCE_MS);
  };

  const run = async () => {
    // Searching is a request to see results, so surface that page at once.
    onRan();
    if (sqlMode) {
      setSelected(null);
      setPageIndex(0);
      try {
        await runQuery({ sql: queryText });
        setParseError(null);
      } catch (e) {
        setParseError(e instanceof AuditQueryError ? e.message : String(e));
      }
      return;
    }
    // The text box wins when it parses; otherwise the pills do.
    let next = filters;
    try {
      next = parseAuditQuery(queryText);
      setFilters(next);
    } catch {
      // Keep the pill state as it stands.
    }
    await executeQuery(next);
  };

  const channelName = useCallback(
    (id?: number) => (id == null ? undefined : channels.find((channel) => channel.id === id)?.name),
    [channels],
  );

  const suggestContext = useMemo<AuditSuggestContext>(
    () => ({
      categories: catChips,
      userNames: users.map((user) => user.name),
      channels: channels.map((channel) => ({ id: channel.id, name: channel.name })),
    }),
    [catChips, users, channels],
  );

  return (
    <Box>
      <Stack direction="row" gap={0.75} alignItems="center" flexWrap="wrap" sx={{ mb: "12px" }}>
        <Box sx={{ flex: "1 1 320px", minWidth: 260 }}>
          {sqlMode ? (
            <SqlEditor
              value={queryText}
              onChange={setQueryText}
              placeholder={t("audit.sqlPlaceholder", {
                defaultValue: "SELECT ... FROM audit_entries WHERE ...",
              })}
            />
          ) : (
            <QueryAutocomplete
              value={queryText}
              onChange={setQueryText}
              onCommit={(text: string) => {
                if (isSqlQuery(text)) return;
                try {
                  setFilters(parseAuditQuery(text));
                  setParseError(null);
                } catch (e) {
                  setParseError(e instanceof AuditQueryError ? e.message : String(e));
                }
              }}
              onRun={() => void run()}
              context={suggestContext}
              placeholder={t("audit.queryPlaceholder", {
                defaultValue: advancedSqlAvailable
                  ? "category ~ kick and ts > now-7d   (or start with SELECT for SQL)"
                  : "category ~ kick and ts > now-7d",
              })}
            />
          )}
        </Box>
        <Button
          size="small"
          variant="contained"
          disabled={loading}
          data-testid={TID.auditRunQuery}
          startIcon={<SearchIcon width={13} height={13} />}
          onClick={() => void run()}
        >
          {loading
            ? t("audit.searching", { defaultValue: "Searching…" })
            : t("audit.search", { defaultValue: "Search" })}
        </Button>
        <Button
          size="small"
          variant={live ? "contained" : "outlined"}
          color={live ? "success" : "primary"}
          data-testid={TID.auditLiveToggle}
          title={t("audit.liveTailHelp", { defaultValue: "Stream new matching entries as they happen" })}
          startIcon={<StatusDot status={live ? "online" : "offline"} />}
          onClick={() => void setLive(!live)}
        >
          {t("audit.liveTail", { defaultValue: "Live" })}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={entries.length === 0}
          startIcon={<DownloadIcon width={13} height={13} />}
          onClick={() => download("audit-log.csv", "text/csv", toCsv(entries))}
        >
          CSV
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={entries.length === 0}
          startIcon={<DownloadIcon width={13} height={13} />}
          onClick={() => download("audit-log.json", "application/json", JSON.stringify(entries, null, 2))}
        >
          JSON
        </Button>
      </Stack>

      {(parseError ?? serverError) && (
        <Box data-testid={TID.auditQueryError}>
          <Banner tone="danger">{parseError ?? serverError}</Banner>
        </Box>
      )}

      <Stack direction="row" gap={1.5} alignItems="flex-start">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {view === "dashboard" ? (
            <AuditDashboard entries={entries} hasMore={hasMore} />
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
              page={pageIndex}
              onPageChange={setPageIndex}
            />
          )}
        </Box>

        {/* Pills cannot express SQL, so the rail has nothing to say in SQL mode. */}
        {!sqlMode && (
          <AuditFilterRail
            open={railOpen}
            onToggle={() =>
              setRailOpen((open) => {
                writeBoolPref(PREF_RAIL_OPEN, !open);
                return !open;
              })
            }
            filters={filters}
            onChange={updateFilters}
            categories={catChips}
            endless={endless}
            onEndlessChange={(next) => {
              writeBoolPref(PREF_ENDLESS, next);
              setEndless(next);
              setPageIndex(0);
            }}
          />
        )}
      </Stack>
    </Box>
  );
}

/** KPI tiles and charts, all scoped to the currently loaded result set. */
function AuditDashboard({
  entries,
  hasMore,
}: Readonly<{ entries: readonly AuditEntry[]; hasMore: boolean }>) {
  const { t } = useTranslation("settings");
  const theme = useTheme();
  const { nebula } = theme.palette;

  const dayAgo = Date.now() - 86_400_000;
  const kpis = useMemo(() => {
    const actors = new Set(
      entries
        .map((entry) => entry.actorHash ?? entry.actorName ?? String(entry.actorUserId ?? ""))
        .filter(Boolean),
    );
    return {
      total: entries.length,
      last24h: entries.filter((entry) => entry.ts >= dayAgo).length,
      flagged: entries.filter((entry) => entry.severity === "warning" || entry.severity === "critical")
        .length,
      reports: entries.filter((entry) => entry.category === "signal.report").length,
      distinctActors: actors.size,
    };
  }, [entries, dayAgo]);

  const charts = useMemo(() => {
    // Chart.js paints to a canvas and cannot inherit the theme through CSS, so
    // every colour here is read off the palette rather than hard-coded.
    const series = [nebula.accent, nebula.ok, "#d55181", nebula.warn, "#199e70", nebula.bad];
    const tick = { color: nebula.muted };
    const grid = { color: nebula.line2 };
    const severityColour: Record<string, string> = {
      info: nebula.accent,
      notice: nebula.ok,
      warning: nebula.warn,
      critical: nebula.bad,
    };

    const time = timeSeries(entries);
    const categories = categoryBreakdown(entries, 5);
    const bySeverity = new Map<string, number>();
    for (const entry of entries) {
      const key = entry.severity || "info";
      bySeverity.set(key, (bySeverity.get(key) ?? 0) + 1);
    }
    const severities = ["info", "notice", "warning", "critical"].filter((key) => bySeverity.has(key));

    return [
      {
        title: t("audit.chartOverTime", { defaultValue: "Events over time" }),
        config: {
          type: "bar",
          data: {
            labels: time.labels,
            datasets: [
              {
                data: time.counts,
                backgroundColor: nebula.accent,
                borderRadius: NEBULA_RADIUS.sm,
                maxBarThickness: 18,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { intersect: false } },
            scales: {
              x: { ticks: { ...tick, maxTicksLimit: 8 }, grid: { display: false } },
              y: { ticks: { ...tick, precision: 0 }, grid },
            },
          },
        },
      },
      {
        title: t("audit.chartByCategory", { defaultValue: "By category" }),
        config: {
          type: "bar",
          data: {
            labels: categories.labels,
            datasets: [
              {
                data: categories.counts,
                backgroundColor: categories.labels.map((_, index) => series[index % series.length]),
                borderRadius: NEBULA_RADIUS.sm,
                maxBarThickness: 16,
              },
            ],
          },
          options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { ...tick, precision: 0 }, grid },
              y: { ticks: tick, grid: { display: false } },
            },
          },
        },
      },
      {
        title: t("audit.chartBySeverity", { defaultValue: "By severity" }),
        config: {
          type: "doughnut",
          data: {
            labels: severities,
            datasets: [
              {
                data: severities.map((key) => bySeverity.get(key) ?? 0),
                backgroundColor: severities.map((key) => severityColour[key]),
                borderColor: nebula.bg0,
                borderWidth: 2,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: true, position: "bottom", labels: { color: nebula.muted, boxWidth: 12 } },
            },
          },
        },
      },
    ];
  }, [entries, nebula, t]);

  const tiles = [
    { value: String(kpis.last24h), label: t("audit.kpiActions24h", { defaultValue: "Actions (24h)" }) },
    { value: String(kpis.flagged), label: t("audit.kpiFlagged", { defaultValue: "Warnings & critical" }) },
    { value: String(kpis.reports), label: t("audit.kpiReports", { defaultValue: "User reports" }) },
    { value: String(kpis.distinctActors), label: t("audit.kpiActors", { defaultValue: "Distinct actors" }) },
    {
      // A "+" because the count is of what has been *loaded*, and the server
      // is still holding more that this figure does not include.
      value: `${kpis.total}${hasMore ? "+" : ""}`,
      label: t("audit.kpiLoaded", { defaultValue: "Entries loaded" }),
      sub: t("audit.kpiScope", { defaultValue: "in current results" }),
    },
  ];

  return (
    <>
      <Stack direction="row" gap={1} flexWrap="wrap" data-testid={TID.auditKpiRow}>
        {tiles.map((tile) => (
          <SettingsCard key={tile.label} sx={{ flex: "1 1 120px", p: "12px 14px" }}>
            <Typography sx={{ fontSize: 18, fontWeight: 600 }}>{tile.value}</Typography>
            <Typography sx={(t2) => ({ fontSize: 10.5, color: t2.palette.nebula.muted })}>
              {tile.label}
            </Typography>
            {tile.sub && (
              <Typography sx={(t2) => ({ fontSize: 10, color: t2.palette.nebula.dim })}>
                {tile.sub}
              </Typography>
            )}
          </SettingsCard>
        ))}
      </Stack>

      {entries.length > 0 ? (
        <Stack direction="row" gap={1.25} flexWrap="wrap" sx={{ mt: "14px" }}>
          {charts.map((chart) => (
            <SettingsCard key={chart.title} sx={{ flex: "1 1 260px", minWidth: 240 }}>
              <Typography sx={{ fontSize: 11.5, fontWeight: 600, mb: "8px" }}>{chart.title}</Typography>
              <Box sx={{ height: 180 }}>
                <DashboardChart config={chart.config} ariaLabel={chart.title} />
              </Box>
            </SettingsCard>
          ))}
        </Stack>
      ) : (
        <Box sx={{ mt: "14px" }}>
          <EmptyState>
            {t("audit.noEntries", { defaultValue: "No entries. Run a search, or wait for the live tail." })}
          </EmptyState>
        </Box>
      )}
    </>
  );
}

/** A severity or source word, coloured but never colour alone. */
function AuditBadge({ value, kind }: Readonly<{ value: string; kind: "severity" | "source" }>) {
  return (
    <Box
      component="span"
      sx={(theme) => {
        const { nebula } = theme.palette;
        const colour =
          kind === "severity"
            ? ({ critical: nebula.bad, warning: nebula.warn, notice: nebula.ok, info: nebula.accent }[
                value
              ] ?? nebula.accent)
            : ({ client: nebula.accent, plugin: nebula.warn }[value] ?? nebula.muted);
        return {
          px: "7px",
          py: "2px",
          borderRadius: "999px",
          fontSize: 10,
          fontWeight: 600,
          color: colour,
          border: `1px solid ${colour}`,
          whiteSpace: "nowrap",
        };
      }}
    >
      {value}
    </Box>
  );
}

/** The results table, plus the detail panel for the selected row. */
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
}: Readonly<{
  entries: readonly AuditEntry[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  selected: AuditEntry | null;
  onSelect: (entry: AuditEntry | null) => void;
  channelName: (id?: number) => string | undefined;
  endless: boolean;
  page: number;
  onPageChange: (page: number) => void;
}>) {
  const { t } = useTranslation("settings");

  // Pagination slices the already-loaded buffer; running past its end pulls
  // the next keyset page from the server.
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const atLastPage = page >= pageCount - 1;
  const visible = endless ? entries : entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!endless || !hasMore || loadingMore) return;
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) onLoadMore();
  };

  const noReason = (
    <Box component="span" sx={(theme) => ({ color: theme.palette.nebula.dim, fontStyle: "italic" })}>
      {t("audit.noReason", { defaultValue: "no reason given" })}
    </Box>
  );

  const HEADERS = [
    t("audit.colTime", { defaultValue: "Time" }),
    t("audit.colSeverity", { defaultValue: "Severity" }),
    t("audit.colSource", { defaultValue: "Source" }),
    t("audit.colCategory", { defaultValue: "Category" }),
    t("audit.colActor", { defaultValue: "Actor" }),
    t("audit.colTarget", { defaultValue: "Target" }),
    t("audit.colChannel", { defaultValue: "Channel" }),
    t("audit.colReason", { defaultValue: "Reason" }),
  ];

  return (
    <>
      {selected && (
        <SettingsCard sx={{ mb: "12px" }} testId={TID.auditDetailDrawer}>
          <Stack direction="row" alignItems="center" gap={0.75} sx={{ mb: "10px" }}>
            <AuditBadge value={selected.severity} kind="severity" />
            <AuditBadge value={selected.source} kind="source" />
            <Typography sx={{ flex: 1, fontSize: 12.5, fontWeight: 600 }} noWrap>
              #{selected.id} · {selected.category}
            </Typography>
            <Button size="small" onClick={() => onSelect(null)}>
              {t("audit.close", { defaultValue: "Close" })}
            </Button>
          </Stack>

          <Box sx={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "4px 12px", fontSize: 11.5 }}>
            <DetailKey>{t("audit.colTime", { defaultValue: "Time" })}</DetailKey>
            <span>{fmtTime(selected.ts)}</span>
            <DetailKey>{t("audit.colActor", { defaultValue: "Actor" })}</DetailKey>
            <span>
              {selected.actorName ?? "-"}
              {selected.actorUserId != null ? ` (#${selected.actorUserId})` : ""}
            </span>
            <DetailKey>{t("audit.colTarget", { defaultValue: "Target" })}</DetailKey>
            <span>
              {selected.targetName ?? "-"}
              {selected.targetUserId != null ? ` (#${selected.targetUserId})` : ""}
            </span>
            <DetailKey>{t("audit.colChannel", { defaultValue: "Channel" })}</DetailKey>
            <span>
              {selected.channelId != null
                ? (channelName(selected.channelId) ?? `#${selected.channelId}`)
                : "-"}
            </span>
            <DetailKey>{t("audit.colReason", { defaultValue: "Reason" })}</DetailKey>
            <span>{selected.reason || noReason}</span>
            {selected.relatesTo != null && (
              <>
                <DetailKey>{t("audit.relatesTo", { defaultValue: "Related entry" })}</DetailKey>
                <span>#{selected.relatesTo}</span>
              </>
            )}
          </Box>

          {selected.detailJson && (
            <Box
              component="pre"
              sx={(theme) => ({
                mt: "10px",
                p: "10px",
                borderRadius: radius("md"),
                maxHeight: 220,
                overflow: "auto",
                fontFamily: NEBULA_MONO,
                fontSize: 10.5,
                background: theme.palette.nebula.card2,
              })}
            >
              {(() => {
                // Pretty-printed when it parses; shown verbatim when it does
                // not, because an unparseable detail is still evidence.
                try {
                  return JSON.stringify(JSON.parse(selected.detailJson), null, 2);
                } catch {
                  return selected.detailJson;
                }
              })()}
            </Box>
          )}
          {selected.entryHash && (
            <Typography
              sx={(theme) => ({
                mt: "8px",
                fontFamily: NEBULA_MONO,
                fontSize: 10,
                color: theme.palette.nebula.dim,
                wordBreak: "break-all",
              })}
            >
              chain: {selected.entryHash}
            </Typography>
          )}
        </SettingsCard>
      )}

      <TableContainer
        onScroll={onScroll}
        sx={(theme) => ({
          maxHeight: "52vh",
          overflow: "auto",
          borderRadius: radius("lg"),
          background: theme.palette.nebula.card,
          border: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        <Table
          stickyHeader
          size="small"
          data-testid={TID.auditTable}
          sx={{ fontSize: 11.5, borderSpacing: 0 }}
        >
          <TableHead>
            <TableRow>
              {HEADERS.map((header) => (
                <TableCell
                  key={header}
                  sx={(theme) => ({
                    px: "10px",
                    py: "8px",
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    color: theme.palette.nebula.dim,
                    background: theme.palette.nebula.bg0,
                    borderBottom: `1px solid ${theme.palette.nebula.line2}`,
                  })}
                >
                  {header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  sx={(theme) => ({
                    px: "12px",
                    py: "26px",
                    textAlign: "center",
                    border: "none",
                    color: theme.palette.nebula.muted,
                  })}
                >
                  {loading || loadingMore
                    ? t("audit.loading", { defaultValue: "Loading…" })
                    : t("audit.noEntries", {
                        defaultValue: "No entries. Run a search, or wait for the live tail.",
                      })}
                </TableCell>
              </TableRow>
            )}
            {visible.map((entry) => (
              <TableRow
                key={entry.id}
                selected={selected?.id === entry.id}
                data-testid={TID.auditRow}
                data-entry-id={entry.id}
                onClick={() => onSelect(entry)}
                sx={(theme) => ({
                  cursor: "pointer",
                  "&.Mui-selected, &.Mui-selected:hover": {
                    background: theme.palette.nebula.accentSoft,
                  },
                  "&:hover": { background: theme.palette.nebula.hover },
                })}
              >
                <Cell sx={{ whiteSpace: "nowrap" }}>{fmtTime(entry.ts)}</Cell>
                <Cell>
                  <AuditBadge value={entry.severity} kind="severity" />
                </Cell>
                <Cell>
                  <AuditBadge value={entry.source} kind="source" />
                </Cell>
                <Cell>{entry.category}</Cell>
                <Cell>{entry.actorName ?? (entry.actorUserId != null ? `#${entry.actorUserId}` : "-")}</Cell>
                <Cell>
                  {entry.targetName ?? (entry.targetUserId != null ? `#${entry.targetUserId}` : "-")}
                </Cell>
                <Cell>
                  {entry.channelId != null ? (channelName(entry.channelId) ?? `#${entry.channelId}`) : "-"}
                </Cell>
                <Cell sx={{ maxWidth: 220 }}>{entry.reason || noReason}</Cell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" alignItems="center" gap={1.5} sx={{ mt: "10px" }} flexWrap="wrap">
        {endless ? (
          <>
            {/* A fallback for when the table is too short to scroll at all. */}
            {hasMore && (
              <Button
                size="small"
                variant="outlined"
                disabled={loadingMore}
                startIcon={<RefreshCwIcon width={13} height={13} />}
                onClick={onLoadMore}
              >
                {loadingMore
                  ? t("audit.loading", { defaultValue: "Loading…" })
                  : t("audit.loadMore", { defaultValue: "Load more" })}
              </Button>
            )}
            {!hasMore && entries.length > 0 && (
              <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
                {t("audit.endOfResults", { defaultValue: "End of results" })}
              </Typography>
            )}
          </>
        ) : (
          <Stack direction="row" alignItems="center" gap={1}>
            <Button
              size="small"
              variant="outlined"
              disabled={page === 0}
              data-testid={TID.auditPagePrev}
              startIcon={<ChevronLeftIcon width={13} height={13} />}
              onClick={() => onPageChange(page - 1)}
            >
              {t("audit.prevPage", { defaultValue: "Previous" })}
            </Button>
            <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
              {t("audit.pageOf", {
                defaultValue: "Page {{page}} of {{pages}}",
                page: page + 1,
                pages: pageCount,
              })}
              {hasMore ? "+" : ""}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              disabled={atLastPage && !hasMore}
              data-testid={TID.auditPageNext}
              endIcon={<ChevronRightIcon width={13} height={13} />}
              onClick={() => {
                if (!atLastPage) onPageChange(page + 1);
                else if (hasMore) {
                  onLoadMore();
                  onPageChange(page + 1);
                }
              }}
            >
              {t("audit.nextPage", { defaultValue: "Next" })}
            </Button>
          </Stack>
        )}
        <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
          {t("audit.countNote", { defaultValue: "{{count}} entries loaded", count: entries.length })}
        </Typography>
      </Stack>
    </>
  );
}

function DetailKey({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box component="span" sx={(theme) => ({ color: theme.palette.nebula.muted })}>
      {children}
    </Box>
  );
}

function Cell({ children, sx }: Readonly<{ children: React.ReactNode; sx?: object }>) {
  return (
    <TableCell
      sx={(theme) => ({
        px: "10px",
        py: "7px",
        // The rule sits on top of each row, so the last one ends on the card
        // rather than on a line; MUI's own bottom border would double it.
        borderTop: `1px solid ${theme.palette.nebula.line}`,
        borderBottom: "none",
        color: theme.palette.nebula.text,
        overflow: "hidden",
        textOverflow: "ellipsis",
        ...sx,
      })}
    >
      {children}
    </TableCell>
  );
}

/**
 * The collapsible rail of point-and-click filters.
 *
 * Every control writes back through `onChange`, which re-serialises the
 * canonical query text and runs the query straight away - so the rail and the
 * search box can never drift apart, and results update as you click.
 */
function AuditFilterRail({
  open,
  onToggle,
  filters,
  onChange,
  categories,
  endless,
  onEndlessChange,
}: Readonly<{
  open: boolean;
  onToggle: () => void;
  filters: AuditFilterState;
  onChange: (patch: Partial<AuditFilterState>, immediate?: boolean) => void;
  categories: readonly string[];
  endless: boolean;
  onEndlessChange: (endless: boolean) => void;
}>) {
  const { t } = useTranslation("settings");
  return (
    <Box
      data-open={open}
      data-testid={TID.auditFilterRail}
      sx={(theme) => ({
        flex: "none",
        width: open ? 220 : 40,
        transition: "width .15s",
        p: "8px",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      <Stack direction="row" alignItems="center" sx={{ mb: open ? "8px" : 0 }}>
        {open && (
          <Typography sx={{ flex: 1, fontSize: 11.5, fontWeight: 600 }}>
            {t("audit.quickFilters", { defaultValue: "Quick filters" })}
          </Typography>
        )}
        <IconButton
          size="small"
          data-testid={TID.auditFilterRailToggle}
          aria-expanded={open}
          title={
            open
              ? t("audit.collapseFilters", { defaultValue: "Collapse quick filters" })
              : t("audit.expandFilters", { defaultValue: "Expand quick filters" })
          }
          onClick={onToggle}
        >
          {open ? <ChevronRightIcon width={14} height={14} /> : <ChevronLeftIcon width={14} height={14} />}
        </IconButton>
      </Stack>

      {open && (
        <Stack gap={1}>
          <RailSelect
            label={t("audit.filterSince", { defaultValue: "Since" })}
            value={filters.since}
            onChange={(since) => onChange({ since })}
            options={SINCE_OPTIONS.map((option) => ({
              value: option,
              label: option === "" ? t("audit.sinceAll", { defaultValue: "all time" }) : option,
            }))}
          />
          <RailSelect
            label={t("audit.filterSource", { defaultValue: "Source" })}
            value={filters.source}
            onChange={(source) => onChange({ source })}
            options={[
              { value: "", label: t("audit.any", { defaultValue: "any" }) },
              { value: "server", label: "server" },
              { value: "client", label: "client" },
              { value: "plugin", label: "plugin" },
            ]}
          />
          <RailSelect
            label={t("audit.filterSeverity", { defaultValue: "Severity" })}
            value={filters.severity}
            onChange={(severity) => onChange({ severity })}
            options={[
              { value: "", label: t("audit.any", { defaultValue: "any" }) },
              { value: "info", label: "info" },
              { value: "notice", label: "notice" },
              { value: "warning", label: "warning" },
              { value: "critical", label: "critical" },
            ]}
          />

          <Field label={t("audit.filterActor", { defaultValue: "Actor" })}>
            <TextField
              fullWidth
              size="small"
              value={filters.actor}
              placeholder={t("audit.userPlaceholder", { defaultValue: "name or id" })}
              onChange={(event) => onChange({ actor: event.target.value }, false)}
              slotProps={{ htmlInput: { "aria-label": t("audit.filterActor", { defaultValue: "Actor" }) } }}
            />
          </Field>
          <Field label={t("audit.filterTarget", { defaultValue: "Target" })}>
            <TextField
              fullWidth
              size="small"
              value={filters.target}
              placeholder={t("audit.userPlaceholder", { defaultValue: "name or id" })}
              onChange={(event) => onChange({ target: event.target.value }, false)}
              slotProps={{
                htmlInput: { "aria-label": t("audit.filterTarget", { defaultValue: "Target" }) },
              }}
            />
          </Field>
          <Field label={t("audit.filterText", { defaultValue: "Text" })}>
            <TextField
              fullWidth
              size="small"
              value={filters.text}
              onChange={(event) => onChange({ text: event.target.value }, false)}
              slotProps={{ htmlInput: { "aria-label": t("audit.filterText", { defaultValue: "Text" }) } }}
            />
          </Field>

          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 600, mb: "6px" }}>
              {t("audit.filterCategory", { defaultValue: "Categories" })}
            </Typography>
            <Stack direction="row" gap={0.375} flexWrap="wrap">
              {categories.map((category) => {
                const on = filters.categories.includes(category);
                return (
                  <Box
                    key={category}
                    component="button"
                    aria-pressed={on}
                    onClick={() =>
                      onChange({
                        categories: on
                          ? filters.categories.filter((entry) => entry !== category)
                          : [...filters.categories, category],
                      })
                    }
                    sx={(theme) => ({
                      all: "unset",
                      cursor: "pointer",
                      px: "7px",
                      py: "2px",
                      borderRadius: "999px",
                      fontSize: 9.5,
                      color: on ? theme.palette.nebula.text : theme.palette.nebula.dim,
                      background: on ? theme.palette.nebula.accentSoft : "transparent",
                      border: `1px solid ${on ? theme.palette.nebula.accentLine : theme.palette.nebula.line2}`,
                    })}
                  >
                    {category}
                  </Box>
                );
              })}
            </Stack>
          </Box>

          <Box sx={(theme) => ({ borderTop: `1px solid ${theme.palette.nebula.line}`, pt: "8px" })}>
            <Typography sx={{ fontSize: 11, fontWeight: 600, mb: "4px" }}>
              {t("audit.resultsLabel", { defaultValue: "Results" })}
            </Typography>
            <Stack direction="row" alignItems="center" gap={0.75}>
              <Switch
                checked={endless}
                onChange={() => onEndlessChange(!endless)}
                slotProps={{
                  input: {
                    "aria-label": t("audit.endlessScroll", { defaultValue: "Endless scrolling" }),
                    "data-testid": TID.auditEndlessToggle,
                  } as InputHTMLAttributes<HTMLInputElement>,
                }}
              />
              <Typography sx={{ fontSize: 11 }}>
                {t("audit.endlessScroll", { defaultValue: "Endless scrolling" })}
              </Typography>
            </Stack>
            <Typography sx={(theme) => ({ mt: "3px", fontSize: 10, color: theme.palette.nebula.dim })}>
              {endless
                ? t("audit.endlessOn", { defaultValue: "Loads more as you scroll." })
                : t("audit.endlessOff", { defaultValue: "Paged, 25 rows at a time." })}
            </Typography>
          </Box>
        </Stack>
      )}
    </Box>
  );
}

function RailSelect({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}>) {
  return (
    <Field label={label}>
      <TextField
        select
        fullWidth
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{ htmlInput: { "aria-label": label } }}
      >
        {options.map((option) => (
          <MenuItem key={option.value || "any"} value={option.value}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
    </Field>
  );
}

/**
 * Configuration: the chain status, and the schema-driven toggle matrix.
 *
 * Schema-driven exactly like the runtime server settings, so the audit plugin
 * owns which parts exist. Turning a part off stops new entries but never
 * deletes history - deletion happens only through the retention policy - and
 * every change here is itself an audit entry.
 */
function AuditConfig() {
  const { t } = useTranslation("settings");
  const config = useAuditStore((state) => state.config);
  const busy = useAuditStore((state) => state.configBusy);
  const configError = useAuditStore((state) => state.configError);
  const chain = useAuditStore((state) => state.chain);
  const saveConfig = useAuditStore((state) => state.saveConfig);
  const verifyChain = useAuditStore((state) => state.verifyChain);

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState(0);

  // A fresh snapshot - the server's re-broadcast after a save - supersedes
  // anything typed against the old one.
  const revision = config?.revision ?? -1;
  useEffect(() => setEdits({}), [revision]);

  const groups = useMemo(() => {
    const map = new Map<string, ServerSetting[]>();
    for (const setting of config?.settings ?? []) {
      const list = map.get(setting.group) ?? [];
      list.push(setting);
      map.set(setting.group, list);
    }
    return [...map.entries()];
  }, [config]);

  if (!config) {
    return (
      <EmptyState>
        {t("audit.configUnavailable", {
          defaultValue:
            "Audit configuration isn't available. This server may not run the audit plugin, or you may not have permission to configure it.",
        })}
      </EmptyState>
    );
  }

  const changed: ServerSetting[] = config.settings
    .filter((setting) => setting.key in edits && (edits[setting.key] ?? "") !== (setting.value ?? ""))
    .map((setting) => ({ ...setting, value: edits[setting.key] ?? "" }));

  const save = async () => {
    try {
      await saveConfig(changed);
      setEdits({});
      setSavedAt(Date.now());
    } catch {
      // The store already holds the error.
    }
  };

  return (
    <Box sx={{ maxWidth: 720 }}>
      <Typography sx={(theme) => ({ mb: "14px", fontSize: 11.5, color: theme.palette.nebula.muted })}>
        {t("audit.configIntro", {
          defaultValue:
            "Every part is an independent switch. Turning a part off stops new entries but never deletes history - deletion only happens through the retention policy, and every change here is itself an audit entry.",
        })}
      </Typography>

      <SettingsCard testId={TID.auditChainCard}>
        <Stack direction="row" alignItems="center" gap={1.25} flexWrap="wrap">
          <ShieldCheckIcon width={16} height={16} />
          <Typography sx={{ fontSize: 12 }}>
            {t("audit.chainHeight", {
              defaultValue: "Hash chain: {{height}} entries",
              height: chain.height ?? config.chainHeight,
            })}
          </Typography>
          {chain.ok != null && (
            <Typography
              sx={(theme) => ({
                flex: 1,
                fontSize: 11.5,
                fontWeight: 600,
                color: chain.ok ? theme.palette.nebula.ok : theme.palette.nebula.bad,
              })}
            >
              {chain.ok
                ? t("audit.chainOk", { defaultValue: "verified - no tampering detected" })
                : t("audit.chainBad", { defaultValue: "BROKEN: {{error}}", error: chain.error ?? "?" })}
            </Typography>
          )}
          <Button
            size="small"
            variant="outlined"
            sx={{ ml: "auto" }}
            disabled={chain.verifying}
            data-testid={TID.auditVerifyChain}
            onClick={() => void verifyChain()}
          >
            {chain.verifying
              ? t("audit.verifying", { defaultValue: "Verifying…" })
              : t("audit.verify", { defaultValue: "Verify chain" })}
          </Button>
        </Stack>
      </SettingsCard>

      {groups.map(([group, items]) => (
        <Box key={group}>
          <GroupTitle>{group}</GroupTitle>
          <Stack gap={0.75}>
            {items.map((setting) => (
              <Stack
                key={setting.key}
                direction="row"
                alignItems="center"
                gap={2}
                sx={(theme) => ({ py: "8px", borderBottom: `1px solid ${theme.palette.nebula.line}` })}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                    {setting.label || setting.key}
                  </Typography>
                  {setting.help && (
                    <Typography
                      sx={(theme) => ({
                        mt: "2px",
                        fontSize: 11,
                        lineHeight: 1.5,
                        color: theme.palette.nebula.muted,
                      })}
                    >
                      {setting.help}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ flex: "none", width: setting.type === "bool" ? "auto" : 200 }}>
                  <AuditSettingField
                    setting={setting}
                    value={edits[setting.key] ?? setting.value ?? ""}
                    onChange={(value) => setEdits((prev) => ({ ...prev, [setting.key]: value }))}
                  />
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>
      ))}

      <Stack direction="row" alignItems="center" gap={1.5} sx={{ mt: "18px" }}>
        {configError && <Banner tone="danger">{configError}</Banner>}
        {!configError && savedAt > 0 && changed.length === 0 && (
          <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.ok })}>
            {t("audit.saved", { defaultValue: "Saved" })}
          </Typography>
        )}
        <Button
          size="small"
          variant="contained"
          sx={{ ml: "auto" }}
          disabled={busy || changed.length === 0}
          data-testid={TID.auditConfigSave}
          onClick={() => void save()}
        >
          {busy
            ? t("audit.saving", { defaultValue: "Saving…" })
            : t("audit.saveChanges", { defaultValue: "Save changes" })}
          {changed.length > 0 ? ` (${changed.length})` : ""}
        </Button>
      </Stack>
    </Box>
  );
}

/** The control for one audit setting, chosen by its declared type. */
function AuditSettingField({
  setting,
  value,
  onChange,
}: Readonly<{ setting: ServerSetting; value: string; onChange: (value: string) => void }>) {
  const label = setting.label || setting.key;
  // The E2E suites address a setting by this attribute, so it has to reach the
  // real control rather than a wrapper.
  const hook = { "data-audit-setting": setting.key };

  if (setting.type === "bool") {
    const checked = value === "true" || value === "1";
    return (
      <Switch
        checked={checked}
        onChange={() => onChange(checked ? "false" : "true")}
        slotProps={{
          input: { "aria-label": label, ...hook } as InputHTMLAttributes<HTMLInputElement>,
        }}
      />
    );
  }

  if (setting.type === "enum") {
    return (
      <TextField
        select
        fullWidth
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{ htmlInput: { "aria-label": label, ...hook } }}
      >
        {/* A value the server sent that is not in its own option list is still
            the current value; dropping it would silently rewrite the setting. */}
        {!setting.options.includes(value) && value !== "" && <MenuItem value={value}>{value}</MenuItem>}
        {setting.options.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  return (
    <TextField
      fullWidth
      size="small"
      type={setting.type === "int" ? "number" : setting.type === "password" ? "password" : "text"}
      value={value}
      // A secret is never sent back by the server, so an empty box means
      // "unchanged" rather than "empty".
      placeholder={setting.type === "password" && setting.secret ? "•••••••• (unchanged)" : ""}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{
        htmlInput: {
          "aria-label": label,
          ...hook,
          ...(setting.type === "password" ? { autoComplete: "new-password" } : {}),
        },
      }}
    />
  );
}
