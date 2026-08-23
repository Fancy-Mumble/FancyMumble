/**
 * The open server's livery, as it arrives and as it changes.
 *
 * Two sources, and both are needed. The backend pushes `server-livery` when the
 * document arrives after sync and again whenever an operator edits it, so a
 * change repaints without a reconnect. And it is read once on mount, because a
 * pack that mounts late - or an HMR reload mid-session - would otherwise sit
 * unbranded until the next edit, which may never come.
 *
 * Outside the webview there is no event stream and no backend, so this stays
 * null and every consumer takes the unbranded path.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ServerLivery } from "./livery";

interface LiveryEvent {
  livery: ServerLivery | null;
}

export function useServerLivery(): ServerLivery | null {
  const [livery, setLivery] = useState<ServerLivery | null>(null);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in globalThis)) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void invoke<ServerLivery | null>("get_livery")
      .then((current) => {
        if (!cancelled) setLivery(current ?? null);
      })
      .catch(() => undefined);

    void listen<LiveryEvent>("server-livery", (event) => {
      if (!cancelled) setLivery(event.payload.livery ?? null);
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

  return livery;
}
