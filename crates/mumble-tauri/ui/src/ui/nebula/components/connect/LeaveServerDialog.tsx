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
  return (
    <Dialog open={session !== null} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogContent>
        <Typography sx={{ fontWeight: 600, fontSize: 14, mb: "6px" }}>Leave this server?</Typography>
        <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
          {session
            ? `You will be disconnected from ${session.label || session.host} and dropped out of voice.`
            : ""}
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
          label={<Typography sx={{ fontSize: 12 }}>Don&rsquo;t ask again</Typography>}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={leaving}>
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          disabled={leaving}
          variant="contained"
          sx={(theme) => ({ background: theme.palette.nebula.bad })}
        >
          {leaving ? "Leaving…" : "Leave"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
