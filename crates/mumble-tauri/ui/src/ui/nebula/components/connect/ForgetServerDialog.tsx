import { useTranslation } from "react-i18next";
import { Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";
import type { ServerGroup } from "../../selectors";

interface ForgetServerDialogProps {
  /** The server about to be forgotten, or null when the dialog is closed. */
  group: ServerGroup | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The confirmation shown before a saved server is removed.
 *
 * Forgetting drops every identity saved on the address, not one login, so the
 * body says how many go with it. An open session is left alone: the tab stays
 * until it is closed, only the way back in disappears.
 */
export function ForgetServerDialog({ group, onConfirm, onCancel }: Readonly<ForgetServerDialogProps>) {
  const { t } = useTranslation(["nebulaSidebar", "common", "server"]);
  return (
    <Dialog open={group !== null} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogContent>
        <Typography sx={{ fontWeight: 600, fontSize: 14, mb: "6px" }}>
          {t("nebulaSidebar:servers.forgetTitle")}
        </Typography>
        <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
          {group
            ? t("nebulaSidebar:servers.forgetBody", {
                server: group.label,
                count: group.identities.length,
              })
            : ""}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t("common:actions.cancel")}</Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          sx={(theme) => ({ background: theme.palette.nebula.bad })}
        >
          {t("server:list.removeServer")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
