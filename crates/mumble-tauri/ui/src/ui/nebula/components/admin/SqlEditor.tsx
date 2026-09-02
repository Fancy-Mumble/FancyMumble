import { useLayoutEffect, useRef } from "react";
import { Box } from "@mui/material";
import { TID } from "@core/testids";
import { HighlightBackdrop, HighlightFieldShell, TRANSPARENT_CONTROL } from "./highlightField";

interface SqlEditorProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly placeholder: string;
}

/**
 * The advanced (SQL) audit query field.
 *
 * The same overlay as `QueryAutocomplete`, wrapped rather than single-line, and
 * kept scrolled with its backdrop on both axes - a textarea the user has
 * resized or scrolled must not leave its colours behind.
 */
export function SqlEditor({ value, onChange, placeholder }: SqlEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const sync = () => {
    if (backdropRef.current && taRef.current) {
      backdropRef.current.scrollTop = taRef.current.scrollTop;
      backdropRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };
  // Realign after any value change - resize, or a programmatic edit.
  useLayoutEffect(sync);

  return (
    <HighlightFieldShell>
      <HighlightBackdrop ref={backdropRef} value={value} language="sql" wrap="pre-wrap" />
      <Box
        component="textarea"
        ref={taRef}
        data-testid={TID.auditQueryInput}
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
        onScroll={sync}
        sx={(theme) => ({
          ...TRANSPARENT_CONTROL,
          minHeight: 84,
          resize: "vertical",
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
          caretColor: theme.palette.nebula.text,
          "&::placeholder": {
            color: theme.palette.nebula.muted,
            WebkitTextFillColor: theme.palette.nebula.muted,
          },
        })}
      />
    </HighlightFieldShell>
  );
}
