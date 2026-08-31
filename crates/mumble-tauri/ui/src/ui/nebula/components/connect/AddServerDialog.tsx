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
import { addServer } from "@core/serverStorage";
import type { SavedServer } from "@core/types";
import { SectionLabel, Stack } from "../primitives";

interface AddServerDialogProps {
  open: boolean;
  /** Pre-fills host/port when adding another identity to a known server. */
  preset?: { host: string; port: number; label: string } | null;
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
 * having a second variant.
 */
export function AddServerDialog({ open, preset, onClose, onAdded }: Readonly<AddServerDialogProps>) {
  const { t } = useTranslation(["nebulaConnect", "common", "server"]);
  const [label, setLabel] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("64738");
  const [username, setUsername] = useState("");
  const [certLabel, setCertLabel] = useState("");
  const [certificates, setCertificates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(preset?.label ?? "");
    setHost(preset?.host ?? "");
    setPort(String(preset?.port ?? 64738));
    setUsername("");
    setCertLabel("");
    setError(null);
    void invoke<string[]>("list_certificates")
      .then(setCertificates)
      .catch(() => setCertificates([]));
  }, [open, preset]);

  const save = async () => {
    const parsedPort = Number.parseInt(port, 10);
    if (!host.trim() || !username.trim() || !Number.isFinite(parsedPort)) {
      setError(t("nebulaConnect:addServer.required"));
      return;
    }
    setSaving(true);
    try {
      const created = await addServer({
        label: label.trim() || host.trim(),
        host: host.trim(),
        port: parsedPort,
        username: username.trim(),
        cert_label: certLabel || null,
      });
      onAdded(created);
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
          {preset
            ? t("nebulaConnect:addServer.eyebrowIdentity")
            : t("nebulaConnect:addServer.eyebrowServer")}
        </SectionLabel>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
          {preset
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
