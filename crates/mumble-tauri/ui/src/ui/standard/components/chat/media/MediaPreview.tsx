/**
 * MediaPreview - renders inline media (images, GIFs, videos) extracted
 * from a Mumble message body.
 *
 * - Images / GIFs show a small thumbnail; click opens a lightbox.
 * - GIFs auto-play for 4 s on first view, then freeze permanently.
 * - Videos show a poster frame; click opens a lightbox with playback.
 */

import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import MediaPlayer from "@shared/mediaplayer/MediaPlayer";
import styles from "./MediaPreview.module.css";
import { ExternalLinkGuard } from "../../elements/ExternalLinkGuard";
import { CloseIcon, EyeOffIcon } from "../../../icons";
import type { TimeFormat } from "@core/types";
import { formatTimestamp } from "@core/utils/format";
import { useInnerHtml } from "@core/utils/innerHtml";
import { imageSizeFromSource, rememberImageSize } from "@core/utils/imageSize";
import { neutraliseRemoteMedia } from "@core/utils/remoteMedia";
import { ImageContextMenu } from "../../elements/ImageContextMenu";

// --- Types --------------------------------------------------------

export interface MediaItem {
  kind: "image" | "gif" | "video";
  src: string; // data-URL or remote URL
  alt: string;
  /** When true, render heavily blurred until the viewer clicks to reveal. */
  spoiler: boolean;
  /**
   * The picture's own dimensions, where they could be known before it loads.
   *
   * Read out of the encoded bytes (see `imageSizeFromSource`) or off the tag
   * that carried it. Absent for a remote source nobody has measured yet, and
   * for video, whose container this client does not parse.
   */
  width?: number;
  height?: number;
}

interface Props {
  /** The raw HTML body of the message. */
  html: string;
  /** Unique key for this message (e.g. index) used to track GIF play state. */
  messageId: string;
  /**
   * When true the top margin on the media grid is suppressed.
   * Used when the bubble has zero padding (pure-media messages).
   */
  compact?: boolean;
  /** Epoch-ms timestamp to overlay on each media thumbnail. */
  timestamp?: number | null;
  /** Time format preference for the timestamp chip. */
  timeFormat?: TimeFormat;
  /** Display timestamp in local timezone. */
  convertToLocalTime?: boolean;
  /** OS-reported clock format for "auto" mode (true = 24h). */
  systemUses24h?: boolean;
  /** Name of the message sender (shown in lightbox). */
  senderName?: string;
  /** Epoch-ms timestamp of the message (shown in lightbox). */
  messageTimestamp?: number | null;
  /** When provided, thumbnail clicks call this instead of opening the internal lightbox. */
  onOpenLightbox?: (src: string) => void;
  /** When true, render the media as a uniform square tile that fills its grid
   *  cell (used for image-gallery tiles in the message list). */
  tile?: boolean;
}

// --- Global GIF-played tracker ------------------------------------
// Persists across re-renders and channel switches.  Once a GIF has
// played its 4 s it is marked here so it will never auto-play again.
const playedGifs = new Set<string>();

/** Cached frozen-frame data URLs so re-mounts don't need to reload. */
const frozenFrames = new Map<string, string>();

/**
 * Spoiler thumbnails the viewer has already revealed this session.
 * Module-scope (like `playedGifs`) so a reveal survives unmount/remount -
 * e.g. switching to settings and back, or scrolling the message out of view
 * and back - instead of snapping back to blurred.
 */
const revealedSpoilers = new Set<string>();

/** How many tiles a gallery draws before the rest go behind a "+n". */
const GALLERY_TILE_CAP = 4;

// --- Helpers ------------------------------------------------------

// --- HTML Sanitiser (whitelist-based) ------------------------------

/** Tags allowed in message text after media extraction. */
const ALLOWED_TAGS = new Set([
  "b",
  "i",
  "u",
  "s",
  "em",
  "strong",
  "br",
  "p",
  "span",
  "font",
  "code",
  "pre",
  "a",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "sub",
  "sup",
  "small",
  "del",
  "ins",
  "abbr",
  "mark",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
]);

