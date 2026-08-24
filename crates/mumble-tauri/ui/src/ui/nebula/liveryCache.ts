/**
 * The last livery each server sent, kept on disk so its connect page paints
 * before the user commits to a connection.
 *
 * A livery document only ever arrives over an established connection: the
 * client asks with `FancyLiveryQuery` after sync and the server answers with
 * `LiveryDoc`. The UDP ping cannot carry it - it carries an eight-byte digest
 * of it, and that is the whole point. So the connect screen for a server the
 * user is merely looking at has exactly two honest options: draw nothing, or
 * draw what that server said last time and let the digest say whether it still
 * holds. This is the second.
 *
 * # Keyed by address, and only by address
 *
 * The key is `host:port`, the same key the sidebar groups saved logins under.
 * Not the saved-server id, because several identities share one server and each
 * would otherwise cache its own copy; and never a session id, which is minted
 * per connection and gone by the time this is read.
 *
 * # What a cached document is trusted for
 *
 * Nothing it was not already trusted for. Artwork was turned into `data:` URIs
 * by the Rust side from bytes it received on a connection the client made, so a
 * stored document still holds no URL a viewer fetches and still cannot beacon.
 * Colour is re-clamped on every render by `liveryTokens`, not stored pre-folded,
 * so a cache written under one theme cannot smuggle an unreadable palette into
 * another.
 */
import { load } from "@core/utils/store";
import type { ServerLivery } from "./livery";

const STORE_FILE = "livery.json";
const KEY = "livery";

/**
 * A document and the digest that was current when it was stored.
 *
 * The digest is what makes the entry checkable: a ping answers with the
 * server's current one, and only an exact match licenses drawing this.
 */
export interface CachedLivery {
  /** Lowercase hex, as both the document and the ping spell it. */
  digest: string;
  livery: ServerLivery;
  /** Epoch millis, for a human reading the file and for future ageing. */
  savedAt: number;
}

type CacheMap = Record<string, CachedLivery>;

/**
 * A cap on one entry, in characters of JSON.
 *
 * Artwork rides along as base64, so a server with a large banner would
 * otherwise put megabytes into a settings file that is read whole on every
 * connect screen. A document too big to store simply is not stored: the page
 * then reports `missing` and paints unbranded, which is the same answer it
 * gives before a server has ever been visited.
 */
const MAX_ENTRY_CHARS = 1_500_000;

/** The address key. Lowercased, because a hostname is not case-sensitive. */
export function liveryKey(host: string, port: number): string {
  return `${host}:${port}`.toLocaleLowerCase();
}

/** Outside the webview there is no store plugin and nothing to read. */
function inWebview(): boolean {
  return "__TAURI_INTERNALS__" in globalThis;
}

async function readAll(): Promise<CacheMap> {
  if (!inWebview()) return {};
  try {
    const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
    return (await store.get<CacheMap>(KEY)) ?? {};
  } catch {
    // A cache is an optimisation. Losing one costs a banner, so no caller has
    // to handle a failure to read it.
    return {};
  }
}

/** What this address said last time, or null. */
export async function readCachedLivery(host: string, port: number): Promise<CachedLivery | null> {
  return (await readAll())[liveryKey(host, port)] ?? null;
}

/**
 * Store what a server just sent, under the address it was sent from.
 *
 * A document with no digest is dropped rather than stored: without one there is
 * nothing a later ping could check it against, and an entry that can never be
 * validated would either be drawn on faith or never drawn at all.
 */
export async function writeCachedLivery(
  host: string,
  port: number,
  livery: ServerLivery,
): Promise<void> {
  if (!inWebview() || !livery.digest) return;
  const entry: CachedLivery = { digest: livery.digest, livery, savedAt: Date.now() };
  if (JSON.stringify(entry).length > MAX_ENTRY_CHARS) return;
  try {
    const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
    const all = (await store.get<CacheMap>(KEY)) ?? {};
    await store.set(KEY, { ...all, [liveryKey(host, port)]: entry });
  } catch {
    /* see readAll: a cache that cannot be written is not an error */
  }
}

/**
 * Forget this address's document.
 *
 * Called when a server answers a ping with an empty digest, which is a Fancy
 * server saying it has no livery - a different statement from the silence of a
 * server that does not speak Fancy at all, and the one that has to clear a
 * cache. Otherwise branding an operator deliberately removed would outlive the
 * removal on every client that had already seen it.
 */
export async function forgetCachedLivery(host: string, port: number): Promise<void> {
  if (!inWebview()) return;
  try {
    const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
    const all = (await store.get<CacheMap>(KEY)) ?? {};
    const key = liveryKey(host, port);
    if (!(key in all)) return;
    const next = { ...all };
    delete next[key];
    await store.set(KEY, next);
  } catch {
    /* see readAll */
  }
}
