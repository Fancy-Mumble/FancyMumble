/**
 * Whose screen share the app's one capture belongs to, from this connection's
 * point of view.
 *
 * Only one capture runs, shared by every server connection. The store records
 * the own session that started it and the server that session was on. The
 * server is what tells two connections apart: session numbers are handed out
 * per server, so the same number on two servers says nothing. Where no server
 * was known when the share started, the session number is all there is.
 */
import type { ServerId } from "@core/types";

export type BroadcastOwner = "none" | "here" | "elsewhere";

export interface BroadcastOwnerInput {
  broadcastingOwnSession: number | null;
  broadcastingServerId: ServerId | null;
  ownSession: number | null;
  activeServerId: ServerId | null;
}

export function broadcastOwner(state: BroadcastOwnerInput): BroadcastOwner {
  if (state.broadcastingOwnSession === null) return "none";
  const sameConnection =
    state.broadcastingServerId !== null && state.activeServerId !== null
      ? state.broadcastingServerId === state.activeServerId
      : state.ownSession !== null && state.broadcastingOwnSession === state.ownSession;
  return sameConnection ? "here" : "elsewhere";
}
