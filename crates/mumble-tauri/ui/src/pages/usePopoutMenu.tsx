/**
 * Shared right-click menu + window-sizing helpers for popout windows
 * (image popout and stream popout).  Provides:
 *
 *  - "Fit to <Image|Stream>": shrink the window to the rendered media
 *    rect, removing letterbox bars without rescaling.
 *  - "Lock Aspect Ratio": persistent toggle (localStorage) that snaps
 *    the window to the media's intrinsic aspect ratio on every resize
 *    via the native `set_window_aspect_ratio` command.
 *  - "Close": close the popout window.
 *
 * The menu auto-clamps inside the window and closes on Escape (which
 * otherwise closes the window).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import styles from "./PopoutPage.module.css";

interface MenuPos { x: number; y: number; }

export interface PopoutMenuOptions {
  /** Ref to the rendered media element used for fit + aspect ratio. */
  readonly mediaRef: RefObject<HTMLImageElement | HTMLVideoElement | null>;
  /** True once the media has reported its intrinsic dimensions. */
  readonly mediaReady: boolean;
  /** Label suffix - "Image" or "Stream". */
  readonly mediaLabel: string;
  /** localStorage key for aspect-lock persistence. */
  readonly aspectStorageKey?: string;
}

/** Hook + JSX renderer for the popout right-click menu. */
export function usePopoutMenu({ mediaRef, mediaReady, mediaLabel, aspectStorageKey = "popout.aspectLocked" }: PopoutMenuOptions) {
  const [menu, setMenu] = useState<MenuPos | null>(null);
  const [aspectLocked, setAspectLocked] = useState<boolean>(() => {
    try { return localStorage.getItem(aspectStorageKey) === "1"; } catch { return false; }
  });
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenu(null), []);
  const close = useCallback(() => {
    getCurrentWindow().close().catch((e) => console.error("close failed", e));
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const fitToMedia = useCallback(() => {
    closeMenu();
    const m = mediaRef.current;
    if (!m) return;
    const rect = m.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    getCurrentWindow()
      .setSize(new LogicalSize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height))))
      .catch((e) => console.error("setSize failed", e));
  }, [mediaRef, closeMenu]);

  const toggleAspectLock = useCallback(() => {
    closeMenu();
    setAspectLocked((prev) => {
      const next = !prev;
      try { localStorage.setItem(aspectStorageKey, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, [closeMenu, aspectStorageKey]);

  // Clamp the menu inside the window after layout.
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 4;
    const maxX = window.innerWidth - rect.width - margin;
    const maxY = window.innerHeight - rect.height - margin;
    const x = Math.max(margin, Math.min(menu.x, maxX));
    const y = Math.max(margin, Math.min(menu.y, maxY));
    if (x !== menu.x || y !== menu.y) setMenu({ x, y });
  }, [menu]);

  // Escape closes the menu (or the window if no menu is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menu) closeMenu(); else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, closeMenu, close]);

  // Native aspect-ratio constraint via the OS resize loop.  See
  // PopoutPage.tsx for the full rationale.
  useEffect(() => {
    if (!mediaReady) return;
    const m = mediaRef.current;
    if (!m) return;
    const w = m instanceof HTMLVideoElement ? m.videoWidth : m.naturalWidth;
    const h = m instanceof HTMLVideoElement ? m.videoHeight : m.naturalHeight;
    const ratio = aspectLocked ? w / h : null;
    if (ratio !== null && (!Number.isFinite(ratio) || ratio <= 0)) return;
    invoke<boolean>("set_window_aspect_ratio", { ratio })
      .catch((e) => console.error("set_window_aspect_ratio failed", e));
    return () => {
      invoke<boolean>("set_window_aspect_ratio", { ratio: null })
        .catch((e) => console.error("set_window_aspect_ratio clear failed", e));
    };
  }, [aspectLocked, mediaReady, mediaRef]);

  const renderMenu = menu ? (
    <>
      <div
        className={styles.menuOverlay}
        onClick={closeMenu}
        onContextMenu={(e) => { e.preventDefault(); closeMenu(); }}
        role="presentation"
      />
      <div ref={menuRef} className={styles.menu} style={{ top: menu.y, left: menu.x }}>
        <button type="button" className={styles.menuItem} onClick={fitToMedia}>
          Fit to {mediaLabel}
        </button>
        <button
          type="button"
          className={styles.menuItem}
          onClick={toggleAspectLock}
          role="menuitemcheckbox"
          aria-checked={aspectLocked}
        >
          {aspectLocked ? "\u2713 " : ""}Lock Aspect Ratio
        </button>
        <button type="button" className={styles.menuItem} onClick={() => { closeMenu(); close(); }}>
          Close
        </button>
      </div>
    </>
  ) : null;

  return { onContextMenu, renderMenu, close };
}
