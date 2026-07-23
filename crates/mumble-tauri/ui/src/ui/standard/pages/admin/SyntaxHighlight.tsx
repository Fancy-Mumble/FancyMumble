/**
 * The colored backdrop half of the highlight-overlay technique.
 *
 * A transparent `<input>`/`<textarea>` sits on top of this element; here we
 * render the same text as highlight.js `<span>`s (via {@link ./auditHljs}) so
 * the colors show through the see-through control. The caller keeps the two
 * scrolled together. `aria-hidden` because the real control stays the
 * accessible, editable surface.
 */

import { forwardRef } from "react";
import { useAuditHighlight } from "@core/features/admin/auditHljs";
import styles from "./AuditLogTab.module.css";

interface HighlightBackdropProps {
  readonly value: string;
  /** highlight.js language: `AUDIT_DSL_LANGUAGE` or `"sql"`. */
  readonly language: string;
  /** Extra class selecting single-line (`acBackdrop`) vs wrapped (`sqlBackdrop`). */
  readonly variantClass: string;
}

export const HighlightBackdrop = forwardRef<HTMLDivElement, HighlightBackdropProps>(
  function HighlightBackdrop({ value, language, variantClass }, ref) {
    const tokens = useAuditHighlight(value, language);
    return (
      <div ref={ref} aria-hidden="true" className={`${styles.hlBackdrop} ${variantClass}`}>
        {tokens.map((tok, i) => (
          <span key={`${i}:${tok.cls}`} className={tok.cls || undefined}>
            {tok.text}
          </span>
        ))}
        {/* A trailing newline needs a filler so the last (empty) line has height. */}
        {value.endsWith("\n") && " "}
      </div>
    );
  },
);
