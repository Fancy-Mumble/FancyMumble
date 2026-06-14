/**
 * Defensive sanitiser for live-doc WebSocket URLs received from the
 * server.
 *
 * A misconfigured Fancy Mumble server (no `plugin.fancy-live-doc.public_url`
 * set) advertises its bind address verbatim - e.g. `ws://0.0.0.0:64740/...`.
 * Browsers and Tauri WebViews reject `0.0.0.0` / `::` as a destination
 * (`ERR_ADDRESS_INVALID`) so we substitute the host the Mumble TCP
 * session is actually connected to and preserve the port + path + query.
 */

const BIND_ALL_HOSTS = new Set<string>([
  "0.0.0.0",
  "::",
  "[::]",
  "0:0:0:0:0:0:0:0",
  "[0:0:0:0:0:0:0:0]",
]);

/**
 * Returns `rawWsUrl` unchanged when:
 * - the URL is malformed, or
 * - `fallbackHost` is empty / null, or
 * - the host is already a routable address.
 *
 * Otherwise rewrites the hostname to `fallbackHost` and logs a warning.
 */
export function sanitiseWsUrl(
  rawWsUrl: string,
  fallbackHost: string | null | undefined,
): string {
  if (!rawWsUrl) return rawWsUrl;
  let parsed: URL;
  try {
    parsed = new URL(rawWsUrl);
  } catch {
    return rawWsUrl;
  }
  if (!fallbackHost) return rawWsUrl;
  // URL.hostname strips IPv6 brackets, so `[::]` is reported as `::`.
  if (!BIND_ALL_HOSTS.has(parsed.hostname)) return rawWsUrl;
  const original = parsed.hostname;
  parsed.hostname = fallbackHost;
  console.warn(
    "[liveDoc] server advertised bind-all host",
    original,
    "- rewriting to",
    fallbackHost,
    "(set plugin.fancy-live-doc.public_url on the server to fix permanently)",
  );
  return parsed.toString();
}
