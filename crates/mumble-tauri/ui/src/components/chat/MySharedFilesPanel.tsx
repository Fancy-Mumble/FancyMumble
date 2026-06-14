/**
 * MySharedFilesPanel - a chat-splitting bar (like Downloads / Pinned) that
 * lists the *current user's own* uploaded files, styled like the admin file
 * table.  The server scopes every request to the caller's session JWT, so a
 * normal user only ever sees their own files; cross-user access stays
 * admin-only.  Reuses the shared file-server presentation components.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { message, confirm as askConfirm } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppStore } from "../../store";
import { formatBytes } from "../../utils/format";
import type { AdminFileEntry } from "../../types";
import { FolderIcon, RefreshCwIcon, ImageIcon, TrashIcon, LinkIcon } from "../../icons";
import { categorize, isPreviewable } from "../fileserver/fileTypes";
import { CategoryIcon, FileThumb, PreviewModal, ExpiryBadge } from "../fileserver/FilePreview";
import { myListFiles, deleteMyFile, myFileLink, makeMyFilesSource, dropPreview } from "../fileserver/fileServerMe";
import styles from "./MySharedFilesPanel.module.css";

export default function MySharedFilesPanel() {
  const { t } = useTranslation(["chat", "settings"]);
  const config = useAppStore((s) => s.fileServerConfig);
  const channels = useAppStore((s) => s.channels);

  const baseUrl = config?.baseUrl;
  const sessionJwt = config?.sessionJwt;

  const [files, setFiles] = useState<AdminFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AdminFileEntry | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!baseUrl || !sessionJwt) return;
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
  }, [baseUrl, sessionJwt]);

  useEffect(() => { void refresh(); }, [refresh]);

  const source = useMemo(
    () => (baseUrl && sessionJwt ? makeMyFilesSource({ baseUrl, sessionJwt }) : null),
    [baseUrl, sessionJwt],
  );

  const channelName = useCallback(
    (id: number) => channels.find((c) => c.id === id)?.name || t("fileServer.root", { ns: "settings", defaultValue: "Root" }),
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
      if (!baseUrl || !sessionJwt) return;
      const ok = await askConfirm(
        t("mySharedFiles.confirmDelete", { defaultValue: "Delete \"{{name}}\"? The shared link will stop working.", name: f.filename }),
        { title: t("mySharedFiles.deleteTitle", { defaultValue: "Delete file" }), kind: "warning" },
      );
      if (!ok) return;
      setDeleting(f.id);
      try {
        await deleteMyFile({ baseUrl, sessionJwt }, f.id);
        dropPreview(f.id);
        setFiles((prev) => prev.filter((x) => x.id !== f.id));
      } catch (e) {
        await message(e instanceof Error ? e.message : String(e), { title: t("mySharedFiles.deleteFailed", { defaultValue: "Delete failed" }), kind: "error" });
      } finally {
        setDeleting(null);
      }
    },
    [baseUrl, sessionJwt, t],
  );

  let body: React.ReactNode;
  if (!source) {
    body = <p className={styles.empty}>{t("mySharedFiles.unavailable", { defaultValue: "File sharing is not enabled on this server." })}</p>;
  } else if (loading && files.length === 0) {
    body = <p className={styles.empty}>{t("mySharedFiles.loading", { defaultValue: "Loading your files…" })}</p>;
  } else if (error) {
    body = <p className={styles.empty}>{t("mySharedFiles.error", { defaultValue: "Could not load your files" })}: {error}</p>;
  } else if (files.length === 0) {
    body = <p className={styles.empty}>{t("mySharedFiles.empty", { defaultValue: "You haven't shared any files yet." })}</p>;
  } else {
    body = (
      <table className={styles.table}>
        <thead>
          <tr>
            <th />
            <th>{t("mySharedFiles.colName", { defaultValue: "Name" })}</th>
            <th>{t("mySharedFiles.colType", { defaultValue: "Type" })}</th>
            <th className={styles.num}>{t("mySharedFiles.colSize", { defaultValue: "Size" })}</th>
            <th>{t("mySharedFiles.colAccess", { defaultValue: "Access" })}</th>
            <th>{t("mySharedFiles.colChannel", { defaultValue: "Channel" })}</th>
            <th>{t("mySharedFiles.colUploaded", { defaultValue: "Uploaded" })}</th>
            <th>{t("mySharedFiles.colExpires", { defaultValue: "Expires" })}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.id}>
              <td><FileThumb file={f} source={source} onOpen={setPreview} /></td>
              <td className={styles.nameCell}>
                <span className={styles.fileName} title={f.filename}>{f.filename}</span>
              </td>
              <td className={styles.typeCell}>
                <CategoryIcon cat={categorize(f.mime_type)} size={14} />{" "}
                <span title={f.mime_type}>{t(`fileServer.category.${categorize(f.mime_type)}`, { ns: "settings", defaultValue: categorize(f.mime_type) })}</span>
              </td>
              <td className={styles.num}>{formatBytes(f.size_bytes)}</td>
              <td>
                <span className={`${styles.accessBadge} ${styles[`access_${f.access_mode}`]}`}>
                  {t(`fileServer.access.${f.access_mode}`, { ns: "settings", defaultValue: f.access_mode })}
                </span>
              </td>
              <td title={`#${f.channel_id}`}>{channelName(f.channel_id)}</td>
              <td className={styles.dateCell}>{new Date(f.uploaded_at).toLocaleString()}</td>
              <td className={styles.dateCell}>
                {f.expires_at != null
                  ? <ExpiryBadge expiresAt={f.expires_at} />
                  : <span className={styles.noExpiry}>{t("mySharedFiles.neverExpires", { defaultValue: "Never" })}</span>}
              </td>
              <td className={styles.actionsCell}>
                {f.access_mode === "public" && (
                  <button type="button" className={styles.iconBtn} onClick={() => void handleShareLink(f)} title={t("mySharedFiles.openLink", { defaultValue: "Open share link in browser" })}>
                    <LinkIcon width={15} height={15} />
                  </button>
                )}
                {isPreviewable(f.mime_type) && f.access_mode !== "password" && (
                  <button type="button" className={styles.iconBtn} onClick={() => setPreview(f)} title={t("mySharedFiles.preview", { defaultValue: "Preview" })}>
                    <ImageIcon width={15} height={15} />
                  </button>
                )}
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.deleteBtn}`}
                  onClick={() => void handleDelete(f)}
                  disabled={deleting === f.id}
                  title={t("mySharedFiles.delete", { defaultValue: "Delete" })}
                >
                  <TrashIcon width={15} height={15} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>
          <FolderIcon width={14} height={14} /> {t("mySharedFiles.title", { defaultValue: "My shared files" })}
        </span>
        {files.length > 0 && <span className={styles.count}>{files.length}</span>}
        <div className={styles.headerActions}>
          <button type="button" className={styles.refreshBtn} onClick={() => void refresh()} disabled={loading}>
            <RefreshCwIcon width={14} height={14} /> {t("mySharedFiles.refresh", { defaultValue: "Refresh" })}
          </button>
        </div>
      </div>
      <div className={styles.body}>{body}</div>
      {preview && source && <PreviewModal file={preview} source={source} onClose={() => setPreview(null)} />}
    </div>
  );
}
