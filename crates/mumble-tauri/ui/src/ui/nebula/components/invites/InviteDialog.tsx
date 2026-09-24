import { useTranslation } from "react-i18next";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import { TID } from "@core/testids";
import { lifetimeKey } from "@core/features/invites/inviteOptions";
import { useCreateInvite } from "@core/features/invites/useCreateInvite";
import { CheckIcon, CopyIcon } from "@ui/icons";
import { SectionLabel, Stack } from "../primitives";

interface InviteDialogProps {
  /** Where the invite lands people; the root (id 0) invites to the server. */
  target: { id: number; name: string } | null;
  onClose: () => void;
}

/**
 * Minting an invite link: two choices, one button, and the link to copy.
 *
 * The choices are cut to the server's ceilings before they are offered, so
 * what is picked is what the invite says. The link appears in place of the
 * button rather than in a second dialog: copying it is the whole point, and a
 * dialog that closed on success would make the user find it again.
 */
export function InviteDialog({ target, onClose }: Readonly<InviteDialogProps>) {
  const { t } = useTranslation(["server", "common"]);
  const state = useCreateInvite(target?.id ?? 0, target !== null);
  if (!target) return null;
  const place = target.id === 0 ? t("server:invites.thisServer") : target.name;

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>
        <SectionLabel>{t("server:invites.link")}</SectionLabel>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{t("server:invites.title", { place })}</Typography>
      </DialogTitle>
      <DialogContent>
        <Stack gap={1.5} sx={{ mt: 1 }}>
          <Stack direction="row" gap={1.5}>
            <TextField
              select
              size="small"
              sx={{ flex: 1 }}
              label={t("server:invites.lifetime")}
              value={String(state.lifetime)}
              disabled={state.link !== null}
              onChange={(event) => state.setLifetime(Number(event.target.value))}
              data-testid={TID.inviteLifetime}
            >
              {state.lifetimes.map((seconds) => {
                const key = lifetimeKey(seconds);
                return (
                  <MenuItem key={seconds} value={String(seconds)}>
                    {key ? t(key as "server:invites.never") : `${Math.round(seconds / 3600)} h`}
                  </MenuItem>
                );
              })}
            </TextField>
            <TextField
              select
              size="small"
              sx={{ flex: 1 }}
              label={t("server:invites.uses")}
              value={String(state.maxUses)}
              disabled={state.link !== null}
              onChange={(event) => state.setMaxUses(Number(event.target.value))}
              data-testid={TID.inviteMaxUses}
            >
              {state.useLimits.map((count) => (
                <MenuItem key={count} value={String(count)}>
                  {count === 0 ? t("server:invites.noLimit") : t("server:invites.usesCount", { count })}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          {state.link && (
            <Stack direction="row" gap={1} alignItems="center">
              <TextField
                size="small"
                fullWidth
                label={t("server:invites.link")}
                value={state.link}
                slotProps={{
                  htmlInput: {
                    readOnly: true,
                    "data-testid": TID.inviteLink,
                    onFocus: (event: React.FocusEvent<HTMLInputElement>) => event.target.select(),
                  },
                }}
              />
              <Button
                variant="outlined"
                size="small"
                data-testid={TID.inviteCopy}
                onClick={() => void state.copy()}
                startIcon={
                  state.copied ? <CheckIcon width={13} height={13} /> : <CopyIcon width={13} height={13} />
                }
                sx={{ flex: "none" }}
              >
                {state.copied ? t("server:invites.copied") : t("server:invites.copy")}
              </Button>
            </Stack>
          )}

          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {state.support.skipsPassword
              ? t("server:invites.skipsPassword")
              : t("server:invites.needsPassword")}
          </Typography>
          {state.error && (
            <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.bad })}>
              {state.error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close", { defaultValue: "Close" })}</Button>
        {!state.link && (
          <Button
            variant="contained"
            disabled={state.busy}
            data-testid={TID.inviteCreate}
            onClick={() => void state.create()}
          >
            {state.busy ? t("server:invites.creating") : t("server:invites.create")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
