import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { CloseIcon, ChevronLeftIcon, ChevronRightIcon } from "../../icons";
import type { ChatMessage, TimeFormat } from "@core/types";
import { extractOffloadInfo, offloadManager, type MessageScope } from "@core/messageOffload";
import { extractMedia } from "../chat/media/MediaPreview";
import { formatTimestamp } from "@core/utils/format";
import { ImageContextMenu } from "./ImageContextMenu";
import styles from "./Lightbox.module.css";

const SWIPE_THRESHOLD = 50;
const DISMISS_THRESHOLD = 120;

interface MediaItem {
  src: string;
  kind: "image" | "gif" | "video";
  alt: string;
  senderName: string;
  timestamp: number;
  offloadedMessageId?: string;
  offloadedMediaIndex?: number;
}

/**
 * One picture in a gallery this component did not build from messages.
 *
 * Everything but the address is optional, because the callers that hand one
 * over are looking at something that is not a message yet - a file staged in
 * the composer has a name and nothing else to say about who sent it or when.
 */
export interface LightboxGalleryItem {
  readonly src: string;
  readonly kind?: "image" | "gif" | "video";
  readonly alt?: string;
  /** Drawn where a message's sender would be, e.g. the file's own name. */
  readonly caption?: string;
  readonly timestamp?: number;
}

export interface LightboxHandle {
  open: (src: string) => void;
  /**
   * Open on a gallery of the caller's own, rather than on the conversation.
   *
   * The gallery built from `allMessages` only knows about pictures that have
   * been sent, so a caller showing something else - the composer's staged
   * files - hands over its own list and the one to start on. The overlay is
   * otherwise the same, and closing it returns the lightbox to the
   * conversation's own gallery.
   */
  openGallery: (items: readonly LightboxGalleryItem[], index: number) => void;
}

export interface LightboxProps {
  readonly allMessages: readonly ChatMessage[];
  readonly selectedChannel: number | null;
  readonly selectedDmUser: number | null;
  readonly currentScope: () => MessageScope | null;
  readonly timeFormat?: TimeFormat;
  readonly convertToLocalTime?: boolean;
  readonly systemUses24h?: boolean;
}

/**
 * A media URL reduced to the form the browser would load it as.
 *
 * Only ever used to compare two spellings of one picture, so a `data:` URI -
 * which `URL` will happily parse and which can be megabytes long - is returned
 * untouched, and anything unparseable falls back to itself.
 */
function resolveSrc(src: string): string {
  if (src.startsWith("data:")) return src;
  try {
    return new URL(src, document.baseURI).href;
  } catch {
    return src;
  }
}

function getItemDisplaySrc(item: MediaItem, resolved: Map<string, string>): string {
  if (item.offloadedMessageId) {
    const key = `${item.offloadedMessageId}:${item.offloadedMediaIndex ?? 0}`;
    return resolved.get(key) ?? item.src;
  }
  return item.src;
}

// -- Overlay rendering (internal) -----------------------------------

interface OverlayProps {
  readonly items: MediaItem[];
  readonly activeIndex: number;
  readonly onClose: () => void;
  readonly onNavigate: (index: number) => void;
  readonly onLoadOffloaded?: (messageId: string, mediaIndex: number) => Promise<string | null>;
  readonly timeFormat: TimeFormat;
  readonly convertToLocalTime: boolean;
  readonly systemUses24h?: boolean;
}

