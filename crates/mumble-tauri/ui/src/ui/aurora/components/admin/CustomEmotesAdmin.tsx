import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@core/store";
import { inferMimeType } from "@core/utils/media";
import { Button, TextField } from "../primitives";
import styles from "./CustomEmotesAdmin.module.css";

const ALLOWED_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

export default function CustomEmotesAdmin() {
  const emotes = useAppStore((state) => state.customServerEmotes);
  const supported = useAppStore((state) => state.fileServerCapabilities?.features.custom_emotes ?? false);
  const canManage = useAppStore((state) => state.fileServerConfig?.canManageEmotes ?? false);
  const [shortcode, setShortcode] = useState("");
  const [aliasEmoji, setAliasEmoji] = useState("");
  const [description, setDescription] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!supported || !canManage)
    return (
      <div className={styles.empty}>
        This server does not expose custom-emote administration, or your account lacks permission.
      </div>
    );
  const pick = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Emote image", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }],
    });
    if (typeof selected === "string") setFilePath(selected);
  };
  const add = async () => {
    if (!filePath || !shortcode.trim() || !aliasEmoji.trim()) {
      setStatus("Shortcode, alias and an image are required.");
      return;
    }
    const mimeType = inferMimeType(filePath);
    if (!mimeType || !ALLOWED_MIME.includes(mimeType)) {
      setStatus("Choose a PNG, JPEG, GIF, WebP or SVG image.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await useAppStore.getState().addCustomEmote({
        shortcode: shortcode.trim(),
        aliasEmoji: aliasEmoji.trim(),
        description: description.trim() || undefined,
        filePath,
        mimeType,
      });
      setShortcode("");
      setAliasEmoji("");
      setDescription("");
      setFilePath(null);
      setStatus("Custom emote uploaded.");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.root}>
      <header>
        <div>
          <h3>Custom emotes</h3>
          <p>Add server-owned reaction images and aliases.</p>
        </div>
      </header>
      {status && <div className={styles.status}>{status}</div>}
      <section className={styles.form}>
        <TextField
          label="Shortcode"
          value={shortcode}
          onChange={(event) => setShortcode(event.target.value.replace(/[^A-Za-z0-9_-]/g, ""))}
          placeholder="party_parrot"
          maxLength={64}
        />
        <TextField
          label="Emoji alias"
          value={aliasEmoji}
          onChange={(event) => setAliasEmoji(event.target.value)}
          placeholder="🎉"
          maxLength={32}
        />
        <TextField
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={256}
        />
        <div className={styles.file}>
          <Button onClick={() => void pick()}>{filePath ? "Change image" : "Choose image"}</Button>
          <span>{filePath ?? "No image selected"}</span>
        </div>
        <Button variant="primary" disabled={busy} onClick={() => void add()}>
          {busy ? "Uploading…" : "Add emote"}
        </Button>
      </section>
      <section className={styles.list}>
        {emotes.map((emote) => (
          <article key={emote.shortcode}>
            {emote.imageDataUrl ? <img src={emote.imageDataUrl} alt="" /> : <span>{emote.aliasEmoji}</span>}
            <div>
              <strong>:{emote.shortcode}:</strong>
              <small>
                {emote.aliasEmoji} · {emote.description || "No description"}
              </small>
            </div>
            <Button
              variant="danger"
              onClick={() =>
                void useAppStore
                  .getState()
                  .removeCustomEmote(emote.shortcode)
                  .catch((reason) => setStatus(String(reason)))
              }
            >
              Remove
            </Button>
          </article>
        ))}
        {emotes.length === 0 && <div className={styles.empty}>No custom emotes are installed.</div>}
      </section>
    </div>
  );
}
