import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "@mui/material/styles";
import { Box, Button, Checkbox, IconButton, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { confirm as askConfirm, message } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@core/store";
import { formatBytes } from "@core/utils/format";
import { fuzzyMatchAny } from "@core/utils/fuzzy";
import type { AdminFileEntry, DocumentSummary, FileServerStorageStats, UserEntry } from "@core/types";
import {
  adminDeleteDocument,
  adminDeleteFile,
  adminListCalendars,
  adminListDocuments,
  adminListFiles,
  categorize,
  checkFileServerHealth,
  dropPreview,
  isPreviewable,
  makeAdminFilesSource,
  type AdminCreds,
  type CalendarUsageEntry,
  type FileCategory,
  type FileServerHealth,
} from "@standard/pages/admin/fileServerAdmin";
import DashboardChart from "@standard/pages/admin/DashboardChart";
import {
  CategoryIcon,
  ExpiryBadge,
  FileThumb,
  PreviewModal,
} from "@standard/components/fileserver/FilePreview";
import { FileTextIcon, ImageIcon, RefreshCwIcon, TrashIcon } from "@ui/icons";
import { NEBULA_MONO, NEBULA_RADIUS } from "../../tokens";
import { SearchBox, Stack, StatusDot } from "../primitives";
import { Banner, EmptyState, GroupTitle, SettingsCard } from "../settings/controls";
import { AdminPage, DataTable, type Column } from "./controls";

const CATEGORIES: FileCategory[] = ["image", "video", "audio", "document", "archive", "other"];

type SortKey = "name" | "type" | "size" | "access" | "channel" | "owner" | "uploaded" | "expires";

/**
 * Resolve a file's uploader to a currently-connected user.
 *
 * The registered user id is tried first because it survives a certificate
 * being regenerated; the cert hash is the fallback for unregistered and legacy
 * uploads, which have no id to match on.
 */
function matchUploader(
  file: AdminFileEntry,
  byId: Map<number, UserEntry>,
  byHash: Map<string, UserEntry>,
): UserEntry | undefined {
  if (file.uploader_user_id != null) {
    const found = byId.get(file.uploader_user_id);
    if (found) return found;
  }
  return file.uploader_cert_hash ? byHash.get(file.uploader_cert_hash) : undefined;
}

/** One headline number. */
function StatCard({ label, value, sub }: Readonly<{ label: string; value: string; sub?: string }>) {
  return (
    <SettingsCard sx={{ flex: "1 1 130px", p: "12px 14px" }}>
      <Typography sx={{ fontSize: 17, fontWeight: 600 }}>{value}</Typography>
      <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.muted })}>{label}</Typography>
      {sub && (
        <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.dim })}>{sub}</Typography>
      )}
    </SettingsCard>
  );
}

/**
 * The file-server dashboard.
 *
 * The file store and the live-document store are two different stores on the
 * same server, so the page lists them separately but selects across both -
 * an admin clearing out a user's data does not care which store a thing is in.
 *
 * Health is probed independently of the listing, because "the file server is
 * down" and "the list request is hung" look identical from the table alone.
 */
