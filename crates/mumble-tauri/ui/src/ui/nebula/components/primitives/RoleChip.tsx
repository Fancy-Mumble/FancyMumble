import { useMemo } from "react";
import { Box } from "@mui/material";
import { safeRoleColor } from "@core/features/roster/roles";
import { textureToDataUrl } from "@core/profileFormat";
import { radius } from "../../tokens";

export interface RoleChipProps {
  /** Display name of the role. */
  readonly name: string;
  /** Optional colour the server assigned the role. */
  readonly color?: string | null;
  /** Optional raw icon bytes (PNG/JPEG), drawn as a small avatar. */
  readonly icon?: number[] | null;
  readonly size?: "small" | "medium" | "large";
  readonly title?: string;
  readonly onClick?: () => void;
}

/** The three steps, kept as data so the sx block stays one expression. */
const SIZES = {
  small: { px: "6px", py: "1px", fontSize: 11 },
  medium: { px: "9px", py: "2.5px", fontSize: 12 },
  large: { px: "12px", py: "5px", fontSize: 13 },
} as const;

/**
 * A role, drawn as the pill it is on every surface that names one.
 *
 * The colour is the server's, not the pack's, so it is mixed rather than used
 * raw: a fill at full strength on a Nebula card is a slab, and role colours are
 * chosen against a dark chat list rather than against this scheme. Uncoloured
 * roles fall back to the neutral chip, never to a made-up hue.
 *
 * Mixed in CSS rather than with MUI's `alpha()`: the colour can be anything a
 * server stored, and `alpha()` throws on a named colour and garbles a short or
 * half-typed hex - a single such role took down every surface listing it.
 */
export function RoleChip({ name, color, icon, size = "medium", title, onClick }: RoleChipProps) {
  const iconSrc = useMemo(() => (icon && icon.length > 0 ? textureToDataUrl(icon) : null), [icon]);
  const step = SIZES[size];
  const tint = safeRoleColor(color);

  return (
    <Box
      component={onClick ? "button" : "span"}
      type={onClick ? "button" : undefined}
      title={title ?? name}
      onClick={onClick}
      sx={(theme) => {
        const { nebula } = theme.palette;
        return {
          all: "unset",
          boxSizing: "border-box",
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
          maxWidth: "100%",
          overflow: "hidden",
          whiteSpace: "nowrap",
          cursor: onClick ? "pointer" : "default",
          borderRadius: radius("pill"),
          fontWeight: 600,
          lineHeight: 1.2,
          ...step,
          color: tint ?? nebula.text,
          background: tint ? `color-mix(in srgb, ${tint} 18%, transparent)` : nebula.card2,
          border: `var(--nebula-line-width, 1px) solid ${tint ? `color-mix(in srgb, ${tint} 50%, transparent)` : "transparent"}`,
        };
      }}
    >
      {iconSrc ? (
        <Box
          component="img"
          src={iconSrc}
          alt=""
          sx={{ width: "1em", height: "1em", borderRadius: radius("pill"), objectFit: "cover", flex: "none" }}
        />
      ) : (
        <Box
          component="span"
          aria-hidden
          sx={{
            width: "0.55em",
            height: "0.55em",
            borderRadius: radius("pill"),
            flex: "none",
            background: "currentColor",
          }}
        />
      )}
      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {name}
      </Box>
    </Box>
  );
}
