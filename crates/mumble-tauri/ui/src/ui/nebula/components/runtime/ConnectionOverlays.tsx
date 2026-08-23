import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Typography,
} from "@mui/material";
import { getSavedServers, setServerPassword } from "@core/serverStorage";
import { useAppStore } from "@core/store";
import { SectionLabel, Stack } from "../primitives";
import { radius } from "../../tokens";

/** Password / two-factor challenge raised mid-connect by the backend. */
function ConnectionChallenge() {
  const passwordRequired = useAppStore((state) => state.passwordRequired);
  const passwordAttempted = useAppStore((state) => state.passwordAttempted);
  const totpRequired = useAppStore((state) => state.totpRequired);
  const pending = useAppStore((state) => state.pendingConnect);
  const error = useAppStore((state) => state.error);
  const [secret, setSecret] = useState("");
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    setSecret("");
    setRemember(false);
  }, [passwordRequired, totpRequired]);

  if ((!passwordRequired && !totpRequired) || !pending) return null;
  const isTotp = totpRequired;

  const submit = async () => {
    if (isTotp) {
      await useAppStore.getState().retryWithTotp(secret);
      return;
    }
    if (remember) {
      const saved = (await getSavedServers()).find(
        (server) =>
          server.host === pending.host &&
          server.port === pending.port &&
          server.username === pending.username,
      );
      if (saved) await setServerPassword(saved.id, secret);
    }
    await useAppStore.getState().retryWithPassword(secret);
  };

  return (
    <Dialog open onClose={() => useAppStore.getState().dismissPasswordPrompt()} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>
        <SectionLabel>SECURE CONNECTION</SectionLabel>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
          {isTotp ? "Two-factor authentication" : "Server password required"}
        </Typography>
      </DialogTitle>
      <Box
        component="form"
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogContent>
          <Stack gap={1.5}>
            <Typography sx={{ fontSize: 12 }}>
              Connect as <strong>{pending.username}</strong> to{" "}
              <strong>
                {pending.host}:{pending.port}
              </strong>
              .
            </Typography>
            {passwordAttempted && error && <Alert severity="error">{error}</Alert>}
            <TextField
              autoFocus
              fullWidth
              size="small"
              label={isTotp ? "Six-digit authentication code" : "Server password"}
              type={isTotp ? "text" : "password"}
              value={secret}
              onChange={(event) =>
                setSecret(isTotp ? event.target.value.replace(/\D/g, "").slice(0, 6) : event.target.value)
              }
              slotProps={{
                htmlInput: {
                  inputMode: isTotp ? "numeric" : undefined,
                  autoComplete: isTotp ? "one-time-code" : "current-password",
                },
              }}
            />
            {!isTotp && (
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                }
                label={<Typography sx={{ fontSize: 12 }}>Remember for this saved server</Typography>}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => useAppStore.getState().dismissPasswordPrompt()}>Cancel</Button>
          <Button variant="contained" type="submit" disabled={isTotp ? secret.length !== 6 : !secret}>
            Connect securely
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** Banner shown while the client is waiting out a reconnect backoff. */
function ReconnectBanner() {
  const scheduled = useAppStore((state) => state.reconnectScheduled);
  const lostAt = useAppStore((state) => state.connectionLostAt);
  const nextAt = useAppStore((state) => state.nextReconnectAt);
  const attempts = useAppStore((state) => state.reconnectAttempts);
  const pending = useAppStore((state) => state.pendingConnect);
  const active = useAppStore((state) =>
    state.sessions.find((session) => session.id === state.activeServerId),
  );
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!scheduled && lostAt === null) return;
    const timer = globalThis.setInterval(() => setNow(Date.now()), 500);
    return () => globalThis.clearInterval(timer);
  }, [lostAt, scheduled]);

  if (!scheduled && lostAt === null) return null;
  const retryIn = nextAt === null ? null : Math.max(0, Math.ceil((nextAt - now) / 1000));
  const retry = () => {
    const target = pending ?? active;
    if (!target) return;
    void useAppStore
      .getState()
      .connect(target.host, target.port, target.username, "certLabel" in target ? target.certLabel : null);
  };

  return (
    <Stack
      role="status"
      direction="row"
      alignItems="center"
      gap={1.5}
      sx={(theme) => ({
        position: "absolute",
        left: "50%",
        bottom: 92,
        transform: "translateX(-50%)",
        zIndex: 20,
        px: "16px",
        py: "10px",
        borderRadius: radius("lg"),
        background: `${theme.palette.nebula.tint},${theme.palette.nebula.bg0}`,
        border: `1px solid ${theme.palette.nebula.line2}`,
        boxShadow: theme.palette.nebula.shadow,
      })}
    >
      <Box
        sx={(theme) => ({
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: theme.palette.nebula.warn,
          animation: "nebula-pulse 1.2s ease-in-out infinite",
          "@keyframes nebula-pulse": { "50%": { opacity: 0.25 } },
        })}
      />
      <Box>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>Connection interrupted</Typography>
        <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.muted })}>
          {retryIn === null ? "Waiting to reconnect" : `Retrying in ${retryIn}s`} · attempt {attempts + 1}
        </Typography>
      </Box>
      <Button size="small" variant="contained" onClick={retry}>
        Retry now
      </Button>
      <Button size="small" onClick={() => void useAppStore.getState().disconnect()}>
        Cancel
      </Button>
    </Stack>
  );
}

export function ConnectionOverlays() {
  return (
    <>
      <ReconnectBanner />
      <ConnectionChallenge />
    </>
  );
}