export function FileServerAdmin() {
  const { t } = useTranslation("settings");
  const config = useAppStore((state) => state.fileServerConfig);
  const channels = useAppStore((state) => state.channels);
  const users = useAppStore((state) => state.users);
  const setFileServerAdminOpen = useAppStore((state) => state.setFileServerAdminOpen);
  const creds: AdminCreds | null = config ? { baseUrl: config.baseUrl, sessionJwt: config.sessionJwt } : null;

  const connectedByHash = useMemo(() => {
    const map = new Map<string, UserEntry>();
    for (const user of users) if (user.hash) map.set(user.hash, user);
    return map;
  }, [users]);
  const connectedById = useMemo(() => {
    const map = new Map<number, UserEntry>();
    for (const user of users) if (user.user_id != null) map.set(user.user_id, user);
    return map;
  }, [users]);

  // Tells the store this dashboard is open, so disabling the file-server
  // plugin at runtime can prompt before tearing the view down underneath it.
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
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "uploaded",
    dir: "desc",
  });
  const [preview, setPreview] = useState<AdminFileEntry | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // One selection across both stores: `file:<id>` and `doc:<name>`.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [health, setHealth] = useState<FileServerHealth | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const ownerLabel = useCallback(
    (file: AdminFileEntry) =>
      matchUploader(file, connectedById, connectedByHash)?.name ?? file.uploader_name ?? "",
    [connectedById, connectedByHash],
  );
  const docOwnerLabel = useCallback(
    (doc: DocumentSummary) =>
      (doc.owner_cert_hash ? connectedByHash.get(doc.owner_cert_hash)?.name : undefined) ??
      doc.owner_name ??
      "",
    [connectedByHash],
  );
  const channelName = useCallback(
    (id: number) => channels.find((channel) => channel.id === id)?.name ?? `#${id}`,
    [channels],
  );

  const refresh = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    const active: AdminCreds = { baseUrl: config.baseUrl, sessionJwt: config.sessionJwt };
    try {
      // Documents and calendars are optional stores; a failure in either must
      // not blank a dashboard whose main subject - the files - loaded fine.
      const [filesRes, docsRes, calsRes] = await Promise.allSettled([
        adminListFiles(active),
        adminListDocuments(active),
        adminListCalendars(active),
      ]);
      if (filesRes.status !== "fulfilled") {
        throw filesRes.reason instanceof Error ? filesRes.reason : new Error(String(filesRes.reason));
      }
      setFiles(filesRes.value.files);
      setStats(filesRes.value.stats);
      setDocuments(docsRes.status === "fulfilled" ? docsRes.value.documents : []);
      setCalendars(calsRes.status === "fulfilled" ? calsRes.value.entries : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const checkHealth = useCallback(async () => {
    if (!config) return;
    setCheckingHealth(true);
    try {
      setHealth(await checkFileServerHealth(config.baseUrl));
    } finally {
      setCheckingHealth(false);
    }
  }, [config]);

  useEffect(() => {
    void checkHealth();
    const timer = setInterval(() => void checkHealth(), 20_000);
    return () => clearInterval(timer);
  }, [checkHealth]);

  const displayedFiles = useMemo(() => {
    const query = search.trim();
    const filtered = query
      ? files.filter((file) =>
          fuzzyMatchAny(query, [
            file.filename,
            file.mime_type,
            file.id,
            channelName(file.channel_id),
            ownerLabel(file),
          ]),
        )
      : files;
    const direction = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "name":
          return a.filename.localeCompare(b.filename) * direction;
        case "type":
          return a.mime_type.localeCompare(b.mime_type) * direction;
        case "size":
          return (a.size_bytes - b.size_bytes) * direction;
        case "access":
          return a.access_mode.localeCompare(b.access_mode) * direction;
        case "channel":
          return (a.channel_id - b.channel_id) * direction;
        case "owner":
          return ownerLabel(a).localeCompare(ownerLabel(b)) * direction;
        // A file with no TTL sorts as "never", after every dated file when
        // ordered soonest-first.
        case "expires":
          return (
            ((a.expires_at ?? Number.POSITIVE_INFINITY) - (b.expires_at ?? Number.POSITIVE_INFINITY)) *
            direction
          );
        default:
          return (a.uploaded_at - b.uploaded_at) * direction;
      }
    });
  }, [files, search, sort, channelName, ownerLabel]);

  const displayedDocs = useMemo(() => {
    const query = search.trim();
    const filtered = query
      ? documents.filter((doc) => fuzzyMatchAny(query, [doc.name, docOwnerLabel(doc)]))
      : documents;
    return [...filtered].sort((a, b) => b.updated_at - a.updated_at);
  }, [documents, search, docOwnerLabel]);

  const fileKey = (id: string) => `file:${id}`;
  const docKey = (name: string) => `doc:${name}`;
  const toggleKey = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setRangeSelected = (keys: readonly string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });

  // Select-all only ever acts on what the search leaves visible.
  const visibleKeys = useMemo(
    () => [
      ...displayedFiles.map((file) => fileKey(file.id)),
      ...displayedDocs.map((doc) => docKey(doc.name)),
    ],
    [displayedFiles, displayedDocs],
  );
  const selectedVisible = visibleKeys.filter((key) => selected.has(key)).length;
  const allVisibleSelected = visibleKeys.length > 0 && selectedVisible === visibleKeys.length;

  const deleteFile = async (file: AdminFileEntry) => {
    if (!creds) return;
    const ok = await askConfirm(
      t("fileServer.deleteConfirm", {
        defaultValue: 'Delete "{{name}}" from the server? This cannot be undone.',
        name: file.filename,
      }),
      { title: t("fileServer.delete", { defaultValue: "Delete file" }), kind: "warning" },
    );
    if (!ok) return;
    setDeleting(file.id);
    try {
      await adminDeleteFile(creds, file.id);
      dropPreview(file.id);
      setFiles((prev) => prev.filter((entry) => entry.id !== file.id));
      // Adjusted locally rather than refetched: the numbers above the table
      // would otherwise disagree with it until the next refresh.
      setStats(
        (prev) =>
          prev && {
            ...prev,
            total_bytes_used: Math.max(0, prev.total_bytes_used - file.size_bytes),
            file_count: Math.max(0, prev.file_count - 1),
          },
      );
    } catch (e) {
      await message(e instanceof Error ? e.message : String(e), {
        title: t("fileServer.deleteFailed", { defaultValue: "Delete failed" }),
        kind: "error",
      });
      void refresh();
    } finally {
      setDeleting(null);
    }
  };

  const deleteDoc = async (doc: DocumentSummary) => {
    if (!creds) return;
    const ok = await askConfirm(
      t("fileServer.docs.deleteConfirm", {
        defaultValue: 'Delete document "{{name}}"? This removes all its revisions and cannot be undone.',
        name: doc.name,
      }),
      { title: t("fileServer.docs.delete", { defaultValue: "Delete document" }), kind: "warning" },
    );
    if (!ok) return;
    setDeleting(docKey(doc.name));
    try {
      await adminDeleteDocument(creds, doc.name);
      setDocuments((prev) => prev.filter((entry) => entry.name !== doc.name));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(docKey(doc.name));
        return next;
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
  };

  const bulkDelete = async () => {
    if (!creds || selected.size === 0) return;
    const fileIds = [...selected].filter((key) => key.startsWith("file:")).map((key) => key.slice(5));
    const docNames = [...selected].filter((key) => key.startsWith("doc:")).map((key) => key.slice(4));
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
    // Every failure is collected rather than aborting the run: a single
    // already-deleted file should not strand the rest of the selection.
    const failures: string[] = [];
    for (const id of fileIds) {
      try {
        await adminDeleteFile(creds, id);
        dropPreview(id);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
      }
    }
    for (const name of docNames) {
      try {
        await adminDeleteDocument(creds, name);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
      }
    }
    setBulkDeleting(false);
    if (failures.length > 0) {
      await message(failures.join("\n"), {
        title: t("fileServer.deleteFailed", { defaultValue: "Delete failed" }),
        kind: "error",
      });
    }
    void refresh();
  };

  const used = stats?.total_bytes_used ?? 0;
  const capacity = stats?.max_total_storage_bytes ?? 0;
  const free = Math.max(0, capacity - used);
  const usagePct = capacity > 0 ? Math.min(100, Math.round((used / capacity) * 100)) : 0;

  // Chart.js draws to a canvas, so it cannot inherit the theme through CSS -
  // the palette is read off the MUI theme and passed in.
  const charts = useNebulaChartConfigs({ files, used, free, nearFull: usagePct > 90 });

  const sortHeader = (key: SortKey, label: string) => (
    <Box
      component="span"
      role="button"
      tabIndex={0}
      sx={{ cursor: "pointer", userSelect: "none" }}
      onClick={() =>
        setSort((prev) =>
          prev.key === key
            ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
            : {
                key,
                dir:
                  key === "name" || key === "type" || key === "owner" || key === "expires" ? "asc" : "desc",
              },
        )
      }
    >
      {label}
      {sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
    </Box>
  );

  if (!creds) {
    return (
      <AdminPage title={t("fileServer.title", { defaultValue: "File server storage" })}>
        <EmptyState>
          {t("fileServer.noConfig", { defaultValue: "The file server is not enabled on this server." })}
        </EmptyState>
      </AdminPage>
    );
  }

  const source = makeAdminFilesSource(creds);

  const fileColumns: Column<AdminFileEntry>[] = [
    {
      key: "select",
      width: 34,
      header: (
        <Checkbox
          size="small"
          checked={
            displayedFiles.length > 0 && displayedFiles.every((file) => selected.has(fileKey(file.id)))
          }
          onChange={(event) =>
            setRangeSelected(
              displayedFiles.map((file) => fileKey(file.id)),
              event.target.checked,
            )
          }
          slotProps={{
            input: { "aria-label": t("fileServer.selectAllFiles", { defaultValue: "Select all files" }) },
          }}
        />
      ),
      cell: (file) => (
        <Checkbox
          size="small"
          checked={selected.has(fileKey(file.id))}
          onChange={() => toggleKey(fileKey(file.id))}
          slotProps={{ input: { "aria-label": t("fileServer.selectRow", { defaultValue: "Select" }) } }}
        />
      ),
    },
    {
      key: "preview",
      header: t("fileServer.col.preview", { defaultValue: "Preview" }),
      cell: (file) => <FileThumb file={file} source={source} onOpen={setPreview} />,
    },
    {
      key: "name",
      header: sortHeader("name", t("fileServer.col.name", { defaultValue: "Name" })),
      cell: (file) => (
        <Box component="span" title={file.filename} sx={{ fontWeight: 500 }}>
          {file.filename}
        </Box>
      ),
    },
    {
      key: "type",
      header: sortHeader("type", t("fileServer.col.type", { defaultValue: "Type" })),
      cell: (file) => (
        <Stack direction="row" alignItems="center" gap={0.625}>
          <CategoryIcon cat={categorize(file.mime_type)} size={13} />
          <Box component="span" title={file.mime_type}>
            {t(`fileServer.category.${categorize(file.mime_type)}` as "fileServer.category.image", {
              defaultValue: categorize(file.mime_type),
            })}
          </Box>
        </Stack>
      ),
    },
    {
      key: "size",
      align: "right",
      header: sortHeader("size", t("fileServer.col.size", { defaultValue: "Size" })),
      cell: (file) => formatBytes(file.size_bytes),
    },
    {
      key: "access",
      header: sortHeader("access", t("fileServer.col.access", { defaultValue: "Access" })),
      cell: (file) => (
        <Box
          component="span"
          sx={(theme) => {
            const { nebula } = theme.palette;
            const tone = { public: nebula.ok, password: nebula.warn, session: nebula.accent }[
              file.access_mode
            ];
            return {
              px: "7px",
              py: "2px",
              borderRadius: "999px",
              fontSize: 10,
              fontWeight: 600,
              color: tone,
              border: `1px solid ${tone}`,
            };
          }}
        >
          {t(`fileServer.access.${file.access_mode}` as "fileServer.access.public", {
            defaultValue: file.access_mode,
          })}
        </Box>
      ),
    },
    {
      key: "channel",
      header: sortHeader("channel", t("fileServer.col.channel", { defaultValue: "Channel" })),
      cell: (file) => (
        <Box component="span" title={`#${file.channel_id}`}>
          {channelName(file.channel_id)}
        </Box>
      ),
    },
    {
      key: "owner",
      header: sortHeader("owner", t("fileServer.col.owner", { defaultValue: "Owner" })),
      cell: (file) => {
        const entry = matchUploader(file, connectedById, connectedByHash);
        const name = entry?.name ?? file.uploader_name;
        const online = file.uploader_online || entry != null;
        return (
          <Stack direction="row" alignItems="center" gap={0.75}>
            <StatusDot status={online ? "online" : "offline"} />
            <Box component="span" title={file.uploader_cert_hash ?? undefined}>
              {name ??
                (file.uploader_cert_hash
                  ? file.uploader_cert_hash.slice(0, 10)
                  : t("fileServer.unknownOwner", { defaultValue: "Unknown" }))}
            </Box>
          </Stack>
        );
      },
    },
    {
      key: "uploaded",
      header: sortHeader("uploaded", t("fileServer.col.uploaded", { defaultValue: "Uploaded" })),
      cell: (file) => (
        <Box component="span" sx={(theme) => ({ color: theme.palette.nebula.muted })}>
          {new Date(file.uploaded_at).toLocaleString()}
        </Box>
      ),
    },
    {
      key: "expires",
      header: sortHeader("expires", t("fileServer.col.expires", { defaultValue: "Expires" })),
      cell: (file) =>
        file.expires_at != null ? (
          <ExpiryBadge expiresAt={file.expires_at} />
        ) : (
          <Box component="span" sx={(theme) => ({ color: theme.palette.nebula.dim })}>
            {t("fileServer.neverExpires", { defaultValue: "Never" })}
          </Box>
        ),
    },
    {
      key: "actions",
      align: "right",
      header: t("fileServer.col.actions", { defaultValue: "Actions" }),
      cell: (file) => (
        <Stack direction="row" gap={0.25} justifyContent="flex-end">
          {/* A password-protected file cannot be decrypted here, so there is
              nothing to preview even when its type is previewable. */}
          {isPreviewable(file.mime_type) && file.access_mode !== "password" && (
            <IconButton
              size="small"
              title={t("fileServer.preview", { defaultValue: "Preview" })}
              aria-label={t("fileServer.preview", { defaultValue: "Preview" })}
              onClick={() => setPreview(file)}
            >
              <ImageIcon width={14} height={14} />
            </IconButton>
          )}
          <IconButton
            size="small"
            disabled={deleting === file.id}
            title={t("fileServer.delete", { defaultValue: "Delete" })}
            aria-label={t("fileServer.delete", { defaultValue: "Delete" })}
            onClick={() => void deleteFile(file)}
          >
            <TrashIcon width={14} height={14} />
          </IconButton>
        </Stack>
      ),
    },
  ];

  const docColumns: Column<DocumentSummary>[] = [
    {
      key: "select",
      width: 34,
      header: (
        <Checkbox
          size="small"
          checked={displayedDocs.length > 0 && displayedDocs.every((doc) => selected.has(docKey(doc.name)))}
          onChange={(event) =>
            setRangeSelected(
              displayedDocs.map((doc) => docKey(doc.name)),
              event.target.checked,
            )
          }
          slotProps={{
            input: {
              "aria-label": t("fileServer.selectAllDocs", { defaultValue: "Select all documents" }),
            },
          }}
        />
      ),
      cell: (doc) => (
        <Checkbox
          size="small"
          checked={selected.has(docKey(doc.name))}
          onChange={() => toggleKey(docKey(doc.name))}
          slotProps={{ input: { "aria-label": t("fileServer.selectRow", { defaultValue: "Select" }) } }}
        />
      ),
    },
    {
      key: "name",
      header: t("fileServer.docs.col.name", { defaultValue: "Document" }),
      cell: (doc) => (
        <Stack direction="row" alignItems="center" gap={0.75}>
          <FileTextIcon width={13} height={13} />
          <Box component="span" sx={{ fontWeight: 500 }}>
            {doc.name}
          </Box>
        </Stack>
      ),
    },
    {
      key: "owner",
      header: t("fileServer.col.owner", { defaultValue: "Owner" }),
      cell: (doc) => {
        const entry = doc.owner_cert_hash ? connectedByHash.get(doc.owner_cert_hash) : undefined;
        const name = entry?.name ?? doc.owner_name;
        if (!name) {
          return (
            <Box component="span" sx={(theme) => ({ color: theme.palette.nebula.dim })}>
              {t("fileServer.unknownOwner", { defaultValue: "Unknown" })}
            </Box>
          );
        }
        return (
          <Stack direction="row" alignItems="center" gap={0.75}>
            <StatusDot status={entry ? "online" : "offline"} />
            <Box component="span" title={doc.owner_cert_hash ?? undefined}>
              {name}
            </Box>
          </Stack>
        );
      },
    },
    {
      key: "revisions",
      align: "right",
      header: t("fileServer.docs.col.revisions", { defaultValue: "Revisions" }),
      cell: (doc) => doc.revision_count,
    },
    {
      key: "size",
      align: "right",
      header: t("fileServer.docs.col.size", { defaultValue: "Size" }),
      cell: (doc) => formatBytes(doc.size_bytes),
    },
    {
      key: "updated",
      header: t("fileServer.docs.col.updated", { defaultValue: "Updated" }),
      cell: (doc) => (
        <Box component="span" sx={(theme) => ({ color: theme.palette.nebula.muted })}>
          {new Date(doc.updated_at).toLocaleString()}
        </Box>
      ),
    },
    {
      key: "actions",
      align: "right",
      header: t("fileServer.col.actions", { defaultValue: "Actions" }),
      cell: (doc) => (
        <IconButton
          size="small"
          disabled={deleting === docKey(doc.name)}
          title={t("fileServer.docs.delete", { defaultValue: "Delete document" })}
          aria-label={t("fileServer.docs.delete", { defaultValue: "Delete document" })}
          onClick={() => void deleteDoc(doc)}
        >
          <TrashIcon width={14} height={14} />
        </IconButton>
      ),
    },
  ];

  return (
    <AdminPage
      wide
      title={t("fileServer.title", { defaultValue: "File server storage" })}
      toolbar={
        <Button
          size="small"
          variant="outlined"
          disabled={loading}
          startIcon={<RefreshCwIcon width={13} height={13} />}
          onClick={() => void refresh()}
        >
          {t("fileServer.refresh", { defaultValue: "Refresh" })}
        </Button>
      }
    >
      <SettingsCard sx={{ mb: "14px", p: "10px 14px" }}>
        <Stack direction="row" alignItems="center" gap={1}>
          <StatusDot status={health?.ok ? "online" : health ? "muted" : "offline"} />
          <Typography sx={{ flex: 1, fontSize: 11.5 }}>
            {health?.ok
              ? t("fileServer.health.online", {
                  defaultValue: "File server online · {{ms}} ms",
                  ms: health.latencyMs,
                })
              : health
                ? `${t("fileServer.health.offline", { defaultValue: "File server unreachable" })}${
                    health.error ? ` - ${health.error}` : ""
                  }`
                : t("fileServer.health.checking", { defaultValue: "Checking file server…" })}
          </Typography>
          <Button size="small" disabled={checkingHealth} onClick={() => void checkHealth()}>
            {t("fileServer.health.recheck", { defaultValue: "Re-check" })}
          </Button>
        </Stack>
      </SettingsCard>

      {error && (
        <Banner tone="danger">
          {t("fileServer.error", { defaultValue: "Could not load files" })}: {error}
        </Banner>
      )}

      <Stack direction="row" gap={1} flexWrap="wrap">
        <StatCard
          label={t("fileServer.stats.used", { defaultValue: "Used" })}
          value={formatBytes(used)}
          sub={`${usagePct}%`}
        />
        <StatCard label={t("fileServer.stats.free", { defaultValue: "Free" })} value={formatBytes(free)} />
        <StatCard
          label={t("fileServer.stats.total", { defaultValue: "Capacity" })}
          value={formatBytes(capacity)}
        />
        <StatCard
          label={t("fileServer.stats.files", { defaultValue: "Files" })}
          value={String(stats?.file_count ?? files.length)}
        />
        <StatCard
          label={t("fileServer.stats.maxFile", { defaultValue: "Max upload" })}
          value={formatBytes(stats?.max_file_size_bytes ?? 0)}
        />
      </Stack>

      <Box
        title={`${formatBytes(used)} / ${formatBytes(capacity)}`}
        sx={(theme) => ({
          mt: "12px",
          height: 6,
          borderRadius: "999px",
          overflow: "hidden",
          background: theme.palette.nebula.card2,
        })}
      >
        <Box
          sx={(theme) => ({
            width: `${usagePct}%`,
            height: "100%",
            background: usagePct > 90 ? theme.palette.nebula.bad : theme.palette.nebula.accent,
          })}
        />
      </Box>

      {files.length > 0 && (
        <Stack direction="row" gap={1.25} flexWrap="wrap" sx={{ mt: "18px" }}>
          {charts.map((chart) => (
            <SettingsCard key={chart.title} sx={{ flex: "1 1 260px", minWidth: 240 }}>
              <Typography sx={{ fontSize: 11.5, fontWeight: 600, mb: "8px" }}>{chart.title}</Typography>
              <Box sx={{ height: 180 }}>
                <DashboardChart config={chart.config} ariaLabel={chart.title} />
              </Box>
            </SettingsCard>
          ))}
        </Stack>
      )}

      <GroupTitle>
        {t("fileServer.calendars.title", { defaultValue: "Active calendars" })} ({calendars.length})
      </GroupTitle>
      <DataTable
        rows={calendars}
        rowKey={(entry) => `${entry.scope}:${entry.key}`}
        empty={t("fileServer.calendars.empty", { defaultValue: "No user calendars stored yet." })}
        columns={[
          {
            key: "scope",
            header: t("fileServer.calendars.user", { defaultValue: "User (server:id)" }),
            cell: (entry) => (
              <Box component="span" sx={{ fontFamily: NEBULA_MONO, fontSize: 11 }}>
                {entry.scope}
              </Box>
            ),
          },
          {
            key: "size",
            align: "right",
            header: t("fileServer.calendars.size", { defaultValue: "Size" }),
            cell: (entry) => formatBytes(entry.size_bytes),
          },
          {
            key: "updated",
            align: "right",
            header: t("fileServer.calendars.updated", { defaultValue: "Updated" }),
            cell: (entry) => new Date(entry.updated_at).toLocaleString(),
          },
        ]}
      />

      <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap" sx={{ mt: "22px", mb: "10px" }}>
        <Box sx={{ width: 260 }}>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder={t("fileServer.searchAll", { defaultValue: "Search files & documents…" })}
          />
        </Box>
        <Stack direction="row" alignItems="center" gap={0.5}>
          <Checkbox
            size="small"
            checked={allVisibleSelected}
            // Some-but-not-all selected is neither checked nor unchecked, and
            // showing it as unchecked makes the next click look like a no-op.
            indeterminate={selectedVisible > 0 && !allVisibleSelected}
            disabled={visibleKeys.length === 0}
            onChange={() => setRangeSelected(visibleKeys, !allVisibleSelected)}
            slotProps={{ input: { "aria-label": t("fileServer.selectAll", { defaultValue: "Select all" }) } }}
          />
          <Typography sx={{ fontSize: 11.5 }}>
            {t("fileServer.selectAll", {
              defaultValue: "Select all ({{count}})",
              count: visibleKeys.length,
            })}
          </Typography>
        </Stack>
        <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
          {t("fileServer.resultCountAll", {
            defaultValue: "{{files}} file(s), {{docs}} doc(s)",
            files: displayedFiles.length,
            docs: displayedDocs.length,
          })}
        </Typography>
        {selected.size > 0 && (
          <Button
            size="small"
            color="error"
            variant="contained"
            disabled={bulkDeleting}
            startIcon={<TrashIcon width={13} height={13} />}
            onClick={() => void bulkDelete()}
          >
            {t("fileServer.bulkDeleteN", {
              defaultValue: "Delete selected ({{count}})",
              count: selected.size,
            })}
          </Button>
        )}
      </Stack>

      <DataTable
        columns={fileColumns}
        rows={displayedFiles}
        rowKey={(file) => file.id}
        selectedKey={null}
        empty={
          loading
            ? t("fileServer.loading", { defaultValue: "Loading…" })
            : error
              ? t("fileServer.error", { defaultValue: "Could not load files" })
              : search.trim()
                ? t("fileServer.noMatch", { defaultValue: "No files match your search." })
                : t("fileServer.empty", { defaultValue: "No files stored." })
        }
      />

      <GroupTitle hint={t("fileServer.docs.noExpiry", { defaultValue: "" })}>
        {t("fileServer.docs.title", { defaultValue: "Live documents" })}
      </GroupTitle>
      <DataTable
        columns={docColumns}
        rows={displayedDocs}
        rowKey={(doc) => doc.name}
        empty={
          loading
            ? t("fileServer.loading", { defaultValue: "Loading…" })
            : error
              ? t("fileServer.docs.error", { defaultValue: "Could not load documents" })
              : search.trim()
                ? t("fileServer.docs.noMatch", { defaultValue: "No documents match your search." })
                : t("fileServer.docs.empty", { defaultValue: "No documents persisted yet." })
        }
      />

      {preview && <PreviewModal file={preview} source={source} onClose={() => setPreview(null)} />}
    </AdminPage>
  );
}

/**
 * The three dashboard charts, coloured from the Nebula palette.
 *
 * Chart.js paints to a canvas and cannot inherit anything through CSS, so
 * Standard's hard-coded hexes would keep its dark-theme greys in a light Nebula
 * window. Reading the palette here is what makes the charts follow the theme
 * like everything around them.
 */
function useNebulaChartConfigs({
  files,
  used,
  free,
  nearFull,
}: Readonly<{ files: readonly AdminFileEntry[]; used: number; free: number; nearFull: boolean }>) {
  const { t } = useTranslation("settings");
  const theme = useTheme();
  const { nebula } = theme.palette;

  return useMemo(() => {
    const series = [nebula.accent, "#8a5cf6", "#f0428a", nebula.ok, nebula.warn, nebula.bad, "#3c8be0"];
    const tick = { color: nebula.muted };
    const donut = (labels: string[], data: number[], colors: string[], cutout: string) => ({
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderColor: nebula.bg0, borderWidth: 2 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout,
        plugins: {
          legend: { display: true, position: "bottom", labels: { color: nebula.muted, boxWidth: 12 } },
        },
      },
    });

    const sizes = new Map<FileCategory, number>();
    for (const file of files) {
      const category = categorize(file.mime_type);
      sizes.set(category, (sizes.get(category) ?? 0) + file.size_bytes);
    }
    const present = CATEGORIES.filter((category) => (sizes.get(category) ?? 0) > 0);

    const access = { public: 0, password: 0, session: 0 };
    for (const file of files) access[file.access_mode] += 1;

    return [
      {
        title: t("fileServer.chart.usage", { defaultValue: "Storage usage" }),
        config: donut(
          [
            t("fileServer.chart.used", { defaultValue: "Used" }),
            t("fileServer.chart.free", { defaultValue: "Free" }),
          ],
          [used, free],
          [nearFull ? nebula.bad : nebula.accent, nebula.card2],
          "68%",
        ),
      },
      {
        title: t("fileServer.chart.byType", { defaultValue: "Size by type" }),
        config: {
          type: "bar",
          data: {
            labels: present.map((category) =>
              t(`fileServer.category.${category}` as "fileServer.category.image", {
                defaultValue: category,
              }),
            ),
            datasets: [
              {
                label: t("fileServer.chart.byType", { defaultValue: "Size by type" }),
                data: present.map((category) => sizes.get(category) ?? 0),
                backgroundColor: present.map((_, index) => series[index % series.length]),
                borderRadius: NEBULA_RADIUS.sm,
              },
            ],
          },
          options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: {
                ticks: { ...tick, callback: (value: number | string) => formatBytes(Number(value)) },
                grid: { color: nebula.line2 },
              },
              y: { ticks: tick, grid: { display: false } },
            },
          },
        },
      },
      {
        title: t("fileServer.chart.byAccess", { defaultValue: "By access mode" }),
        config: donut(
          [
            t("fileServer.access.public", { defaultValue: "Public" }),
            t("fileServer.access.password", { defaultValue: "Password" }),
            t("fileServer.access.session", { defaultValue: "Session" }),
          ],
          [access.public, access.password, access.session],
          [nebula.ok, nebula.warn, nebula.accent],
          "60%",
        ),
      },
    ];
  }, [files, used, free, nearFull, nebula, t]);
}