/** Attributes allowed per-tag; `"*"` key applies to every tag. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  "*": new Set(["class", "title"]),
  a: new Set(["href", "target", "rel"]),
  font: new Set(["color", "size", "face"]),
  span: new Set([
    "style",
    "data-mention-session",
    "data-mention-role",
    "data-mention-everyone",
    "data-mention-here",
  ]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
};

/** Protocols accepted inside `href` attributes. */
const SAFE_URL_RE = /^(?:https?:|mailto:|#)/i;

/** CSS properties allowed in inline `style` attributes. */
const SAFE_CSS_PROPS = new Set([
  "color",
  "background-color",
  "background",
  "font-size",
  "font-weight",
  "font-style",
  "font-family",
  "text-decoration",
  "text-align",
  "margin",
  "padding",
  "border",
  "display",
  "white-space",
  "word-break",
  "line-height",
  "letter-spacing",
]);

/**
 * Walk the DOM tree produced by DOMParser and strip anything
 * not on the whitelist.  Mutates `root` in place.
 */
function sanitiseTree(root: Element): void {
  for (const child of Array.from(root.children)) {
    const tag = child.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      child.replaceWith(document.createTextNode(child.textContent ?? ""));
      continue;
    }
    sanitiseAttrs(child, tag);
    sanitiseTree(child);
  }
}

/** Filter an inline `style` attribute value to allowed CSS properties only. */
function sanitiseStyle(value: string): string {
  return value
    .split(";")
    .filter((decl) => {
      const prop = decl.split(":")[0]?.trim().toLowerCase() ?? "";
      return SAFE_CSS_PROPS.has(prop);
    })
    .join(";");
}

/** Process one attribute: remove it if disallowed, sanitise href/style otherwise. */
function handleAttr(child: Element, attr: Attr, globalAllowed: Set<string>, tagAllowed: Set<string>): void {
  const name = attr.name.toLowerCase();
  if (name.startsWith("on") || (!globalAllowed.has(name) && !tagAllowed.has(name))) {
    child.removeAttribute(attr.name);
    return;
  }
  if (name === "href" && !SAFE_URL_RE.test(attr.value.trim())) {
    child.removeAttribute(attr.name);
    return;
  }
  if (name === "style") {
    const safe = sanitiseStyle(attr.value);
    if (safe) {
      child.setAttribute("style", safe);
    } else {
      child.removeAttribute("style");
    }
  }
}

/** Strip or normalise all attributes on a single element. */
function sanitiseAttrs(child: Element, tag: string): void {
  const globalAllowed = ALLOWED_ATTRS["*"] ?? new Set<string>();
  const tagAllowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
  for (const attr of Array.from(child.attributes)) {
    handleAttr(child, attr, globalAllowed, tagAllowed);
  }
  if (tag === "a") {
    child.setAttribute("target", "_blank");
    child.setAttribute("rel", "noopener noreferrer");
    (child as HTMLElement).dataset["external"] = "true";
  }
}

/**
 * Find `<span class="math-inline">` and `<span class="math-display">`
 * elements produced by `markdownToHtml` and render their text content
 * as KaTeX HTML in place.  Called after sanitisation so the KaTeX
 * output (which is complex but safe) is not stripped.
 */
// KaTeX is ~450 kB; load it (and its stylesheet) only when a message actually
// contains math, keeping it off the heap on the common no-math path.
let katexModule: (typeof import("katex"))["default"] | null = null;
let katexLoading: Promise<(typeof import("katex"))["default"]> | null = null;
function loadKatex(): Promise<(typeof import("katex"))["default"]> {
  if (katexModule) return Promise.resolve(katexModule);
  katexLoading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([m]) => (katexModule = m.default),
  );
  return katexLoading;
}

