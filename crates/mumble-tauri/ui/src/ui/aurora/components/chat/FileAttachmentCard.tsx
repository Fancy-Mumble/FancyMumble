import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { decodeFileAttachmentPayload, previewKindForFilename, type FileAttachmentInfo } from "@core/features/chat/fileAttachments";
import { useAppStore } from "@core/store";
import { formatBytes } from "@core/utils/format";
import { Button, TextField } from "../primitives";
import styles from "./FileAttachmentCard.module.css";

export function FileAttachmentMarker({ payload }: { payload: string }) {
  const info = useMemo(() => decodeFileAttachmentPayload(payload), [payload]);
  return info ? <FileAttachmentCard info={info} /> : null;
}

export function FileAttachmentCard({ info }: { info: FileAttachmentInfo }) {
  const downloadFile = useAppStore((state) => state.downloadFile);
  const addDownload = useAppStore((state) => state.addDownload);
  const [password, setPassword] = useState("");
  const [askPassword, setAskPassword] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = previewKindForFilename(info.filename);
  const expired = !!info.expiresAt && info.expiresAt * 1000 < Date.now();
  const previewSource = savedPath ? convertFileSrc(savedPath) : info.mode === "public" ? info.url : null;

  const download = async () => {
    if (info.mode === "password" && !askPassword) { setAskPassword(true); return; }
    setBusy(true); setError(null);
    try {
      const destination = await save({ defaultPath: info.filename });
      if (!destination) return;
      const written = await downloadFile({ url: info.url, destPath: destination, password: info.mode === "password" ? password : undefined });
      addDownload({ filename: info.filename, destPath: destination, sizeBytes: written, sourceUrl: info.url, mode: info.mode });
      setSavedPath(destination); setAskPassword(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  return <section className={styles.fileCard}>
    {previewSource && kind === "image" && <img src={previewSource} alt={info.filename} loading="lazy" />}
    {previewSource && kind === "audio" && <audio src={previewSource} controls preload="none"><track kind="captions" /></audio>}
    {previewSource && kind === "video" && <video src={previewSource} controls preload="metadata"><track kind="captions" /></video>}
    <div className={styles.fileDetails}><strong>{info.filename}</strong><small>{formatBytes(info.sizeBytes)} · {info.mode}{info.expiresAt ? ` · expires ${new Date(info.expiresAt * 1000).toLocaleString()}` : ""}</small></div>
    {askPassword && <TextField label="File password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />}
    {error && <p role="alert">{error}</p>}
    <footer><Button variant="primary" disabled={busy || expired || (askPassword && !password)} onClick={() => void download()}>{expired ? "Expired" : busy ? "Saving…" : savedPath ? "Save another copy" : "Download"}</Button>{(info.mode === "public" || info.mode === "password") && !expired && <Button onClick={() => void openUrl(info.url)}>Open</Button>}</footer>
  </section>;
}
