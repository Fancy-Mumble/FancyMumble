/**
 * LiveDocSourceEditor - modal form to create or edit a single bibliography
 * source.  Works in CSL-JSON; authors are edited as a friendly
 * "Family, Given; …" string and the year as a plain number.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "../../../icons";
import {
  CSL_TYPES,
  makeSourceId,
  parseAuthors,
  authorsToString,
  issuedYear,
  yearToDate,
  type CslItem,
} from "./liveDocCslTypes";
import styles from "./LiveDocCitations.module.css";

interface LiveDocSourceEditorProps {
  readonly initial?: CslItem | null;
  readonly onSave: (item: CslItem) => void;
  readonly onCancel: () => void;
}

export default function LiveDocSourceEditor({ initial, onSave, onCancel }: LiveDocSourceEditorProps) {
  const { t } = useTranslation("chat");
  const [type, setType] = useState(initial?.type ?? "book");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [authors, setAuthors] = useState(authorsToString(initial?.author));
  const [year, setYear] = useState(initial ? issuedYear(initial) : "");
  const [container, setContainer] = useState(initial?.["container-title"] ?? "");
  const [publisher, setPublisher] = useState(initial?.publisher ?? "");
  const [place, setPlace] = useState(initial?.["publisher-place"] ?? "");
  const [volume, setVolume] = useState(initial?.volume ?? "");
  const [issue, setIssue] = useState(initial?.issue ?? "");
  const [page, setPage] = useState(initial?.page ?? "");
  const [edition, setEdition] = useState(initial?.edition ?? "");
  const [url, setUrl] = useState(initial?.URL ?? "");
  const [doi, setDoi] = useState(initial?.DOI ?? "");

  const save = () => {
    const base: CslItem = {
      ...(initial ?? {}),
      id: initial?.id ?? makeSourceId({ author: parseAuthors(authors), issued: yearToDate(year) }),
      type,
    };
    const set = (k: keyof CslItem, v: string) => {
      if (v.trim()) (base as Record<string, unknown>)[k] = v.trim();
      else delete (base as Record<string, unknown>)[k];
    };
    set("title", title);
    base.author = parseAuthors(authors);
    if (base.author.length === 0) delete base.author;
    const date = yearToDate(year);
    if (date) base.issued = date;
    else delete base.issued;
    set("container-title", container);
    set("publisher", publisher);
    set("publisher-place", place);
    set("volume", volume);
    set("issue", issue);
    set("page", page);
    set("edition", edition);
    set("URL", url);
    set("DOI", doi);
    onSave(base);
  };

  const tt = (k: string, d: string) => t(`liveDoc.citations.field.${k}`, { defaultValue: d });

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={`${styles.dialog} ${styles.dialogNarrow}`}>
        <div className={styles.dialogHeader}>
          <span className={styles.dialogTitle}>
            {initial
              ? t("liveDoc.citations.editSource", { defaultValue: "Edit source" })
              : t("liveDoc.citations.newSource", { defaultValue: "New source" })}
          </span>
          <button type="button" className={styles.dialogClose} onClick={onCancel} aria-label={t("liveDoc.citations.cancel", { defaultValue: "Cancel" })}>
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{tt("type", "Type")}</span>
            <select className={styles.select} value={type} onChange={(e) => setType(e.target.value)}>
              {CSL_TYPES.map((c) => (
                <option key={c.value} value={c.value}>
                  {t(`liveDoc.citations.sourceType.${c.labelKey}`, { defaultValue: c.value })}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>{tt("title", "Title")}</span>
            <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>{tt("author", "Author(s) — Family, Given; …")}</span>
            <input className={styles.input} value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="Smith, John; Doe, Jane" />
          </label>

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{tt("year", "Year")}</span>
              <input className={styles.input} value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{tt("container", "Journal / Book / Site")}</span>
              <input className={styles.input} value={container} onChange={(e) => setContainer(e.target.value)} />
            </label>
          </div>

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{tt("publisher", "Publisher")}</span>
              <input className={styles.input} value={publisher} onChange={(e) => setPublisher(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{tt("place", "Place")}</span>
              <input className={styles.input} value={place} onChange={(e) => setPlace(e.target.value)} />
            </label>
          </div>

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{tt("volume", "Volume")}</span>
              <input className={styles.input} value={volume} onChange={(e) => setVolume(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{tt("issue", "Issue / Number")}</span>
              <input className={styles.input} value={issue} onChange={(e) => setIssue(e.target.value)} />
            </label>
          </div>

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{tt("page", "Pages")}</span>
              <input className={styles.input} value={page} onChange={(e) => setPage(e.target.value)} placeholder="12-34" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{tt("edition", "Edition")}</span>
              <input className={styles.input} value={edition} onChange={(e) => setEdition(e.target.value)} />
            </label>
          </div>

          <div className={styles.grid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>URL</span>
              <input className={styles.input} value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>DOI</span>
              <input className={styles.input} value={doi} onChange={(e) => setDoi(e.target.value)} />
            </label>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onCancel}>
            {t("liveDoc.citations.cancel", { defaultValue: "Cancel" })}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={save} disabled={!title.trim() && !authors.trim()}>
            {t("liveDoc.citations.save", { defaultValue: "Save" })}
          </button>
        </div>
      </div>
    </div>
  );
}