function renderMathWith(katex: (typeof import("katex"))["default"], root: HTMLElement): void {
  for (const span of root.querySelectorAll<HTMLSpanElement>("span.math-inline, span.math-display")) {
    const latex = span.textContent ?? "";
    const displayMode = span.classList.contains("math-display");
    try {
      span.innerHTML = katex.renderToString(latex.trim(), {
        throwOnError: false,
        output: "html",
        displayMode,
      });
    } catch {
      span.textContent = displayMode ? `$$${latex}$$` : `$${latex}$`;
    }
  }
}

/**
 * Render any LaTeX math spans inside a *live* DOM node, lazy-loading KaTeX on
 * first use.  No-op (and no KaTeX load) when the node has no math - the common
 * case.  Operates on the mounted element (not the detached parse tree) so the
 * asynchronous KaTeX load can write its output back into what the user sees.
 */
function renderMathNodes(root: HTMLElement): void {
  if (!root.querySelector("span.math-inline, span.math-display")) return;
  if (katexModule) {
    renderMathWith(katexModule, root);
    return;
  }
  void loadKatex().then((katex) => renderMathWith(katex, root));
}

/** A positive whole number written in an attribute, or nothing. */
function attrSize(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The size a tag states about itself - `<img width=… height=…>`. */
function taggedSize(element: Element): { width?: number; height?: number } {
  const width = attrSize(element.getAttribute("width"));
  const height = attrSize(element.getAttribute("height"));
  return width && height ? { width, height } : {};
}

/**
 * How big a picture is going to be, decided before it has decoded.
 *
 * The tag is asked first - a live-doc or a bridge may have written the size
 * down - and the bytes second, which is where an ordinary pasted screenshot
 * answers from. Both are cheap, and either one is what stops the row being
 * laid out at zero height and jumping when the decode lands.
 */
function intrinsicSize(element: Element, src: string): { width?: number; height?: number } {
  const tagged = taggedSize(element);
  if (tagged.width) return tagged;
  return imageSizeFromSource(src) ?? {};
}

/** Parse `<img>` and `<video>` tags out of HTML and classify them. */
export function extractMedia(html: string): { cleaned: string; media: MediaItem[] } {
  const media: MediaItem[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Images
  // Remote pictures and clips never load by themselves (see remoteMedia.ts):
  // they stay in the text as links, and only inline ones become tiles.
  neutraliseRemoteMedia(doc.body);

  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    if (!src) return;
    const isGif =
      src.startsWith("data:image/gif") ||
      src.toLowerCase().endsWith(".gif") ||
      (src.toLowerCase().endsWith(".webp") && src.includes("klipy.com"));
    media.push({
      kind: isGif ? "gif" : "image",
      src,
      alt: img.alt || "",
      spoiler: img.getAttribute("data-spoiler") === "1",
      ...intrinsicSize(img, src),
    });
    img.remove();
  });

  // Videos
  doc.querySelectorAll("video").forEach((vid) => {
    const src = vid.getAttribute("src") ?? vid.querySelector("source")?.getAttribute("src") ?? "";
    if (!src) return;
    media.push({
      kind: "video",
      src,
      alt: "",
      spoiler: vid.getAttribute("data-spoiler") === "1",
      // No container is parsed for a clip; only a tag that says so is believed.
      ...taggedSize(vid),
    });
    vid.remove();
  });

  // Sanitise the remaining DOM tree.
  sanitiseTree(doc.body);

  // NOTE: math spans are left as-is here and rendered post-mount (see
  // `renderMathNodes` in MediaPreview) so KaTeX can be lazy-loaded.
  const cleaned = doc.body.innerHTML.trim();
  return { cleaned, media };
}

// --- Sub-components -----------------------------------------------

/** Centered "Spoiler" badge overlaid on blurred spoiler media. */
function SpoilerBadge() {
  const { t } = useTranslation("chat");
  return (
    <span className={styles.spoilerBadge} aria-hidden="true">
      <EyeOffIcon width={18} height={18} />
      <span className={styles.spoilerBadgeText}>{t("spoiler.badge")}</span>
    </span>
  );
}

