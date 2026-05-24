/**
 * useLiveDoc - manages a single Yjs document + y-websocket provider
 * for one channel-scoped Live Doc session.
 *
 * The hook owns lifecycle: it constructs the Y.Doc on first call,
 * wires up the WS provider (with JWT in the query string), keeps a
 * connection-status flag in React state, and tears everything down
 * when the channel/slug changes or the panel closes.
 *
 * The opener flow (request -> invite -> connect) is split:
 *   1. Caller invokes `openLiveDoc(channelId, slug, title)` from the
 *      ChatComposer menu; this sends a `fancy-live-doc/open`
 *      PluginDataTransmission to the server.
 *   2. The server replies with `fancy-live-doc/invite` containing
 *      `ws_url + token`.  The store listens for that event and
 *      stores the session payload in `activeLiveDocs`.
 *   3. LiveDocPanel mounts and calls this hook with the payload.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { LiveDocSessionInfo } from "../../../store";

export type { LiveDocSessionInfo };
export type LiveDocStatus = "connecting" | "connected" | "disconnected";

/** One participant currently editing the doc.  `session` matches the
 *  Mumble session id so callers can resolve avatar bytes from the
 *  global user list.  The local user is included. */
export interface LiveDocPeer {
  readonly session: number;
  readonly name: string;
  readonly color: string;
  readonly isLocal: boolean;
}

export interface LiveDocHandle {
  readonly doc: Y.Doc;
  readonly provider: WebsocketProvider | null;
  readonly status: LiveDocStatus;
  readonly peerCount: number;
  readonly peers: ReadonlyArray<LiveDocPeer>;
  readonly error: string | null;
}

/**
 * Construct + manage a Yjs+WS session for one document.  Returns
 * `null` until `session` is non-null.
 */
export function useLiveDoc(session: LiveDocSessionInfo | null): LiveDocHandle | null {
  const doc = useMemo(() => new Y.Doc(), [session?.slug, session?.channelId, session?.serverId]);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const [status, setStatus] = useState<LiveDocStatus>("connecting");
  const [peerCount, setPeerCount] = useState(0);
  const [peers, setPeers] = useState<ReadonlyArray<LiveDocPeer>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      return;
    }
    // y-websocket constructs: serverUrl + "/" + roomname + "?" + params
    // Server expects:         ws://host:port/ws/{serverId}/{channelId}/{slug}?token=...
    // So: serverUrl = "ws://host:port", roomname = "ws/{serverId}/{channelId}/{slug}"
    const base = wsBase(session.wsUrl);
    const roomPath = wsPath(session.wsUrl);
    if (!base || !roomPath) {
      console.error("[useLiveDoc] malformed wsUrl:", session.wsUrl);
      setStatus("disconnected");
      setError("Invalid document URL received from server.");
      return;
    }
    setError(null);
    const provider = new WebsocketProvider(base, roomPath, doc, {
      params: { token: session.token },
      connect: true,
    });
    providerRef.current = provider;

    provider.awareness.setLocalStateField("user", {
      name: session.ownName,
      color: session.ownColor,
      session: session.ownSession,
    });

    const onStatus = (event: { status: string }) => {
      if (event.status === "connected") {
        setStatus("connected");
        setError(null);
      } else if (event.status === "connecting") {
        setStatus("connecting");
      } else {
        setStatus("disconnected");
      }
    };
    const onError = (event: Event) => {
      const msg = event instanceof ErrorEvent ? event.message : "WebSocket connection failed.";
      console.error("[useLiveDoc] connection error:", msg);
      setStatus("disconnected");
      setError(msg);
    };
    const onAwareness = () => {
      const states = provider.awareness.getStates();
      setPeerCount(states.size);
      const localClientId = provider.awareness.clientID;
      const next: LiveDocPeer[] = [];
      const seen = new Set<number>();
      states.forEach((state, clientId) => {
        const u = (state as { user?: { name?: string; color?: string; session?: number } }).user;
        if (!u || typeof u.session !== "number") return;
        if (seen.has(u.session)) return;
        seen.add(u.session);
        next.push({
          session: u.session,
          name: u.name ?? "",
          color: u.color ?? "#999",
          isLocal: clientId === localClientId,
        });
      });
      setPeers(next);
    };
    provider.on("status", onStatus);
    provider.on("connection-error", onError);
    provider.awareness.on("change", onAwareness);
    onAwareness();

    return () => {
      provider.off("status", onStatus);
      provider.off("connection-error", onError);
      provider.awareness.off("change", onAwareness);
      provider.disconnect();
      provider.destroy();
      providerRef.current = null;
    };
  }, [session, doc]);

  useEffect(() => {
    return () => {
      doc.destroy();
    };
  }, [doc]);

  if (!session) return null;
  return { doc, provider: providerRef.current, status, peerCount, peers, error };
}

/** Extract the scheme + host + port from a WebSocket URL, e.g.
 *  "ws://host:3001/ws/1/42/slug" -> "ws://host:3001". */
function wsBase(wsUrl: string): string {
  const proto = wsUrl.startsWith("wss://") ? "wss://" : "ws://";
  const rest = wsUrl.slice(proto.length);
  const slashIdx = rest.indexOf("/");
  return slashIdx >= 0 ? proto + rest.slice(0, slashIdx) : wsUrl;
}

/** Extract the path without its leading slash, e.g.
 *  "ws://host:3001/ws/1/42/slug" -> "ws/1/42/slug". */
function wsPath(wsUrl: string): string {
  const proto = wsUrl.startsWith("wss://") ? "wss://" : "ws://";
  const rest = wsUrl.slice(proto.length);
  const slashIdx = rest.indexOf("/");
  return slashIdx >= 0 ? rest.slice(slashIdx + 1) : "";
}
