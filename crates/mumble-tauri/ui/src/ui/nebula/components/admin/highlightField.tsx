import { forwardRef, type ReactNode } from "react";
import { Box } from "@mui/material";
import { useAuditHighlight } from "@core/features/admin/auditHljs";
import { NEBULA_MONO, radius } from "../../tokens";

/**
 * The highlight-overlay field the audit query and the SQL editor are both made
 * of: a transparent control sitting exactly on top of a coloured copy of its
 * own text.
 *
 * The two layers only line up while they agree on *every* metric, so the
 * metrics are one constant used by both rather than two blocks that happen to
 * match today. Anything that changes the type here has to change it once.
 */
export const MONO_TEXT = {
  fontFamily: NEBULA_MONO,
  fontSize: 12.5,
  lineHeight: 1.4,
  letterSpacing: 0,
  padding: "8px 10px",
  border: 0,
  boxSizing: "border-box",
} as const;

interface HighlightBackdropProps {
  readonly value: string;
  /** highlight.js language: `AUDIT_DSL_LANGUAGE` or `"sql"`. */
  readonly language: string;
  /** `pre` for the single-line field, `pre-wrap` for the wrapped editor. */
  readonly wrap: "pre" | "pre-wrap";
}

/**
 * The coloured half of the overlay.
 *
 * Token colours are highlight.js's own global `.hljs-*` classes, injected by
 * `auditHljs` - they are the language's colours rather than the pack's, and a
 * theme that restated them would drift from every other code surface.
 * `aria-hidden`, because the real control stays the accessible one.
 */
export const HighlightBackdrop = forwardRef<HTMLDivElement, HighlightBackdropProps>(
  function HighlightBackdrop({ value, language, wrap }, ref) {
    const tokens = useAuditHighlight(value, language);
    return (
      <Box
        ref={ref}
        aria-hidden
        sx={(theme) => ({
          ...MONO_TEXT,
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          pointerEvents: "none",
          whiteSpace: wrap,
          overflowWrap: wrap === "pre-wrap" ? "break-word" : undefined,
          color: theme.palette.nebula.text,
        })}
      >
        {tokens.map((tok, i) => (
          <span key={`${i}:${tok.cls}`} className={tok.cls || undefined}>
            {tok.text}
          </span>
        ))}
        {/* A trailing newline needs a filler, or the last line has no height. */}
        {value.endsWith("\n") && " "}
      </Box>
    );
  },
);

/** The bordered well both fields sit in, lit on focus like any other input. */
export function HighlightFieldShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Box
      sx={(theme) => ({
        position: "relative",
        width: "100%",
        borderRadius: radius("md"),
        background: theme.palette.nebula.card2,
        border: `1px solid ${theme.palette.nebula.line2}`,
        "&:focus-within": { borderColor: theme.palette.nebula.accent },
      })}
    >
      {children}
    </Box>
  );
}

/**
 * The see-through control laid over the backdrop.
 *
 * The text itself is invisible - only the caret is painted - so what the user
 * reads is always the highlighted copy underneath, and selection still behaves
 * because the real control is the one being selected.
 */
export const TRANSPARENT_CONTROL = {
  ...MONO_TEXT,
  position: "relative",
  zIndex: 1,
  width: "100%",
  display: "block",
  background: "transparent",
  color: "transparent",
  WebkitTextFillColor: "transparent",
  outline: "none",
  "&:focus": { outline: "none" },
} as const;