/**
 * The frame a picture is going to occupy, held open before it can fill it.
 *
 * Handed to CSS as the picture's own dimensions rather than as a finished
 * width: the stylesheet already knows what a thumbnail may grow to, and it
 * differs by where the message is drawn (the mobile thread caps them smaller).
 * Two custom properties let the same caps do the arithmetic in both places
 * instead of this file guessing at them.
 *
 * Only for a thumbnail whose frame is not already decided - a gallery tile and
 * a grid tile are square whatever they hold, so they never move.
 */
function reservedBox(item: MediaItem, reserve: boolean): { className: string; style?: CSSProperties } {
  if (!reserve || !item.width || !item.height) return { className: styles.thumbWrap };
  return {
    className: `${styles.thumbWrap} ${styles.thumbWrapSized}`,
    style: { "--thumb-w": item.width, "--thumb-h": item.height } as CSSProperties,
  };
}

/** What fills a reserved frame until the picture does. */
function ThumbSkeleton() {
  return <span className={styles.thumbSkeleton} aria-hidden="true" />;
}

/**
 * Whether the picture has painted yet.
 *
 * A cached picture is `complete` before React ever hears a `load` event, so
 * the ref settles it as well as the handler - otherwise a skeleton would sit
 * over a picture that is already there. A picture that fails counts as
 * settled too: a broken frame is an answer, an endless shimmer is not.
 */
function useThumbLoaded() {
  const [loaded, setLoaded] = useState(false);
  /**
   * What the picture turned out to be, where that is not what was read of it.
   *
   * The frame was reserved from the encoded bytes, which is a reading, not a
   * measurement. A file whose header lies - or a format this client parses
   * imperfectly - corrects itself here rather than living in a frame of the
   * wrong shape for as long as the message is on screen.
   */
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  /** The picture is there (or is never going to be): stop standing in for it. */
  const settle = useCallback((element: HTMLImageElement | null) => {
    if (element && element.naturalWidth > 0) {
      const size = { width: element.naturalWidth, height: element.naturalHeight };
      // Worth writing down: a picture the body points at by URL cannot be
      // measured from its bytes, and this is the only time anyone sees them.
      rememberImageSize(element.currentSrc || element.src, size);
      setNatural((current) =>
        current?.width === size.width && current.height === size.height ? current : size,
      );
    }
    setLoaded(true);
  }, []);
  /** For the ref: a picture that was already decoded gets no `load` event. */
  const settleIfDone = useCallback(
    (element: HTMLImageElement | null) => {
      if (element?.complete) settle(element);
    },
    [settle],
  );
  return { loaded, natural, settle, settleIfDone };
}

