/**
 * URL helpers for the mumble-file-server plugin's HTTP surface.
 *
 * Kept out of `store.ts` so the main file is not cluttered with the
 * loopback / reverse-proxy URL plumbing.  Imports `useAppStore` lazily
 * (inside function bodies only) to avoid a hard dependency cycle with
 * the module that actually defines the store.
 */

import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store";
import type { FileServerCapabilities } from "../types";

/** Default port the mumble-file-server plugin binds to. */
export const DEFAULT_FILE_SERVER_PORT = 64739;

/** Build the file-server REST base URL.
 *
 *  Preference order:
 *  1. `serverConfig.fancy_rest_api_url` (server-side override, used when the
 *     HTTP interface is fronted by a reverse proxy / ingress on a different
 *     hostname than the Mumble TCP port).
 *  2. `http://<connect host>:64739` - the plugin's default loopback bind on
 *     the same hostname the user connected to. */
export function fileServerBaseUrl(): string | null {
  const state = useAppStore.getState();
  const override = state.serverConfig.fancy_rest_api_url;
  if (override && override.length > 0) return override.replace(/\/+$/, "");
  const pending = state.pendingConnect;
  if (!pending) return null;
  // Normalize "localhost" to the IPv4 loopback. On Windows, "localhost"
  // resolves to ::1 first, and Docker Desktop's IPv6 port forwarding is
  // unreliable for published ports - the request times out even though
  // `docker port` advertises both 0.0.0.0 and [::] mappings. Forcing
  // IPv4 here avoids the misleading "request failed" probe error during
  // local development.
  const host = pending.host === "localhost" ? "127.0.0.1" : pending.host;
  return `http://${host}:${DEFAULT_FILE_SERVER_PORT}`;
}

/** Rebase a URL returned by the file-server plugin so its origin matches
 *  the current server override URL (e.g. `https://files.mumble.magical.rocks`).
 *  The plugin embeds its own internal origin in download URLs; when the HTTP
 *  interface is fronted by a reverse proxy this origin is wrong for public
 *  access.  Only the scheme + host are replaced; path, query, and fragment
 *  are preserved unchanged.
 *
 *  Only rewrites URLs whose origin actually matches the file-server's
 *  known internal origin: other plugins are free to embed arbitrary URLs
 *  (e.g. `https://placehold.co/...`) and we must leave those alone.
 *  Returns the original URL unchanged when there is no file-server
 *  config, no rewrite target, the URL does not belong to the file server,
 *  or parsing fails. */
export function rebaseFileServerUrl(rawUrl: string): string {
  const internal = useAppStore.getState().fileServerConfig?.internalBaseUrl;
  if (!internal) return rawUrl;
  const target = fileServerBaseUrl();
  if (!target) return rawUrl;
  try {
    const u = new URL(rawUrl);
    const internalUrl = new URL(internal);
    if (u.protocol !== internalUrl.protocol || u.host !== internalUrl.host) {
      return rawUrl;
    }
    const o = new URL(target);
    u.protocol = o.protocol;
    u.hostname = o.hostname;
    u.port = o.port;
    return u.toString();
  } catch {
    return rawUrl;
  }
}

/** Probe `GET {baseUrl}/capabilities` and store the result in the Zustand
 *  store.  Called whenever `serverConfig` changes so the Capabilities tab
 *  and Custom-Emotes admin tab populate even when no `fancy-file-server-config`
 *  plugin-data arrives (e.g. when the file-server plugin is loaded but the
 *  user has no upload permissions, or the capabilities endpoint is reachable
 *  via reverse proxy while the per-session config message is suppressed). */
export async function probeFileServerCapabilities(): Promise<void> {
  const baseUrl = fileServerBaseUrl();
  if (!baseUrl) return;
  try {
    const body = await invoke<string>("fetch_file_server_capabilities", { baseUrl });
    const caps = JSON.parse(body) as FileServerCapabilities;
    useAppStore.setState({ fileServerCapabilities: caps });
  } catch (e) {
    console.warn("file-server capabilities probe failed:", e);
  }
}
