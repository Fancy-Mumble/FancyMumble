import { useAppStore } from "@core/store";
import SessionStatusActions from "./SessionStatusActions";
import SessionStatusCard from "./SessionStatusCard";

export interface SessionStatusScreenProps {
  /** Opens the server browser so the user can pick a different connection. */
  onOpenServers: () => void;
}

/**
 * Shown when the active session exists but is not connected - a rejected
 * password, a kick/ban, or a dropped link. Without it the client would render
 * its full connected chrome around an unauthenticated session.
 */
export default function SessionStatusScreen({ onOpenServers }: SessionStatusScreenProps) {
  const sessions = useAppStore((state) => state.sessions);
  const activeServerId = useAppStore((state) => state.activeServerId);
  const sessionErrors = useAppStore((state) => state.sessionErrors);
  const globalError = useAppStore((state) => state.error);
  const reconnectScheduled = useAppStore((state) => state.reconnectScheduled);
  const reconnectAttempts = useAppStore((state) => state.reconnectAttempts);

  const active = sessions.find((session) => session.id === activeServerId) ?? sessions[0];
  const error = (activeServerId ? sessionErrors[activeServerId] : null) ?? globalError;
  const address = active ? `${active.host}:${active.port}` : "Unknown server";
  const server = active?.username ? `${active.username} · ${address}` : address;

  // The server's own wording is the only reliable description of what went
  // wrong, so it carries the message. Adding our own cause would contradict
  // it whenever the guess is wrong (a dropped link is not a refusal).
  const title = reconnectScheduled ? "Reconnecting…" : error ? "Connection failed" : "Disconnected";
  const reason = reconnectScheduled ? `Attempt ${reconnectAttempts + 1} · retrying automatically.` : error;

  const retry = () => {
    if (!active) return;
    void useAppStore.getState().connect(active.host, active.port, active.username, active.certLabel);
  };

  return (
    <SessionStatusCard
      pending={reconnectScheduled}
      title={title}
      server={server}
      reason={reason}
      actions={
        <SessionStatusActions
          retryLabel={reconnectScheduled ? "Retry now" : "Try again"}
          onRetry={retry}
          onOpenServers={onOpenServers}
          onClose={() => void useAppStore.getState().disconnect()}
        />
      }
    />
  );
}
