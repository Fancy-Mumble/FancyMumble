/**
 * What the active server lets this session do with invites, asked once per
 * connection and shared by every component that draws an "Invite" entry.
 */

import { useEffect, useSyncExternalStore } from "react";
import { useAppStore } from "../../store";
import { fetchInviteSupport, NO_INVITES, type InviteSupport } from "./invitesApi";
import { buildInviteLink } from "./inviteLink";

/** Answers by server id, and who is waiting for them. */
const answers = new Map<string, InviteSupport>();
const asking = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Ask again for `serverId`, e.g. after an admin changed the invite settings.
 * A question already in flight is not asked twice.
 */
export function refreshInviteSupport(serverId: string): void {
  if (asking.has(serverId)) return;
  asking.add(serverId);
  void fetchInviteSupport()
    .catch(() => NO_INVITES)
    .then((support) => {
      answers.set(serverId, support);
      asking.delete(serverId);
      notify();
    });
}

/**
 * The active server's answer, `NO_INVITES` until it has arrived and on a
 * server that has no invites at all.
 */
export function useInviteSupport(): InviteSupport {
  const serverId = useAppStore((s) => s.activeServerId);
  const connected = useAppStore((s) => s.status === "connected");
  const support = useSyncExternalStore(subscribe, () =>
    serverId ? (answers.get(serverId) ?? NO_INVITES) : NO_INVITES,
  );
  useEffect(() => {
    if (!serverId) return;
    if (!connected) {
      // A reconnect may land on a server whose settings changed meanwhile.
      answers.delete(serverId);
      return;
    }
    if (!answers.has(serverId)) refreshInviteSupport(serverId);
  }, [serverId, connected]);
  return support;
}

/**
 * The link for `code` on the active server, named the way the user sees it.
 * `null` when there is no active session to take an address from.
 */
export function inviteLinkFor(code: string, support: InviteSupport): string | null {
  const { sessions, activeServerId } = useAppStore.getState();
  const session = sessions.find((s) => s.id === activeServerId);
  if (!session) return null;
  return buildInviteLink({
    code,
    host: session.host,
    port: session.port,
    advertised: support.address,
    name: session.label,
  });
}
