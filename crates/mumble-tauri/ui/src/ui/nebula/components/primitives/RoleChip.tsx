import { useMemo } from "react";
import { Box, alpha } from "@mui/material";
import { textureToDataUrl } from "@core/profileFormat";

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
 */
export function RoleChip({ name, color, icon, size = "medium", title, onClick }: RoleChipProps) {
  const iconSrc = useMemo(() => (icon && icon.length > 0 ? textureToDataUrl(icon) : null), [icon]);
  const step = SIZES[size];

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
          borderRadius: "999px",
          fontWeight: 600,
          lineHeight: 1.2,
          ...step,
          color: color ?? nebula.text,
          background: color ? alpha(color, 0.18) : nebula.card2,
          border: `1px solid ${color ? alpha(color, 0.5) : "transparent"}`,
        };
      }}
    >
      {iconSrc ? (
        <Box
          component="img"
          src={iconSrc}
          alt=""
          sx={{ width: "1em", height: "1em", borderRadius: "999px", objectFit: "cover", flex: "none" }}
        />
      ) : (
        <Box
          component="span"
          aria-hidden
          sx={{
            width: "0.55em",
            height: "0.55em",
            borderRadius: "999px",
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
