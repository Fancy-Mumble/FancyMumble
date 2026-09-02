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
import { addServer, getServerPassword, setServerPassword, updateServer } from "@core/serverStorage";
import type { SavedServer } from "@core/types";
import { SectionLabel, Stack } from "../primitives";

interface AddServerDialogProps {
  open: boolean;
  /** Pre-fills host/port when adding another identity to a known server. */
  preset?: { host: string; port: number; label: string } | null;
  /**
   * The saved entry being changed rather than created.
   *
   * Set, and every field opens on what is on file and the save writes back to
   * that id; the address is editable here, because a server that moved is the
   * usual reason to open this at all.
   */
  editing?: SavedServer | null;
  onClose: () => void;
  /** The saved identity, so the caller can select the server it belongs to. */
  onAdded: (server: SavedServer) => void;
}

/**
 * Saving a server, in Nebula's own chrome.
 *
 * Identities are separate saved entries that happen to share host and port, so
 * "add an identity" and "add a server" are the same form with the address
 * filled in - which is why this dialog takes an optional preset rather than
 * having a second variant. Editing one is the same form again, opened on what
 * is already stored, for the same reason: three dialogs asking for a label, an
 * address, a name and a certificate would be three places to fix a bug in.
 *
 * The password is the one field that is not simply a column of the record. It
 * lives in the credential store, is never read back into the box - a saved
 * password is reported, not displayed - and is only written when something has
 * been typed, so opening the dialog and saving does not silently clear it.
 */
export function AddServerDialog({
  open,
  preset,
  editing = null,
  onClose,
  onAdded,
}: Readonly<AddServerDialogProps>) {
  const { t } = useTranslation(["nebulaConnect", "common", "server"]);
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("64738");
  const [username, setUsername] = useState("");
  const [certLabel, setCertLabel] = useState("");
  const [password, setPassword] = useState("");
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [certificates, setCertificates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(editing?.label ?? preset?.label ?? "");
    setHost(editing?.host ?? preset?.host ?? "");
    setPort(String(editing?.port ?? preset?.port ?? 64738));
    setUsername(editing?.username ?? "");
    setCertLabel(editing?.cert_label ?? "");
    setPassword("");
    setError(null);
    void invoke<string[]>("list_certificates")
      .then(setCertificates)
      .catch(() => setCertificates([]));
    // Whether there is one, not what it is: the box stays empty so saving
    // without touching it leaves the stored password alone.
    if (editing) {
      void getServerPassword(editing.id)
        .then((stored) => setHasStoredPassword(!!stored))
        .catch(() => setHasStoredPassword(false));
    } else {
      setHasStoredPassword(false);
    }
  }, [open, preset, editing]);

  const save = async () => {
    const parsedPort = Number.parseInt(port, 10);
    if (!host.trim() || !username.trim() || !Number.isFinite(parsedPort)) {
      setError(t("nebulaConnect:addServer.required"));
      return;
    }
    setSaving(true);
    try {
      const fields = {
        label: label.trim() || host.trim(),
        host: host.trim(),
        port: parsedPort,
        username: username.trim(),
        cert_label: certLabel || null,
      };
      if (editing) {
        await updateServer(editing.id, fields);
        if (password) await setServerPassword(editing.id, password);
        onAdded({ ...editing, ...fields });
      } else {
        onAdded(await addServer(fields));
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>
        <SectionLabel>
          {editing
            ? t("nebulaConnect:addServer.eyebrowEdit")
            : preset
              ? t("nebulaConnect:addServer.eyebrowIdentity")
              : t("nebulaConnect:addServer.eyebrowServer")}
        </SectionLabel>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
          {editing
            ? t("server:edit.title")
            : preset
              ? t("nebulaConnect:addServer.titleIdentity", { server: preset.label })
              : t("nebulaConnect:addServer.titleServer")}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack gap={1.5} sx={{ mt: 1 }}>
          <TextField
            size="small"
            label={t("nebulaConnect:addServer.displayName")}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Stack direction="row" gap={1.5}>
            <TextField
              size="small"
              label={t("nebulaConnect:addServer.address")}
              sx={{ flex: 2 }}
              disabled={!!preset}
              value={host}
              onChange={(event) => setHost(event.target.value)}
            />
            <TextField
              size="small"
              label={t("server:edit.portField")}
              sx={{ flex: 1 }}
              disabled={!!preset}
              value={port}
              onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))}
            />
          </Stack>
          <TextField
            size="small"
            label={t("server:edit.usernameField")}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            select
            size="small"
            label={t("nebulaConnect:addServer.certificate")}
            value={certLabel}
            onChange={(event) => setCertLabel(event.target.value)}
            helperText={t("nebulaConnect:addServer.certificateHelp")}
          >
            <MenuItem value="">{t("nebulaConnect:addServer.anonymous")}</MenuItem>
            {certificates.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </TextField>
          {/* Only when there is a record to change one on: a server being
              saved for the first time has nothing to attach a password to
              until it exists. */}
          {editing && (
            <TextField
              size="small"
              type="password"
              label={t("server:edit.passwordField")}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              helperText={
                hasStoredPassword
                  ? t("server:edit.passwordPlaceholderClear")
                  : t("server:edit.passwordPlaceholderEmpty")
              }
              slotProps={{ htmlInput: { autoComplete: "new-password" } }}
            />
          )}
          {error && (
            <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.bad })}>
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.cancel")}</Button>
        <Button variant="contained" disabled={saving} onClick={() => void save()}>
          {t("server:edit.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
