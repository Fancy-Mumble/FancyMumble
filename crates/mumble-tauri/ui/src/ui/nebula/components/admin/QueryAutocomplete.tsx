import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { TID } from "@core/testids";
import {
  suggestAudit,
  type AuditSuggestContext,
  type AuditSuggestion,
} from "@core/features/admin/auditSuggest";
import { AUDIT_DSL_LANGUAGE } from "@core/features/admin/auditHljs";
import { NEBULA_MONO, radius } from "../../tokens";
import { HighlightBackdrop, HighlightFieldShell, TRANSPARENT_CONTROL } from "./highlightField";

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

/**
 * The simple-mode audit search field: a caret-aware typeahead over the query
 * DSL, drawn on the highlight overlay.
 *
 * Keyboard model (matching Kibana and editor typeaheads):
 *   - ↓ / ↑         move the highlight
 *   - Enter / Tab   accept the highlighted suggestion; Enter with nothing
 *                   highlighted runs the search instead
 *   - Esc           dismiss the list (a second Esc bubbles to any parent)
 * Accepting splices the suggestion into the token under the caret, then
 * re-opens with the next context (field -> operator -> value -> `and`).
 */
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

  // Keep `active` in range as the list shrinks and grows while typing.
  useEffect(() => {
    setActive((a) => (a >= suggestions.length ? -1 : a));
  }, [suggestions.length]);

  // Restore the caret after a programmatic splice, and keep the backdrop
  // scrolled in lockstep with the (transparent) input on every render.
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
    <HighlightFieldShell>
      <HighlightBackdrop ref={backdropRef} value={value} language={AUDIT_DSL_LANGUAGE} wrap="pre" />
      <Box
        component="input"
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={show}
        aria-controls={TID.auditQuerySuggestions}
        aria-autocomplete="list"
        aria-activedescendant={show && active >= 0 ? `${TID.auditQuerySuggestionItem}-${active}` : undefined}
        data-testid={TID.auditQueryInput}
        value={value}
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
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
        sx={(theme) => ({
          ...TRANSPARENT_CONTROL,
          caretColor: theme.palette.nebula.text,
          "&::placeholder": {
            color: theme.palette.nebula.muted,
            WebkitTextFillColor: theme.palette.nebula.muted,
          },
        })}
      />
      {show && (
        <Box
          component="ul"
          id={TID.auditQuerySuggestions}
          data-testid={TID.auditQuerySuggestions}
          role="listbox"
          sx={(theme) => ({
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 30,
            m: 0,
            p: "4px",
            listStyle: "none",
            maxHeight: 280,
            overflowY: "auto",
            borderRadius: radius("md"),
            background: theme.palette.nebula.card,
            border: `1px solid ${theme.palette.nebula.line2}`,
            boxShadow: theme.palette.nebula.shadow,
          })}
        >
          {suggestions.map((s, i) => (
            <Box
              component="li"
              key={`${s.kind}:${s.label}`}
              id={`${TID.auditQuerySuggestionItem}-${i}`}
              data-testid={TID.auditQuerySuggestionItem}
              data-suggest-kind={s.kind}
              data-active={i === active}
              role="option"
              aria-selected={i === active}
              // mousedown (not click) so it fires before the input's blur.
              onMouseDown={(e) => {
                e.preventDefault();
                accept(i);
              }}
              onMouseEnter={() => setActive(i)}
              sx={(theme) => ({
                display: "flex",
                alignItems: "baseline",
                gap: "8px",
                px: "8px",
                py: "6px",
                borderRadius: radius("sm"),
                cursor: "pointer",
                fontFamily: NEBULA_MONO,
                fontSize: 12.5,
                color: i === active ? theme.palette.nebula.onAccent : theme.palette.nebula.text,
                background: i === active ? theme.palette.nebula.accent : "transparent",
              })}
            >
              <Box
                component="span"
                aria-hidden
                sx={{ flex: "none", width: 14, textAlign: "center", fontSize: 11, opacity: 0.85 }}
              >
                {KIND_GLYPH[s.kind]}
              </Box>
              <Box component="span" sx={{ flex: "0 1 auto", whiteSpace: "nowrap" }}>
                {s.label}
              </Box>
              {s.detail && (
                <Typography
                  noWrap
                  sx={(theme) => ({
                    flex: "1 1 auto",
                    textAlign: "right",
                    fontSize: 11,
                    color: i === active ? "inherit" : theme.palette.nebula.muted,
                    opacity: i === active ? 0.75 : 1,
                  })}
                >
                  {s.detail}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
    </HighlightFieldShell>
  );
}
