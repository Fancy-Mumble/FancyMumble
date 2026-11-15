/**
 * Syntax-highlighted editor for advanced (SQL) mode.
 *
 * The same overlay technique as {@link ./QueryAutocomplete}: a transparent
 * `<textarea>` over a {@link ./SyntaxHighlight!HighlightBackdrop} rendering the
 * SQL tokens, kept scrolled together on both axes.
 */

import { useLayoutEffect, useRef } from "react";
import { TID } from "@core/testids";
import { HighlightBackdrop } from "./SyntaxHighlight";
import styles from "./AuditLogTab.module.css";

interface SqlEditorProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly placeholder: string;
}

export function SqlEditor({ value, onChange, placeholder }: SqlEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const sync = () => {
    if (backdropRef.current && taRef.current) {
      backdropRef.current.scrollTop = taRef.current.scrollTop;
      backdropRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };
  // Keep the backdrop aligned after value changes (e.g. resize/programmatic).
  useLayoutEffect(sync);

  return (
    <div className={styles.sqlWrap}>
      <HighlightBackdrop ref={backdropRef} value={value} language="sql" variantClass={styles.sqlBackdrop} />
      <textarea
        ref={taRef}
        className={styles.sqlEditor}
        data-testid={TID.auditQueryInput}
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onScroll={sync}
      />
    </div>
  );
}
