import type { ReactNode } from "react";
import { Stack } from "../primitives";
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { SectionLabel } from "../primitives/SectionLabel";

interface SidebarShellProps {
  /** Column heading; omitted on the chat screen, which leads with search. */
  title?: string;
  /**
   * Product wordmark for the plate above the column. Only a stencil skin
   * prints it - every other chrome voice leads with search, as it always has.
   */
  brand?: string;
  /**
   * The heading over the column's contents - the server, and how many
   * channels are under it. Stencil-only, like the brand plate above it.
   */
  heading?: { label: string | undefined; count?: number };
  action?: { label: string; onClick: () => void; testId?: string };
  back?: { label: string; onClick: () => void; testId?: string };
  search?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * The column *is* the screen, rather than a column beside one.
   *
   * A phone has no second column to sit next to, so the fixed width becomes
   * the whole width and the hairline that divided it from the pane on its
   * right goes with it - there is nothing on its right.
   */
  full?: boolean;
}

/** The fixed 290px left column every screen fills differently. */
export function SidebarShell({
  title,
  brand,
  heading,
  action,
  back,
  search,
  children,
  footer,
  full = false,
}: Readonly<SidebarShellProps>) {
  const stencil = useTheme().palette.nebulaSkin.chrome === "stencil";
  return (
    <Stack
      component="nav"
      sx={(theme) => ({
        width: full ? "100%" : theme.palette.nebulaSkin.columnWidth,
        flex: full ? 1 : "none",
        minHeight: 0,
        ...(full ? {} : { borderRight: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}` }),
        background: theme.palette.nebula.panel,
      })}
    >
      {brand && stencil && (
        <Box
          sx={(theme) => ({
            flex: "none",
            display: "flex",
            alignItems: "center",
            height: 74,
            px: "18px",
            borderBottom: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.line}`,
          })}
        >
          {/* Two skews: the plate leans, the word inside leans back so it
              stays upright on a slanted ground. */}
          <Box
            sx={(theme) => ({
              transform: "skewX(-12deg)",
              background: theme.palette.nebula.accent,
              px: "14px",
              py: "6px",
              boxShadow: `3px 3px 0 ${theme.palette.nebula.accentSoft}`,
            })}
          >
            <Typography
              component="div"
              sx={(theme) => ({
                transform: "skewX(12deg)",
                fontStyle: "italic",
                fontWeight: 800,
                fontSize: 15,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                color: theme.palette.nebula.onAccent,
              })}
            >
              {brand}
            </Typography>
          </Box>
        </Box>
      )}
      {back && (
        <Box
          component="button"
          data-testid={back.testId}
          onClick={back.onClick}
          sx={(theme) => ({
            all: "unset",
            cursor: "pointer",
            px: "16px",
            pt: "14px",
            pb: "4px",
            fontSize: 12,
            color: theme.palette.nebula.muted,
            "&:hover": { color: theme.palette.nebula.text },
          })}
        >
          ‹ {back.label}
        </Box>
      )}
      {title && (
        <Stack direction="row" alignItems="center" sx={{ px: "14px", pt: back ? "10px" : "14px", pb: "8px" }}>
          <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{title}</Typography>
          {action && (
            <Box
              component="button"
              data-testid={action.testId}
              onClick={action.onClick}
              sx={(theme) => ({
                all: "unset",
                cursor: "pointer",
                ml: "auto",
                fontSize: 12,
                fontWeight: 500,
                color: theme.palette.nebula.accent,
              })}
            >
              {action.label}
            </Box>
          )}
        </Stack>
      )}
      {search && (
        <Box
          sx={
            stencil
              ? { px: "18px", pt: "16px", pb: "10px" }
              : { px: "12px", pt: title ? 0 : "12px", pb: "6px" }
          }
        >
          {search}
        </Box>
      )}
      {heading?.label && stencil && (
        <Box sx={{ px: "14px", pt: "6px", pb: "8px", display: "flex", alignItems: "center", gap: "10px" }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <SectionLabel>{heading.label}</SectionLabel>
          </Box>
          {heading.count !== undefined && (
            <Typography
              component="div"
              sx={(theme) => ({
                flex: "none",
                fontSize: 11,
                fontWeight: 700,
                color: theme.palette.nebula.muted,
              })}
            >
              {String(heading.count).padStart(2, "0")}
            </Typography>
          )}
        </Box>
      )}
      {children}
      {footer}
    </Stack>
  );
}
