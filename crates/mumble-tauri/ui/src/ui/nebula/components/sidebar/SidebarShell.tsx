import type { ReactNode } from "react";
import { Stack } from "../primitives";
import { Box, Typography } from "@mui/material";

interface SidebarShellProps {
  /** Column heading; omitted on the chat screen, which leads with search. */
  title?: string;
  action?: { label: string; onClick: () => void; testId?: string };
  back?: { label: string; onClick: () => void; testId?: string };
  search?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** The fixed 290px left column every screen fills differently. */
export function SidebarShell({ title, action, back, search, children, footer }: Readonly<SidebarShellProps>) {
  return (
    <Stack
      component="nav"
      sx={(theme) => ({
        width: 290,
        flex: "none",
        minHeight: 0,
        borderRight: `1px solid ${theme.palette.nebula.line}`,
        background: theme.palette.nebula.panel,
      })}
    >
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
      {search && <Box sx={{ px: "12px", pt: title ? 0 : "12px", pb: "6px" }}>{search}</Box>}
      {children}
      {footer}
    </Stack>
  );
}
