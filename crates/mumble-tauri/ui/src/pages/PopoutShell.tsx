/**
 * PopoutShell - shared chrome for both the image and stream popout windows.
 *
 * Encapsulates everything that is identical between the two:
 *  - Transparent body so the OS-level transparent window shows through.
 *  - Mouse-wheel-to-dim opacity (0.15 - 1.0).
 *  - Drag handle for moving the frameless window.
 *  - Frosted-glass info bar (sender, avatar, caption, timestamp).
 *  - Right-click context menu via {@link usePopoutMenu}
 *    (Fit, Lock Aspect Ratio, Close).
 *  - Auto-close on `server-disconnected`.
 *  - Error display.
 *
 * The caller supplies the actual media element (`<img>` or `<video>`)
 * and any extra overlays (e.g. drawing canvas) as `children`.
 */
import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import styles from "./PopoutPage.module.css";
import { usePopoutMenu } from "./usePopoutMenu";

interface InfoBarData {
  readonly name?: string | null;
  readonly avatar?: string | null;
  readonly caption?: string | null;
  readonly timestamp?: number | null;
}

interface PopoutShellProps {
  readonly mediaRef: RefObject<HTMLImageElement | HTMLVideoElement | null>;
  readonly mediaReady: boolean;
  readonly mediaLabel: string;
  readonly aspectStorageKey?: string;
  readonly error?: string | null;
  readonly placeholder?: ReactNode;
  readonly infoBar?: InfoBarData | null;
  readonly children: ReactNode;
}

const OPACITY_MIN = 0.15;
const OPACITY_MAX = 1;
const OPACITY_STEP = 0.05;

function formatTimestamp(ms: number | null | undefined): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function initialFor(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
}

export default function PopoutShell({
  mediaRef, mediaReady, mediaLabel, aspectStorageKey,
  error, placeholder, infoBar, children,
}: PopoutShellProps) {
  const { onContextMenu, renderMenu, close } = usePopoutMenu({
    mediaRef, mediaReady, mediaLabel, aspectStorageKey,
  });

  // Make the host page transparent so the OS-level transparent window
  // (configured via `.transparent(true)` in the Rust window builder)
  // actually shows the desktop behind us.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlBg = html.style.background;
    const prevBodyBg = body.style.background;
    html.style.background = "transparent";
    body.style.background = "transparent";
    return () => {
      html.style.background = prevHtmlBg;
      body.style.background = prevBodyBg;
    };
  }, []);

  // Mouse-wheel dims the window (does NOT auto-restore so the user can
  // park a faded popout on top of other content).
  const opacityRef = useRef(OPACITY_MAX);
  const applyOpacity = useCallback((value: number) => {
    const clamped = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, value));
    opacityRef.current = clamped;
    document.documentElement.style.opacity = String(clamped);
  }, []);
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -OPACITY_STEP : OPACITY_STEP;
      applyOpacity(opacityRef.current + delta);
    };
    globalThis.addEventListener("wheel", onWheel, { passive: false });
    return () => globalThis.removeEventListener("wheel", onWheel);
  }, [applyOpacity]);

  // Auto-close when the underlying server connection drops.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string | null>("server-disconnected", () => close())
      .then((u) => { unlisten = u; }).catch(() => {});
    return () => { unlisten?.(); };
  }, [close]);

  const timestamp = formatTimestamp(infoBar?.timestamp);
  const senderName = infoBar?.name ?? null;
  const caption = infoBar?.caption ?? null;
  const showInfoBar = !!(senderName || caption || timestamp);

  return (
    <div className={styles.popout} onContextMenu={onContextMenu} role="presentation">
      <div className={styles.dragHandle} data-tauri-drag-region />
      {error && <div className={styles.error}>{error}</div>}
      {!error && placeholder}
      {children}
      {showInfoBar && (
        <div className={styles.infoBar} data-tauri-drag-region>
          {infoBar?.avatar ? (
            <img className={styles.avatar} src={infoBar.avatar} alt="" draggable={false} />
          ) : (
            <div className={styles.avatarFallback} aria-hidden="true">
              {initialFor(senderName)}
            </div>
          )}
          <div className={styles.infoText}>
            <div className={styles.infoTopRow}>
              {senderName && <span className={styles.senderName}>{senderName}</span>}
              {timestamp && <span className={styles.timestamp}>{timestamp}</span>}
            </div>
            {caption && <div className={styles.caption}>{caption}</div>}
          </div>
        </div>
      )}
      {renderMenu}
    </div>
  );
}
