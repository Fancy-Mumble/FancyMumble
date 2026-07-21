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
export type LiveDocPageMargin = "normal" | "narrow" | "moderate" | "wide" | "mirrored";
export type LiveDocRulerUnit = "cm" | "in";
export type LiveDocPageColumns = 1 | 2 | 3;

/** Document-level page layout (Word-style "Page setup"). */
export interface LiveDocPageSetup {
  readonly size: LiveDocPageSize;
  readonly orientation: LiveDocPageOrientation;
  readonly margin: LiveDocPageMargin;
  /** Custom horizontal (left/right) margin in CSS px.  When set it
   *  overrides the named `margin` preset; dragging a ruler handle writes
   *  it, and picking a named preset clears it. */
  readonly marginX?: number;
  /** Custom vertical (top/bottom) margin in CSS px (see `marginX`). */
  readonly marginY?: number;
  /** Unit shown in the Alt-key ruler measurement overlay. */
  readonly rulerUnit: LiveDocRulerUnit;
  /** Number of text columns on the page (1 = single, default). */
  readonly columns?: LiveDocPageColumns;
}

/** Returns the default ruler unit for a given page size. */
export function defaultRulerUnit(size: LiveDocPageSize): LiveDocRulerUnit {
  return size === "a4" ? "cm" : "in";
}

export const DEFAULT_PAGE_SETUP: LiveDocPageSetup = {
  size: "a4",
  orientation: "portrait",
  margin: "normal",
  rulerUnit: defaultRulerUnit("a4"),
};

/** Page dimensions in CSS px at 96 dpi (portrait). */
const PAGE_PX: Record<LiveDocPageSize, { readonly w: number; readonly h: number }> = {
  a4: { w: 794, h: 1123 }, // 210 x 297 mm
  letter: { w: 816, h: 1056 }, // 8.5 x 11 in
  legal: { w: 816, h: 1344 }, // 8.5 x 14 in
};
const MARGIN_PX: Record<LiveDocPageMargin, { readonly x: number; readonly y: number }> = {
  normal:   { x: 96,  y: 96  }, // 1" all sides
  narrow:   { x: 48,  y: 48  }, // 0.5" all sides
  moderate: { x: 72,  y: 96  }, // 0.75" left/right, 1" top/bottom
  wide:     { x: 192, y: 96  }, // 2" left/right, 1" top/bottom
  mirrored: { x: 120, y: 96  }, // 1.25" inner/outer, 1" top/bottom
};
/** Named CSS paged-media sizes (used by the print/PDF `@page` rule). */
const PAGE_CSS_SIZE: Record<LiveDocPageSize, string> = { a4: "A4", letter: "letter", legal: "legal" };

function isPageSize(v: unknown): v is LiveDocPageSize {
  return v === "a4" || v === "letter" || v === "legal";
}
function isPageMargin(v: unknown): v is LiveDocPageMargin {
  return v === "normal" || v === "narrow" || v === "moderate" || v === "wide" || v === "mirrored";
}
function isMarginPx(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}
function isRulerUnit(v: unknown): v is LiveDocRulerUnit {
  return v === "cm" || v === "in";
}
function isPageColumns(v: unknown): v is LiveDocPageColumns {
  return v === 1 || v === 2 || v === 3;
}

function readPageSetup(doc: Y.Doc | null): LiveDocPageSetup {
  if (!doc) return DEFAULT_PAGE_SETUP;
  const meta = doc.getMap("meta");
  const size = meta.get("pageSize");
  const orientation = meta.get("pageOrientation");
  const margin = meta.get("pageMargin");
  const marginX = meta.get("pageMarginX");
  const marginY = meta.get("pageMarginY");
  const rulerUnit = meta.get("pageRulerUnit");
  const columns = meta.get("pageColumns");
  const resolvedSize = isPageSize(size) ? size : DEFAULT_PAGE_SETUP.size;
  return {
    size: resolvedSize,
    orientation: orientation === "landscape" ? "landscape" : "portrait",
    margin: isPageMargin(margin) ? margin : DEFAULT_PAGE_SETUP.margin,
    rulerUnit: isRulerUnit(rulerUnit) ? rulerUnit : defaultRulerUnit(resolvedSize),
    ...(isMarginPx(marginX) ? { marginX } : {}),
    ...(isMarginPx(marginY) ? { marginY } : {}),
    ...(isPageColumns(columns) ? { columns } : {}),
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
    if (patch.margin) {
      meta.set("pageMargin", patch.margin);
      // Picking a named preset discards any custom ruler-drag overrides.
      meta.delete("pageMarginX");
      meta.delete("pageMarginY");
    }
    if (isMarginPx(patch.marginX)) meta.set("pageMarginX", patch.marginX);
    if (isMarginPx(patch.marginY)) meta.set("pageMarginY", patch.marginY);
    if (isRulerUnit(patch.rulerUnit)) meta.set("pageRulerUnit", patch.rulerUnit);
    if (patch.columns !== undefined) {
      if (patch.columns === 1) meta.delete("pageColumns");
      else meta.set("pageColumns", patch.columns);
    }
  });
}

