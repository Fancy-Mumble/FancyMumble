import type { ReactNode } from "react";
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
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
 * `stickyHeader` is MUI's own, which switches the table to
 * `border-collapse: separate` so the header cells keep their borders while
 * they float. What it does not do is bound the scroller: sticky resolves
 * against the nearest one, and `TableContainer` is one either way (`overflow-x`
 * computes `overflow-y` to `auto`), so left unbounded it never scrolls and the
 * header sits in a box that cannot move while the page scrolls away beneath
 * it. Bounding it needs the height the parent hands down, so the page above
 * must be an `AdminPage` with `fill`.
 *
 * `flush` drops the card chrome - the radius, the hairline, the fill - for a
 * host that is already a surface. A dialog paper draws all three itself, so a
 * table nested inside one with no padding between them showed two rounded
 * borders a pixel apart. Flush, the table *is* the dialog, and the paper's
 * own radius does the cornering.
 *
 * `layout="fixed"` hands the column widths to `table-layout: fixed`, which is
 * what makes a `width` binding rather than a suggestion: under the default
 * auto layout a long filename widens its column until the columns past it are
 * pushed out of the viewport, and no cell can ellipsise because none of them
 * has a definite width to ellipsise against. The unsized column takes up the
 * slack.
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
  flush,
  layout = "auto",
  minWidth,
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
  /** Drop the card chrome so an enclosing surface (a dialog paper) is the card. */
  flush?: boolean;
  /** `fixed` makes `Column.width` binding and lets cells ellipsise. */
  layout?: "auto" | "fixed";
  /** Floor for the table's width: narrower than this it scrolls sideways in
   *  its own box rather than squeezing every column past legibility. */
  minWidth?: number | string;
}>) {
  if (rows.length === 0) {
    return (
      <Box
        sx={(theme) => ({
          px: "16px",
          py: "28px",
          textAlign: "center",
          color: theme.palette.nebula.muted,
          fontSize: 12,
          ...(flush
            ? {}
            : {
                borderRadius: radius("lg"),
                border: `1px dashed ${theme.palette.nebula.line2}`,
              }),
        })}
      >
        {empty}
      </Box>
    );
  }
  return (
    <TableContainer
      sx={(theme) => ({
        // `0 1 auto`, not `1 1 auto`: a short table keeps its natural height
        // rather than stretching an empty card down the pane; only a table
        // taller than the space left over shrinks into a scroller.
        ...(stickyHeader && { overflowY: "auto", flex: "0 1 auto", minHeight: 0 }),
        ...(flush
          ? {}
          : {
              borderRadius: radius("lg"),
              background: theme.palette.nebula.card,
              border: `1px solid ${theme.palette.nebula.line}`,
            }),
      })}
    >
      <Table
        stickyHeader={stickyHeader}
        size="small"
        sx={{
          minWidth,
          tableLayout: layout,
          fontSize: 12,
          // Sticky mode is `border-collapse: separate`, which brings a default
          // `border-spacing` with it and gaps every cell.
          borderSpacing: 0,
        }}
      >
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell
                key={column.key}
                align={column.align ?? "left"}
                sx={(theme) => ({
                  px: "12px",
                  py: "9px",
                  width: column.width,
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: theme.palette.nebula.dim,
                  borderBottom: `1px solid ${theme.palette.nebula.line2}`,
                  whiteSpace: "nowrap",
                  // `card` is translucent, so rows would read straight through
                  // the pinned strip. `bg0` is the window's own surface and
                  // opaque - MUI pins with `background.default`, which this
                  // pack leaves transparent.
                  ...(stickyHeader && { background: theme.palette.nebula.bg0 }),
                })}
              >
                {column.header}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => {
            const key = rowKey(row);
            const selected = selectedKey != null && selectedKey === key;
            return (
              <TableRow
                key={key}
                selected={selected}
                {...rowAttrs?.(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                sx={(theme) => ({
                  cursor: onRowClick ? "pointer" : "default",
                  "&.Mui-selected, &.Mui-selected:hover": {
                    background: theme.palette.nebula.accentSoft,
                  },
                  "&:hover": onRowClick ? { background: theme.palette.nebula.hover } : undefined,
                })}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    align={column.align ?? "left"}
                    sx={(theme) => ({
                      px: "12px",
                      py: "9px",
                      // The rule between rows is drawn on top, not bottom, so
                      // the last row ends on the surface rather than on a line.
                      borderTop: `1px solid ${theme.palette.nebula.line}`,
                      borderBottom: "none",
                      color: theme.palette.nebula.text,
                      verticalAlign: "middle",
                    })}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
