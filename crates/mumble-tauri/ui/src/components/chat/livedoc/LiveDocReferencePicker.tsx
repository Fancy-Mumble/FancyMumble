/**
 * LiveDocReferencePicker - popover that lists every referenceable
 * target (headings, bookmarks, captions) so the user can pick one to
 * insert a cross-reference to.  Targets are grouped visually by kind
 * via a per-row kind badge.
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "../../../icons";
import type { RefTarget } from "./liveDocReferences";
import styles from "./LiveDocReferences.module.css";

interface LiveDocReferencePickerProps {
  readonly targets: readonly RefTarget[];
  readonly onPick: (target: RefTarget) => void;
  readonly onClose: () => void;
}

function targetRowLabel(
  target: RefTarget,
  translate: (key: string) => string,
): string {
  if (target.number !== undefined) {
    const kindLabel = translate(`liveDoc.references.kind.${target.kind}`);
    const text = target.label.trim();
    return text ? `${kindLabel} ${target.number}: ${text}` : `${kindLabel} ${target.number}`;
  }
  return target.label.trim() || translate("liveDoc.references.untitledTarget");
}

export default function LiveDocReferencePicker({
  targets,
  onPick,
  onClose,
}: LiveDocReferencePickerProps) {
  const { t } = useTranslation("chat");
  const translate = t as (key: string) => string;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className={styles.picker} role="dialog" aria-label={t("liveDoc.references.pickerTitle")}>
      <div className={styles.pickerHeader}>
        <span className={styles.pickerTitle}>{t("liveDoc.references.pickerTitle")}</span>
        <button
          type="button"
          className={styles.pickerClose}
          onClick={onClose}
          aria-label={t("liveDoc.references.pickerClose")}
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>
      {targets.length === 0 ? (
        <p className={styles.pickerEmpty}>{t("liveDoc.references.pickerEmpty")}</p>
      ) : (
        <ul className={styles.pickerList}>
          {targets.map((target) => (
            <li key={target.id}>
              <button
                type="button"
                className={styles.pickerItem}
                onClick={() => onPick(target)}
              >
                <span className={styles.pickerKind}>
                  {translate(`liveDoc.references.kind.${target.kind}`)}
                </span>
                <span className={styles.pickerLabel}>{targetRowLabel(target, translate)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
