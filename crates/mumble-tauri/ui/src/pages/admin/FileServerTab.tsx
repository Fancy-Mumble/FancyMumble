/**
 * FileServerTab - the admin "File server" dashboard.
 *
 * Lists every file the server is storing with storage stats + charts, a
 * sortable / fuzzy-searchable table, inline previews for common types, and a
 * delete action.  All data flows through the Tauri proxy commands (the
 * file-server origin is cross-origin to the webview).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { message, confirm as askConfirm } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../../store";
import { formatBytes } from "../../utils/format";
import { fuzzyMatchAny } from "../../utils/fuzzy";
import UserHoverCard from "../../components/sidebar/user/UserHoverCard";
import type { AdminFileEntry, DocumentSummary, FileServerStorageStats, UserEntry } from "../../types";
import {
  RefreshCwIcon, TrashIcon, SearchIcon, ImageIcon, DatabaseIcon,
} from "../../icons";
import {
  adminListFiles, adminDeleteFile, adminListDocuments, adminDeleteDocument,
  adminListCalendars,
  categorize, isPreviewable, makeAdminFilesSource,
  dropPreview, checkFileServerHealth,
  type AdminCreds, type CalendarUsageEntry, type FileCategory, type FileServerHealth,
} from "./fileServerAdmin";
import { CategoryIcon, FileThumb, PreviewModal, ExpiryBadge } from "../../components/fileserver/FilePreview";
import DashboardChart from "./DashboardChart";
import { DocumentsSection } from "./DocumentsSection";
import panel from "./AdminPanel.module.css";
import styles from "./FileServerTab.module.css";

const PALETTE = ["#2aabee", "#8a5cf6", "#f0428a", "#38b27a", "#e0892f", "#e0533c", "#3c8be0"];
const CATEGORIES: FileCategory[] = ["image", "video", "audio", "document", "archive", "other"];

type SortKey = "name" | "type" | "size" | "access" | "channel" | "owner" | "uploaded" | "expires";
type SortDir = "asc" | "desc";

/** Resolve a file's uploader to a currently-connected user.  Prefers the stable
 *  registered user id (which survives certificate regeneration across sessions)
 *  and falls back to the cert hash for unregistered/legacy uploads. */
function matchUploader(
  file: AdminFileEntry,
  connectedById: Map<number, UserEntry>,
  connectedByHash: Map<string, UserEntry>,
): UserEntry | undefined {
  if (file.uploader_user_id != null) {
    const byId = connectedById.get(file.uploader_user_id);
    if (byId) return byId;
  }
  return file.uploader_cert_hash ? connectedByHash.get(file.uploader_cert_hash) : undefined;
}

/** Owner cell: the uploader's name, with the shared live profile card on
 *  hover when they are currently connected (matched by stable user id, then
 *  cert hash). */
function OwnerCell({
  file,
  connectedById,
  connectedByHash,
}: {
  file: AdminFileEntry;
  connectedById: Map<number, UserEntry>;
  connectedByHash: Map<string, UserEntry>;
}) {
  const { t } = useTranslation("settings");
  const entry = matchUploader(file, connectedById, connectedByHash);
  const name = entry?.name ?? file.uploader_name;
  const online = file.uploader_online || entry != null;
  return (
    <span className={styles.ownerCell}>
      <span className={`${styles.ownerDot} ${online ? styles.online : styles.offline}`} title={online ? t("fileServer.online", { defaultValue: "Uploader online" }) : t("fileServer.offline", { defaultValue: "Uploader offline" })} />
      {entry ? (
        <UserHoverCard user={entry} />
      ) : name ? (
        <span className={styles.ownerName} title={file.uploader_cert_hash ?? undefined}>{name}</span>
      ) : (
        <span className={styles.ownerUnknown} title={file.uploader_cert_hash ?? undefined}>
          {file.uploader_cert_hash ? file.uploader_cert_hash.slice(0, 10) : t("fileServer.unknownOwner", { defaultValue: "Unknown" })}
        </span>
      )}
    </span>
  );
}

/** One headline stat card. */
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

