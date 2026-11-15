import { useTranslation } from "react-i18next";
import { Box } from "@mui/material";
import { useGifBrowser } from "../../gif/GifBrowser";
import { PopoverPanel } from "./PopoverPanel";

/** The canvas's width for this panel. */
export const GIF_POPOVER_WIDTH = 400;

/**
 * The GIF panel.
 *
 * Search is a row, not a boxed field with a glowing ring - the same header the
 * emoji panel uses, because they are the same object at two widths. Tabs are
 * bare pills with only the active one lit.
 *
 * The grid is two columns: at 400px a third column makes each tile too small
 * to tell two reaction GIFs apart, which is the whole task here.
 */
export function GifPopover({
  left,
  onSelect,
  onClose,
}: Readonly<{ left: number; onSelect: (url: string) => void; onClose: () => void }>) {
  const { t } = useTranslation("nebulaChat");
  const { searchRow, body } = useGifBrowser({ onSelect: (gif) => onSelect(gif.url), onEscape: onClose });

  return (
    <PopoverPanel
      width={GIF_POPOVER_WIDTH}
      left={left}
      title="GIF"
      onClose={onClose}
      footer={
        <>
          <Box component="span" sx={{ flex: 1 }}>
            {t("gif.sendHint")}
          </Box>
          <Box component="span">Klipy</Box>
        </>
      }
      header={searchRow}
    >
      {body}
    </PopoverPanel>
  );
}
