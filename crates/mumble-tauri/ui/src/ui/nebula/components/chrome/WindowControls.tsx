import { useTranslation } from "react-i18next";
import { IconButton, Typography } from "@mui/material";
import { Stack } from "../primitives";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktopPlatform } from "@core/utils/platform";
import { CloseIcon, MinimizeIcon, SquareIcon } from "@ui/icons";

// Window operations resolve the window on click rather than at render so these
// mount safely outside a Tauri webview (tests, browser dev server).
const minimize = () => void getCurrentWindow().minimize();
const toggleMaximize = () => void getCurrentWindow().toggleMaximize();
const close = () => void getCurrentWindow().close();

/**
 * Minimise, maximise and close.
 *
 * `band` is the pack's arrangement - three loose glyphs at the end of the top
 * strip. `corner` is for a skin with no strip to end: the three sit on a
 * bevelled tab that floats over the window's top-right corner and names the
 * server, which is where that kind of design puts them.
 */
export function WindowControls({
  variant = "band",
  label,
}: Readonly<{ variant?: "band" | "corner"; label?: string | null }>) {
  const { t } = useTranslation(["common"]);
  if (!isDesktopPlatform()) return null;
  const corner = variant === "corner";
  return (
    <Stack
      direction="row"
      alignItems="center"
      gap={corner ? 1.5 : 0.5}
      data-testid="nebula-window-controls"
      sx={(theme) =>
        corner
          ? {
              flex: "none",
              px: "14px",
              py: "3px",
              background: theme.palette.nebula.rail,
              color: theme.palette.nebula.railDim,
              clipPath: "polygon(16px 0, 100% 0, 100% 100%, 0 100%)",
            }
          : {}
      }
    >
      {corner && label && (
        <Typography
          component="div"
          sx={(theme) => ({
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            // On a navy ground the accent ink is unreadable; `barDim` is
            // the scheme's own colour for text over the bar.
            color: theme.palette.nebula.barDim,
          })}
        >
          {label}
        </Typography>
      )}
      <IconButton size="small" aria-label={t("common:actions.minimize")} onClick={minimize}>
        <MinimizeIcon width={13} height={13} />
      </IconButton>
      <IconButton size="small" aria-label={t("common:actions.maximize")} onClick={toggleMaximize}>
        <SquareIcon width={11} height={11} />
      </IconButton>
      <IconButton
        size="small"
        aria-label={t("common:actions.close")}
        onClick={close}
        sx={(theme) => ({
          ...(corner ? { color: theme.palette.nebula.bad, opacity: 0.8 } : {}),
          "&:hover": { background: `${theme.palette.nebula.bad}33` },
        })}
      >
        <CloseIcon width={13} height={13} />
      </IconButton>
    </Stack>
  );
}
