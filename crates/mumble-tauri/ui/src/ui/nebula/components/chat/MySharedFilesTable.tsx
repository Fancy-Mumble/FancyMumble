/**
 * "My shared files" - the caller's own uploads - as Nebula's own table.
 *
 * Standard's panel was borrowed here first, which put a CSS-module table
 * inside a MUI dialog: its own surface colour, its own hairlines, its own
 * chips, none of which this pack's theme could reach, and a padded dialog
 * ring around the lot. The rows are the same rows; this renders them through
 * `DataTable`, the primitive the admin pages already use, so the dialog is
 * one surface, the header pins, and every colour comes from the palette.
 *
 * The file-preview atoms stay shared. What a thumbnail has to do - lazily
 * fetch bytes back through the proxy and cache the object URL - is not a
 * question a visual pack answers differently.
 *
 * The server scopes every request to the caller's session, so a normal user
 * only ever sees their own files; cross-user access stays admin-only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, IconButton, Tooltip, Typography } from "@mui/material";
import { message, confirm as askConfirm } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppStore } from "@core/store";
import { formatBytes } from "@core/utils/format";
import { expiryInfo } from "@core/utils/expiry";
import { categorize, isPreviewable } from "@core/features/fileserver/fileTypes";
import type { AdminFileEntry } from "@core/types";
import { ExternalLinkIcon, ImageIcon, RefreshCwIcon, TrashIcon, UploadIcon } from "@ui/icons";
import { CategoryIcon, FileThumb, PreviewModal } from "@standard/components/fileserver/FilePreview";
import {
  myListFiles,
  deleteMyFile,
  myFileLink,
  myFilesAvailable,
  myFileLinkSupported,
  makeMyFilesSource,
  dropPreview,
} from "@standard/components/fileserver/fileServerMe";
import { Stack, StatChip, type StatChipTone } from "../primitives";
import { DataTable, type Column } from "../admin/controls";

/**
 * Short, locale-aware "date, time" for the Uploaded column.
 *
 * `toLocaleString()` spends its width on seconds and a four-digit year nobody
 * reads in a file list, and a column that wide costs the actions column its
 * place. The full stamp stays one hover away.
 */
const shortStamp = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

/** Access modes carry a scope, and a scope reads as a tone. */
const ACCESS_TONE: Record<string, StatChipTone> = {
  public: "ok",
  password: "warn",
  session: "accent",
};

/** One line, ellipsised: a wrapping filename or channel name turns a row into
 *  three and shoves the actions off the edge. */
const ellipsis = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

