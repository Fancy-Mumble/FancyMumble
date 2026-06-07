/**
 * LiveDocLaunchDialog - modal that replaces the previous
 * `window.prompt` with a styled chooser matching `FileShareDialog`.
 *
 * Two modes (rendered as a radio group, same as the file-share
 * dialog's access-mode selector):
 *
 *   * "new"      - create a fresh blank document (just a title).
 *   * "existing" - open an already-saved document by slug.  Server
 *                  rehydrates from the most recent revision stored
 *                  on the file-server.
 *
 * Users on either mode may optionally seed the freshly-opened
 * document with the contents of a local `.md` file - this is the
 * "open existing markdown file for editing" path.  The selected
 * content is delivered through `onSubmit` so the parent can pipe
 * it into the editor after the WS connection comes up.
 *
 * Visual styling is shared with FileShareDialog via its CSS module;
 * no new CSS file is needed.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { FileDropZone } from "../../elements/FileDropZone";
import { FileTextIcon } from "../../../icons";
import { Modal } from "../../elements/Modal";
import styles from "../file/FileShareDialog.module.css";

type LaunchMode = "new" | "existing";

export interface LiveDocLaunchChoice {
  readonly mode: LaunchMode;
  readonly title: string;
  /** Whether to publish the document to the current channel immediately
   *  ("publish") or keep it private until explicitly published
   *  ("private"). */
  readonly visibility: "private" | "publish";
  /** Optional `.md` text that the parent should insert as the initial
   *  document body once the editor is mounted. */
  readonly seedMarkdown?: string;
  /** Filename the seed markdown came from (used to derive a stable
   *  slug when the user did not supply a title). */
  readonly seedFilename?: string;
}

interface LiveDocLaunchDialogProps {
  readonly open: boolean;
  readonly onSubmit: (choice: LiveDocLaunchChoice) => void;
  readonly onCancel: () => void;
}

const MAX_SEED_BYTES = 1 * 1024 * 1024;

