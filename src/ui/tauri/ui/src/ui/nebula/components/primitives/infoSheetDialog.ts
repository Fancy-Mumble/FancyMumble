import type { DialogProps } from "@mui/material";
import { SAFE_AREA } from "../../tokens";
import { useIsHandheld } from "../../useIsHandheld";

/**
 * How an information sheet's dialog sits over the shell.
 *
 * On a desktop or tablet the sheet floats as a card. A phone has no room for
 * one - a card inset from every edge leaves the facts squeezed into a strip -
 * so there the dialog takes the whole screen, kept clear of the status and
 * gesture bars the app draws under, and the sheet is stretched to fill it.
 * `&&` doubles the paper's class so that outranks the sheet's own width and
 * `maxHeight`, which sit on a single class.
 */
export function useInfoSheetDialogProps(): Pick<DialogProps, "maxWidth" | "fullScreen" | "slotProps"> {
  const handheld = useIsHandheld();
  return {
    maxWidth: false,
    fullScreen: handheld,
    slotProps: {
      paper: {
        sx: handheld
          ? {
              overflow: "hidden",
              boxSizing: "border-box",
              pt: SAFE_AREA.top,
              pb: SAFE_AREA.bottom,
              "&& > *": { width: "100%", maxWidth: "100%", flex: "1 1 auto", minHeight: 0, maxHeight: "100%" },
            }
          : { m: "16px", overflow: "hidden" },
      },
    },
  };
}
