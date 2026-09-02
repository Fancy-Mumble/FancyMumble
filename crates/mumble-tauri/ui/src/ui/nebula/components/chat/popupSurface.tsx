import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { radius } from "../../tokens";

/**
 * The floating list the composer opens above itself.
 *
 * `@` and `/` open two lists that are the same object in the mock - same
 * glass, same rows, same rule about where they sit - so the surface is one
 * component and each list contributes only its rows. The composer's own popup
 * slot does the positioning; nothing here is absolute, because a surface that
 * placed itself could not be reused anywhere else.
 */
export function PopupSurface({ ariaLabel, children }: Readonly<{ ariaLabel?: string; children: ReactNode }>) {
  return (
    <Box
      role="listbox"
      aria-label={ariaLabel}
      sx={(theme) => ({
        display: "flex",
        flexDirection: "column",
        maxHeight: 240,
        overflow: "hidden",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line2}`,
        boxShadow: theme.palette.nebula.shadow,
      })}
    >
      {children}
    </Box>
  );
}

/** What a list says when the query matched nothing. */
export function PopupEmpty({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Typography
      sx={(theme) => ({
        px: "14px",
        py: "10px",
        fontSize: 12,
        textAlign: "center",
        color: theme.palette.nebula.muted,
      })}
    >
      {children}
    </Typography>
  );
}

/** The shape both lists' rows share; the caller supplies the active fill. */
export const POPUP_ROW = {
  all: "unset",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: "10px",
  width: "100%",
  px: "10px",
  py: "6px",
  borderRadius: radius("md"),
  cursor: "pointer",
  userSelect: "none",
  fontSize: 13,
  transition: "background 0.1s",
} as const;
