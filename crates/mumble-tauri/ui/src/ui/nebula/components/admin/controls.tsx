import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { Stack } from "../primitives";
import { radius } from "../../tokens";

/**
 * An administration page: a title, an optional toolbar, and the page itself.
 *
 * `wide` opts out of the reading-width column that the settings pages use.
 * The ACL editor, the audit viewer and the file-server dashboard are tables
 * whose columns carry the meaning, and squeezing them into a 640px measure
 * turns every row into three wrapped lines.
 *
 * `maxWidth` is for the pages in between: a form beside a preview is neither a
 * single reading column nor a table, and it needs the title and the toolbar
 * bounded with the content, so the save button stays over the column it saves
 * rather than drifting to the far edge of a wide window.
 */
export function AdminPage({
  title,
  hint,
  toolbar,
  wide,
  maxWidth,
  children,
}: Readonly<{
  title: string;
  hint?: string;
  toolbar?: ReactNode;
  wide?: boolean;
  maxWidth?: number;
  children: ReactNode;
}>) {
  return (
    <Box sx={{ maxWidth: maxWidth ?? (wide ? "none" : 760) }}>
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        gap={2}
        sx={{ mb: "20px" }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 20, fontWeight: 600 }}>{title}</Typography>
          {hint && (
            <Typography
              sx={(theme) => ({ mt: "4px", fontSize: 12, color: theme.palette.nebula.muted })}
            >
              {hint}
            </Typography>
          )}
        </Box>
        {toolbar && (
          <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ flex: "none" }}>
            {toolbar}
          </Stack>
        )}
      </Stack>
      {children}
    </Box>
  );
}

/**
 * The list-and-detail layout most admin pages use.
 *
 * The panes scroll independently: the list is often long and the detail form
 * short, and a single scroller means scrolling to the bottom of a 300-entry
 * ban list to reach the form that edits the entry at the top.
 */
export function SplitView({
  list,
  detail,
  listWidth = 300,
}: Readonly<{ list: ReactNode; detail: ReactNode; listWidth?: number }>) {
  return (
    <Stack direction="row" gap={1.5} sx={{ alignItems: "stretch", minHeight: 0 }}>
      <Box
        sx={(theme) => ({
          flex: "none",
          width: listWidth,
          maxHeight: "62vh",
          overflowY: "auto",
          p: "6px",
          borderRadius: radius("lg"),
          background: theme.palette.nebula.card,
          border: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        {list}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, maxHeight: "62vh", overflowY: "auto" }}>{detail}</Box>
    </Stack>
  );
}

/** One row of a `SplitView` list. */
export function ListRow({
  title,
  subtitle,
  selected,
  onClick,
}: Readonly<{ title: string; subtitle?: string; selected: boolean; onClick: () => void }>) {
  return (
    <Box
      component="button"
      aria-current={selected}
      onClick={onClick}
      sx={(theme) => ({
        all: "unset",
        boxSizing: "border-box",
        display: "block",
        width: "100%",
        cursor: "pointer",
        px: "11px",
        py: "8px",
        borderRadius: radius("md"),
        background: selected ? theme.palette.nebula.accentSoft : "transparent",
        border: `1px solid ${selected ? theme.palette.nebula.accentLine : "transparent"}`,
        "&:hover": { background: selected ? theme.palette.nebula.accentSoft : theme.palette.nebula.hover },
      })}
    >
      <Typography sx={{ fontSize: 12.5, fontWeight: selected ? 600 : 500 }} noWrap>
        {title}
      </Typography>
      {subtitle && (
        <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })} noWrap>
          {subtitle}
        </Typography>
      )}
    </Box>
  );
}

/** The prompt in a detail pane with nothing selected. */
export function DetailPlaceholder({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Box
      sx={(theme) => ({
        height: "100%",
        minHeight: 180,
        display: "grid",
        placeItems: "center",
        borderRadius: radius("lg"),
        border: `1px dashed ${theme.palette.nebula.line2}`,
        color: theme.palette.nebula.muted,
        fontSize: 12,
      })}
    >
      {children}
    </Box>
  );
}

export interface Column<T> {
  key: string;
  /** A node, not a string, so a column can make its own header clickable to sort. */
  header: ReactNode;
  /** Rendered cell. Return a string for plain text. */
  cell: (row: T) => ReactNode;
  width?: number | string;
  align?: "left" | "right";
}

/**
 * A table for the pages whose subject really is rows and columns.
 *
 * Its own horizontal scroller: an admin table can be wider than the window and
 * the page body must never scroll sideways, or the sidebar goes with it.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  selectedKey,
  rowAttrs,
}: Readonly<{
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  empty: ReactNode;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  /** Extra DOM attributes per row - the hook the E2E suites address rows by. */
  rowAttrs?: (row: T) => Record<string, string | undefined>;
}>) {
  if (rows.length === 0) {
    return (
      <Box
        sx={(theme) => ({
          px: "16px",
          py: "28px",
          textAlign: "center",
          borderRadius: radius("lg"),
          border: `1px dashed ${theme.palette.nebula.line2}`,
          color: theme.palette.nebula.muted,
          fontSize: 12,
        })}
      >
        {empty}
      </Box>
    );
  }
  return (
    <Box
      sx={(theme) => ({
        overflowX: "auto",
        borderRadius: radius("lg"),
        background: theme.palette.nebula.card,
        border: `1px solid ${theme.palette.nebula.line}`,
      })}
    >
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <Box component="thead">
          <Box component="tr">
            {columns.map((column) => (
              <Box
                component="th"
                key={column.key}
                sx={(theme) => ({
                  px: "12px",
                  py: "9px",
                  width: column.width,
                  textAlign: column.align ?? "left",
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: theme.palette.nebula.dim,
                  borderBottom: `1px solid ${theme.palette.nebula.line2}`,
                  whiteSpace: "nowrap",
                })}
              >
                {column.header}
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map((row) => {
            const key = rowKey(row);
            const selected = selectedKey != null && selectedKey === key;
            return (
              <Box
                component="tr"
                key={key}
                {...rowAttrs?.(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                sx={(theme) => ({
                  cursor: onRowClick ? "pointer" : "default",
                  background: selected ? theme.palette.nebula.accentSoft : "transparent",
                  "&:hover": onRowClick
                    ? { background: selected ? theme.palette.nebula.accentSoft : theme.palette.nebula.hover }
                    : undefined,
                })}
              >
                {columns.map((column) => (
                  <Box
                    component="td"
                    key={column.key}
                    sx={(theme) => ({
                      px: "12px",
                      py: "9px",
                      textAlign: column.align ?? "left",
                      borderTop: `1px solid ${theme.palette.nebula.line}`,
                      color: theme.palette.nebula.text,
                      verticalAlign: "middle",
                    })}
                  >
                    {column.cell(row)}
                  </Box>
                ))}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
