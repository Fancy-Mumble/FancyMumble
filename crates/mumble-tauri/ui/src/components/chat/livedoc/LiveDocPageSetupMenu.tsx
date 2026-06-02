/**
 * LiveDocPageSetupMenu - header control for the document's page layout
 * (Word-style "Page setup"): paper size, orientation and margins.
 *
 * The settings live in the shared Yjs `meta` map (see `useLiveDoc`), so
 * a change propagates live to every collaborator and persists with the
 * document.  The editing surface and the rulers react automatically via
 * the `--ld-*` custom properties.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type * as Y from "yjs";
import { SlidersIcon } from "../../../icons";
import {
  useLiveDocPageSetup,
  setLiveDocPageSetup,
  useLiveDocDecoration,
  setLiveDocDecoration,
  useLiveDocHeaderFooter,
  setLiveDocHeaderFooter,
  type LiveDocPageSize,
  type LiveDocPageOrientation,
  type LiveDocPageMargin,
  type LiveDocPageBorder,
  type LiveDocRulerUnit,
} from "./useLiveDoc";
import panelStyles from "./LiveDocPanel.module.css";
import styles from "./LiveDocPageSetupMenu.module.css";

const SIZES: ReadonlyArray<LiveDocPageSize> = ["a4", "letter", "legal"];
const RULER_UNITS: ReadonlyArray<LiveDocRulerUnit> = ["cm", "in"];
const ORIENTATIONS: ReadonlyArray<LiveDocPageOrientation> = ["portrait", "landscape"];
const MARGINS: ReadonlyArray<LiveDocPageMargin> = ["normal", "narrow", "moderate", "wide", "mirrored"];
const BORDERS: ReadonlyArray<LiveDocPageBorder> = ["none", "thin", "medium"];

interface SegmentProps<T extends string> {
  readonly label: string;
  readonly options: ReadonlyArray<T>;
  readonly value: T;
  readonly optionLabel: (value: T) => string;
  readonly onPick: (value: T) => void;
}

function Segment<T extends string>({ label, options, value, optionLabel, onPick }: SegmentProps<T>) {
  return (
    <div className={styles.segment}>
      <span className={styles.segmentLabel}>{label}</span>
      <div className={styles.segmentOptions} role="group" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`${styles.segmentOption} ${opt === value ? styles.segmentOptionActive : ""}`}
            aria-pressed={opt === value}
            onClick={() => onPick(opt)}
          >
            {optionLabel(opt)}
          </button>
        ))}
      </div>
    </div>
  );
}

interface LiveDocPageSetupMenuProps {
  readonly doc: Y.Doc | null;
  /** Insert a cover page at the top of the document. */
  readonly onInsertCoverPage?: () => void;
  /** Insert a "next page" section break at the caret. */
  readonly onInsertSectionBreak?: () => void;
}

export default function LiveDocPageSetupMenu({
  doc,
  onInsertCoverPage,
  onInsertSectionBreak,
}: LiveDocPageSetupMenuProps) {
  const { t } = useTranslation("chat");
  const setup = useLiveDocPageSetup(doc);
  const decoration = useLiveDocDecoration(doc);
  const headerFooter = useLiveDocHeaderFooter(doc);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!doc) return null;

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        type="button"
        className={`${panelStyles.headerIconBtn} ${open ? panelStyles.headerBtnActive : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={t("liveDoc.pageSetup.title")}
        aria-label={t("liveDoc.pageSetup.title")}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <SlidersIcon width={16} height={16} aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.popover} role="dialog" aria-label={t("liveDoc.pageSetup.title")}>
          <Segment
            label={t("liveDoc.pageSetup.size")}
            options={SIZES}
            value={setup.size}
            optionLabel={(s) => t(`liveDoc.pageSetup.sizes.${s}`)}
            onPick={(size) => setLiveDocPageSetup(doc, { size })}
          />
          <Segment
            label={t("liveDoc.pageSetup.orientation")}
            options={ORIENTATIONS}
            value={setup.orientation}
            optionLabel={(o) => t(`liveDoc.pageSetup.orientations.${o}`)}
            onPick={(orientation) => setLiveDocPageSetup(doc, { orientation })}
          />
          <Segment
            label={t("liveDoc.pageSetup.margins")}
            options={MARGINS}
            value={setup.margin}
            optionLabel={(m) => t(`liveDoc.pageSetup.marginOptions.${m}`)}
            onPick={(margin) => setLiveDocPageSetup(doc, { margin })}
          />
          <Segment
            label={t("liveDoc.pageSetup.rulerUnit")}
            options={RULER_UNITS}
            value={setup.rulerUnit}
            optionLabel={(u) => t(`liveDoc.pageSetup.rulerUnitOptions.${u}`)}
            onPick={(rulerUnit) => setLiveDocPageSetup(doc, { rulerUnit })}
          />
          <Segment
            label={t("liveDoc.pageSetup.border")}
            options={BORDERS}
            value={decoration.border}
            optionLabel={(b) => t(`liveDoc.pageSetup.borderOptions.${b}`)}
            onPick={(border) => setLiveDocDecoration(doc, { border })}
          />
          <div className={styles.segment}>
            <span className={styles.segmentLabel}>{t("liveDoc.pageSetup.watermark")}</span>
            <input
              type="text"
              className={styles.watermarkInput}
              value={decoration.watermark}
              maxLength={80}
              placeholder={t("liveDoc.pageSetup.watermarkPlaceholder")}
              onChange={(e) => setLiveDocDecoration(doc, { watermark: e.target.value })}
            />
          </div>
          <div className={styles.toggleRow}>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={headerFooter.enabled}
                onChange={(e) => setLiveDocHeaderFooter(doc, { enabled: e.target.checked })}
              />
              <span>{t("liveDoc.headerFooter.enable")}</span>
            </label>
            <label className={`${styles.toggle} ${headerFooter.enabled ? "" : styles.toggleDisabled}`}>
              <input
                type="checkbox"
                checked={headerFooter.showPageNumber}
                disabled={!headerFooter.enabled}
                onChange={(e) => setLiveDocHeaderFooter(doc, { showPageNumber: e.target.checked })}
              />
              <span>{t("liveDoc.headerFooter.pageNumbers")}</span>
            </label>
          </div>
          {(onInsertCoverPage || onInsertSectionBreak) && (
            <div className={styles.actions}>
              {onInsertCoverPage && (
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    onInsertCoverPage();
                    setOpen(false);
                  }}
                >
                  {t("liveDoc.pageSetup.insertCoverPage")}
                </button>
              )}
              {onInsertSectionBreak && (
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    onInsertSectionBreak();
                    setOpen(false);
                  }}
                >
                  {t("liveDoc.pageSetup.insertSectionBreak")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
