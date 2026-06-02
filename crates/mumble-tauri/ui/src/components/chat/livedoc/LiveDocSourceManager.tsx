/**
 * LiveDocSourceManager - Word-style Source Manager.
 *
 * Left pane = the per-user **Master List** (reusable across documents,
 * persisted to private storage); right pane = this document's **Current
 * List** (synced via Yjs).  Copy sources between them, create / edit /
 * delete, and import / export BibTeX.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type * as Y from "yjs";
import { ArrowRightIcon, ArrowLeftIcon, CloseIcon, EditIcon, TrashIcon, PlusIcon } from "../../../icons";
import { sourceLabel, type CslItem } from "./liveDocCslTypes";
import { useLiveDocSources, setLiveDocSource, deleteLiveDocSource } from "./useLiveDocSources";
import { useLiveDocMasterSourcesStore } from "./liveDocMasterSourcesStore";
import { parseBibtex, toBibtex } from "./liveDocBibtex";
import LiveDocSourceEditor from "./LiveDocSourceEditor";
import LiveDocBibtexImportDialog from "./LiveDocBibtexImportDialog";
import styles from "./LiveDocCitations.module.css";

interface LiveDocSourceManagerProps {
  readonly doc: Y.Doc;
  readonly onClose: () => void;
}

type EditTarget = { item: CslItem | null } | null;

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/x-bibtex" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function LiveDocSourceManager({ doc, onClose }: LiveDocSourceManagerProps) {
  const { t } = useTranslation("chat");
  const current = useLiveDocSources(doc);
  const master = useLiveDocMasterSourcesStore((s) => s.sources);
  const loadMaster = useLiveDocMasterSourcesStore((s) => s.load);
  const upsertMaster = useLiveDocMasterSourcesStore((s) => s.upsert);
  const removeMaster = useLiveDocMasterSourcesStore((s) => s.remove);
  const [editing, setEditing] = useState<EditTarget>(null);
  const [bibtexOpen, setBibtexOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadMaster();
  }, [loadMaster]);

  const currentIds = new Set(current.map((s) => s.id));

  const importBibtex = (text: string) => {
    const items = parseBibtex(text);
    for (const item of items) {
      setLiveDocSource(doc, item);
      upsertMaster(item);
    }
  };

  const tb = (k: string, d: string) => t(`liveDoc.citations.${k}`, { defaultValue: d });

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>{tb("manageSources", "Manage Sources")}</span>
          <button type="button" className={styles.dialogClose} onClick={onClose} aria-label={tb("close", "Close")}>
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <div className={styles.toolbar}>
          <button type="button" className={styles.btn} onClick={() => setEditing({ item: null })}>
            <PlusIcon width={14} height={14} aria-hidden="true" /> {tb("newSource", "New source")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".bib,.bibtex,text/plain"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void file.text().then(importBibtex).catch((err) => console.warn("bibtex import failed:", err));
              e.target.value = "";
            }}
          />
          <button type="button" className={styles.btn} onClick={() => setBibtexOpen(true)}>
            {tb("newFromBibtex", "New from BibTeX")}
          </button>
          <button type="button" className={styles.btn} onClick={() => fileRef.current?.click()}>
            {tb("importBibtex", "Import BibTeX")}
          </button>
          <button type="button" className={styles.btn} onClick={() => download("references.bib", toBibtex(current))} disabled={current.length === 0}>
            {tb("exportBibtex", "Export BibTeX")}
          </button>
          <span className={styles.spacer} />
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={onClose}>
            {tb("done", "Done")}
          </button>
        </div>

        <div className={styles.panes}>
          {/* Master list */}
          <div className={styles.pane}>
            <div className={styles.paneTitle}>{tb("masterList", "Master List (your library)")}</div>
            {master.length === 0 ? (
              <div className={styles.empty}>{tb("masterEmpty", "No saved sources yet.")}</div>
            ) : (
              <ul className={styles.list}>
                {master.map((item) => (
                  <li key={item.id} className={styles.item}>
                    <span className={styles.itemLabel} title={sourceLabel(item)}>
                      {currentIds.has(item.id) ? "✓ " : ""}
                      {sourceLabel(item)}
                    </span>
                    <span className={styles.itemActions}>
                      <button type="button" className={styles.iconBtn} title={tb("copyToCurrent", "Copy to document")} onClick={() => setLiveDocSource(doc, item)}>
                        <ArrowRightIcon width={14} height={14} />
                      </button>
                      <button type="button" className={styles.iconBtn} title={tb("edit", "Edit")} onClick={() => setEditing({ item })}>
                        <EditIcon width={14} height={14} />
                      </button>
                      <button type="button" className={styles.iconBtn} title={tb("delete", "Delete")} onClick={() => removeMaster(item.id)}>
                        <TrashIcon width={14} height={14} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Copy controls */}
          <div className={styles.paneMid} aria-hidden="true">
            <ArrowRightIcon width={18} height={18} />
            <ArrowLeftIcon width={18} height={18} />
          </div>

          {/* Current list */}
          <div className={styles.pane}>
            <div className={styles.paneTitle}>{tb("currentList", "Current List (this document)")}</div>
            {current.length === 0 ? (
              <div className={styles.empty}>{tb("currentEmpty", "No sources in this document yet.")}</div>
            ) : (
              <ul className={styles.list}>
                {current.map((item) => (
                  <li key={item.id} className={styles.item}>
                    <button type="button" className={styles.iconBtn} title={tb("copyToMaster", "Copy to master")} onClick={() => upsertMaster(item)}>
                      <ArrowLeftIcon width={14} height={14} />
                    </button>
                    <span className={styles.itemLabel} title={sourceLabel(item)}>
                      {sourceLabel(item)}
                    </span>
                    <span className={styles.itemActions}>
                      <button type="button" className={styles.iconBtn} title={tb("edit", "Edit")} onClick={() => setEditing({ item })}>
                        <EditIcon width={14} height={14} />
                      </button>
                      <button type="button" className={styles.iconBtn} title={tb("delete", "Delete")} onClick={() => deleteLiveDocSource(doc, item.id)}>
                        <TrashIcon width={14} height={14} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Per-master-item copy-to-current: rendered as a hint row below. */}
        <div className={styles.toolbar}>
          <span className={styles.fieldLabel}>{tb("copyHint", "Tip: use the arrows to copy a source into this document or back to your library.")}</span>
        </div>
      </div>

      {editing !== null && (
        <LiveDocSourceEditor
          initial={editing.item}
          onSave={(item) => {
            setLiveDocSource(doc, item);
            upsertMaster(item);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {bibtexOpen && (
        <LiveDocBibtexImportDialog
          onImport={(items) => {
            for (const item of items) {
              setLiveDocSource(doc, item);
              upsertMaster(item);
            }
          }}
          onClose={() => setBibtexOpen(false)}
        />
      )}
    </div>
  );
}
