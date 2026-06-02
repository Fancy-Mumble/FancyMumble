/**
 * LiveDocCitationPicker - the "Insert Citation" chooser.
 *
 * Lists the document's current sources (searchable) and offers "Add New
 * Source…" (creates a source, adds it to the current + master lists, then
 * cites it) and "Add New Placeholder…" (inserts a named, unset citation to
 * fill in later).
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type * as Y from "yjs";
import { CloseIcon, PlusIcon } from "../../../icons";
import { sourceLabel, type CslItem } from "./liveDocCslTypes";
import { useLiveDocSources, setLiveDocSource } from "./useLiveDocSources";
import { useLiveDocMasterSourcesStore } from "./liveDocMasterSourcesStore";
import type { CitationItemRef } from "./liveDocCitations";
import LiveDocSourceEditor from "./LiveDocSourceEditor";
import LiveDocBibtexImportDialog from "./LiveDocBibtexImportDialog";
import styles from "./LiveDocCitations.module.css";

interface LiveDocCitationPickerProps {
  readonly doc: Y.Doc;
  readonly onInsert: (items: CitationItemRef[]) => void;
  readonly onInsertPlaceholder: (tag: string) => void;
  readonly onClose: () => void;
}

export default function LiveDocCitationPicker({ doc, onInsert, onInsertPlaceholder, onClose }: LiveDocCitationPickerProps) {
  const { t } = useTranslation("chat");
  const sources = useLiveDocSources(doc);
  const upsertMaster = useLiveDocMasterSourcesStore((s) => s.upsert);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"list" | "newSource" | "newPlaceholder" | "newBibtex">("list");
  const [tag, setTag] = useState("");

  const tb = (k: string, d: string) => t(`liveDoc.citations.${k}`, { defaultValue: d });

  const filtered = query.trim()
    ? sources.filter((s) => sourceLabel(s).toLowerCase().includes(query.trim().toLowerCase()))
    : sources;

  const cite = (item: CslItem) => {
    onInsert([{ id: item.id }]);
    onClose();
  };

  if (mode === "newSource") {
    return (
      <LiveDocSourceEditor
        onSave={(item) => {
          setLiveDocSource(doc, item);
          upsertMaster(item);
          onInsert([{ id: item.id }]);
          onClose();
        }}
        onCancel={() => setMode("list")}
      />
    );
  }

  if (mode === "newBibtex") {
    return (
      <LiveDocBibtexImportDialog
        onImport={(items) => {
          for (const item of items) {
            setLiveDocSource(doc, item);
            upsertMaster(item);
          }
          if (items.length > 0) onInsert(items.map((it) => ({ id: it.id })));
          onClose();
        }}
        onClose={() => setMode("list")}
      />
    );
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.dialog} ${styles.dialogNarrow}`}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>{tb("insertCitation", "Insert Citation")}</span>
          <button type="button" className={styles.dialogClose} onClick={onClose} aria-label={tb("close", "Close")}>
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        {mode === "newPlaceholder" ? (
          <div className={styles.form}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{tb("placeholderTag", "Placeholder name")}</span>
              <input
                className={styles.input}
                value={tag}
                autoFocus
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tag.trim()) {
                    onInsertPlaceholder(tag.trim());
                    onClose();
                  }
                }}
                placeholder="Placeholder1"
              />
            </label>
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={() => setMode("list")}>
                {tb("back", "Back")}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={!tag.trim()}
                onClick={() => {
                  onInsertPlaceholder(tag.trim());
                  onClose();
                }}
              >
                {tb("insert", "Insert")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <input
              className={styles.searchInput}
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tb("searchSources", "Search sources…")}
            />
            <div className={styles.list} style={{ maxHeight: 300 }}>
              {filtered.map((item) => (
                <button key={item.id} type="button" className={styles.pickerItem} onClick={() => cite(item)}>
                  {sourceLabel(item)}
                </button>
              ))}
              {filtered.length === 0 && <div className={styles.empty}>{tb("noSources", "No sources yet.")}</div>}
            </div>
            <div className={styles.pickerSep} />
            <button type="button" className={`${styles.pickerItem} ${styles.pickerAdd}`} onClick={() => setMode("newSource")}>
              <PlusIcon width={14} height={14} aria-hidden="true" /> {tb("addNewSource", "Add New Source…")}
            </button>
            <button type="button" className={`${styles.pickerItem} ${styles.pickerAdd}`} onClick={() => setMode("newBibtex")}>
              <PlusIcon width={14} height={14} aria-hidden="true" /> {tb("addFromBibtex", "Add from BibTeX…")}
            </button>
            <button type="button" className={`${styles.pickerItem} ${styles.pickerAdd}`} onClick={() => setMode("newPlaceholder")}>
              <PlusIcon width={14} height={14} aria-hidden="true" /> {tb("addNewPlaceholder", "Add New Placeholder…")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
