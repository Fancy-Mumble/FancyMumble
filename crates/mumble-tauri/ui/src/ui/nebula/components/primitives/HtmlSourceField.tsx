/**
 * A syntax-highlighted editor for raw markup.
 *
 * The other half of editing a welcome text: a document a WYSIWYG cannot hold
 * without changing it has to be editable *as what it is*, and a wall of
 * uncoloured angle brackets is not a thing anyone can find a typo in.
 *
 * The technique is the one the audit query bar already uses: a transparent
 * `<textarea>` over an `aria-hidden` backdrop rendering the same characters as
 * highlight.js spans, with the two scrolled together. Every glyph therefore has
 * to be laid out identically in both layers - which is why the font, size, line
 * height, padding and wrapping below are stated once and shared, rather than
 * set on each.
 */

import { useLayoutEffect, useRef } from "react";
import { Box, useTheme } from "@mui/material";
import { useAuditHighlight } from "@core/features/admin/auditHljs";
import { NEBULA_MONO, radius } from "../../tokens";

/** highlight.js calls the HTML grammar `xml`. */
const LANGUAGE = "xml";

export interface HtmlSourceFieldProps {
  readonly value: string;
  readonly onChange: (html: string) => void;
  /** Names the field for a screen reader, and for the tests. */
  readonly ariaLabel: string;
  readonly minHeight?: number;
  readonly maxHeight?: number;
}

export function HtmlSourceField({
  value,
  onChange,
  ariaLabel,
  minHeight = 160,
  maxHeight = 420,
}: Readonly<HtmlSourceFieldProps>) {
  const { nebula } = useTheme().palette;
  const tokens = useAuditHighlight(value, LANGUAGE);
  const backdrop = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Follow the textarea rather than listening for scroll on both: the caret can
  // move the view without a scroll event the backdrop would see.
  const sync = () => {
    if (!backdrop.current || !input.current) return;
    backdrop.current.scrollTop = input.current.scrollTop;
    backdrop.current.scrollLeft = input.current.scrollLeft;
  };
  useLayoutEffect(sync, [value]);

  // Both layers, character for character. Anything that moves a glyph belongs
  // here or the colours drift off the text under the caret.
  const layout = {
    margin: 0,
    padding: "10px 13px",
    fontFamily: NEBULA_MONO,
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    overflowWrap: "anywhere" as const,
    border: 0,
    minHeight,
    maxHeight,
    overflow: "auto",
    tabSize: 2,
  };

  return (
    <Box
      sx={{
        position: "relative",
        borderRadius: radius("md"),
        background: nebula.card,
        border: `1px solid ${nebula.line2}`,
        transition: "border-color 140ms ease",
        "&:focus-within": { borderColor: nebula.accentLine },
      }}
    >
      <Box
        ref={backdrop}
        aria-hidden="true"
        sx={{
          ...layout,
          // Under the textarea, and never the thing that scrolls itself: the
          // control on top owns the scroll position and hands it down.
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          color: nebula.text,
          pointerEvents: "none",
          "& .hljs-tag, & .hljs-name": { color: nebula.accent },
          "& .hljs-attr": { color: nebula.ok },
          "& .hljs-string": { color: nebula.warn },
          "& .hljs-comment": { color: nebula.dim, fontStyle: "italic" },
        }}
      >
        {tokens.map((token, index) => (
          <span key={`${index}:${token.cls}`} className={token.cls || undefined}>
            {token.text}
          </span>
        ))}
        {/* A trailing newline needs a filler, or the last line has no height. */}
        {value.endsWith("\n") && " "}
      </Box>

      <Box
        component="textarea"
        ref={input}
        aria-label={ariaLabel}
        spellCheck={false}
        value={value}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        onScroll={sync}
        sx={{
          ...layout,
          position: "relative",
          display: "block",
          width: "100%",
          resize: "vertical",
          background: "transparent",
          // The text is drawn by the backdrop; this layer contributes the caret
          // and the selection, and nothing else visible.
          color: "transparent",
          caretColor: nebula.text,
          outline: "none",
          "&::selection": { background: nebula.accentSoft, color: "transparent" },
        }}
      />
    </Box>
  );
}
