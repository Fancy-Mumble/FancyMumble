/**
 * Server livery: one document per connection, filed under the session that
 * sent it.
 *
 * Two sources, and both are needed. The backend pushes `server-livery` when the
 * document arrives after sync and again whenever an operator edits it, so a
 * change repaints without a reconnect. And it is read once on mount, because a
 * pack that mounts late - or an HMR reload mid-session - would otherwise sit
 * unbranded until the next edit, which may never come.
 *
 * # Why this is keyed
 *
 * The backend already keeps a `SharedState` per connected server and stamps
 * `serverId` onto every event it emits. Holding a single document here threw
 * that away: whichever server pushed last branded *every* server's connect
 * screen - banner, name, tagline, motto - and repainted the whole window in its
 * colours, for as long as it stayed open. So a caller has to name the server it
 * is asking about, and gets null for one that has said nothing, and for one
 * that is not open at all. An address the user has merely saved has sent
 * nothing, and must draw unbranded.
 *
 * Outside the webview there is no event stream and no backend, so this stays
 * empty and every consumer takes the unbranded path.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "@core/store";
import type { ServerId } from "@core/types";
import type { ServerLivery } from "./livery";
import { writeCachedLivery } from "./liveryCache";

interface LiveryEvent {
  livery: ServerLivery | null;
  /** Which session it came from, stamped by the backend's emitter. */
  serverId?: ServerId | null;
}

/** Every open server's livery, keyed by session id. */
export type ServerLiveries = Readonly<Record<ServerId, ServerLivery | null>>;

/**
 * Every open server's livery.
 *
 * One subscription for callers that read more than one, which is the normal
 * case: the theme follows the tab in front of the user while the connect screen
 * draws whichever server the sidebar has selected, and those are routinely
 * different servers.
 */
export function useServerLiveries(): ServerLiveries {
  const [liveries, setLiveries] = useState<ServerLiveries>({});
  const sessions = useAppStore((state) => state.sessions);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in globalThis)) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const file = (serverId: ServerId | null, livery: ServerLivery | null) => {
      // Nothing to file it under means nothing we could route it to later:
      // adopting it anyway is exactly the bug this module is keyed to avoid.
      if (cancelled || !serverId) return;
      setLiveries((current) => ({ ...current, [serverId]: livery }));

      // Also keep it against the address, which is the only name this server
      // still has once the session ends. A connect screen has no session to
      // read - that is the whole reason the document is cached at all.
      const from = useAppStore.getState().sessions.find((session) => session.id === serverId);
      if (from && livery) void writeCachedLivery(from.host, from.port, livery);
    };

    // `get_livery` reads through the same handle every other command does, so
    // it answers for the active session and is filed under that one - never
    // under whichever server a screen happens to be drawing.
    void invoke<ServerLivery | null>("get_livery")
      .then((current) => file(useAppStore.getState().activeServerId, current ?? null))
      .catch(() => undefined);

    void listen<LiveryEvent>("server-livery", (event) => {
      // An unstamped push can only have come from the session the backend
      // considers active - it skips the stamp only before a session is
      // registered - and falling back to it is how the store routes every
      // other server-scoped event.
      file(event.payload.serverId ?? useAppStore.getState().activeServerId, event.payload.livery ?? null);
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch((reason) => console.error("livery subscription failed:", reason));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // A closed session's document is unreachable - its id is gone from every
  // group - and artwork rides along as `data:` URIs, so a long sitting spent
  // reconnecting would otherwise accumulate banners nothing can draw.
  useEffect(() => {
    const live = new Set(sessions.map((session) => session.id));
    setLiveries((current) => {
      const kept = Object.keys(current).filter((id) => live.has(id));
      if (kept.length === Object.keys(current).length) return current;
      return Object.fromEntries(kept.map((id) => [id, current[id]]));
    });
  }, [sessions]);

  return liveries;
}

/** One server's livery, or null when it has said nothing - or is not open. */
export function useServerLivery(serverId: ServerId | null | undefined): ServerLivery | null {
  return useServerLiveries()[serverId ?? ""] ?? null;
}
