import { useTranslation } from "react-i18next";
import { Box, Dialog, Typography } from "@mui/material";
import type { KlipyGif } from "@standard/pages/settings/KlipyGifBrowser";
import { CloseIcon } from "@ui/icons";
import { useGifBrowser } from "../gif/GifBrowser";
import { Stack } from "../primitives";

/**
 * The composer's GIF browser, in a dialog, for the avatar and banner.
 *
 * A dialog rather than the composer's popover because there is no bar here for
 * a popover to sit on. Mount it only while it is wanted: the browser fetches
 * and takes focus when it mounts.
 */
export function GifPickerDialog({
  title,
  onSelect,
  onClose,
}: Readonly<{ title: string; onSelect: (gif: KlipyGif) => void; onClose: () => void }>) {
  const { t } = useTranslation("common");
  const { searchRow, body } = useGifBrowser({ onSelect, onEscape: onClose, gridHeight: 360 });

  return (
    <Dialog
      open
      onClose={onClose}
      aria-labelledby="nebula-gif-picker-title"
      slotProps={{ paper: { sx: { width: 420, maxWidth: "calc(100% - 32px)", overflow: "hidden" } } }}
    >
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
          id="nebula-gif-picker-title"
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
      {searchRow}
      {body}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="flex-end"
        sx={(theme) => ({
          flex: "none",
          minHeight: 38,
          px: "14px",
          borderTop: `var(--nebula-line-width, 1px) solid ${theme.palette.nebula.washLine}`,
          fontSize: 11,
          color: theme.palette.nebula.muted,
        })}
      >
        Klipy
      </Stack>
    </Dialog>
  );
}