function GifThumb({
  item,
  id,
  timeLabel,
  reserve = false,
}: Readonly<{
  item: MediaItem;
  id: string;
  timeLabel?: string | null;
  reserve?: boolean;
}>) {
  const { t } = useTranslation("chat");
  const imgRef = useRef<HTMLImageElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { loaded, natural, settle, settleIfDone } = useThumbLoaded();
  const box = reservedBox(natural ? { ...item, ...natural } : item, reserve);
  const [revealed, setRevealed] = useState(() => revealedSpoilers.has(id));
  const [frozen, setFrozen] = useState(() => playedGifs.has(id));
  const [posterSrc, setPosterSrc] = useState<string | null>(() => frozenFrames.get(id) ?? null);

  /** Snapshot whatever frame the <img> is currently showing -> data URL,
   *  cache it, then freeze the display. */
  const captureAndFreeze = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    const img = imgRef.current;
    if (img && img.naturalWidth > 0) {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d")?.drawImage(img, 0, 0);
        const url = c.toDataURL();
        frozenFrames.set(id, url);
        setPosterSrc(url);
      } catch {
        // Cross-origin image without CORS headers - freeze without a poster frame.
      }
    }
    setFrozen(true);
  }, [id]);

  /** Start the play countdown (4 s). */
  const startTimer = useCallback(() => {
    timerRef.current = setTimeout(captureAndFreeze, 4000);
  }, [captureAndFreeze]);

  /** Called when the playing <img> finishes loading. */
  const handleImgLoad = useCallback(() => {
    // Only auto-start on first play; replays set their own timer.
    if (!playedGifs.has(id)) {
      playedGifs.add(id);
      startTimer();
    }
  }, [id, startTimer]);

  // For already-played GIFs without a cached frame, load frame 0.
  useEffect(() => {
    if (!frozen || posterSrc) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d")?.drawImage(img, 0, 0);
        const url = c.toDataURL();
        frozenFrames.set(id, url);
        setPosterSrc(url);
      } catch {
        // Cross-origin image without CORS headers - no poster frame.
      }
    };
    img.src = item.src;
  }, [frozen, posterSrc, id, item.src]);

  // Pause on window blur or tab hidden.
  useEffect(() => {
    if (frozen) return;
    const pause = () => captureAndFreeze();
    const onVisChange = () => {
      if (document.hidden) pause();
    };
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, [frozen, captureAndFreeze]);

  // Cleanup timer on unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleToggle = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setFrozen(false);
    startTimer();
  }, [startTimer]);

  // Spoiler cover: keep the GIF hidden (and never auto-play) behind a heavy
  // blur until the viewer clicks to reveal.
  if (item.spoiler && !revealed) {
    return (
      <button
        type="button"
        className={box.className}
        style={box.style}
        onClick={() => {
          revealedSpoilers.add(id);
          setRevealed(true);
        }}
        aria-label={t("spoiler.reveal")}
      >
        <img
          className={`${styles.thumb} ${styles.spoilerBlurred}`}
          src={posterSrc ?? item.src}
          alt=""
          ref={settleIfDone}
          onLoad={(event) => settle(event.currentTarget)}
          onError={() => settle(null)}
        />
        {!loaded && <ThumbSkeleton />}
        <SpoilerBadge />
        {timeLabel && <span className={styles.timeChip}>{timeLabel}</span>}
      </button>
    );
  }

  if (frozen) {
    return (
      <button type="button" className={box.className} style={box.style} onClick={handleToggle}>
        {posterSrc ? (
          <img
            className={styles.thumb}
            src={posterSrc}
            alt={item.alt}
            ref={settleIfDone}
            onLoad={(event) => settle(event.currentTarget)}
            onError={() => settle(null)}
          />
        ) : (
          <div className={styles.thumbPlaceholder} />
        )}
        {posterSrc && !loaded && <ThumbSkeleton />}
        <div className={styles.replayOverlay}>
          <span className={styles.replayIcon}>&#x25B6;</span>
        </div>
        <span className={styles.gifBadge}>GIF</span>
        {timeLabel && <span className={styles.timeChip}>{timeLabel}</span>}
      </button>
    );
  }

  return (
    <button type="button" className={box.className} style={box.style} onClick={captureAndFreeze}>
      <img
        ref={(element) => {
          imgRef.current = element;
          settleIfDone(element);
        }}
        className={styles.thumb}
        src={item.src}
        alt={item.alt}
        crossOrigin="anonymous"
        onLoad={(event) => {
          settle(event.currentTarget);
          handleImgLoad();
        }}
        onError={() => settle(null)}
      />
      {!loaded && <ThumbSkeleton />}
      <span className={styles.gifBadge}>GIF</span>
      {timeLabel && <span className={styles.timeChip}>{timeLabel}</span>}
    </button>
  );
}

