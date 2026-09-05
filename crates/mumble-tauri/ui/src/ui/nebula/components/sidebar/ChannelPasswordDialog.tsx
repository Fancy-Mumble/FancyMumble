import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Dialog, DialogActions, DialogContent, TextField, Typography } from "@mui/material";
import type { ChannelEntry } from "@core/types";
import { TID } from "@core/testids";
import { Stack } from "../primitives";

interface ChannelPasswordDialogProps {
  /** The channel being entered, or null when nothing is being entered. */
  channel: ChannelEntry | null;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

/**
 * The password a restricted channel asks for on the way in.
 *
 * Nebula already answers the two challenges a *server* raises - a password and
 * a one-time code - and had no answer for the one a channel raises, so a
 * password-protected room simply could not be entered from this pack. The
 * shape is deliberately the connect challenge's: it is the same question about
 * a smaller thing, and a second layout for it would only make the pair harder
 * to recognise as one idea.
 *
 * The channel is a prop rather than local state because the row that asked has
 * usually gone by the time this is on screen - the menu closed, the tree
 * scrolled - and a dialog that lost its subject would join whatever happened
 * to be selected.
 */
export function ChannelPasswordDialog({
  channel,
  onConfirm,
  onCancel,
}: Readonly<ChannelPasswordDialogProps>) {
  const { t } = useTranslation(["sidebar", "common"]);
  const [password, setPassword] = useState("");

  // A second channel asked with the first one's attempt still in the field
  // would offer that password as the answer to a different door.
  useEffect(() => setPassword(""), [channel?.id]);

  if (!channel) return null;

  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth>
      <Box
        component="form"
        data-testid={TID.passwordPromptDialog}
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          onConfirm(password);
        }}
      >
        <DialogContent>
          <Stack gap={1.5}>
            <Box>
              <Typography sx={{ fontWeight: 600, fontSize: 14, mb: "4px" }}>
                {t("sidebar:channelPassword.title")}
              </Typography>
              <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
                <Box component="strong" sx={(theme) => ({ color: theme.palette.nebula.text })}>
                  {channel.name}
                </Box>
                {t("sidebar:channelPassword.body")}
              </Typography>
            </Box>
            <TextField
              autoFocus
              fullWidth
              size="small"
              type="password"
              label={t("sidebar:channelPassword.placeholder")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              slotProps={{ htmlInput: { autoComplete: "current-password" } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancel}>{t("common:actions.cancel")}</Button>
          <Button type="submit" variant="contained" disabled={!password}>
            {t("sidebar:channelPassword.joinBtn")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
