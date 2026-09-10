import { useTranslation } from "react-i18next";
import { Box, Typography } from "@mui/material";
import { Stack } from "../../primitives";
import { washPanel } from "../../../theme";
import { radius } from "../../../tokens";
import { CloseIcon } from "@ui/icons";

/**
 * The shell every composer popover is made of.
 *
 * The canvas draws emoji, GIF, poll and file share as one object at four
 * widths - same corner, same glass, same 44px header on a hairline - so it is
 * one component here too. Building each separately is how four panels drift
 * into four different paddings.
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
  const { t } = useTranslation("common");
  return (
    <Box
      role="dialog"
      aria-label={title}
      sx={(theme) => ({
        position: "absolute",
        bottom: "100%",
        // The composer's inset, so the panel and the bar share one edge - but
        // only while there is room to the right of it. On a narrow window a
        // 400px panel opened from a button two thirds along the bar would
        // begin past the point where it still fits, and `maxWidth` only
        // narrows it: what overflows is the *offset*, not the width. The upper
        // bound is therefore where this panel's right edge meets the opposite
        // inset, and `max` keeps that bound from crossing behind the near one
        // when the panel is wider than the whole bar. Inert on a desktop
        // window, where the preferred offset is nowhere near the bound.
        left: `clamp(10px, ${left + 10}px, max(10px, calc(100% - 10px - ${width}px)))`,
        width,
        maxWidth: "calc(100% - 20px)",
        zIndex: 25,
        display: "flex",
        flexDirection: "column",
        // The pack's floating-surface corner, the one NebulaSurface takes: a
        // 16px literal rounded these four panels in a skin whose every other
        // corner is square.
        borderRadius: radius("xl"),
        overflow: "hidden",
        ...washPanel(theme),
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
            borderBottom: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.washLine}`,
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
            aria-label={t("actions.close")}
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
            borderTop: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.washLine}`,
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
