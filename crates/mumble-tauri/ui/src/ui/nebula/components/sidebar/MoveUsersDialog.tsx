import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  TextField,
  Typography,
} from "@mui/material";
import type { ChannelEntry } from "@core/types";
import { Stack } from "../primitives";

interface MoveUsersDialogProps {
  /** The room being emptied, or null when nothing is being moved. */
  source: ChannelEntry | null;
  /** Every channel, from which the destinations are drawn. */
  channels: readonly ChannelEntry[];
  onConfirm: (targetChannelId: number) => void;
  onCancel: () => void;
}

/**
 * Move everyone out of a channel at once.
 *
 * Nebula could already move one person - it is on their menu - and moving a
 * whole room one name at a time is not the same job: the reason to do it at
 * all is that a meeting ran over, or a room has to be cleared, and both want
 * one act rather than twenty.
 *
 * The destination is a search field rather than a list, because a server with
 * enough channels to need this has too many to scroll.
 */
export function MoveUsersDialog({ source, channels, onConfirm, onCancel }: Readonly<MoveUsersDialogProps>) {
  const { t } = useTranslation(["sidebar", "common"]);

  // Everywhere except here: moving a room into itself is the one destination
  // that cannot mean anything.
  const destinations = useMemo(
    () => (source ? channels.filter((channel) => channel.id !== source.id) : []),
    [channels, source],
  );

  const [target, setTarget] = useState<ChannelEntry | null>(null);
  useEffect(() => setTarget(null), [source?.id]);

  if (!source) return null;

  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogContent>
        <Stack gap={1.5}>
          <Stack gap={0.5}>
            <Typography sx={{ fontWeight: 600, fontSize: 14 }}>
              {t("sidebar:moveUsersDialog.title", { channel: source.name })}
            </Typography>
            <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
              {t("sidebar:moveUsersDialog.body")}
            </Typography>
          </Stack>
          <Autocomplete
            openOnFocus
            options={destinations}
            value={target}
            onChange={(_event, next) => setTarget(next)}
            getOptionLabel={(channel) => channel.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            noOptionsText={t("sidebar:moveUsersDialog.noOptions")}
            renderInput={(params) => (
              <TextField
                {...params}
                autoFocus
                size="small"
                label={t("sidebar:moveUsersDialog.destinationLabel")}
                placeholder={t("sidebar:moveUsersDialog.searchPlaceholder")}
              />
            )}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" disabled={target === null} onClick={() => target && onConfirm(target.id)}>
          {t("sidebar:moveUsersDialog.confirmBtn")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
