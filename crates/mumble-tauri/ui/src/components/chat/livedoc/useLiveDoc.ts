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

/**
 * Observe the document title stored in the shared Yjs `meta` map.
 *
 * The title lives in `doc.getMap("meta").get("title")` so a rename
 * propagates live to every peer and is persisted with the document
 * snapshot.  Returns `fallback` until a title has been set or while the
 * document is not yet connected (`doc === null`).
 */
export function useLiveDocTitle(doc: Y.Doc | null, fallback: string): string {
  const readTitle = (): string => {
    if (!doc) return fallback;
    const value = doc.getMap("meta").get("title");
    return typeof value === "string" && value.trim() ? value : fallback;
  };
  const [title, setTitle] = useState<string>(readTitle);

  useEffect(() => {
    if (!doc) {
      setTitle(fallback);
      return;
    }
    const meta = doc.getMap("meta");
    const update = () => {
      const value = meta.get("title");
      setTitle(typeof value === "string" && value.trim() ? value : fallback);
    };
    meta.observe(update);
    update();
    return () => meta.unobserve(update);
  }, [doc, fallback]);

  return title;
}

/** Write a new title into the shared Yjs `meta` map (propagates live). */
export function setLiveDocTitle(doc: Y.Doc, title: string): void {
  const trimmed = title.trim();
  if (trimmed) doc.getMap("meta").set("title", trimmed);
}

// --- Page setup (document layout) --------------------------------------
//
// Page geometry lives in the shared Yjs `meta` map alongside the title so
// it propagates live to every peer and is persisted with the document
// snapshot (the file-server stores the Yjs blob opaquely).

export type LiveDocPageSize = "a4" | "letter" | "legal";
export type LiveDocPageOrientation = "portrait" | "landscape";
export type LiveDocPageMargin = "normal" | "narrow" | "wide";

/** Document-level page layout (Word-style "Page setup"). */
export interface LiveDocPageSetup {
  readonly size: LiveDocPageSize;
  readonly orientation: LiveDocPageOrientation;
  readonly margin: LiveDocPageMargin;
}

export const DEFAULT_PAGE_SETUP: LiveDocPageSetup = {
  size: "a4",
  orientation: "portrait",
  margin: "normal",
};

/** Page dimensions in CSS px at 96 dpi (portrait). */
const PAGE_PX: Record<LiveDocPageSize, { readonly w: number; readonly h: number }> = {
  a4: { w: 794, h: 1123 }, // 210 x 297 mm
  letter: { w: 816, h: 1056 }, // 8.5 x 11 in
  legal: { w: 816, h: 1344 }, // 8.5 x 14 in
};
const MARGIN_PX: Record<LiveDocPageMargin, number> = { normal: 96, narrow: 48, wide: 144 };
/** Named CSS paged-media sizes (used by the print/PDF `@page` rule). */
const PAGE_CSS_SIZE: Record<LiveDocPageSize, string> = { a4: "A4", letter: "letter", legal: "legal" };
const MARGIN_MM: Record<LiveDocPageMargin, string> = {
  normal: "25.4mm",
  narrow: "12.7mm",
  wide: "38.1mm",
};

function isPageSize(v: unknown): v is LiveDocPageSize {
  return v === "a4" || v === "letter" || v === "legal";
}
function isPageMargin(v: unknown): v is LiveDocPageMargin {
  return v === "normal" || v === "narrow" || v === "wide";
}

function readPageSetup(doc: Y.Doc | null): LiveDocPageSetup {
  if (!doc) return DEFAULT_PAGE_SETUP;
  const meta = doc.getMap("meta");
  const size = meta.get("pageSize");
  const orientation = meta.get("pageOrientation");
  const margin = meta.get("pageMargin");
  return {
    size: isPageSize(size) ? size : DEFAULT_PAGE_SETUP.size,
    orientation: orientation === "landscape" ? "landscape" : "portrait",
    margin: isPageMargin(margin) ? margin : DEFAULT_PAGE_SETUP.margin,
  };
}

/** Observe the document's page setup from the shared `meta` map. */
export function useLiveDocPageSetup(doc: Y.Doc | null): LiveDocPageSetup {
  const [setup, setSetup] = useState<LiveDocPageSetup>(() => readPageSetup(doc));
  useEffect(() => {
    if (!doc) {
      setSetup(DEFAULT_PAGE_SETUP);
      return;
    }
    const meta = doc.getMap("meta");
    const update = () => setSetup(readPageSetup(doc));
    meta.observe(update);
    update();
    return () => meta.unobserve(update);
  }, [doc]);
  return setup;
}

/** Patch the document's page setup (propagates live + persists). */
export function setLiveDocPageSetup(doc: Y.Doc, patch: Partial<LiveDocPageSetup>): void {
  const meta = doc.getMap("meta");
  doc.transact(() => {
    if (patch.size) meta.set("pageSize", patch.size);
    if (patch.orientation) meta.set("pageOrientation", patch.orientation);
    if (patch.margin) meta.set("pageMargin", patch.margin);
  });
}

/** Page geometry in CSS px for the on-screen editing surface. */
export function pageGeometryPx(setup: LiveDocPageSetup): {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
} {
  const base = PAGE_PX[setup.size];
  const portrait = setup.orientation === "portrait";
  return {
    width: portrait ? base.w : base.h,
    height: portrait ? base.h : base.w,
    margin: MARGIN_PX[setup.margin],
  };
}