function ImageThumb({
  item,
  id,
  onOpen,
  timeLabel,
  reserve = false,
}: Readonly<{
  item: MediaItem;
  id: string;
  onOpen: () => void;
  timeLabel?: string | null;
  reserve?: boolean;
}>) {
  const { t } = useTranslation("chat");
  const [revealed, setRevealed] = useState(() => revealedSpoilers.has(id));
  const { loaded, natural, settle, settleIfDone } = useThumbLoaded();
  const box = reservedBox(natural ? { ...item, ...natural } : item, reserve);
  const blurred = item.spoiler && !revealed;
  const handleClick = useCallback(() => {
    if (blurred) {
      revealedSpoilers.add(id);
      setRevealed(true);
      return;
    }
    onOpen();
  }, [blurred, id, onOpen]);
  return (
    <button
      type="button"
      className={box.className}
      style={box.style}
      onClick={handleClick}
      aria-label={blurred ? t("spoiler.reveal") : undefined}
    >
      <img
        className={`${styles.thumb} ${blurred ? styles.spoilerBlurred : ""}`}
        src={item.src}
        alt={blurred ? "" : item.alt}
        ref={settleIfDone}
        onLoad={(event) => settle(event.currentTarget)}
        onError={() => settle(null)}
      />
      {!loaded && <ThumbSkeleton />}
      {blurred && <SpoilerBadge />}
      {timeLabel && <span className={styles.timeChip}>{timeLabel}</span>}
    </button>
  );
}

/** `m:ss` (or `h:mm:ss`), for how long a clip runs. */
function clipLength(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const whole = Math.floor(seconds);
  const s = String(whole % 60).padStart(2, "0");
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function VideoThumb({
  item,
  id,
  onOpen,
  timeLabel,
  reserve = false,
}: Readonly<{
  item: MediaItem;
  id: string;
  onOpen: () => void;
  timeLabel?: string | null;
  reserve?: boolean;
}>) {
  const { t } = useTranslation("chat");
  const [revealed, setRevealed] = useState(() => revealedSpoilers.has(id));
  const [seconds, setSeconds] = useState<number | null>(null);
  const [posterShown, setPosterShown] = useState(false);
  const box = reservedBox(item, reserve);
  const blurred = item.spoiler && !revealed;
  const handleClick = useCallback(() => {
    if (blurred) {
      revealedSpoilers.add(id);
      setRevealed(true);
      return;
    }
    onOpen();
  }, [blurred, id, onOpen]);
  const length = blurred || seconds == null ? "" : clipLength(seconds);
  return (
    <button
      type="button"
      className={box.className}
      style={box.style}
      onClick={handleClick}
      aria-label={blurred ? t("spoiler.reveal") : undefined}
    >
      <video
        className={`${styles.thumb} ${blurred ? styles.spoilerBlurred : ""}`}
        src={item.src}
        muted
        preload="metadata"
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          setSeconds(element.duration);
          // Metadata alone leaves the element a black rectangle on every
          // engine we ship on - the frame the thumbnail is *of* is only
          // decoded once something seeks to it.
          if (element.currentTime === 0 && Number.isFinite(element.duration)) {
            element.currentTime = Math.min(0.1, element.duration / 2);
          }
        }}
        // The frame is there once the seek lands; until then the skeleton
        // stands in rather than a black rectangle.
        onSeeked={() => setPosterShown(true)}
        onLoadedData={() => setPosterShown(true)}
        onError={() => setPosterShown(true)}
      />
      {!posterShown && <ThumbSkeleton />}
      {/* A clip reads as a clip from the disc in the middle of it, the way it
          does everywhere else. The small corner triangle it used to wear was
          the same size and weight as the timestamp opposite, so a video and a
          still were the same object until one of them was clicked. */}
      {blurred ? (
        <SpoilerBadge />
      ) : (
        <span className={styles.playDisc} aria-hidden="true">
          &#x25B6;
        </span>
      )}
      {length && <span className={styles.lengthChip}>{length}</span>}
      {/* Bottom-right belongs to the clip's length; the message clock steps
          aside to the other corner rather than sitting on top of it. */}
      {timeLabel && (
        <span className={`${styles.timeChip} ${length ? styles.timeChipLeft : ""}`}>{timeLabel}</span>
      )}
    </button>
  );
}

// --- Lightbox -----------------------------------------------------