export default function MySharedFilesTable() {
  const { t } = useTranslation(["chat", "settings"]);
  const config = useAppStore((s) => s.fileServerConfig);
  const kind = useAppStore((s) => s.fileServerKind);
  const channels = useAppStore((s) => s.channels);

  const baseUrl = config?.baseUrl ?? "";
  const sessionJwt = config?.sessionJwt ?? "";
  // The canon carries neither of those and still serves this table, so what
  // gates the work is whether the server can answer, not whether it handed
  // over HTTP credentials.
  const available = myFilesAvailable(kind, config);

  const [files, setFiles] = useState<AdminFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AdminFileEntry | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await myListFiles({ baseUrl, sessionJwt });
      setFiles(resp.files);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [available, baseUrl, sessionJwt]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const source = useMemo(
    () => (available ? makeMyFilesSource({ baseUrl, sessionJwt }) : null),
    [available, baseUrl, sessionJwt],
  );

  const channelName = useCallback(
    (id: number) =>
      channels.find((c) => c.id === id)?.name ||
      t("fileServer.root", { ns: "settings", defaultValue: "Root" }),
    [channels, t],
  );

  const handleShareLink = useCallback(
    async (f: AdminFileEntry) => {
      if (!baseUrl || !sessionJwt) return;
      try {
        const url = await myFileLink({ baseUrl, sessionJwt }, f.id);
        await openUrl(url);
      } catch (e) {
        await message(e instanceof Error ? e.message : String(e), {
          title: t("mySharedFiles.linkFailed", { defaultValue: "Couldn't open share link" }),
          kind: "error",
        });
      }
    },
    [baseUrl, sessionJwt, t],
  );

  const handleDelete = useCallback(
    async (f: AdminFileEntry) => {
      if (!available) return;
      const ok = await askConfirm(
        t("mySharedFiles.confirmDelete", {
          defaultValue: 'Delete "{{name}}"? The shared link will stop working.',
          name: f.filename,
        }),
        { title: t("mySharedFiles.deleteTitle", { defaultValue: "Delete file" }), kind: "warning" },
      );
      if (!ok) return;
      setDeleting(f.id);
      try {
        await deleteMyFile({ baseUrl, sessionJwt }, f.id);
        dropPreview(f.id);
        setFiles((prev) => prev.filter((x) => x.id !== f.id));
      } catch (e) {
        await message(e instanceof Error ? e.message : String(e), {
          title: t("mySharedFiles.deleteFailed", { defaultValue: "Delete failed" }),
          kind: "error",
        });
      } finally {
        setDeleting(null);
      }
    },
    [available, baseUrl, sessionJwt, t],
  );

  const columns: readonly Column<AdminFileEntry>[] = useMemo(
    () => [
      {
        key: "thumb",
        header: "",
        width: 66,
        cell: (f) => (source ? <FileThumb file={f} source={source} onOpen={setPreview} /> : null),
      },
      {
        key: "name",
        header: t("mySharedFiles.colName", { defaultValue: "Name" }),
        cell: (f) => (
          <Box component="span" title={f.filename} sx={ellipsis}>
            {f.filename}
          </Box>
        ),
      },
      {
        key: "type",
        header: t("mySharedFiles.colType", { defaultValue: "Type" }),
        width: 112,
        cell: (f) => (
          <Stack direction="row" alignItems="center" gap="6px" sx={{ minWidth: 0 }}>
            <CategoryIcon cat={categorize(f.mime_type)} size={13} />
            <Box
              component="span"
              title={f.mime_type}
              sx={(theme) => ({ ...ellipsis, color: theme.palette.nebula.muted })}
            >
              {t(`fileServer.category.${categorize(f.mime_type)}`, {
                ns: "settings",
                defaultValue: categorize(f.mime_type),
              })}
            </Box>
          </Stack>
        ),
      },
      {
        key: "size",
        header: t("mySharedFiles.colSize", { defaultValue: "Size" }),
        width: 84,
        align: "right",
        cell: (f) => (
          <Box component="span" sx={(theme) => ({ whiteSpace: "nowrap", color: theme.palette.nebula.muted })}>
            {formatBytes(f.size_bytes)}
          </Box>
        ),
      },
      {
        key: "access",
        header: t("mySharedFiles.colAccess", { defaultValue: "Access" }),
        width: 96,
        cell: (f) => (
          <StatChip tone={ACCESS_TONE[f.access_mode] ?? "neutral"}>
            {t(`fileServer.access.${f.access_mode}`, { ns: "settings", defaultValue: f.access_mode })}
          </StatChip>
        ),
      },
      {
        key: "channel",
        header: t("mySharedFiles.colChannel", { defaultValue: "Channel" }),
        width: 148,
        cell: (f) => (
          <Box
            component="span"
            title={`${channelName(f.channel_id)} (#${f.channel_id})`}
            sx={(theme) => ({ ...ellipsis, color: theme.palette.nebula.muted })}
          >
            {channelName(f.channel_id)}
          </Box>
        ),
      },
      {
        key: "uploaded",
        header: t("mySharedFiles.colUploaded", { defaultValue: "Uploaded" }),
        width: 122,
        cell: (f) => (
          <Box
            component="span"
            title={new Date(f.uploaded_at).toLocaleString()}
            sx={(theme) => ({ whiteSpace: "nowrap", color: theme.palette.nebula.muted })}
          >
            {shortStamp.format(f.uploaded_at)}
          </Box>
        ),
      },
      {
        key: "expires",
        header: t("mySharedFiles.colExpires", { defaultValue: "Expires" }),
        width: 100,
        cell: (f) => <ExpiryChip expiresAt={f.expires_at} />,
      },
      {
        key: "actions",
        header: "",
        width: 112,
        align: "right",
        cell: (f) => (
          <Stack direction="row" gap="2px" justifyContent="flex-end">
            {f.access_mode === "public" && myFileLinkSupported(kind) && (
              <Tooltip title={t("mySharedFiles.openLink", { defaultValue: "Open share link in browser" })}>
                <IconButton size="small" onClick={() => void handleShareLink(f)}>
                  <ExternalLinkIcon width={14} height={14} />
                </IconButton>
              </Tooltip>
            )}
            {isPreviewable(f.mime_type) && f.access_mode !== "password" && (
              <Tooltip title={t("mySharedFiles.preview", { defaultValue: "Preview" })}>
                <IconButton size="small" onClick={() => setPreview(f)}>
                  <ImageIcon width={14} height={14} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t("mySharedFiles.delete", { defaultValue: "Delete" })}>
              <IconButton
                size="small"
                disabled={deleting === f.id}
                onClick={() => void handleDelete(f)}
                sx={(theme) => ({ "&:hover": { color: theme.palette.nebula.bad } })}
              >
                <TrashIcon width={14} height={14} />
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
    ],
    [channelName, deleting, handleDelete, handleShareLink, kind, source, t],
  );

  const empty = !available
    ? t("mySharedFiles.unavailable", { defaultValue: "File sharing is not enabled on this server." })
    : error
      ? `${t("mySharedFiles.error", { defaultValue: "Could not load your files" })}: ${error}`
      : loading
        ? t("mySharedFiles.loading", { defaultValue: "Loading your files…" })
        : t("mySharedFiles.empty", { defaultValue: "You haven't shared any files yet." });

  return (
    <Stack direction="column" sx={{ flex: 1, minHeight: 0, minWidth: 0 }}>
      {/* The dialog's own bar: the paper draws the surface, so this is a
          hairline strip rather than a second card. */}
      <Stack
        direction="row"
        alignItems="center"
        gap="10px"
        sx={(theme) => ({
          px: "14px",
          py: "10px",
          flexShrink: 0,
          borderBottom: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        <UploadIcon width={14} height={14} />
        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
          {t("mySharedFiles.title", { defaultValue: "My shared files" })}
        </Typography>
        {files.length > 0 && <StatChip tone="dim">{files.length}</StatChip>}
        <Button
          size="small"
          variant="text"
          disabled={loading}
          onClick={() => void refresh()}
          startIcon={<RefreshCwIcon width={13} height={13} />}
          sx={{ ml: "auto" }}
        >
          {t("mySharedFiles.refresh", { defaultValue: "Refresh" })}
        </Button>
      </Stack>

      <DataTable
        stickyHeader
        flush
        layout="fixed"
        minWidth={1060}
        columns={columns}
        rows={files}
        rowKey={(f) => f.id}
        empty={empty}
      />

      {preview && source && <PreviewModal file={preview} source={source} onClose={() => setPreview(null)} />}
    </Stack>
  );
}

/** The remaining lifetime as a tone: gone, going, fine, ample. */
function ExpiryChip({ expiresAt }: { readonly expiresAt: number | null }) {
  const { t } = useTranslation(["chat", "settings"]);
  const info = expiryInfo(expiresAt);
  if (!info.hasExpiry || info.relative == null) {
    return (
      <Box component="span" sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.dim })}>
        {t("mySharedFiles.neverExpires", { defaultValue: "Never" })}
      </Box>
    );
  }
  const tone: StatChipTone = info.expired ? "bad" : info.soon ? "warn" : info.far ? "ok" : "neutral";
  const title = info.expired
    ? t("fileServer.expiredAt", { ns: "settings", defaultValue: "Expired {{when}}", when: info.absolute })
    : t("fileServer.expiresAt", { ns: "settings", defaultValue: "Expires {{when}}", when: info.absolute });
  return (
    <StatChip tone={tone} title={title} sx={{ px: "8px", whiteSpace: "nowrap" }}>
      {info.relative}
    </StatChip>
  );
}
