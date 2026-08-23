import { useEffect, useState } from "react";
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
      setError("Address, port and username are required.");
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
        <SectionLabel>{preset ? "NEW IDENTITY" : "NEW SERVER"}</SectionLabel>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
          {preset ? `Join ${preset.label} as someone else` : "Add a server"}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack gap={1.5} sx={{ mt: 1 }}>
          <TextField
            size="small"
            label="Display name"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Stack direction="row" gap={1.5}>
            <TextField
              size="small"
              label="Address"
              sx={{ flex: 2 }}
              disabled={!!preset}
              value={host}
              onChange={(event) => setHost(event.target.value)}
            />
            <TextField
              size="small"
              label="Port"
              sx={{ flex: 1 }}
              disabled={!!preset}
              value={port}
              onChange={(event) => setPort(event.target.value.replace(/\D/g, ""))}
            />
          </Stack>
          <TextField
            size="small"
            label="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            select
            size="small"
            label="Certificate"
            value={certLabel}
            onChange={(event) => setCertLabel(event.target.value)}
            helperText="Optional. A certificate lets the server recognise you across reconnects."
          >
            <MenuItem value="">Connect anonymously</MenuItem>
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
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving} onClick={() => void save()}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
