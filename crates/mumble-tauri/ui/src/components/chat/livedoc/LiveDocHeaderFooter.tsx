/**
 * LiveDocHeaderFooter - repeating, editable header / footer bands.
 *
 * The document carries one shared header string and one shared footer string
 * (plus an optional "Page N" token) in the Yjs `meta` map, so edits sync live
 * to every collaborator.  Word repeats that header at the top of *every* page
 * and the footer at the bottom of every page; we reproduce that by rendering
 * one band per page, positioned from the same page geometry the pagination
 * gutters use (`pageCount` comes from the pagination plugin, so the bands stay
 * aligned with the sheet boundaries).  Every band edits the one shared value,
 * so typing in any page updates them all - exactly like Word.
 */

import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type * as Y from "yjs";
import {
  useLiveDocHeaderFooter,
  setLiveDocHeaderFooter,
  formatPageNumber,
  type LiveDocHeaderFooter as HeaderFooterValue,
  type LiveDocTranslate,
} from "./useLiveDoc";
import styles from "./LiveDocHeaderFooter.module.css";

/** Height of a band in px; kept in sync with `.band` in the stylesheet so the
 *  bands centre cleanly in their page margins. */
const BAND_HEIGHT_PX = 28;

interface BandProps {
  readonly doc: Y.Doc;
  readonly zone: "header" | "footer";
  readonly value: HeaderFooterValue;
  readonly readOnly: boolean;
  /** Absolute placement (a `top` or `bottom` offset) for the band. */
  readonly style: CSSProperties;
  /** Render the editable text input (the zone's own toggle is on). */
  readonly showInput: boolean;
  readonly pageNumberLabel: string | null;
}

function Band({ doc, zone, value, readOnly, style, showInput, pageNumberLabel }: Readonly<BandProps>) {
  const { t } = useTranslation("chat");
  const text = zone === "header" ? value.header : value.footer;
  const bandStyle = zone === "header" ? value.headerStyle : value.footerStyle;
  const placeholder = t(`liveDoc.headerFooter.${zone}Placeholder`);
  return (
    <div
      className={styles.band}
      style={style}
      data-livedoc-band={zone}
      data-band-style={bandStyle}
    >
      {showInput ? (
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
      ) : (
        // Page-number-only footer: keep the number aligned where it would sit
        // alongside footer text.
        <span className={styles.bandSpacer} aria-hidden="true" />
      )}
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
  /** When false the document is one continuous page: a single header at the top
   *  and a single footer pinned to the bottom of the surface. */
  readonly paginated: boolean;
  /** Number of laid-out pages (from the pagination plugin). */
  readonly pageCount: number;
  /** Full page height in px (`--ld-page-h`). */
  readonly pageHeightPx: number;
  /** Vertical page margin in px (`--ld-pad-y`). */
  readonly marginYPx: number;
  /** Inter-sheet gutter height in px (matches the pagination gutters). */
  readonly gapPx: number;
}

export default function LiveDocHeaderFooter({
  doc,
  zone,
  readOnly = false,
  paginated,
  pageCount,
  pageHeightPx,
  marginYPx,
  gapPx,
}: Readonly<LiveDocHeaderFooterProps>) {
  const { t } = useTranslation("chat");
  const value = useLiveDocHeaderFooter(doc);

  // Each zone is independent: the header shows on its own toggle; the footer
  // area shows if its text zone OR the (separate) page number is enabled.
  const showInput = zone === "header" ? value.headerEnabled : value.footerEnabled;
  const showFooterNumber = zone === "footer" && value.showPageNumber;
  if (!showInput && !showFooterNumber) return null;

  const half = BAND_HEIGHT_PX / 2;
  const band = (key: number, style: CSSProperties, pageNumber: number, total: number) => (
    <Band
      key={key}
      doc={doc}
      zone={zone}
      value={value}
      readOnly={readOnly}
      style={style}
      showInput={showInput}
      pageNumberLabel={
        showFooterNumber
          ? formatPageNumber(value.pageNumberStyle, pageNumber, total, t as unknown as LiveDocTranslate)
          : null
      }
    />
  );

  // One continuous page: a single header in the top margin and a single footer
  // pinned to the bottom margin of the (content-sized) surface.
  if (!paginated) {
    const style: CSSProperties =
      zone === "header" ? { top: marginYPx / 2 - half } : { bottom: marginYPx / 2 - half };
    return <>{band(0, style, 1, 1)}</>;
  }

  const count = Math.max(1, pageCount);
  // One sheet plus the grey gutter that follows it.  Each page's content area
  // is padded to a full sheet by the pagination fillers, so every page sits at
  // a fixed multiple of this period (matching the gutter positions).
  const period = pageHeightPx + gapPx;
  const contentHeight = pageHeightPx - 2 * marginYPx;

  const bands = [];
  for (let p = 0; p < count; p++) {
    const sheetTop = p * period;
    // Header centres in the page's top margin; footer in its bottom margin.
    const top =
      zone === "header"
        ? marginYPx / 2 + sheetTop - half
        : marginYPx + sheetTop + contentHeight + marginYPx / 2 - half;
    bands.push(band(p, { top }, p + 1, count));
  }

  return <>{bands}</>;
}