export default function LiveDocLaunchDialog({
  open,
  onSubmit,
  onCancel,
}: LiveDocLaunchDialogProps) {
  const { t } = useTranslation("chat");
  const { t: tc } = useTranslation("common");
  const [mode, setMode] = useState<LaunchMode>("new");
  const [visibility, setVisibility] = useState<"private" | "publish">("private");
  const [title, setTitle] = useState("");
  const [seedMarkdown, setSeedMarkdown] = useState<string | undefined>(undefined);
  const [seedFilename, setSeedFilename] = useState<string | undefined>(undefined);
  const [seedError, setSeedError] = useState<string | null>(null);
  // Collapsed by default: a simple "name + open" flow.  The advanced section
  // (new/existing, private/publish, seed file) is revealed via "More options".
  const [showAdvanced, setShowAdvanced] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMode("new");
    setVisibility("private");
    setShowAdvanced(false);
    setTitle(t("liveDoc.untitled"));
    setSeedMarkdown(undefined);
    setSeedFilename(undefined);
    setSeedError(null);
    requestAnimationFrame(() => {
      const el = titleRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
  }, [open, t]);

  const handleFile = useCallback(
    async (file: File) => {
      setSeedError(null);
      if (file.size > MAX_SEED_BYTES) {
        setSeedError(t("liveDoc.launch.seedTooLarge"));
        return;
      }
      const text = await file.text();
      setSeedMarkdown(text);
      setSeedFilename(file.name);
      if (!title) {
        setTitle(file.name.replace(/\.md$/i, ""));
      }
    },
    [t, title],
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const trimmed = title.trim();
      console.log("[LiveDocLaunchDialog] submit:", { mode, trimmed, hasSeed: !!seedMarkdown });
      if (!trimmed) {
        console.warn("[LiveDocLaunchDialog] aborted: empty title");
        return;
      }
      onSubmit({ mode, title: trimmed, visibility, seedMarkdown, seedFilename });
    },
    [mode, title, visibility, seedMarkdown, seedFilename, onSubmit],
  );

  if (!open) return null;

  return (
    <Modal onClose={onCancel} closeOnEsc={false} closeOnOverlayClick={false} zIndex={200} overlayClassName={styles.overlayBlur}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={t("liveDoc.launch.title")}>
        <div className={styles.header}>
          <h2 className={styles.title}>{t("liveDoc.launch.title")}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onCancel}
            aria-label={tc("actions.close")}
          >
            ×
          </button>
        </div>

        <form className={styles.body} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="live-doc-title">
              {t("liveDoc.launch.titleLabel")}
            </label>
            <input
              ref={titleRef}
              id="live-doc-title"
              className={styles.input}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("liveDoc.newDocPlaceholder")}
              maxLength={120}
            />
          </div>

          <button
            type="button"
            className={styles.moreToggle}
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? t("liveDoc.launch.fewerOptions") : t("liveDoc.launch.moreOptions")}
          </button>

          {showAdvanced && (
            <>
              <div className={styles.modeList} role="radiogroup" aria-label={t("liveDoc.launch.modeLabel")}>
                {(["new", "existing"] as const).map((m) => {
                  const active = mode === m;
                  const cls = [styles.modeOption, active ? styles.modeOptionActive : ""].filter(Boolean).join(" ");
                  return (
                    <label key={m} className={cls}>
                      <input
                        type="radio"
                        name="live-doc-launch-mode"
                        value={m}
                        checked={active}
                        onChange={() => setMode(m)}
                        className={styles.radio}
                      />
                      <div className={styles.modeText}>
                        <div className={styles.modeName}>
                          {m === "new" ? t("liveDoc.launch.modeNew") : t("liveDoc.launch.modeExisting")}
                        </div>
                        <div className={styles.modeDesc}>
                          {m === "new" ? t("liveDoc.launch.modeNewDesc") : t("liveDoc.launch.modeExistingDesc")}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              <div className={styles.modeList} role="radiogroup" aria-label={t("liveDoc.launch.visibilityLabel")}>
                {(["publish", "private"] as const).map((v) => {
                  const active = visibility === v;
                  const cls = [styles.modeOption, active ? styles.modeOptionActive : ""].filter(Boolean).join(" ");
                  return (
                    <label key={v} className={cls}>
                      <input
                        type="radio"
                        name="live-doc-visibility"
                        value={v}
                        checked={active}
                        onChange={() => setVisibility(v)}
                        className={styles.radio}
                      />
                      <div className={styles.modeText}>
                        <div className={styles.modeName}>
                          {v === "publish" ? t("liveDoc.launch.visPublish") : t("liveDoc.launch.visPrivate")}
                        </div>
                        <div className={styles.modeDesc}>
                          {v === "publish" ? t("liveDoc.launch.visPublishDesc") : t("liveDoc.launch.visPrivateDesc")}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {mode === "new" && (
                <div className={styles.field}>
                  <label className={styles.label}>
                    {t("liveDoc.launch.seedLabel")}{" "}
                    <span className={styles.labelOptional}>{tc("actions.optional")}</span>
                  </label>
                  <FileDropZone
                    accept=".md,.markdown,text/markdown,text/plain"
                    onFile={(f) => void handleFile(f)}
                    label={t("liveDoc.launch.seedDropHint")}
                    preview={
                      seedFilename ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <FileTextIcon width={20} height={20} aria-hidden="true" />
                          <span>{seedFilename}</span>
                        </span>
                      ) : undefined
                    }
                    onRemove={
                      seedFilename
                        ? () => {
                            setSeedMarkdown(undefined);
                            setSeedFilename(undefined);
                            setSeedError(null);
                          }
                        : undefined
                    }
                  />
                  {seedError && <p className={styles.message} role="alert">{seedError}</p>}
                </div>
              )}
            </>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onCancel}>
              {tc("actions.cancel")}
            </button>
            <button type="submit" className={styles.uploadBtn} disabled={title.trim().length === 0}>
              {t("liveDoc.openButton")}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
