import { Box, InputBase } from "@mui/material";
import { SearchIcon } from "@ui/icons";
import { radius } from "../../tokens";
import { chamferedSurface } from "../../theme";

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Keyboard hint chip on the right, already written for this platform -
   *  `shortcutLabel` turns a binding into one. */
  hint?: string;
  autoFocus?: boolean;
  /** Lets the owner focus the field, e.g. from the hint chip's shortcut. */
  inputRef?: React.Ref<HTMLInputElement>;
  /** For fields that drive a list below them, where the arrow keys and Enter
   *  belong to the list rather than to the text. */
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

/** The mock's rounded search field - a card with a leading glyph, not an input frame. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  hint,
  autoFocus,
  inputRef,
  onKeyDown,
}: Readonly<SearchBoxProps>) {
  return (
    <Box
      sx={(theme) => ({
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: "14px",
        py: "9px",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.input,
        border: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line2}`,
        color: theme.palette.nebula.dim,
        // A skin may lean its controls instead of rounding them, and a real
        // `border` is sliced off at the diagonal: the lean survived, the edge
        // along it did not, so the field sat open down both cut sides. Drawn
        // instead as an edge-coloured ground with the fill inset over it,
        // which is the one technique that strokes a diagonal.
        //
        // Only where there is a diagonal to stroke. That ground shows through
        // wherever the fill is translucent, which on a glass skin lifts the
        // whole field a step - and a rounded border was never sliced to begin
        // with, so those skins keep the real one.
        ...(theme.palette.nebulaSkin.clipPlate !== "none"
          ? chamferedSurface(
              theme,
              theme.palette.nebula.input,
              theme.palette.nebula.line2,
              "var(--nebula-clip-plate, none)",
            )
          : {}),
      })}
    >
      <SearchIcon width={12} height={12} />
      <InputBase
        value={value}
        autoFocus={autoFocus}
        inputRef={inputRef}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        inputProps={{ "aria-label": placeholder }}
        sx={{ flex: 1, fontSize: 12.5 }}
      />
      {hint && (
        <Box
          component="span"
          sx={(theme) => ({
            fontSize: 10,
            px: "5px",
            py: "1px",
            borderRadius: radius("sm"),
            background: theme.palette.nebula.card2,
          })}
        >
          {hint}
        </Box>
      )}
    </Box>
  );
}
