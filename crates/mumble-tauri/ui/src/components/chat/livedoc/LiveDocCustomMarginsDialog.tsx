import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { LiveDocRulerUnit } from "./useLiveDoc";
import { Modal } from "../../elements/Modal";
import styles from "./LiveDocCustomMarginsDialog.module.css";

const PX_PER_CM = 96 / 2.54;
const PX_PER_IN = 96;

function pxToUnit(px: number, unit: LiveDocRulerUnit): string {
  const factor = unit === "cm" ? PX_PER_CM : PX_PER_IN;
  return (px / factor).toFixed(2);
}

function unitToPx(value: string, unit: LiveDocRulerUnit): number | null {
  const n = parseFloat(value);
  if (!isFinite(n) || n < 0) return null;
  return n * (unit === "cm" ? PX_PER_CM : PX_PER_IN);
}

function clampMargin(px: number): number {
  return Math.round(Math.max(12, Math.min(480, px)));
}

interface Props {
  readonly rulerUnit: LiveDocRulerUnit;
  readonly initialMarginXPx: number;
  readonly initialMarginYPx: number;
  readonly onApply: (marginXPx: number, marginYPx: number) => void;
  readonly onClose: () => void;
}

export default function LiveDocCustomMarginsDialog({
  rulerUnit,
  initialMarginXPx,
  initialMarginYPx,
  onApply,
  onClose,
}: Props) {
  const { t } = useTranslation("chat");
  const unitLabel = rulerUnit === "cm" ? "cm" : "in";

  const [draftX, setDraftX] = useState(() => pxToUnit(initialMarginXPx, rulerUnit));
  const [draftY, setDraftY] = useState(() => pxToUnit(initialMarginYPx, rulerUnit));
  const [errorX, setErrorX] = useState(false);
  const [errorY, setErrorY] = useState(false);

  const handleApply = useCallback(() => {
    const px = unitToPx(draftX, rulerUnit);
    const py = unitToPx(draftY, rulerUnit);
    const xOk = px !== null;
    const yOk = py !== null;
    setErrorX(!xOk);
    setErrorY(!yOk);
    if (!xOk || !yOk) return;
    onApply(clampMargin(px!), clampMargin(py!));
    onClose();
  }, [draftX, draftY, rulerUnit, onApply, onClose]);

  // Esc + backdrop dismissal are handled by Modal; Enter-to-apply stays here.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") handleApply();
    },
    [handleApply],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <Modal onClose={onClose} zIndex={9999}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-labelledby="custom-margins-title"
        aria-modal="true"
      >
        <h3 id="custom-margins-title" className={styles.title}>
          {t("liveDoc.pageSetup.customMargins.title")}
        </h3>

        <div className={styles.fields}>
          <label className={`${styles.field} ${errorX ? styles.fieldError : ""}`}>
            <span className={styles.fieldLabel}>
              {t("liveDoc.pageSetup.customMargins.leftRight")}
            </span>
            <div className={styles.inputWrap}>
              <input
                type="number"
                className={styles.input}
                value={draftX}
                min={0.1}
                step={0.1}
                onChange={(e) => { setDraftX(e.target.value); setErrorX(false); }}
              />
              <span className={styles.unitLabel}>{unitLabel}</span>
            </div>
          </label>

          <label className={`${styles.field} ${errorY ? styles.fieldError : ""}`}>
            <span className={styles.fieldLabel}>
              {t("liveDoc.pageSetup.customMargins.topBottom")}
            </span>
            <div className={styles.inputWrap}>
              <input
                type="number"
                className={styles.input}
                value={draftY}
                min={0.1}
                step={0.1}
                onChange={(e) => { setDraftY(e.target.value); setErrorY(false); }}
              />
              <span className={styles.unitLabel}>{unitLabel}</span>
            </div>
          </label>
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            {t("liveDoc.pageSetup.customMargins.cancel")}
          </button>
          <button type="button" className={styles.applyBtn} onClick={handleApply}>
            {t("liveDoc.pageSetup.customMargins.apply")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
