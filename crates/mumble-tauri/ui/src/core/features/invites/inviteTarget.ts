/**
 * Where a followed invite link leads, before any UI decides what to show.
 *
 * Three answers, and each shell acts on them its own way:
 *
 * - `live`: a session to that server is already up. The invite's job is done;
 *   switch to it rather than reconnect and drop the call the user is in.
 * - `saved`: a login for that server is on file. The code has been put on it,
 *   so connecting now - and every reconnect later - presents it.
 * - `new`: nothing is known about the server, and the one thing a link cannot
 *   say is who the user wants to be there. Ask for a name.
 */

import { useAppStore } from "../../store";
import { getSavedServers, updateServer } from "../../serverStorage";
import type { SavedServer, ServerId } from "../../types";
import type { ParsedInvite } from "./inviteLink";

export type InviteTarget =
  { kind: "live"; serverId: ServerId } | { kind: "saved"; server: SavedServer } | { kind: "new" };

export async function resolveInviteTarget(invite: ParsedInvite): Promise<InviteTarget> {
  const same = (host: string, port: number) =>
    host.toLowerCase() === invite.host.toLowerCase() && port === invite.port;
  const live = useAppStore
    .getState()
    .sessions.find((session) => same(session.host, session.port) && session.status === "connected");
  if (live) return { kind: "live", serverId: live.id };
  // The login used most recently, when there are several identities on file.
  const saved = (await getSavedServers().catch(() => []))
    .filter((server) => same(server.host, server.port))
    .sort((a, b) => (b.last_joined ?? 0) - (a.last_joined ?? 0))[0];
  if (!saved) return { kind: "new" };
  await updateServer(saved.id, { invite_code: invite.code }).catch(() => undefined);
  return { kind: "saved", server: { ...saved, invite_code: invite.code } };
}
