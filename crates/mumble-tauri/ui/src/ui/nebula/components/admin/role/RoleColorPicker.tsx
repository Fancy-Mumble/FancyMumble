import { useRef, type ChangeEvent } from "react";
import { Box, Button, TextField } from "@mui/material";
import { useTranslation } from "react-i18next";
import { NEBULA_MONO, radius } from "../../../tokens";
import { Stack } from "../../primitives";

export interface RoleColorPickerProps {
  readonly value: string | null | undefined;
  readonly onChange: (next: string | null) => void;
  readonly presets?: readonly string[];
  readonly disabled?: boolean;
}

const DEFAULT_PRESETS: readonly string[] = [
  "#5865f2", // blurple
  "#3ba55d", // green
  "#faa61a", // amber
  "#ed4245", // red
  "#eb459e", // pink
  "#9b59b6", // purple
  "#1abc9c", // teal
  "#e67e22", // orange
  "#95a5a6", // gray
];

/** The hex forms a role colour may be written in, short and alpha included. */
function isValidColor(input: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(input.trim());
}

/** The empty swatch: hatching, so "no colour" cannot be read as "black". */
const EMPTY_HATCH =
  "repeating-linear-gradient(45deg, rgba(127,127,127,0.18), rgba(127,127,127,0.18) 4px, transparent 4px, transparent 8px)";

/**
 * The role's colour: a swatch, the hex, and the presets.
 *
 * The text field stays the source of truth and accepts whatever is typed,
 * invalid included - a half-typed `#5865f` must not be rewritten under the
 * cursor. The native colour input is kept only for the picker it opens; the
 * swatch is what the user actually clicks.
 */
export function RoleColorPicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  disabled,
}: RoleColorPickerProps) {
  const { t } = useTranslation("settings");
  const colorInputRef = useRef<HTMLInputElement>(null);
  const current = value ?? "";

  const handleHexChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    onChange(raw ? raw : null);
  };

  return (
    <Stack gap={1}>
      <Stack direction="row" alignItems="center" gap={1}>
        <Box
          component="button"
          type="button"
          aria-label={t("roleDisplay.colorPickerOpen")}
          disabled={disabled}
          onClick={() => colorInputRef.current?.click()}
          sx={(theme) => ({
            all: "unset",
            boxSizing: "border-box",
            width: 32,
            height: 32,
            flex: "none",
            cursor: disabled ? "default" : "pointer",
            borderRadius: radius("md"),
            border: `1px solid ${theme.palette.nebula.line2}`,
            background: current || EMPTY_HATCH,
          })}
        />
        <Box
          component="input"
          ref={colorInputRef}
          type="color"
          value={isValidColor(current) ? current : "#5865f2"}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          sx={{ display: "none" }}
        />
        <TextField
          fullWidth
          size="small"
          placeholder="#5865f2"
          value={current}
          disabled={disabled}
          onChange={handleHexChange}
          slotProps={{
            htmlInput: {
              "aria-label": t("roleDisplay.fieldColor"),
              style: { fontFamily: NEBULA_MONO },
            },
          }}
        />
        {current && !disabled && (
          <Button size="small" sx={{ flex: "none" }} onClick={() => onChange(null)}>
            {t("roleDisplay.colorPickerClear")}
          </Button>
        )}
      </Stack>

      <Stack direction="row" gap={0.5} sx={{ flexWrap: "wrap" }}>
        {presets.map((preset) => {
          const active = current.toLowerCase() === preset.toLowerCase();
          return (
            <Box
              key={preset}
              component="button"
              type="button"
              aria-label={t("roleDisplay.colorPickerUseColor", { color: preset })}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(preset)}
              sx={(theme) => ({
                all: "unset",
                boxSizing: "border-box",
                width: 26,
                height: 26,
                cursor: disabled ? "default" : "pointer",
                borderRadius: radius("sm"),
                background: preset,
                border: `1px solid ${theme.palette.nebula.line2}`,
                outline: active ? `2px solid ${theme.palette.nebula.accent}` : undefined,
                outlineOffset: 1,
              })}
            />
          );
        })}
      </Stack>
    </Stack>
  );
}
