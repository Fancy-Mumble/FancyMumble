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
 *
 * `fill` claims the pane's full height and lays the page out as a column, for
 * a page whose body is one long list: the child that opts in (a `DataTable`
 * with `stickyHeader`) takes the leftover height and scrolls inside it, so the
 * title, the toolbar and the count below the table all stay put.
 */
export function AdminPage({
  title,
  hint,
  toolbar,
  wide,
  fill,
  maxWidth,
  children,
}: Readonly<{
  title: string;
  hint?: string;
  toolbar?: ReactNode;
  wide?: boolean;
  fill?: boolean;
  maxWidth?: number;
  children: ReactNode;
}>) {
  return (
    <Box
      sx={{
        maxWidth: maxWidth ?? (wide ? "none" : 760),
        ...(fill && { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }),
      }}
    >
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
            <Typography sx={(theme) => ({ mt: "4px", fontSize: 12, color: theme.palette.nebula.muted })}>
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
 *
 * `stickyHeader` pins the header row while the rows scroll under it. It also
 * makes this box the vertical scroller, which is not optional: `overflow-x`
 * already computes `overflow-y` to `auto`, so this box is a scroll container
 * either way, and sticky resolves against the nearest one - left unbounded it
 * never scrolls, and the header would sit in a box that cannot move while the
 * page scrolled away beneath it. Bounding it needs the height the parent
 * hands down, so the page above must be an `AdminPage` with `fill`.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  selectedKey,
  rowAttrs,
  stickyHeader,
}: Readonly<{
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  empty: ReactNode;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  /** Extra DOM attributes per row - the hook the E2E suites address rows by. */
  rowAttrs?: (row: T) => Record<string, string | undefined>;
  /** Pin the header row and scroll the rows inside the table. */
  stickyHeader?: boolean;
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
        // `0 1 auto`, not `1 1 auto`: a short table keeps its natural height
        // rather than stretching an empty card down the pane; only a table
        // taller than the space left over shrinks into a scroller.
        ...(stickyHeader && { overflowY: "auto", flex: "0 1 auto", minHeight: 0 }),
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
                  ...(stickyHeader && {
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                    // `card` is translucent, so rows would read straight
                    // through the pinned strip. `bg0` is the window's own
                    // surface and opaque, the colour AuditAdmin pins with.
                    background: theme.palette.nebula.bg0,
                    // `border-collapse: collapse` hands the cell borders over
                    // to the table, which leaves them behind when the header
                    // sticks; an inset shadow travels with the cell.
                    borderBottom: "none",
                    boxShadow: `inset 0 -1px 0 ${theme.palette.nebula.line2}`,
                  }),
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