/** Resolve the effective horizontal/vertical margins in CSS px, applying
 *  any custom ruler-drag overrides on top of the named preset. */
function resolveMarginsPx(setup: LiveDocPageSetup): { readonly x: number; readonly y: number } {
  const preset = MARGIN_PX[setup.margin];
  return {
    x: isMarginPx(setup.marginX) ? setup.marginX : preset.x,
    y: isMarginPx(setup.marginY) ? setup.marginY : preset.y,
  };
}

/** Page geometry in CSS px for the on-screen editing surface. */
export function pageGeometryPx(setup: LiveDocPageSetup): {
  readonly width: number;
  readonly height: number;
  readonly marginX: number;
  readonly marginY: number;
} {
  const base = PAGE_PX[setup.size];
  const portrait = setup.orientation === "portrait";
  const margins = resolveMarginsPx(setup);
  return {
    width: portrait ? base.w : base.h,
    height: portrait ? base.h : base.w,
    marginX: margins.x,
    marginY: margins.y,
  };
}

const PX_PER_MM = 96 / 25.4;
function pxToMm(px: number): string {
  return `${(px / PX_PER_MM).toFixed(2)}mm`;
}

/** Values for the print/PDF `@page { size; margin }` rule. */
export function pageCssRule(setup: LiveDocPageSetup): { readonly size: string; readonly margin: string } {
  const size = `${PAGE_CSS_SIZE[setup.size]} ${setup.orientation}`;
  const margins = resolveMarginsPx(setup);
  return { size, margin: `${pxToMm(margins.y)} ${pxToMm(margins.x)}` };
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

/** Named header/footer theme (Word-style design gallery). */
export type LiveDocBandStyle =
  | "blank"
  | "threeColumns"
  | "austin"
  | "banded"
  | "facet"
  | "filigree"
  | "grid"
  | "integral";
/** Numbering-style template for the footer page number. */
export type LiveDocPageNumberStyle = "page-of" | "page" | "plain" | "dash" | "slash" | "roman";

export const BAND_STYLES: ReadonlyArray<LiveDocBandStyle> = [
  "blank", "threeColumns", "austin", "banded", "facet", "filigree", "grid", "integral",
];
export const PAGE_NUMBER_STYLES: ReadonlyArray<LiveDocPageNumberStyle> = [
  "page-of", "page", "plain", "dash", "slash", "roman",
];

/** Document-level header/footer bands.  Header, footer and the page-number
 *  token are three independent toggles - turning on one never forces another. */
export interface LiveDocHeaderFooter {
  /** Show the running header at the top of every page. */
  readonly headerEnabled: boolean;
  /** Show the running footer at the bottom of every page. */
  readonly footerEnabled: boolean;
  readonly header: string;
  readonly footer: string;
  /** Show an automatic page number at the bottom of every page (independent of
   *  the footer text zone). */
  readonly showPageNumber: boolean;
  readonly headerStyle: LiveDocBandStyle;
  readonly footerStyle: LiveDocBandStyle;
  readonly pageNumberStyle: LiveDocPageNumberStyle;
}

export const DEFAULT_HEADER_FOOTER: LiveDocHeaderFooter = {
  headerEnabled: false,
  footerEnabled: false,
  header: "",
  footer: "",
  showPageNumber: false,
  headerStyle: "blank",
  footerStyle: "blank",
  pageNumberStyle: "page-of",
};

function readBandStyle(value: unknown, fallback: LiveDocBandStyle): LiveDocBandStyle {
  return BAND_STYLES.includes(value as LiveDocBandStyle) ? (value as LiveDocBandStyle) : fallback;
}

function readHeaderFooter(doc: Y.Doc | null): LiveDocHeaderFooter {
  if (!doc) return DEFAULT_HEADER_FOOTER;
  const meta = doc.getMap("meta");
  const header = meta.get("headerText");
  const footer = meta.get("footerText");
  const pageNumberStyle = meta.get("pageNumberStyle");
  // Migration: the old single `headerFooterEnabled` flag turned both zones on.
  const legacyEnabled = meta.get("headerFooterEnabled") === true;
  const headerFlag = meta.get("headerEnabled");
  const footerFlag = meta.get("footerEnabled");
  return {
    headerEnabled: headerFlag === undefined ? legacyEnabled : headerFlag === true,
    footerEnabled: footerFlag === undefined ? legacyEnabled : footerFlag === true,
    header: typeof header === "string" ? header : DEFAULT_HEADER_FOOTER.header,
    footer: typeof footer === "string" ? footer : DEFAULT_HEADER_FOOTER.footer,
    showPageNumber: meta.get("showPageNumber") === true,
    headerStyle: readBandStyle(meta.get("headerStyle"), DEFAULT_HEADER_FOOTER.headerStyle),
    footerStyle: readBandStyle(meta.get("footerStyle"), DEFAULT_HEADER_FOOTER.footerStyle),
    pageNumberStyle: PAGE_NUMBER_STYLES.includes(pageNumberStyle as LiveDocPageNumberStyle)
      ? (pageNumberStyle as LiveDocPageNumberStyle)
      : DEFAULT_HEADER_FOOTER.pageNumberStyle,
  };
}

const ROMAN: ReadonlyArray<readonly [number, string]> = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

function toRoman(n: number): string {
  if (n <= 0) return String(n);
  let out = "";
  let rem = n;
  for (const [value, sym] of ROMAN) {
    while (rem >= value) {
      out += sym;
      rem -= value;
    }
  }
  return out;
}

/** Minimal translate signature (cast the i18next `t` to this at call sites -
 *  relating its huge overload set to a plain function type crashes tsc). */
export type LiveDocTranslate = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Format a 1-based page number per the chosen numbering-style template.
 * `t` is used only for the word-based styles ("Page N", "Page N of M").
 */
export function formatPageNumber(
  style: LiveDocPageNumberStyle,
  pageNumber: number,
  pageCount: number | undefined,
  t: LiveDocTranslate,
): string {
  const total = pageCount && pageCount > 0 ? pageCount : pageNumber;
  switch (style) {
    case "plain":
      return `${pageNumber}`;
    case "dash":
      return `- ${pageNumber} -`;
    case "slash":
      return `${pageNumber} / ${total}`;
    case "roman":
      return toRoman(pageNumber);
    case "page":
      return t("liveDoc.headerFooter.pageNumber", { number: pageNumber });
    case "page-of":
    default:
      return total > 1
        ? t("liveDoc.headerFooter.pageNumberOf", { number: pageNumber, total })
        : t("liveDoc.headerFooter.pageNumber", { number: pageNumber });
  }
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
    if (patch.headerEnabled !== undefined) meta.set("headerEnabled", patch.headerEnabled);
    if (patch.footerEnabled !== undefined) meta.set("footerEnabled", patch.footerEnabled);
    if (patch.header !== undefined) meta.set("headerText", patch.header.slice(0, HEADER_FOOTER_MAX));
    if (patch.footer !== undefined) meta.set("footerText", patch.footer.slice(0, HEADER_FOOTER_MAX));
    if (patch.showPageNumber !== undefined) meta.set("showPageNumber", patch.showPageNumber);
    if (patch.headerStyle !== undefined) meta.set("headerStyle", patch.headerStyle);
    if (patch.footerStyle !== undefined) meta.set("footerStyle", patch.footerStyle);
    if (patch.pageNumberStyle !== undefined) meta.set("pageNumberStyle", patch.pageNumberStyle);
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