export function MediaLightbox({
  item,
  onClose,
  senderName,
  messageTimestamp,
  timeFormat,
  convertToLocalTime,
  systemUses24h,
  link,
}: Readonly<{
  item: MediaItem;
  onClose: () => void;
  senderName?: string;
  messageTimestamp?: number | null;
  timeFormat?: TimeFormat;
  convertToLocalTime?: boolean;
  systemUses24h?: boolean;
  /**
   * The address a browser could open this picture at, where the `src` is not
   * one - a public or password-protected file drawn from a local copy.
   */
  link?: string | null;
}>) {
  /** Where the reader right-clicked the picture, while the menu is up. */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      role="button"
      tabIndex={0}
      className={styles.lightboxOverlay}
      aria-label="Close lightbox"
      onClick={(e) => {
        // See `onContextMenu`: in the React tree this overlay is still a child
        // of whatever opened it, so a click inside it would reach the message
        // row underneath - which in selection mode is the row's checkbox.
        e.stopPropagation();
        // While the menu is up the next click dismisses it, and leaves the
        // picture behind it where it was.
        if (menuAt) {
          setMenuAt(null);
          return;
        }
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClose();
      }}
      /* The picture's own menu, in place of the platform's - and in place of
         the message menu that used to come up through the overlay, drawn
         underneath its blur. */
      onContextMenu={(e) => {
        /* This overlay is portalled to the body, but React propagates through
           the tree it was *written* in - so the message row that drew the card
           sees this right-click too, and answers it with its own menu, drawn
           at the row's z-index behind this overlay's blur. Two menus, one of
           them unreadable. The click stops here. */
        e.stopPropagation();
        // A clip keeps the platform's menu and its playback rows; everything
        // else on the overlay is ours, so no Back / Refresh / Inspect comes up
        // over a photograph.
        if (item.kind === "video") return;
        e.preventDefault();
        setMenuAt((e.target as HTMLElement).closest("img") ? { x: e.clientX, y: e.clientY } : null);
      }}
    >
      <div className={styles.lightboxContent}>
        {item.kind === "video" ? (
          // Our controls rather than the platform's, so the lightbox looks the
          // same on every system it opens on. See `MediaPlayer`.
          <MediaPlayer className={styles.lightboxMedia} src={item.src} kind="video" label={item.alt} />
        ) : (
          <img className={styles.lightboxMedia} src={item.src} alt={item.alt} />
        )}
        <button type="button" className={styles.lightboxClose} onClick={onClose} aria-label="Close">
          <CloseIcon width={18} height={18} />
        </button>
        {senderName && (
          <div className={styles.lightboxCaption}>
            <span className={styles.lightboxSender}>{senderName}</span>
            {messageTimestamp != null && (
              <time className={styles.lightboxTime} dateTime={new Date(messageTimestamp).toISOString()}>
                {formatTimestamp(messageTimestamp, timeFormat, convertToLocalTime, systemUses24h)}
              </time>
            )}
          </div>
        )}
      </div>
      {menuAt && <ImageContextMenu src={item.src} link={link} at={menuAt} onClose={() => setMenuAt(null)} />}
    </div>
  );
}

// --- Main component -----------------------------------------------

