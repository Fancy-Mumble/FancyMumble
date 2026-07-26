import { useEffect, useState } from "react";
import { getSavedServers, setServerPassword } from "@core/serverStorage";
import { useAppStore } from "@core/store";
import { Button, Checkbox, ModalSurface, TextField } from "../primitives";
import styles from "../../AuroraClientExtensions.module.css";

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
    if (isTotp) await useAppStore.getState().retryWithTotp(secret);
    else {
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
    }
  };
  return (
    <ModalSurface
      title={isTotp ? "Two-factor authentication" : "Server password required"}
      eyebrow="SECURE CONNECTION"
      onClose={() => useAppStore.getState().dismissPasswordPrompt()}
      className={styles.challengeSurface}
    >
      <form
        className={styles.challengeForm}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p>
          Connect as <strong>{pending.username}</strong> to{" "}
          <strong>
            {pending.host}:{pending.port}
          </strong>
          .
        </p>
        {passwordAttempted && error && (
          <div className={styles.formError} role="alert">
            {error}
          </div>
        )}
        <TextField
          label={isTotp ? "Six-digit authentication code" : "Server password"}
          type={isTotp ? "text" : "password"}
          inputMode={isTotp ? "numeric" : undefined}
          autoComplete={isTotp ? "one-time-code" : "current-password"}
          maxLength={isTotp ? 6 : undefined}
          value={secret}
          onChange={(event) => setSecret(isTotp ? event.target.value.replace(/\D/g, "") : event.target.value)}
          autoFocus
        />
        {!isTotp && (
          <Checkbox
            className={styles.rememberSecret}
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            label="Remember for this saved server"
          />
        )}
        <footer>
          <Button onClick={() => useAppStore.getState().dismissPasswordPrompt()}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={isTotp ? secret.length !== 6 : !secret}>
            Connect securely
          </Button>
        </footer>
      </form>
    </ModalSurface>
  );
}

function ReconnectOverlay() {
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
    if (target)
      void useAppStore
        .getState()
        .connect(target.host, target.port, target.username, "certLabel" in target ? target.certLabel : null);
  };
  return (
    <div className={styles.reconnectBanner} role="status">
      <span className={styles.reconnectPulse} />
      <div>
        <strong>Connection interrupted</strong>
        <small>
          {retryIn === null ? "Waiting to reconnect" : `Retrying in ${retryIn}s`} · attempt {attempts + 1}
        </small>
      </div>
      <Button onClick={retry}>Retry now</Button>
      <Button variant="bare" onClick={() => void useAppStore.getState().disconnect()}>
        Cancel
      </Button>
    </div>
  );
}

export default function ConnectionOverlays() {
  return (
    <>
      <ReconnectOverlay />
      <ConnectionChallenge />
    </>
  );
}
