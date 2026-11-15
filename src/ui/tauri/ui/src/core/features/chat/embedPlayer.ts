import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Players that refuse to play without an http(s) referrer. */
const REFERRER_GATED = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\//;

/**
 * The address to frame a third-party player at.
 *
 * YouTube's embed shows "Error 153" when it is not asked for with an http(s)
 * referrer, and the app's pages live on `tauri://localhost`, which is not
 * one. So a YouTube player is framed from a page on the backend's loopback
 * origin instead, which does send one. Every other player is framed as it is.
 *
 * `undefined` while the address is being worked out, so the frame is not
 * first pointed at a player that would only show the error.
 */
export function useEmbedPlayerUrl(src: string | undefined): string | undefined {
  const gated = !!src && REFERRER_GATED.test(src);
  const [wrapped, setWrapped] = useState<{ src: string; url: string } | undefined>();

  useEffect(() => {
    if (!gated || !src) return;
    let live = true;
    invoke<string>("embed_player_url", { src })
      .then((url) => typeof url === "string" ? url : src)
      // Outside the app (a browser, a test) there is no backend; the page's
      // own origin is then an http one anyway.
      .catch(() => src)
      .then((url) => {
        if (live) setWrapped({ src, url });
      });
    return () => {
      live = false;
    };
  }, [gated, src]);

  if (!gated) return src;
  return wrapped?.src === src ? wrapped.url : undefined;
}
