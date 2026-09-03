import { Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useGameOverlayAsk } from "@core/features/overlay/gameOverlay";
import { radius } from "../../tokens";
import { Stack } from "../primitives";

/**
 * The overlay's one question.
 *
 * The detector is deliberately reluctant: anything that only *might* be a game
 * gets asked about rather than assumed, because the cost of a false positive
 * is a window over someone's work and the cost of a false negative is one
 * click. This is Discord's "Add it!" and Game Bar's "Remember this is a game",
 * folded into a single prompt that appears once per program and never again.
 */
export function GameOverlayPrompt() {
  const { t } = useTranslation(["nebulaSettings", "common"]);
  const { pending, answer } = useGameOverlayAsk();

  return (
    <Dialog
      open={pending !== null}
      onClose={() => answer(null)}
      slotProps={{ paper: { sx: { borderRadius: radius("lg"), maxWidth: 420 } } }}
    >
      <DialogContent>
        <Stack sx={{ gap: "8px" }}>
          <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
            {t("nebulaSettings:overlay.askTitle", { name: pending?.name ?? "" })}
          </Typography>
          <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
            {t("nebulaSettings:overlay.askBody")}
          </Typography>
          {pending && (
            <Typography
              sx={(theme) => ({
                fontSize: 11,
                color: theme.palette.nebula.dim,
                wordBreak: "break-all",
              })}
            >
              {pending.exePath}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => answer(null)}>{t("nebulaSettings:overlay.askLater")}</Button>
        <Button onClick={() => answer("deny")}>{t("nebulaSettings:overlay.askNo")}</Button>
        <Button variant="contained" onClick={() => answer("allow")}>
          {t("nebulaSettings:overlay.askYes")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
