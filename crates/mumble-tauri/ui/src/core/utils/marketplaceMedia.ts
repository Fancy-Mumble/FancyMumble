// Shared helpers for rendering marketplace plugin imagery (icons,
// banners, gallery) consistently across the admin list (MarketplaceTab)
// and the detail page (PluginPage).

import { safeImageUrl } from "./safeUrl";

/** Marketplace API base used when no dev override is configured.  Its
 *  origin (without `/api/v1`) hosts the public web store and serves any
 *  relative image paths the API hands back. */
export const PROD_MARKETPLACE_BASE = "https://plugins.fancy-mumble.com/api/v1";

/** Deterministic gradient used as a banner / icon fallback when a plugin
 *  ships no banner_url / icon_url.  Mirrors the web store's bannerGradient
 *  so the same plugin gets the same colours in both UIs. */
export function bannerGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  hash = Math.abs(hash);
  const hue = hash % 360;
  const hue2 = (hue + 40 + (hash % 60)) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 45%) 0%, hsl(${hue2} 70% 35%) 100%)`;
}

/** Resolve a marketplace image URL to an absolute, safe src.  The API may
 *  return paths relative to the marketplace host (e.g. "/uploads/x.png");
 *  those resolve fine in the same-origin web store but not inside the
 *  Tauri webview, so anchor them to the API origin.  `baseUrl` is the
 *  active marketplace API base (null = production). */
export function resolveMarketplaceImage(
  url: string | null | undefined,
  baseUrl: string | null,
): string | null {
  if (!url) return null;
  const cleaned = url.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned) || cleaned.startsWith("//")) {
    return safeImageUrl(cleaned);
  }
  try {
    const origin = new URL(baseUrl || PROD_MARKETPLACE_BASE).origin;
    return safeImageUrl(origin + (cleaned.startsWith("/") ? cleaned : `/${cleaned}`));
  } catch {
    return null;
  }
}
