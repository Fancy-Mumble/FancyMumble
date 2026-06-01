/**
 * LiveDocHeaderFooter - interim single-zone header and footer bands.
 *
 * Until a real pagination engine exists, the document carries one shared
 * header at the top of the editing surface and one footer at the bottom
 * (explicitly not per-page).  Both texts plus an optional "Page N" token
 * are stored in the shared Yjs `meta` map (see `useLiveDoc`), so edits
 * sync live to every collaborator and persist with the document.
 */

import { useTranslation } from "react-i18next";
import type * as Y from "yjs";
import {
  useLiveDocHeaderFooter,
  setLiveDocHeaderFooter,
  type LiveDocHeaderFooter as HeaderFooterValue,
} from "./useLiveDoc";
import styles from "./LiveDocHeaderFooter.module.css";

interface BandProps {
  readonly doc: Y.Doc;
  readonly zone: "header" | "footer";
  readonly value: HeaderFooterValue;
  readonly readOnly: boolean;
  readonly pageNumberLabel: string | null;
}

function Band({ doc, zone, value, readOnly, pageNumberLabel }: Readonly<BandProps>) {
  const { t } = useTranslation("chat");
  const text = zone === "header" ? value.header : value.footer;
  const placeholder = t(`liveDoc.headerFooter.${zone}Placeholder`);
  return (
    <div className={`${styles.band} ${styles[zone]}`} data-livedoc-band={zone}>
      <input
        type="text"
        className={styles.bandInput}
        value={text}
        readOnly={readOnly}
        maxLength={200}
        placeholder={placeholder}
        aria-label={t(`liveDoc.headerFooter.${zone}Aria`)}
        onChange={(e) =>
          setLiveDocHeaderFooter(doc, zone === "header" ? { header: e.target.value } : { footer: e.target.value })
        }
      />
      {zone === "footer" && pageNumberLabel && (
        <span className={styles.pageNumber} aria-hidden="true">
          {pageNumberLabel}
        </span>
      )}
    </div>
  );
}

interface LiveDocHeaderFooterProps {
  readonly doc: Y.Doc;
  readonly zone: "header" | "footer";
  readonly readOnly?: boolean;
  /** Page index shown in the optional footer token (1-based). */
  readonly pageNumber?: number;
  /** Total page count, when known (from the pagination foundation). */
  readonly pageCount?: number;
}

export default function LiveDocHeaderFooter({
  doc,
  zone,
  readOnly = false,
  pageNumber = 1,
  pageCount,
}: Readonly<LiveDocHeaderFooterProps>) {
  const { t } = useTranslation("chat");
  const value = useLiveDocHeaderFooter(doc);
  if (!value.enabled) return null;

  let pageNumberLabel: string | null = null;
  if (value.showPageNumber) {
    pageNumberLabel =
      pageCount && pageCount > 1
        ? t("liveDoc.headerFooter.pageNumberOf", { number: pageNumber, total: pageCount })
        : t("liveDoc.headerFooter.pageNumber", { number: pageNumber });
  }

  return (
    <Band
      doc={doc}
      zone={zone}
      value={value}
      readOnly={readOnly}
      pageNumberLabel={pageNumberLabel}
    />
  );
}