export function FileServerTab() {
  const { t } = useTranslation("settings");
  const config = useAppStore((s) => s.fileServerConfig);
  const channels = useAppStore((s) => s.channels);
  const users = useAppStore((s) => s.users);
  const creds: AdminCreds | null = config ? { baseUrl: config.baseUrl, sessionJwt: config.sessionJwt } : null;

  // Maps of stable user id / cert hash -> connected user, so a file's uploader
  // can show that user's live profile card on hover.  The user id is preferred
  // because the cert hash changes between sessions.
  const connectedByHash = useMemo(() => {
    const m = new Map<string, UserEntry>();
    for (const u of users) if (u.hash) m.set(u.hash, u);
    return m;
  }, [users]);
  const connectedById = useMemo(() => {
    const m = new Map<number, UserEntry>();
    for (const u of users) if (u.user_id != null) m.set(u.user_id, u);
    return m;
  }, [users]);
  const ownerLabel = useCallback(
    (f: AdminFileEntry) => matchUploader(f, connectedById, connectedByHash)?.name ?? f.uploader_name ?? "",
    [connectedById, connectedByHash],
  );

  // Tell the store this dashboard is mounted, so a runtime disable of the
  // file-server plugin can prompt the admin before tearing the view down.
  const setFileServerAdminOpen = useAppStore((s) => s.setFileServerAdminOpen);
  useEffect(() => {
    setFileServerAdminOpen(true);
    return () => setFileServerAdminOpen(false);
  }, [setFileServerAdminOpen]);

  const [files, setFiles] = useState<AdminFileEntry[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [calendars, setCalendars] = useState<CalendarUsageEntry[]>([]);
  const [stats, setStats] = useState<FileServerStorageStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "uploaded", dir: "desc" });
  const [preview, setPreview] = useState<AdminFileEntry | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Bulk selection across both files (`file:<id>`) and documents (`doc:<name>`).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const docOwnerLabel = useCallback(
    (d: DocumentSummary) =>
      (d.owner_cert_hash ? connectedByHash.get(d.owner_cert_hash)?.name : undefined) ?? d.owner_name ?? "",
    [connectedByHash],
  );

  const channelName = useCallback(
    (id: number) => channels.find((c) => c.id === id)?.name ?? `#${id}`,
    [channels],
  );

  const refresh = useCallback(async () => {
    if (!creds) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      // Fetch files and documents together; a failure in the (optional)
      // documents list must not blank the whole dashboard, so it is tolerated.
      const [filesRes, docsRes, calsRes] = await Promise.allSettled([
        adminListFiles(creds),
        adminListDocuments(creds),
        adminListCalendars(creds),
      ]);
      if (filesRes.status === "fulfilled") {
        setFiles(filesRes.value.files);
        setStats(filesRes.value.stats);
      } else {
        throw filesRes.reason instanceof Error ? filesRes.reason : new Error(String(filesRes.reason));
      }
      setDocuments(docsRes.status === "fulfilled" ? docsRes.value.documents : []);
      setCalendars(calsRes.status === "fulfilled" ? calsRes.value.entries : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // `creds` is derived from these primitive config fields each render.
  }, [config?.baseUrl, config?.sessionJwt]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Health: probe the file-server's /capabilities independently of the file
  // list, so the admin sees at a glance whether the server is reachable even
  // when the list/upload path is hung.  Re-check on mount and periodically.
  const [health, setHealth] = useState<FileServerHealth | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const checkHealth = useCallback(async () => {
    if (!config) return;
    setCheckingHealth(true);
    try {
      setHealth(await checkFileServerHealth(config.baseUrl));
    } finally {
      setCheckingHealth(false);
    }
  }, [config?.baseUrl]);
  useEffect(() => {
    void checkHealth();
    const id = setInterval(() => void checkHealth(), 20000);
    return () => clearInterval(id);
  }, [checkHealth]);

  const handleDelete = useCallback(async (file: AdminFileEntry) => {
    if (!creds) return;
    const ok = await askConfirm(
      t("fileServer.deleteConfirm", { defaultValue: "Delete \"{{name}}\" from the server? This cannot be undone.", name: file.filename }),
      { title: t("fileServer.delete", { defaultValue: "Delete file" }), kind: "warning" },
    );
    if (!ok) return;
    setDeleting(file.id);
    try {
      await adminDeleteFile(creds, file.id);
      dropPreview(file.id);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      setStats((prev) => prev && {
        ...prev,
        total_bytes_used: Math.max(0, prev.total_bytes_used - file.size_bytes),
        file_count: Math.max(0, prev.file_count - 1),
      });
    } catch (e) {
      await message(e instanceof Error ? e.message : String(e), {
        title: t("fileServer.deleteFailed", { defaultValue: "Delete failed" }),
        kind: "error",
      });
      void refresh();
    } finally {
      setDeleting(null);
    }
  }, [config?.baseUrl, config?.sessionJwt, t, refresh]);

  // Filter (fuzzy) + sort.
  const displayed = useMemo(() => {
    const q = search.trim();
    const filtered = q
      ? files.filter((f) => fuzzyMatchAny(q, [f.filename, f.mime_type, f.id, channelName(f.channel_id), ownerLabel(f)]))
      : files;
    const dir = sort.dir === "asc" ? 1 : -1;
    const cmp = (a: AdminFileEntry, b: AdminFileEntry): number => {
      switch (sort.key) {
        case "name": return a.filename.localeCompare(b.filename) * dir;
        case "type": return a.mime_type.localeCompare(b.mime_type) * dir;
        case "size": return (a.size_bytes - b.size_bytes) * dir;
        case "access": return a.access_mode.localeCompare(b.access_mode) * dir;
        case "channel": return (a.channel_id - b.channel_id) * dir;
        case "owner": return ownerLabel(a).localeCompare(ownerLabel(b)) * dir;
        // Files without a TTL sort as "never expires" (after any dated file in
        // ascending/soonest-first order).
        case "expires": return ((a.expires_at ?? Number.POSITIVE_INFINITY) - (b.expires_at ?? Number.POSITIVE_INFINITY)) * dir;
        case "uploaded":
        default: return (a.uploaded_at - b.uploaded_at) * dir;
      }
    };
    return [...filtered].sort(cmp);
  }, [files, search, sort, channelName, ownerLabel]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "type" || key === "owner" || key === "expires" ? "asc" : "desc" }));

  // Documents matching the same search box, newest first.
  const displayedDocs = useMemo(() => {
    const q = search.trim();
    const filtered = q
      ? documents.filter((d) => fuzzyMatchAny(q, [d.name, docOwnerLabel(d)]))
      : documents;
    return [...filtered].sort((a, b) => b.updated_at - a.updated_at);
  }, [documents, search, docOwnerLabel]);

  // --- Bulk selection across both filtered tables -------------------------
  const fileKey = (id: string) => `file:${id}`;
  const docKey = (name: string) => `doc:${name}`;
  const toggleKey = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  // Keys that are currently visible (after the search filter) - select-all only
  // ever acts on what the admin can see.
  const visibleKeys = useMemo(
    () => [...displayed.map((f) => fileKey(f.id)), ...displayedDocs.map((d) => docKey(d.name))],
    [displayed, displayedDocs],
  );
  const selectedVisibleCount = useMemo(
    () => visibleKeys.reduce((n, k) => (selected.has(k) ? n + 1 : n), 0),
    [visibleKeys, selected],
  );
  const allVisibleSelected = visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;
  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const allSel = visibleKeys.length > 0 && visibleKeys.every((k) => prev.has(k));
      if (allSel) {
        const next = new Set(prev);
        for (const k of visibleKeys) next.delete(k);
        return next;
      }
      return new Set([...prev, ...visibleKeys]);
    });
  }, [visibleKeys]);
  const setRangeSelected = useCallback((keys: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) { if (on) next.add(k); else next.delete(k); }
      return next;
    });
  }, []);

  const bulkDelete = useCallback(async () => {
    if (!creds || selected.size === 0) return;
    const fileIds = [...selected].filter((k) => k.startsWith("file:")).map((k) => k.slice(5));
    const docNames = [...selected].filter((k) => k.startsWith("doc:")).map((k) => k.slice(4));
    const ok = await askConfirm(
      t("fileServer.bulkDeleteConfirm", {
        defaultValue: "Delete {{files}} file(s) and {{docs}} document(s)? This cannot be undone.",
        files: fileIds.length,
        docs: docNames.length,
      }),
      { title: t("fileServer.bulkDelete", { defaultValue: "Delete selected" }), kind: "warning" },
    );
    if (!ok) return;
    setBulkDeleting(true);
    const failures: string[] = [];
    for (const id of fileIds) {
      try { await adminDeleteFile(creds, id); dropPreview(id); }
      catch (e) { failures.push(e instanceof Error ? e.message : String(e)); }
    }
    for (const name of docNames) {
      try { await adminDeleteDocument(creds, name); }
      catch (e) { failures.push(e instanceof Error ? e.message : String(e)); }
    }
    setBulkDeleting(false);
    if (failures.length > 0) {
      await message(failures.join("\n"), {
        title: t("fileServer.deleteFailed", { defaultValue: "Delete failed" }),
        kind: "error",
      });
    }
    void refresh();
  }, [creds, selected, t, refresh]);

  const handleDeleteDoc = useCallback(async (doc: DocumentSummary) => {
    if (!creds) return;
    const ok = await askConfirm(
      t("fileServer.docs.deleteConfirm", { defaultValue: "Delete document \"{{name}}\"? This removes all its revisions and cannot be undone.", name: doc.name }),
      { title: t("fileServer.docs.delete", { defaultValue: "Delete document" }), kind: "warning" },
    );
    if (!ok) return;
    setDeleting(docKey(doc.name));
    try {
      await adminDeleteDocument(creds, doc.name);
      setDocuments((prev) => prev.filter((d) => d.name !== doc.name));
      setSelected((prev) => { const n = new Set(prev); n.delete(docKey(doc.name)); return n; });
    } catch (e) {
      await message(e instanceof Error ? e.message : String(e), {
        title: t("fileServer.deleteFailed", { defaultValue: "Delete failed" }),
        kind: "error",
      });
      void refresh();
    } finally {
      setDeleting(null);
    }
  }, [config?.baseUrl, config?.sessionJwt, t, refresh]);

  // --- Charts (memoised so Chart.js isn't rebuilt on every render) --------
  const usageConfig = useMemo(() => {
    const used = stats?.total_bytes_used ?? 0;
    const free = Math.max(0, (stats?.max_total_storage_bytes ?? 0) - used);
    const nearFull = stats && stats.max_total_storage_bytes > 0 && used / stats.max_total_storage_bytes > 0.9;
    return {
      type: "doughnut",
      data: {
        labels: [t("fileServer.chart.used", { defaultValue: "Used" }), t("fileServer.chart.free", { defaultValue: "Free" })],
        datasets: [{
          data: [used, free],
          backgroundColor: [nearFull ? "#e0533c" : "#2aabee", "rgba(150,160,170,0.18)"],
          borderColor: "#1e2128",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "68%",
        plugins: { legend: { display: true, position: "bottom", labels: { color: "#9aa3ad", boxWidth: 12 } } },
      },
    };
  }, [stats, t]);

  const byTypeConfig = useMemo(() => {
    const sizes = new Map<FileCategory, number>();
    for (const f of files) sizes.set(categorize(f.mime_type), (sizes.get(categorize(f.mime_type)) ?? 0) + f.size_bytes);
    const labels = CATEGORIES.filter((c) => (sizes.get(c) ?? 0) > 0);
    return {
      type: "bar",
      data: {
        labels: labels.map((c) => t(`fileServer.category.${c}`, { defaultValue: c })),
        datasets: [{
          label: t("fileServer.chart.byType", { defaultValue: "Size by type" }),
          data: labels.map((c) => sizes.get(c) ?? 0),
          backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#9aa3ad", callback: (v: number | string) => formatBytes(Number(v)) }, grid: { color: "rgba(128,128,128,0.15)" } },
          y: { ticks: { color: "#9aa3ad" }, grid: { display: false } },
        },
      },
    };
  }, [files, t]);

  const byAccessConfig = useMemo(() => {
    const counts = { public: 0, password: 0, session: 0 };
    for (const f of files) counts[f.access_mode]++;
    return {
      type: "doughnut",
      data: {
        labels: [
          t("fileServer.access.public", { defaultValue: "Public" }),
          t("fileServer.access.password", { defaultValue: "Password" }),
          t("fileServer.access.session", { defaultValue: "Session" }),
        ],
        datasets: [{
          data: [counts.public, counts.password, counts.session],
          backgroundColor: ["#38b27a", "#e0892f", "#8a5cf6"],
          borderColor: "#1e2128", borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "60%",
        plugins: { legend: { display: true, position: "bottom", labels: { color: "#9aa3ad", boxWidth: 12 } } },
      },
    };
  }, [files, t]);

  if (!creds) {
    return <div className={panel.content}><p>{t("fileServer.noConfig", { defaultValue: "The file server is not enabled on this server." })}</p></div>;
  }

  // Preview/thumbnail byte source for the shared file components (admin route).
  const source = makeAdminFilesSource(creds);

  const used = stats?.total_bytes_used ?? 0;
  const cap = stats?.max_total_storage_bytes ?? 0;
  const free = Math.max(0, cap - used);
  const usagePct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const sortArrow = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className={`${panel.content} ${panel.contentWide}`}>
      <div className={styles.header}>
        <h3 className={styles.title}><DatabaseIcon width={18} height={18} /> {t("fileServer.title", { defaultValue: "File server storage" })}</h3>
        <button type="button" className={styles.refreshBtn} onClick={() => void refresh()} disabled={loading}>
          <RefreshCwIcon width={15} height={15} /> {t("fileServer.refresh", { defaultValue: "Refresh" })}
        </button>
      </div>

      {/* Health: at-a-glance reachability of the file-server itself. */}
      <div className={`${styles.healthRow} ${health && !health.ok ? styles.healthRowBad : ""}`}>
        <span
          className={`${styles.healthDot} ${health?.ok ? styles.healthOk : health ? styles.healthBad : styles.healthUnknown}`}
          aria-hidden="true"
        />
        <span className={styles.healthText}>
          {health?.ok
            ? t("fileServer.health.online", { defaultValue: "File server online · {{ms}} ms", ms: health.latencyMs })
            : health
              ? `${t("fileServer.health.offline", { defaultValue: "File server unreachable" })}${health.error ? ` - ${health.error}` : ""}`
              : t("fileServer.health.checking", { defaultValue: "Checking file server…" })}
        </span>
        <button type="button" className={styles.healthRecheck} onClick={() => void checkHealth()} disabled={checkingHealth}>
          {t("fileServer.health.recheck", { defaultValue: "Re-check" })}
        </button>
      </div>

      {error && <p className={styles.error}>{t("fileServer.error", { defaultValue: "Could not load files" })}: {error}</p>}

      {/* Stat cards + usage bar */}
      <div className={styles.statRow}>
        <StatCard label={t("fileServer.stats.used", { defaultValue: "Used" })} value={formatBytes(used)} sub={`${usagePct}%`} />
        <StatCard label={t("fileServer.stats.free", { defaultValue: "Free" })} value={formatBytes(free)} />
        <StatCard label={t("fileServer.stats.total", { defaultValue: "Capacity" })} value={formatBytes(cap)} />
        <StatCard label={t("fileServer.stats.files", { defaultValue: "Files" })} value={String(stats?.file_count ?? files.length)} />
        <StatCard label={t("fileServer.stats.maxFile", { defaultValue: "Max upload" })} value={formatBytes(stats?.max_file_size_bytes ?? 0)} />
      </div>
      <div className={styles.usageBar} title={`${formatBytes(used)} / ${formatBytes(cap)}`}>
        <div className={styles.usageFill} style={{ width: `${usagePct}%`, background: usagePct > 90 ? "#e0533c" : "#2aabee" }} />
      </div>

      {/* Active calendars: per-user calendar blobs in the private store. */}
      <div style={{ marginTop: 16 }}>
        <h4 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, margin: "0 0 8px" }}>
          <DatabaseIcon width={15} height={15} />
          {t("fileServer.calendars.title", { defaultValue: "Active calendars" })}
          <span style={{ opacity: 0.6, fontWeight: 400 }}>({calendars.length})</span>
        </h4>
        {calendars.length === 0 ? (
          <div style={{ opacity: 0.6, fontSize: 13 }}>
            {t("fileServer.calendars.empty", { defaultValue: "No user calendars stored yet." })}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.7 }}>
                <th style={{ padding: "4px 8px" }}>{t("fileServer.calendars.user", { defaultValue: "User (server:id)" })}</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>{t("fileServer.calendars.size", { defaultValue: "Size" })}</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>{t("fileServer.calendars.updated", { defaultValue: "Updated" })}</th>
              </tr>
            </thead>
            <tbody>
              {calendars.map((c) => (
                <tr key={`${c.scope}:${c.key}`} style={{ borderTop: "1px solid var(--color-glass-border)" }}>
                  <td style={{ padding: "4px 8px", fontFamily: "var(--font-mono, monospace)" }}>{c.scope}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right" }}>{formatBytes(c.size_bytes)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", opacity: 0.8 }}>
                    {new Date(c.updated_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Charts */}
      {files.length > 0 && (
        <div className={styles.chartRow}>
          <div className={styles.chartCard}>
            <span className={styles.chartTitle}>{t("fileServer.chart.usage", { defaultValue: "Storage usage" })}</span>
            <div className={styles.chartBox}><DashboardChart config={usageConfig} ariaLabel={t("fileServer.chart.usage", { defaultValue: "Storage usage" })} /></div>
          </div>
          <div className={styles.chartCard}>
            <span className={styles.chartTitle}>{t("fileServer.chart.byType", { defaultValue: "Size by type" })}</span>
            <div className={styles.chartBox}><DashboardChart config={byTypeConfig} ariaLabel={t("fileServer.chart.byType", { defaultValue: "Size by type" })} /></div>
          </div>
          <div className={styles.chartCard}>
            <span className={styles.chartTitle}>{t("fileServer.chart.byAccess", { defaultValue: "By access mode" })}</span>
            <div className={styles.chartBox}><DashboardChart config={byAccessConfig} ariaLabel={t("fileServer.chart.byAccess", { defaultValue: "By access mode" })} /></div>
          </div>
        </div>
      )}

      {/* Toolbar: unified search across files + documents, plus bulk select. */}
      <div className={styles.toolbar}>
        <div className={styles.searchRow}>
          <SearchIcon width={16} height={16} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder={t("fileServer.searchAll", { defaultValue: "Search files & documents…" })}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className={styles.selectAll}>
          <input
            type="checkbox"
            checked={allVisibleSelected}
            ref={(el) => { if (el) el.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected; }}
            onChange={toggleSelectAll}
            disabled={visibleKeys.length === 0}
          />
          {t("fileServer.selectAll", { defaultValue: "Select all ({{count}})", count: visibleKeys.length })}
        </label>
        <span className={styles.resultCount}>
          {t("fileServer.resultCountAll", { defaultValue: "{{files}} file(s), {{docs}} doc(s)", files: displayed.length, docs: displayedDocs.length })}
        </span>
        {selected.size > 0 && (
          <button type="button" className={styles.bulkDeleteBtn} onClick={() => void bulkDelete()} disabled={bulkDeleting}>
            <TrashIcon width={15} height={15} /> {t("fileServer.bulkDeleteN", { defaultValue: "Delete selected ({{count}})", count: selected.size })}
          </button>
        )}
      </div>

      {/* Files table */}
      {displayed.length === 0 ? (
        <p className={styles.empty}>
          {loading
            ? t("fileServer.loading", { defaultValue: "Loading…" })
            : error
              ? t("fileServer.error", { defaultValue: "Could not load files" })
              : search.trim()
                ? t("fileServer.noMatch", { defaultValue: "No files match your search." })
                : t("fileServer.empty", { defaultValue: "No files stored." })}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thCheck}>
                  <input
                    type="checkbox"
                    aria-label={t("fileServer.selectAllFiles", { defaultValue: "Select all files" })}
                    checked={displayed.length > 0 && displayed.every((f) => selected.has(fileKey(f.id)))}
                    onChange={(e) => setRangeSelected(displayed.map((f) => fileKey(f.id)), e.target.checked)}
                  />
                </th>
                <th className={styles.thPreview}>{t("fileServer.col.preview", { defaultValue: "Preview" })}</th>
                <th onClick={() => toggleSort("name")} className={styles.sortable}>{t("fileServer.col.name", { defaultValue: "Name" })}{sortArrow("name")}</th>
                <th onClick={() => toggleSort("type")} className={styles.sortable}>{t("fileServer.col.type", { defaultValue: "Type" })}{sortArrow("type")}</th>
                <th onClick={() => toggleSort("size")} className={`${styles.sortable} ${styles.num}`}>{t("fileServer.col.size", { defaultValue: "Size" })}{sortArrow("size")}</th>
                <th onClick={() => toggleSort("access")} className={styles.sortable}>{t("fileServer.col.access", { defaultValue: "Access" })}{sortArrow("access")}</th>
                <th onClick={() => toggleSort("channel")} className={styles.sortable}>{t("fileServer.col.channel", { defaultValue: "Channel" })}{sortArrow("channel")}</th>
                <th onClick={() => toggleSort("owner")} className={styles.sortable}>{t("fileServer.col.owner", { defaultValue: "Owner" })}{sortArrow("owner")}</th>
                <th onClick={() => toggleSort("uploaded")} className={styles.sortable}>{t("fileServer.col.uploaded", { defaultValue: "Uploaded" })}{sortArrow("uploaded")}</th>
                <th onClick={() => toggleSort("expires")} className={styles.sortable}>{t("fileServer.col.expires", { defaultValue: "Expires" })}{sortArrow("expires")}</th>
                <th className={styles.thActions}>{t("fileServer.col.actions", { defaultValue: "Actions" })}</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((f) => (
                <tr key={f.id} className={selected.has(fileKey(f.id)) ? styles.rowSelected : undefined}>
                  <td className={styles.tdCheck}>
                    <input
                      type="checkbox"
                      aria-label={t("fileServer.selectRow", { defaultValue: "Select" })}
                      checked={selected.has(fileKey(f.id))}
                      onChange={() => toggleKey(fileKey(f.id))}
                    />
                  </td>
                  <td><FileThumb file={f} source={source} onOpen={setPreview} /></td>
                  <td className={styles.nameCell}>
                    <span className={styles.fileName} title={f.filename}>{f.filename}</span>
                  </td>
                  <td className={styles.typeCell}><CategoryIcon cat={categorize(f.mime_type)} size={14} /> <span title={f.mime_type}>{t(`fileServer.category.${categorize(f.mime_type)}`, { defaultValue: categorize(f.mime_type) })}</span></td>
                  <td className={styles.num}>{formatBytes(f.size_bytes)}</td>
                  <td><span className={`${styles.accessBadge} ${styles[`access_${f.access_mode}`]}`}>{t(`fileServer.access.${f.access_mode}`, { defaultValue: f.access_mode })}</span></td>
                  <td title={`#${f.channel_id}`}>{channelName(f.channel_id)}</td>
                  <td><OwnerCell file={f} connectedById={connectedById} connectedByHash={connectedByHash} /></td>
                  <td className={styles.dateCell}>{new Date(f.uploaded_at).toLocaleString()}</td>
                  <td className={styles.dateCell}>
                    {f.expires_at != null
                      ? <ExpiryBadge expiresAt={f.expires_at} />
                      : <span className={styles.noExpiry}>{t("fileServer.neverExpires", { defaultValue: "Never" })}</span>}
                  </td>
                  <td className={styles.actionsCell}>
                    {isPreviewable(f.mime_type) && f.access_mode !== "password" && (
                      <button type="button" className={styles.iconBtn} onClick={() => setPreview(f)} title={t("fileServer.preview", { defaultValue: "Preview" })}>
                        <ImageIcon width={15} height={15} />
                      </button>
                    )}
                    <button type="button" className={`${styles.iconBtn} ${styles.deleteBtn}`} onClick={() => void handleDelete(f)} disabled={deleting === f.id} title={t("fileServer.delete", { defaultValue: "Delete" })}>
                      <TrashIcon width={15} height={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Live documents persisted by the live-doc plugin (separate store). */}
      <DocumentsSection
        docs={displayedDocs}
        connectedByHash={connectedByHash}
        loading={loading}
        error={error}
        searchActive={search.trim().length > 0}
        isSelected={(name) => selected.has(docKey(name))}
        onToggle={(name) => toggleKey(docKey(name))}
        allSelected={displayedDocs.length > 0 && displayedDocs.every((d) => selected.has(docKey(d.name)))}
        onToggleAll={(on) => setRangeSelected(displayedDocs.map((d) => docKey(d.name)), on)}
        onDelete={handleDeleteDoc}
        deletingName={deleting?.startsWith("doc:") ? deleting.slice(4) : null}
      />

      {preview && <PreviewModal file={preview} source={source} onClose={() => setPreview(null)} />}
    </div>
  );
}

export default FileServerTab;
