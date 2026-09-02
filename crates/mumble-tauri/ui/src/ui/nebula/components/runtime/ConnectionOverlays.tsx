import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { usePasswordPrompt } from "@standard/hooks/usePasswordPrompt";
import { SectionLabel, Stack } from "../primitives";
import { radius } from "../../tokens";

/**
 * Password / two-factor challenge raised mid-connect by the backend.
 *
 * Two ways out, not one. The obvious one is the secret the server asked for;
 * the other is the name it refused, which the same prompt has to offer because
 * a taken username is answered by picking another, not by producing a password
 * that does not exist. The retry itself is Standard's - tearing the failed
 * session down before dialling again is fiddly enough that a second copy of it
 * would be a second set of bugs.
 */
function ConnectionChallenge() {
  const { t } = useTranslation(["nebulaConnect", "common", "server"]);
  const passwordRequired = useAppStore((state) => state.passwordRequired);
  const passwordAttempted = useAppStore((state) => state.passwordAttempted);
  const totpRequired = useAppStore((state) => state.totpRequired);
  const pending = useAppStore((state) => state.pendingConnect);
  const error = useAppStore((state) => state.error);
  const [secret, setSecret] = useState("");
  const [remember, setRemember] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const { handleChangeUsername } = usePasswordPrompt();
  const pendingUsername = pending?.username ?? "";

  useEffect(() => {
    setSecret("");
    setRemember(false);
    setEditingUsername(false);
    setUsernameDraft(pendingUsername);
  }, [passwordRequired, totpRequired, pendingUsername]);

  if ((!passwordRequired && !totpRequired) || !pending) return null;
  const isTotp = totpRequired;
  const trimmedUsername = usernameDraft.trim();

  const submit = async () => {
    if (editingUsername) {
      if (!trimmedUsername || trimmedUsername === pending.username) return;
      await handleChangeUsername(trimmedUsername);
      return;
    }
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
        <SectionLabel>{t("nebulaConnect:challenge.eyebrow")}</SectionLabel>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
          {editingUsername
            ? t("nebulaConnect:challenge.titleUsername")
            : isTotp
              ? t("nebulaConnect:challenge.titleTotp")
              : t("nebulaConnect:challenge.titlePassword")}
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
              {editingUsername
                ? t("nebulaConnect:challenge.usernameIntro", { host: pending.host })
                : t("nebulaConnect:challenge.intro", {
                    username: pending.username,
                    target: `${pending.host}:${pending.port}`,
                  })}
            </Typography>
            {!editingUsername && passwordAttempted && error && <Alert severity="error">{error}</Alert>}
            {editingUsername ? (
              <TextField
                autoFocus
                fullWidth
                size="small"
                label={t("server:password.differentUser.usernameLabel")}
                value={usernameDraft}
                onChange={(event) => setUsernameDraft(event.target.value)}
                slotProps={{
                  htmlInput: {
                    autoComplete: "username",
                    autoCapitalize: "off",
                    autoCorrect: "off",
                    spellCheck: false,
                  },
                }}
              />
            ) : (
              <TextField
                autoFocus
                fullWidth
                size="small"
                label={
                  isTotp ? t("nebulaConnect:challenge.codeLabel") : t("nebulaConnect:challenge.passwordLabel")
                }
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
            )}
            {!isTotp && !editingUsername && (
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                }
                label={<Typography sx={{ fontSize: 12 }}>{t("nebulaConnect:challenge.remember")}</Typography>}
              />
            )}
            {/* Offered on the password prompt only: a code challenge means the
                name was already accepted, so changing it there would be
                answering a question nobody asked. */}
            {!isTotp && !editingUsername && (
              <Box
                component="button"
                type="button"
                onClick={() => setEditingUsername(true)}
                sx={(theme) => ({
                  all: "unset",
                  cursor: "pointer",
                  alignSelf: "flex-start",
                  fontSize: 12,
                  color: theme.palette.nebula.accent,
                  "&:hover": { textDecoration: "underline" },
                })}
              >
                {t("server:password.changeUsername")}
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          {editingUsername ? (
            <Button onClick={() => setEditingUsername(false)}>
              {t("server:password.differentUser.back")}
            </Button>
          ) : (
            <Button onClick={() => useAppStore.getState().dismissPasswordPrompt()}>
              {t("common:actions.cancel")}
            </Button>
          )}
          <Button
            variant="contained"
            type="submit"
            disabled={
              editingUsername
                ? !trimmedUsername || trimmedUsername === pending.username
                : isTotp
                  ? secret.length !== 6
                  : !secret
            }
          >
            {editingUsername
              ? t("server:password.differentUser.reconnect")
              : t("nebulaConnect:challenge.submit")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** Banner shown while the client is waiting out a reconnect backoff. */
function ReconnectBanner() {
  const { t } = useTranslation(["nebulaConnect", "common"]);
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
        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{t("nebulaConnect:reconnect.title")}</Typography>
        <Typography sx={(theme) => ({ fontSize: 10.5, color: theme.palette.nebula.muted })}>
          {t("nebulaConnect:reconnect.detail", {
            state:
              retryIn === null
                ? t("nebulaConnect:reconnect.waiting")
                : t("nebulaConnect:reconnect.retryIn", { seconds: retryIn }),
            attempt: attempts + 1,
          })}
        </Typography>
      </Box>
      <Button size="small" variant="contained" onClick={retry}>
        {t("nebulaConnect:reconnect.retryNow")}
      </Button>
      <Button size="small" onClick={() => void useAppStore.getState().disconnect()}>
        {t("common:actions.cancel")}
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