/** Values for the print/PDF `@page { size; margin }` rule. */
export function pageCssRule(setup: LiveDocPageSetup): { readonly size: string; readonly margin: string } {
  return {
    size: `${PAGE_CSS_SIZE[setup.size]} ${setup.orientation}`,
    margin: MARGIN_MM[setup.margin],
  };
}

// --- Page decoration (border + watermark) ------------------------------
//
// Document-level page decoration, also stored in the shared `meta` map so
// it syncs + persists like the page setup above.

export type LiveDocPageBorder = "none" | "thin" | "medium";

/** Document-level page decoration (Word-style border + watermark). */
export interface LiveDocDecoration {
  readonly border: LiveDocPageBorder;
  /** Diagonal watermark text; empty string disables it. */
  readonly watermark: string;
}

export const DEFAULT_DECORATION: LiveDocDecoration = { border: "none", watermark: "" };

/** Page-border thickness in CSS px (0 = no border). */
export const BORDER_WIDTH_PX: Record<LiveDocPageBorder, number> = { none: 0, thin: 1, medium: 3 };

function isPageBorder(v: unknown): v is LiveDocPageBorder {
  return v === "none" || v === "thin" || v === "medium";
}

function readDecoration(doc: Y.Doc | null): LiveDocDecoration {
  if (!doc) return DEFAULT_DECORATION;
  const meta = doc.getMap("meta");
  const border = meta.get("pageBorder");
  const watermark = meta.get("watermark");
  return {
    border: isPageBorder(border) ? border : DEFAULT_DECORATION.border,
    watermark: typeof watermark === "string" ? watermark : DEFAULT_DECORATION.watermark,
  };
}

/** Observe the document's page decoration from the shared `meta` map. */
export function useLiveDocDecoration(doc: Y.Doc | null): LiveDocDecoration {
  const [decoration, setDecoration] = useState<LiveDocDecoration>(() => readDecoration(doc));
  useEffect(() => {
    if (!doc) {
      setDecoration(DEFAULT_DECORATION);
      return;
    }
    const meta = doc.getMap("meta");
    const update = () => setDecoration(readDecoration(doc));
    meta.observe(update);
    update();
    return () => meta.unobserve(update);
  }, [doc]);
  return decoration;
}

/** Patch the document's page decoration (propagates live + persists). */
export function setLiveDocDecoration(doc: Y.Doc, patch: Partial<LiveDocDecoration>): void {
  const meta = doc.getMap("meta");
  doc.transact(() => {
    if (patch.border !== undefined) meta.set("pageBorder", patch.border);
    if (patch.watermark !== undefined) meta.set("watermark", patch.watermark.slice(0, 80));
  });
}

// --- Header / footer (interim single-zone) -----------------------------
//
// Until a real pagination engine exists, the document has a single shared
// header and footer zone rendered at the top/bottom of the one editing
// surface (clearly not per-page).  Both strings plus a "show page number"
// flag live in the shared `meta` map so they sync + persist like the page
// setup above.

const HEADER_FOOTER_MAX = 200;

/** Document-level header/footer band (interim, single-zone). */
export interface LiveDocHeaderFooter {
  readonly enabled: boolean;
  readonly header: string;
  readonly footer: string;
  /** Append an automatic "Page N" token to the footer. */
  readonly showPageNumber: boolean;
}

export const DEFAULT_HEADER_FOOTER: LiveDocHeaderFooter = {
  enabled: false,
  header: "",
  footer: "",
  showPageNumber: false,
};

function readHeaderFooter(doc: Y.Doc | null): LiveDocHeaderFooter {
  if (!doc) return DEFAULT_HEADER_FOOTER;
  const meta = doc.getMap("meta");
  const header = meta.get("headerText");
  const footer = meta.get("footerText");
  return {
    enabled: meta.get("headerFooterEnabled") === true,
    header: typeof header === "string" ? header : DEFAULT_HEADER_FOOTER.header,
    footer: typeof footer === "string" ? footer : DEFAULT_HEADER_FOOTER.footer,
    showPageNumber: meta.get("showPageNumber") === true,
  };
}

/** Observe the document's header/footer from the shared `meta` map. */
export function useLiveDocHeaderFooter(doc: Y.Doc | null): LiveDocHeaderFooter {
  const [value, setValue] = useState<LiveDocHeaderFooter>(() => readHeaderFooter(doc));
  useEffect(() => {
    if (!doc) {
      setValue(DEFAULT_HEADER_FOOTER);
      return;
    }
    const meta = doc.getMap("meta");
    const update = () => setValue(readHeaderFooter(doc));
    meta.observe(update);
    update();
    return () => meta.unobserve(update);
  }, [doc]);
  return value;
}

/** Patch the document's header/footer (propagates live + persists). */
export function setLiveDocHeaderFooter(doc: Y.Doc, patch: Partial<LiveDocHeaderFooter>): void {
  const meta = doc.getMap("meta");
  doc.transact(() => {
    if (patch.enabled !== undefined) meta.set("headerFooterEnabled", patch.enabled);
    if (patch.header !== undefined) meta.set("headerText", patch.header.slice(0, HEADER_FOOTER_MAX));
    if (patch.footer !== undefined) meta.set("footerText", patch.footer.slice(0, HEADER_FOOTER_MAX));
    if (patch.showPageNumber !== undefined) meta.set("showPageNumber", patch.showPageNumber);
  });
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