function LightboxOverlay({
  items,
  activeIndex,
  onClose,
  onNavigate,
  onLoadOffloaded,
  timeFormat,
  convertToLocalTime,
  systemUses24h,
}: OverlayProps): ReactNode {
  const { t } = useTranslation("common");
  const item = items[activeIndex];
  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex < items.length - 1;

  const [resolvedSrcs, setResolvedSrcs] = useState<Map<string, string>>(new Map());
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  /** Where the reader right-clicked the picture, while the menu is up. */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  const offloadKey = item?.offloadedMessageId
    ? `${item.offloadedMessageId}:${item.offloadedMediaIndex ?? 0}`
    : null;
  const isOffloaded = !!offloadKey && !item.src;
  const resolvedSrc = offloadKey ? (resolvedSrcs.get(offloadKey) ?? "") : (item?.src ?? "");
  const isLoading = isOffloaded && !resolvedSrc && loadingKey === offloadKey;
  const needsLoad = isOffloaded && !resolvedSrc && loadingKey !== offloadKey;

  useEffect(() => {
    if (!needsLoad || !item?.offloadedMessageId || !onLoadOffloaded) return;
    const key = `${item.offloadedMessageId}:${item.offloadedMediaIndex ?? 0}`;
    setLoadingKey(key);
    onLoadOffloaded(item.offloadedMessageId, item.offloadedMediaIndex ?? 0)
      .then((src) => {
        if (src) setResolvedSrcs((prev) => new Map(prev).set(key, src));
      })
      .finally(() => setLoadingKey((cur) => (cur === key ? null : cur)));
  }, [needsLoad, item?.offloadedMessageId, item?.offloadedMediaIndex, onLoadOffloaded]);

  const displaySrc = resolvedSrc || item?.src || "";

  const goPrev = useCallback(() => {
    if (activeIndex > 0) onNavigate(activeIndex - 1);
  }, [activeIndex, onNavigate]);

  const goNext = useCallback(() => {
    if (activeIndex < items.length - 1) onNavigate(activeIndex + 1);
  }, [activeIndex, items.length, onNavigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onClose, goPrev, goNext]);

  // -- Zoom & Pan --
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isZoomTransition, setIsZoomTransition] = useState(false);
  const zoomRef = useRef(1);
  const panOffsetRef = useRef({ x: 0, y: 0 });

  const updateZoom = useCallback((z: number) => {
    zoomRef.current = z;
    setZoom(z);
  }, []);

  const updatePan = useCallback((p: { x: number; y: number }) => {
    panOffsetRef.current = p;
    setPanOffset(p);
  }, []);

  const resetZoom = useCallback(
    (animated = false) => {
      updateZoom(1);
      updatePan({ x: 0, y: 0 });
      if (animated) {
        setIsZoomTransition(true);
        setTimeout(() => setIsZoomTransition(false), 250);
      }
    },
    [updateZoom, updatePan],
  );

  useEffect(() => {
    resetZoom();
  }, [activeIndex, resetZoom]);

  // The menu belongs to the picture it was opened on, not to the lightbox:
  // swiping or arrowing to the next one leaves it behind.
  useEffect(() => setMenuAt(null), [activeIndex]);

  // -- Touch gesture tracking --
  const overlayRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const lockedAxis = useRef<"h" | "v" | null>(null);
  const gestureMode = useRef<"none" | "swipe" | "pan" | "pinch" | "dismiss">("none");
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(1);
  const panStart = useRef({ x: 0, y: 0 });
  const panBase = useRef({ x: 0, y: 0 });
  const lastTapTime = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSnapping, setIsSnapping] = useState(false);
  const [dismissOffset, setDismissOffset] = useState(0);
  const [isDismissSnapping, setIsDismissSnapping] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      gestureMode.current = "pinch";
      lockedAxis.current = null;
      setSwipeOffset(0);
      setIsSnapping(false);
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      );
      pinchStartDist.current = dist;
      pinchStartZoom.current = zoomRef.current;
      return;
    }

    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;

    if (zoomRef.current > 1.05) {
      gestureMode.current = "pan";
      panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panBase.current = { ...panOffsetRef.current };
    } else {
      gestureMode.current = "swipe";
      lockedAxis.current = null;
      setIsSnapping(false);
      setSwipeOffset(0);
      setDismissOffset(0);
      setIsDismissSnapping(false);
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (gestureMode.current === "pinch" && e.touches.length >= 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY,
        );
        const newZoom = (dist / pinchStartDist.current) * pinchStartZoom.current;
        updateZoom(Math.max(0.5, Math.min(5, newZoom)));
        return;
      }

      if (gestureMode.current === "pan") {
        e.preventDefault();
        const dx = e.touches[0].clientX - panStart.current.x;
        const dy = e.touches[0].clientY - panStart.current.y;
        updatePan({ x: panBase.current.x + dx, y: panBase.current.y + dy });
        return;
      }

      if (gestureMode.current === "swipe") {
        if (touchStartX.current === null || touchStartY.current === null) return;
        const dx = e.touches[0].clientX - touchStartX.current;
        const dy = e.touches[0].clientY - touchStartY.current;
        if (!lockedAxis.current && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
          lockedAxis.current = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
          if (lockedAxis.current === "v") {
            gestureMode.current = "dismiss";
          }
        }
        if (lockedAxis.current === "h") {
          let offset = dx;
          if ((dx > 0 && !hasPrev) || (dx < 0 && !hasNext)) offset = dx * 0.3;
          setSwipeOffset(offset);
        }
      }

      if (gestureMode.current === "dismiss") {
        if (touchStartY.current === null) return;
        const dy = e.touches[0].clientY - touchStartY.current;
        setDismissOffset(dy);
      }
    },
    [hasPrev, hasNext, updateZoom, updatePan],
  );

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", handleTouchMove);
  }, [handleTouchMove]);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const mode = gestureMode.current;

      if (mode === "pinch") {
        if (e.touches.length > 0 && zoomRef.current > 1.05) {
          gestureMode.current = "pan";
          panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          panBase.current = { ...panOffsetRef.current };
          return;
        }
        gestureMode.current = "none";
        if (zoomRef.current < 1.1) resetZoom(true);
        return;
      }

      if (touchStartX.current !== null && touchStartY.current !== null) {
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        const dy = e.changedTouches[0].clientY - touchStartY.current;
        const target = e.target as HTMLElement;
        const isOnMedia = !!target.closest("img, video");

        if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && isOnMedia) {
          const now = Date.now();
          if (now - lastTapTime.current < 300) {
            lastTapTime.current = 0;
            gestureMode.current = "none";
            touchStartX.current = null;
            touchStartY.current = null;
            setIsZoomTransition(true);
            if (zoomRef.current > 1.05) {
              resetZoom(true);
            } else {
              updateZoom(2.5);
              updatePan({ x: 0, y: 0 });
              setTimeout(() => setIsZoomTransition(false), 250);
            }
            return;
          }
          lastTapTime.current = now;
        }
      }

      if (mode === "dismiss") {
        if (touchStartY.current === null) {
          gestureMode.current = "none";
          return;
        }
        const dy = e.changedTouches[0].clientY - touchStartY.current;
        touchStartX.current = null;
        touchStartY.current = null;
        gestureMode.current = "none";

        if (Math.abs(dy) > DISMISS_THRESHOLD) {
          setIsDismissing(true);
          setIsDismissSnapping(true);
          setDismissOffset(dy < 0 ? -globalThis.innerHeight : globalThis.innerHeight);
          setTimeout(onClose, 200);
        } else {
          setIsDismissSnapping(true);
          setDismissOffset(0);
          setTimeout(() => setIsDismissSnapping(false), 200);
        }
        return;
      }

      if (mode === "pan") {
        gestureMode.current = "none";
        touchStartX.current = null;
        touchStartY.current = null;
        return;
      }

      if (mode === "swipe") {
        if (touchStartX.current === null || touchStartY.current === null) {
          gestureMode.current = "none";
          return;
        }
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        touchStartX.current = null;
        touchStartY.current = null;

        if (lockedAxis.current !== "h") {
          lockedAxis.current = null;
          setSwipeOffset(0);
          setDismissOffset(0);
          gestureMode.current = "none";
          return;
        }
        lockedAxis.current = null;

        const canNavigate = dx < 0 ? hasNext : hasPrev;
        if (Math.abs(dx) > SWIPE_THRESHOLD && canNavigate) {
          setIsSnapping(true);
          setSwipeOffset(dx < 0 ? -globalThis.innerWidth : globalThis.innerWidth);
          setTimeout(() => {
            if (dx < 0) goNext();
            else goPrev();
            setSwipeOffset(0);
            setIsSnapping(false);
          }, 200);
        } else {
          setIsSnapping(true);
          setSwipeOffset(0);
          setTimeout(() => setIsSnapping(false), 200);
        }
      }
      gestureMode.current = "none";
    },
    [goNext, goPrev, hasPrev, hasNext, resetZoom, updateZoom, updatePan, onClose],
  );

  if (!item) return null;

  const prevItem = hasPrev ? items[activeIndex - 1] : null;
  const nextItem = hasNext ? items[activeIndex + 1] : null;
  const prevSrc = prevItem ? getItemDisplaySrc(prevItem, resolvedSrcs) : "";
  const nextSrc = nextItem ? getItemDisplaySrc(nextItem, resolvedSrcs) : "";

  const trackStyle: React.CSSProperties = {
    transform: `translateX(calc(-100vw + ${swipeOffset}px))`,
    transition: isSnapping ? "transform 0.2s ease-out" : "none",
    willChange: swipeOffset !== 0 || isSnapping ? "transform" : undefined,
  };

  const zoomStyle: React.CSSProperties =
    zoom !== 1 || isZoomTransition
      ? {
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          transition: isZoomTransition ? "transform 0.25s ease-out" : "none",
          willChange: "transform",
        }
      : {};

  const dismissProgress = Math.min(1, Math.abs(dismissOffset) / 300);
  const overlayOpacity = isDismissing ? 0 : 1 - dismissProgress * 0.6;

  const dismissStyle: React.CSSProperties =
    dismissOffset !== 0 || isDismissSnapping
      ? {
          transform: `translateY(${dismissOffset}px) scale(${1 - dismissProgress * 0.1})`,
          transition: isDismissSnapping ? "transform 0.2s ease-out" : "none",
          willChange: "transform",
        }
      : {};

  const overlayStyle: React.CSSProperties = {
    background: `rgba(0, 0, 0, ${0.8 * overlayOpacity})`,
    ...(isDismissing ? { transition: "background 0.2s ease-out" } : {}),
  };

  return createPortal(
    <div
      ref={overlayRef}
      className={styles.overlay}
      role="dialog"
      aria-label={t("lightbox.ariaLabel")}
      style={overlayStyle}
      onClick={(e) => {
        // While the menu is up, the next click anywhere is about the menu:
        // dismissing it should not also close the picture behind it.
        if (menuAt) {
          setMenuAt(null);
          return;
        }
        const t = e.target as HTMLElement;
        if (!t.closest("img, video, button") && zoomRef.current <= 1.05) onClose();
      }}
      /* Right-click on the picture itself opens the picture's own menu. Only
         on the picture: the rest of the overlay is empty space, and a menu of
         things to do with a photograph is not what a right-click on empty
         space asked for. A video has no "copy image" to offer, so it keeps
         the platform's own menu and its playback rows. */
      onContextMenu={(e) => {
        // A clip keeps the platform's menu: playback speed and "save video as"
        // are rows this one has no answer for.
        if (item.kind === "video") return;
        // Everything else on the overlay is ours, including the dark space
        // around the picture - so the webview's Back / Refresh / Inspect menu
        // never comes up over a photograph, whether or not a menu follows.
        e.preventDefault();
        setMenuAt((e.target as HTMLElement).closest("img") ? { x: e.clientX, y: e.clientY } : null);
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <button
        type="button"
        className={styles.close}
        onClick={onClose}
        aria-label={t("lightbox.closeAriaLabel")}
      >
        <CloseIcon width={18} height={18} />
      </button>

      <div className={styles.carousel} style={dismissStyle}>
        <div className={styles.track} style={trackStyle}>
          <div className={styles.slide}>
            {prevItem &&
              prevSrc &&
              (prevItem.kind === "video" ? (
                <video className={styles.media} src={prevSrc}>
                  <track kind="captions" />
                </video>
              ) : (
                <img className={styles.media} src={prevSrc} alt={prevItem.alt} draggable={false} />
              ))}
          </div>

          <div className={styles.slide}>
            <div className={styles.zoomContainer} style={zoomStyle}>
              {isLoading || (isOffloaded && !displaySrc) ? (
                <div className={styles.loadingPlaceholder}>
                  <div className={styles.spinner} />
                  <span className={styles.loadingLabel}>{t("lightbox.loading")}</span>
                </div>
              ) : item.kind === "video" ? (
                <video className={styles.media} src={displaySrc} controls autoPlay>
                  <track kind="captions" />
                </video>
              ) : (
                <img className={styles.media} src={displaySrc} alt={item.alt} draggable={false} />
              )}
            </div>
          </div>

          <div className={styles.slide}>
            {nextItem &&
              nextSrc &&
              (nextItem.kind === "video" ? (
                <video className={styles.media} src={nextSrc}>
                  <track kind="captions" />
                </video>
              ) : (
                <img className={styles.media} src={nextSrc} alt={nextItem.alt} draggable={false} />
              ))}
          </div>
        </div>
      </div>

      {hasPrev && (
        <button
          type="button"
          className={`${styles.arrow} ${styles.arrowPrev}`}
          onClick={goPrev}
          aria-label={t("lightbox.prevAriaLabel")}
        >
          <ChevronLeftIcon width={28} height={28} />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          className={`${styles.arrow} ${styles.arrowNext}`}
          onClick={goNext}
          aria-label={t("lightbox.nextAriaLabel")}
        >
          <ChevronRightIcon width={28} height={28} />
        </button>
      )}

      <div className={styles.caption} style={dismissStyle}>
        {items.length > 1 && (
          <span className={styles.counter}>
            {t("lightbox.counter", { n: activeIndex + 1, total: items.length })}
          </span>
        )}
        <div className={styles.senderRow}>
          <span className={styles.sender}>{item.senderName}</span>
          <time className={styles.time} dateTime={new Date(item.timestamp).toISOString()}>
            {formatTimestamp(item.timestamp, timeFormat, convertToLocalTime, systemUses24h)}
          </time>
        </div>
      </div>

      {/* A child of the overlay rather than a portal of its own: the overlay
          is what blurs everything behind it, and only something drawn inside
          it comes out on top of that. */}
      {menuAt && displaySrc && (
        <ImageContextMenu
          src={displaySrc}
          at={menuAt}
          onClose={() => setMenuAt(null)}
          onPopOut={() => {
            void invoke("open_image_popout", {
              payload: {
                src: displaySrc,
                sender_name: item.senderName || null,
                // The lightbox never fetched an avatar; the popout draws the
                // name on its own where there is none.
                sender_avatar: null,
                caption: item.alt || null,
                timestamp_ms: item.timestamp,
              },
            }).catch(() => undefined);
          }}
        />
      )}
    </div>,
    document.body,
  );
}

// -- Public Lightbox component --------------------------------------

export const Lightbox = forwardRef<LightboxHandle, LightboxProps>(function Lightbox(
  {
    allMessages,
    selectedChannel,
    selectedDmUser,
    currentScope,
    timeFormat = "auto",
    convertToLocalTime = true,
    systemUses24h,
  },
  ref,
) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  /** A gallery handed in by a caller, while one is open; else the conversation's. */
  const [ownGallery, setOwnGallery] = useState<MediaItem[] | null>(null);

  const mediaCacheRef = useRef<Map<string, Omit<MediaItem, "src">[]>>(new Map());

  const allMedia = useMemo<MediaItem[]>(() => {
    const result: MediaItem[] = [];
    const cache = mediaCacheRef.current;
    for (const msg of allMessages) {
      const id = msg.message_id;
      const offloaded = extractOffloadInfo(msg.body) !== null;

      if (offloaded && id) {
        const cachedItems = cache.get(id);
        if (cachedItems) {
          for (const [i, cachedItem] of cachedItems.entries()) {
            result.push({
              ...cachedItem,
              src: "",
              offloadedMessageId: id,
              offloadedMediaIndex: i,
            });
          }
          continue;
        }
      }

      const { media } = extractMedia(msg.body);
      const ts = msg.timestamp ?? Date.now();
      const stubs: Omit<MediaItem, "src">[] = [];
      for (const item of media) {
        result.push({
          src: item.src,
          kind: item.kind,
          alt: item.alt,
          senderName: msg.sender_name,
          timestamp: ts,
        });
        stubs.push({
          kind: item.kind,
          alt: item.alt,
          senderName: msg.sender_name,
          timestamp: ts,
        });
      }

      if (id && stubs.length > 0) cache.set(id, stubs);
    }
    return result;
  }, [allMessages]);

  const items = ownGallery ?? allMedia;

  const handleOpenLightbox = useCallback(
    (src: string) => {
      setOwnGallery(null);
      const exact = allMedia.findIndex((m) => m.src === src);
      if (exact >= 0) {
        setLightboxIndex(exact);
        return;
      }
      // A caller that read the src off a live `<img>` hands over the URL the
      // browser resolved, which is not always the string the gallery was built
      // from: a relative path, a bare host and a space in a filename all come
      // back changed. Comparing what both sides resolve to is the difference
      // between opening the picture and the click appearing to do nothing.
      const wanted = resolveSrc(src);
      const idx = allMedia.findIndex((m) => !!m.src && resolveSrc(m.src) === wanted);
      if (idx >= 0) setLightboxIndex(idx);
    },
    [allMedia],
  );

  const handleLoadOffloaded = useCallback(
    async (messageId: string, mediaIndex: number): Promise<string | null> => {
      const scope = currentScope();
      if (!scope) return null;
      const results = await offloadManager.restoreMany([messageId], scope);
      const body = results[messageId];
      if (!body) return null;
      const { media } = extractMedia(body);
      return media[mediaIndex]?.src ?? null;
    },
    [currentScope],
  );

  const handleOpenGallery = useCallback((gallery: readonly LightboxGalleryItem[], index: number) => {
    if (gallery.length === 0 || index < 0 || index >= gallery.length) return;
    setOwnGallery(
      gallery.map((item) => ({
        src: item.src,
        kind: item.kind ?? "image",
        alt: item.alt ?? "",
        senderName: item.caption ?? "",
        timestamp: item.timestamp ?? Date.now(),
      })),
    );
    setLightboxIndex(index);
  }, []);

  const handleNavigate = useCallback((idx: number) => setLightboxIndex(idx), []);
  const handleClose = useCallback(() => {
    setLightboxIndex(null);
    setOwnGallery(null);
  }, []);

  // Close when switching conversations.
  useEffect(() => {
    setLightboxIndex(null);
    setOwnGallery(null);
  }, [selectedChannel, selectedDmUser]);

  useImperativeHandle(
    ref,
    () => ({ open: handleOpenLightbox, openGallery: handleOpenGallery }),
    [handleOpenLightbox, handleOpenGallery],
  );

  if (lightboxIndex === null || !items[lightboxIndex]) return null;

  return (
    <LightboxOverlay
      items={items}
      activeIndex={lightboxIndex}
      onClose={handleClose}
      onNavigate={handleNavigate}
      onLoadOffloaded={handleLoadOffloaded}
      timeFormat={timeFormat}
      convertToLocalTime={convertToLocalTime}
      systemUses24h={systemUses24h}
    />
  );
});
