/**
 * Kibana-style autocomplete for the simple-mode audit search input.
 *
 * A thin combobox wrapper around a text `<input>`: it keeps the query text
 * fully controlled by the parent (pills ⇄ text stay bound), and layers a
 * caret-aware suggestion dropdown on top via {@link ./auditSuggest!suggestAudit}.
 *
 * Keyboard model (matches Kibana / editor typeaheads):
 *   - ↓ / ↑         move the highlight (opens the list if closed)
 *   - Enter / Tab   accept the highlighted suggestion; Enter with nothing
 *                   highlighted runs the search instead
 *   - Esc           dismiss the list (a second Esc bubbles to any parent)
 * Accepting splices the suggestion into the token under the caret, then
 * re-opens with the next context (field → operator → value → `and`).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TID } from "@core/testids";
import {
  suggestAudit,
  type AuditSuggestContext,
  type AuditSuggestion,
} from "@core/features/admin/auditSuggest";
import { AUDIT_DSL_LANGUAGE } from "@core/features/admin/auditHljs";
import { HighlightBackdrop } from "./SyntaxHighlight";
import styles from "./AuditLogTab.module.css";

interface QueryAutocompleteProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** Reparse the text into pills (parity with the old input's onBlur). */
  readonly onCommit: (text: string) => void;
  /** Run the search (Enter with no suggestion highlighted). */
  readonly onRun: () => void;
  readonly context: AuditSuggestContext;
  readonly placeholder: string;
  readonly disabled?: boolean;
}

/** Short glyph per suggestion kind, shown in the row gutter. */
const KIND_GLYPH: Record<AuditSuggestion["kind"], string> = {
  field: "◆",
  operator: "=",
  value: "•",
  keyword: "&",
};

export function QueryAutocomplete({
  value,
  onChange,
  onCommit,
  onRun,
  context,
  placeholder,
  disabled,
}: QueryAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /** Caret to restore after a splice, applied once post-render. */
  const pendingCaret = useRef<number | null>(null);

  const result = useMemo(() => suggestAudit(value, caret, context), [value, caret, context]);
  const suggestions = result.suggestions;
  const show = open && !disabled && suggestions.length > 0;

  // Keep `active` in range as the list shrinks/grows while typing.
  useEffect(() => {
    setActive((a) => (a >= suggestions.length ? -1 : a));
  }, [suggestions.length]);

  // Restore the caret after a programmatic splice, and keep the highlight
  // backdrop scrolled in lockstep with the (transparent) input on every render.
  useLayoutEffect(() => {
    if (pendingCaret.current != null && inputRef.current) {
      const p = pendingCaret.current;
      inputRef.current.setSelectionRange(p, p);
      pendingCaret.current = null;
    }
    if (backdropRef.current && inputRef.current) {
      backdropRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  });

  const syncScroll = useCallback(() => {
    if (backdropRef.current && inputRef.current) {
      backdropRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }, []);

  const syncCaret = useCallback(() => {
    const el = inputRef.current;
    if (el) setCaret(el.selectionStart ?? el.value.length);
  }, []);

  const accept = useCallback(
    (idx: number) => {
      const s = suggestions[idx];
      if (!s) return;
      const next = value.slice(0, result.from) + s.apply + value.slice(result.to);
      const nextCaret = result.from + s.apply.length;
      pendingCaret.current = nextCaret;
      setCaret(nextCaret);
      setActive(-1);
      setOpen(true); // re-open with the follow-on context
      onChange(next);
    },
    [suggestions, value, result.from, result.to, onChange],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (show) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActive((a) => (a + 1) % suggestions.length);
          return;
        case "ArrowUp":
          e.preventDefault();
          setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1));
          return;
        case "Tab":
          e.preventDefault();
          accept(active >= 0 ? active : 0);
          return;
        case "Enter":
          if (active >= 0) {
            e.preventDefault();
            accept(active);
            return;
          }
          break; // nothing highlighted -> fall through to run
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          return;
        default:
          break;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      setOpen(false);
      onCommit(value);
      onRun();
    }
  };

  return (
    <div className={styles.acWrap}>
      <HighlightBackdrop
        ref={backdropRef}
        value={value}
        language={AUDIT_DSL_LANGUAGE}
        variantClass={styles.acBackdrop}
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={show}
        aria-controls={TID.auditQuerySuggestions}
        aria-autocomplete="list"
        aria-activedescendant={show && active >= 0 ? `${TID.auditQuerySuggestionItem}-${active}` : undefined}
        className={styles.queryInput}
        data-testid={TID.auditQueryInput}
        value={value}
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setOpen(true);
          setActive(-1);
        }}
        onKeyUp={syncCaret}
        onScroll={syncScroll}
        onClick={() => {
          syncCaret();
          setOpen(true);
        }}
        onFocus={() => {
          syncCaret();
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          onCommit(value);
        }}
        onKeyDown={onKeyDown}
      />
      {show && (
        <ul
          className={styles.acDropdown}
          id={TID.auditQuerySuggestions}
          data-testid={TID.auditQuerySuggestions}
          role="listbox"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.kind}:${s.label}`}
              id={`${TID.auditQuerySuggestionItem}-${i}`}
              data-testid={TID.auditQuerySuggestionItem}
              data-suggest-kind={s.kind}
              data-active={i === active}
              role="option"
              aria-selected={i === active}
              className={`${styles.acItem}${i === active ? ` ${styles.acItemActive}` : ""}`}
              // mousedown (not click) so it fires before the input's blur.
              onMouseDown={(e) => {
                e.preventDefault();
                accept(i);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className={styles.acGlyph} data-kind={s.kind} aria-hidden="true">
                {KIND_GLYPH[s.kind]}
              </span>
              <span className={styles.acLabel}>{s.label}</span>
              {s.detail && <span className={styles.acDetail}>{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
