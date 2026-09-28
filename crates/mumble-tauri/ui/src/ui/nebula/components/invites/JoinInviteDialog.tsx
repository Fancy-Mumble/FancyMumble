import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
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
import { addServer, getSavedServers } from "@core/serverStorage";
import type { ParsedInvite } from "@core/features/invites/inviteLink";
import type { SavedServer } from "@core/types";
import { TID } from "@core/testids";
import { SectionLabel, Stack } from "../primitives";

/** The certificate the client generates for a fresh profile. */
const DEFAULT_CERT = "default";

interface JoinInviteDialogProps {
  /** The link being followed, or null when none is. */
  invite: ParsedInvite | null;
  onClose: () => void;
  /** The saved login, carrying the invite, ready to connect. */
  onJoin: (server: SavedServer) => void;
}

/**
 * Following an invite to a server this client has never saved.
 *
 * The one thing a link cannot say is who you want to be there, so this asks
 * for a name - prefilled with the one used most recently anywhere - and a
 * certificate, and nothing else: the address, the port and the way in are all
 * in the link. The login is saved with the invite code on it, so the next
 * reconnect presents it again instead of stopping on a password prompt.
 */
export function JoinInviteDialog({ invite, onClose, onJoin }: Readonly<JoinInviteDialogProps>) {
  const { t } = useTranslation(["server", "common"]);
  const [username, setUsername] = useState("");
  const [certLabel, setCertLabel] = useState("");
  const [certificates, setCertificates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invite) return;
    setError(null);
    void getSavedServers()
      .then((saved) => {
        const recent = [...saved].sort((a, b) => (b.last_joined ?? 0) - (a.last_joined ?? 0))[0];
        setUsername((current) => current || recent?.username || "");
      })
      .catch(() => undefined);
    void invoke<string[]>("list_certificates")
      .then((names) => {
        setCertificates(names);
        setCertLabel(
          (current) => current || (names.includes(DEFAULT_CERT) ? DEFAULT_CERT : (names[0] ?? "")),
        );
      })
      .catch(() => setCertificates([]));
  }, [invite]);

  if (!invite) return null;
  const serverName = invite.name || invite.host;

  const join = async () => {
    if (!username.trim()) return;
    setSaving(true);
    try {
      const server = await addServer({
        label: serverName,
        host: invite.host,
        port: invite.port,
        username: username.trim(),
        cert_label: certLabel || null,
        invite_code: invite.code,
      });
      onJoin(server);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>
        <SectionLabel>{t("server:invites.join.eyebrow")}</SectionLabel>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
          {t("server:invites.join.title", { server: serverName })}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack gap={1.5} sx={{ mt: 1 }}>
          <Typography sx={(theme) => ({ fontSize: 12.5, color: theme.palette.nebula.muted })}>
            {t("server:invites.join.body")}
          </Typography>
          <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
            {invite.host}:{invite.port}
          </Typography>
          <TextField
            size="small"
            autoFocus
            label={t("server:invites.join.name")}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void join();
            }}
            slotProps={{ htmlInput: { "data-testid": TID.connectUsernameInput } }}
          />
          <TextField
            select
            size="small"
            label={t("server:invites.join.certificate")}
            value={certLabel}
            onChange={(event) => setCertLabel(event.target.value)}
          >
            <MenuItem value="">{t("server:invites.join.anonymous")}</MenuItem>
            {certificates.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </TextField>
          {error && (
            <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.bad })}>
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button
          variant="contained"
          disabled={saving || !username.trim()}
          data-testid={TID.inviteJoin}
          onClick={() => void join()}
        >
          {saving ? t("server:invites.join.joining") : t("server:invites.join.join")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
