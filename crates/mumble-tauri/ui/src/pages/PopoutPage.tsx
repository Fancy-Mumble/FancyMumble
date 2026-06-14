/**
 * PopoutPage - dedicated route rendered inside a frameless,
 * always-on-top webview window spawned by `open_image_popout`.
 *
 * Lifecycle:
 *  1. Read this window's Tauri label (`popout-<id>`) to recover the id.
 *  2. Invoke `take_popout_image` to retrieve and consume the payload
 *     (image src + sender metadata).
 *  3. Render via {@link PopoutShell} (handles all chrome, menu, dim,
 *     transparent body, server-disconnect close).
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import styles from "./PopoutPage.module.css";
import PopoutShell from "./PopoutShell";

interface PopoutImagePayload {
  src: string;
  sender_name?: string | null;
  sender_avatar?: string | null;
  caption?: string | null;
  timestamp_ms?: number | null;
}

function popoutIdFromLabel(): string | null {
  try {
    const label = getCurrentWindow().label;
    if (label.startsWith("popout-")) return label.slice("popout-".length);
  } catch {
    // not running inside a Tauri window (dev mode)
  }
  return new URLSearchParams(globalThis.location.search).get("popout");
}

export default function PopoutPage() {
  const [payload, setPayload] = useState<PopoutImagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const { t } = useTranslation("common");
  // React 19 StrictMode double-invokes effects in dev; the registry
  // entry is single-use, so guard against the second invocation.
  const fetchedRef = useRef(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const id = popoutIdFromLabel();
    if (!id) {
      setError(t("pages.popout.missingId"));
      return;
    }
    invoke<PopoutImagePayload | null>("take_popout_image", { id })
      .then((result) => {
        if (result) setPayload(result);
        else setError(t("pages.popout.imageUnavailable"));
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <PopoutShell
      mediaRef={imageRef}
      mediaReady={imageLoaded}
      mediaLabel={t("pages.popout.mediaLabel")}
      error={error}
      infoBar={payload ? {
        name: payload.sender_name,
        avatar: payload.sender_avatar,
        caption: payload.caption,
        timestamp: payload.timestamp_ms,
      } : null}
    >
      {payload && (
        <img
          ref={imageRef}
          src={payload.src}
          alt=""
          className={styles.image}
          draggable={false}
          data-tauri-drag-region
          onLoad={() => setImageLoaded(true)}
        />
      )}
    </PopoutShell>
  );
}
