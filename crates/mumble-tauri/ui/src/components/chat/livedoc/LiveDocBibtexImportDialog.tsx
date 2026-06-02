/**
 * LiveDocBibtexImportDialog - paste one or more raw BibTeX entries and turn
 * them into sources ("New Source from BibTeX snippet").  Parses live so the
 * user sees how many valid entries were detected before importing.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "../../../icons";
import { parseBibtex } from "./liveDocBibtex";
import { sourceLabel, type CslItem } from "./liveDocCslTypes";
import styles from "./LiveDocCitations.module.css";

const PLACEHOLDER = `@article{key,
  author = {Schmidt, Lena and Tanaka, Hiroshi},
  title  = {Scaling Laws in Foundation Models},
  journal= {Journal of AI Research},
  year   = {2024},
  volume = {78},
  pages  = {145--182},
  doi    = {10.1234/jair.2024.12345}
}`;

interface LiveDocBibtexImportDialogProps {
  readonly onImport: (items: CslItem[]) => void;
  readonly onClose: () => void;
}

export default function LiveDocBibtexImportDialog({ onImport, onClose }: LiveDocBibtexImportDialogProps) {
  const { t } = useTranslation("chat");
  const [text, setText] = useState("");
  const parsed = useMemo(() => (text.trim() ? parseBibtex(text) : []), [text]);
  const tb = (k: string, d: string) => t(`liveDoc.citations.${k}`, { defaultValue: d });

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.dialog} ${styles.dialogNarrow}`}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>{tb("newFromBibtex", "New Source from BibTeX")}</span>
          <button type="button" className={styles.dialogClose} onClick={onClose} aria-label={tb("close", "Close")}>
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{tb("bibtexSnippet", "Paste a BibTeX entry")}</span>
            <textarea
              className={styles.textarea}
              value={text}
              autoFocus
              spellCheck={false}
              placeholder={PLACEHOLDER}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {parsed.length > 0 && (
            <span className={styles.hint}>
              {parsed.length === 1
                ? tb("oneEntryDetected", "1 entry detected:") + ` ${sourceLabel(parsed[0])}`
                : `${parsed.length} ${tb("entriesDetected", "entries detected")}`}
            </span>
          )}
          {text.trim() && parsed.length === 0 && (
            <span className={styles.hint}>{tb("bibtexInvalid", "No valid BibTeX entry found.")}</span>
          )}
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose}>
            {tb("cancel", "Cancel")}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={parsed.length === 0}
            onClick={() => {
              onImport(parsed);
              onClose();
            }}
          >
            {parsed.length > 1
              ? `${tb("import", "Import")} (${parsed.length})`
              : tb("import", "Import")}
          </button>
        </div>
      </div>
    </div>
  );
}
