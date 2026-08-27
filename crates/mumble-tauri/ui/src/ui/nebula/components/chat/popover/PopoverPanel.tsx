import { Box, Typography } from "@mui/material";
import { Stack } from "../../primitives";
import { CloseIcon } from "@ui/icons";

/**
 * The shell every composer popover is made of.
 *
 * The canvas draws emoji, GIF, poll and file share as one object at four
 * widths - same 16px radius, same glass, same 44px header on a hairline - so
 * it is one component here too. Building each separately is how four panels
 * drift into four different paddings.
 *
 * They are popovers, not dialogs: each sits on the composer's own 10px inset
 * directly above it, with no centred modal and no scrim over the conversation.
 * Dismissal is a click outside, which the caller mounts.
 */
export interface PopoverPanelProps {
  /** The canvas's fixed widths: emoji 340, GIF and poll 400, file share 460. */
  width: number;
  /** Distance from the composer's left edge to the icon that opened this. */
  left: number;
  /** Uppercase label for a titled panel; omitted when the header is a search row. */
  title?: string;
  /** Replaces the title row entirely - the emoji panel's search is a header. */
  header?: React.ReactNode;
  onClose: () => void;
  /** A hint row along the bottom, e.g. a shortcut or an attribution. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function PopoverPanel({
  width,
  left,
  title,
  header,
  onClose,
  footer,
  children,
}: Readonly<PopoverPanelProps>) {
  return (
    <Box
      role="dialog"
      aria-label={title}
      sx={(theme) => ({
        position: "absolute",
        bottom: "100%",
        // The composer's inset, so the panel and the bar share one edge.
        left: left + 10,
        width,
        maxWidth: "calc(100% - 20px)",
        zIndex: 25,
        display: "flex",
        flexDirection: "column",
        borderRadius: "16px",
        overflow: "hidden",
        background: theme.palette.nebula.wash,
        backdropFilter: "blur(36px) saturate(160%)",
        WebkitBackdropFilter: "blur(36px) saturate(160%)",
        border: `1px solid ${theme.palette.nebula.washLine}`,
      })}
    >
      {header ?? (
        <Stack
          direction="row"
          alignItems="center"
          sx={(theme) => ({
            height: 44,
            flex: "none",
            px: "14px",
            borderBottom: `1px solid ${theme.palette.nebula.washLine}`,
          })}
        >
          <Typography
            sx={(theme) => ({
              flex: 1,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: theme.palette.nebula.muted,
            })}
          >
            {title}
          </Typography>
          <Box
            component="button"
            type="button"
            aria-label="Close"
            onClick={onClose}
            sx={(theme) => ({
              all: "unset",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              color: theme.palette.nebula.muted,
              "&:hover": { color: theme.palette.nebula.text },
            })}
          >
            <CloseIcon width={13} height={13} />
          </Box>
        </Stack>
      )}

      {children}

      {footer && (
        <Stack
          direction="row"
          alignItems="center"
          sx={(theme) => ({
            flex: "none",
            minHeight: 38,
            px: "14px",
            borderTop: `1px solid ${theme.palette.nebula.washLine}`,
            fontSize: 11,
            color: theme.palette.nebula.muted,
          })}
        >
          {footer}
        </Stack>
      )}
    </Box>
  );
}

/** The click-away sheet a popover is dismissed by. No scrim - just a target. */
export function PopoverScrim({ onClose }: Readonly<{ onClose: () => void }>) {
  return <Box aria-hidden onClick={onClose} sx={{ position: "fixed", inset: 0, zIndex: 24 }} />;
}
