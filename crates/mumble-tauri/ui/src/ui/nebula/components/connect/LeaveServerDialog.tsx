import { useTranslation } from "react-i18next";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Typography,
} from "@mui/material";
import type { SessionMeta } from "@core/types";
import { TID } from "@core/testids";

interface LeaveServerDialogProps {
  /** The session about to be left, or null when the dialog is closed. */
  session: SessionMeta | null;
  leaving: boolean;
  neverAsk: boolean;
  onNeverAskChange: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The confirmation shown before leaving a server.
 *
 * Nebula draws its own rather than hosting Standard's `ConfirmDialog`: this one
 * sits over the pack's own chrome, and a dialog is a surface the design has an
 * opinion about. What it must not redraw is the *decision* - the same
 * preference silences it here and there, and the tick writes that preference
 * rather than a Nebula-local flag.
 */
export function LeaveServerDialog({
  session,
  leaving,
  neverAsk,
  onNeverAskChange,
  onConfirm,
  onCancel,
}: Readonly<LeaveServerDialogProps>) {
  const { t } = useTranslation(["nebulaConnect", "common", "server"]);
  return (
    <Dialog open={session !== null} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogContent>
        <Typography sx={{ fontWeight: 600, fontSize: 14, mb: "6px" }}>
          {t("nebulaConnect:leave.title")}
        </Typography>
        <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
          {session ? t("nebulaConnect:leave.body", { server: session.label || session.host }) : ""}
        </Typography>
        <FormControlLabel
          sx={{ mt: "10px" }}
          control={
            <Checkbox
              size="small"
              checked={neverAsk}
              onChange={(event) => onNeverAskChange(event.target.checked)}
            />
          }
          label={<Typography sx={{ fontSize: 12 }}>{t("server:tabsBar.disconnectNeverShow")}</Typography>}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={leaving}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          data-testid={TID.disconnectConfirm}
          onClick={onConfirm}
          disabled={leaving}
          variant="contained"
          sx={(theme) => ({ background: theme.palette.nebula.bad })}
        >
          {leaving ? t("nebulaConnect:leave.leaving") : t("common:actions.leave")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
