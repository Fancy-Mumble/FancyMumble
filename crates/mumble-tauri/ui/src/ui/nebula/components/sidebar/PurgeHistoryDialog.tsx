import { useTranslation } from "react-i18next";
import { Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";
import type { ChannelEntry } from "@core/types";
import { Stack } from "../primitives";

interface PurgeHistoryDialogProps {
  /** The channel whose history is going, or null when none is. */
  channel: ChannelEntry | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Clearing a channel's stored history, which asks first.
 *
 * Nebula could already delete one message and a selected run of them; what it
 * had no entry for was the whole archive. That is a different act from either
 * - it takes everyone's messages, not the deleter's, and there is nothing to
 * select - so it asks in its own dialog rather than growing the row's delete.
 */
export function PurgeHistoryDialog({ channel, onConfirm, onCancel }: Readonly<PurgeHistoryDialogProps>) {
  const { t } = useTranslation(["sidebar", "common"]);
  if (!channel) return null;

  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogContent>
        <Stack gap={0.5}>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>
            {t("sidebar:channelSidebar.purgeHistoryTitle")}
          </Typography>
          <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
            {t("sidebar:channelSidebar.purgeHistoryBody", { channel: channel.name })}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" color="error" onClick={onConfirm}>
          {t("sidebar:channelSidebar.purgeConfirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
