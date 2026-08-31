import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { Stack } from "../primitives";
import { radius } from "../../tokens";

interface ExpandableRowProps {
  /** Swatch or glyph showing the current pick at a glance. */
  preview: ReactNode;
  title: string;
  /** The current selection, spelled out. */
  value: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * The mock's "row shows your pick, Change opens just that section" pattern.
 *
 * Only one of these is open at a time, so the page reads as a summary of every
 * choice rather than a wall of pickers; the open row's panel is drawn as a
 * continuation of the header, sharing its border.
 */
export function ExpandableRow({
  preview,
  title,
  value,
  open,
  onToggle,
  children,
}: Readonly<ExpandableRowProps>) {
  const { t } = useTranslation("nebulaSettings");
  return (
    <Box>
      <Stack
        direction="row"
        alignItems="center"
        gap={1.5}
        sx={(theme) => ({
          mt: "10px",
          px: "14px",
          py: "12px",
          background: theme.palette.nebula.card,
          border: `1px solid ${theme.palette.nebula.line}`,
          borderBottom: open ? "none" : `1px solid ${theme.palette.nebula.line}`,
          borderRadius: open ? `${radius("lg")} ${radius("lg")} 0 0` : radius("lg"),
        })}
      >
        <Box sx={{ flex: "none", display: "flex", alignItems: "center" }}>{preview}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography data-settings-anchor={title} sx={{ fontSize: 12.5, fontWeight: 600 }}>
            {title}
          </Typography>
          <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })} noWrap>
            {value}
          </Typography>
        </Box>
        <Box
          component="button"
          aria-expanded={open}
          onClick={onToggle}
          sx={(theme) => ({
            all: "unset",
            cursor: "pointer",
            flex: "none",
            px: "15px",
            py: "7px",
            borderRadius: "999px",
            background: theme.palette.nebula.card2,
            fontSize: 11.5,
            fontWeight: 600,
            "&:hover": { background: theme.palette.nebula.hover },
          })}
        >
          {open ? t("row.done") : t("row.change")}
        </Box>
      </Stack>
      {open && (
        <Box
          sx={(theme) => ({
            px: "16px",
            pt: "16px",
            pb: "14px",
            background: theme.palette.nebula.card,
            border: `1px solid ${theme.palette.nebula.line}`,
            borderTop: "none",
            borderRadius: `0 0 ${radius("lg")} ${radius("lg")}`,
          })}
        >
          {children}
        </Box>
      )}
    </Box>
  );
}