export default function MediaPreview({
  html,
  messageId,
  compact = false,
  timestamp,
  timeFormat = "auto",
  convertToLocalTime = true,
  systemUses24h,
  senderName,
  messageTimestamp,
  onOpenLightbox,
  tile = false,
}: Readonly<Props>): ReactNode {
  // Memoised: extractMedia parses + sanitises the HTML, so re-running it on
  // every render (e.g. hover/timestamp state changes) wasted CPU per message.
  const { cleaned, media } = useMemo(() => extractMedia(html), [html]);
  // Handed to React as one object: a fresh literal makes it re-assign
  // `innerHTML` on every render, and the rebuilt text nodes take the
  // reader's selection with them.
  const cleanedHtml = useInnerHtml(cleaned);
  const { t } = useTranslation("chat");
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  /**
   * How many tiles a block shows before it stops.
   *
   * Nine photographs used to be nine tiles, which is most of a screen of
   * somebody else's afternoon between two lines of conversation. Four is a
   * block the eye takes in at once, and the ninth is one click away.
   */
  const [expanded, setExpanded] = useState(false);
  const capped = !tile && !expanded && media.length > GALLERY_TILE_CAP;
  const shown = capped ? media.slice(0, GALLERY_TILE_CAP) : media;
  const hidden = capped ? media.length - GALLERY_TILE_CAP : 0;
  const contentRef = useRef<HTMLSpanElement>(null);
  // Render (and lazy-load) KaTeX for any math in the mounted message body.
  useEffect(() => {
    if (contentRef.current) renderMathNodes(contentRef.current);
  }, [cleaned]);

  const openLightbox = (idx: number) => {
    const item = media[idx];
    if (onOpenLightbox && item) {
      onOpenLightbox(item.src);
    } else {
      setLightboxIdx(idx);
    }
  };
  const closeLightbox = () => setLightboxIdx(null);

  const timeLabel =
    timestamp == null ? null : formatTimestamp(timestamp, timeFormat, convertToLocalTime, systemUses24h);

  return (
    <>
      {/* Render remaining text (if any) */}
      {cleaned && (
        <ExternalLinkGuard>
          <span ref={contentRef} dangerouslySetInnerHTML={cleanedHtml} />
        </ExternalLinkGuard>
      )}

      {/* Media thumbnails. Two or more become a tiled gallery grid, four of
          them at most until the viewer asks for the rest. */}
      {media.length > 0 && (
        <div
          className={[
            compact ? styles.mediaGridCompact : styles.mediaGrid,
            tile ? styles.tileSingle : "",
            !tile && media.length >= 2 ? styles.gallery : "",
            !tile && shown.length === 3 ? styles.galleryCount3 : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {shown.map((item, i) => {
            const key = `${messageId}-${i}`;
            // A tile's frame is already decided - square in a gallery, square
            // in the grid - so only a lone thumbnail has a shape to hold open.
            const reserve = !tile && media.length < 2;
            // Show the timestamp chip only once per message: on the last tile
            // of a gallery (or the sole tile of a single-media message).
            const itemTimeLabel = i === shown.length - 1 ? timeLabel : undefined;
            const thumb = (() => {
              switch (item.kind) {
                case "gif":
                  return (
                    <GifThumb key={key} item={item} id={key} timeLabel={itemTimeLabel} reserve={reserve} />
                  );
                case "image":
                  return (
                    <ImageThumb
                      key={key}
                      id={key}
                      item={item}
                      onOpen={() => openLightbox(i)}
                      timeLabel={itemTimeLabel}
                      reserve={reserve}
                    />
                  );
                case "video":
                  return (
                    <VideoThumb
                      key={key}
                      id={key}
                      item={item}
                      onOpen={() => openLightbox(i)}
                      timeLabel={itemTimeLabel}
                      reserve={reserve}
                    />
                  );
              }
            })();
            // The last of a truncated block says how much it is standing in
            // for, and clicking it hands over the rest.
            if (hidden > 0 && i === shown.length - 1) {
              return (
                <div key={key} className={styles.overflowTile}>
                  {thumb}
                  <button
                    type="button"
                    className={styles.overflowScrim}
                    onClick={() => setExpanded(true)}
                    aria-label={t("media.showAll", { count: media.length })}
                  >
                    +{hidden}
                  </button>
                </div>
              );
            }
            return thumb;
          })}
        </div>
      )}

      {/* Lightbox - portalled to body to escape backdrop-filter containing blocks */}
      {!onOpenLightbox &&
        lightboxIdx !== null &&
        media[lightboxIdx] &&
        createPortal(
          <MediaLightbox
            item={media[lightboxIdx]}
            onClose={closeLightbox}
            senderName={senderName}
            messageTimestamp={messageTimestamp}
            timeFormat={timeFormat}
            convertToLocalTime={convertToLocalTime}
            systemUses24h={systemUses24h}
          />,
          document.body,
        )}
    </>
  );
}
