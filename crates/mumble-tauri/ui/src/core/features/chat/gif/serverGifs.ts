/**
 * serverGifs - asking the *server* to search, so the user needs no API key.
 *
 * The server holds one provider key for everybody, rate-limits it and caches
 * the answers. That is the path that works for the overwhelming majority of
 * users, who were never going to register with a GIF provider to be able to
 * send a reaction image.
 *
 * # Why this falls back at all
 *
 * A server that has not configured a key answers `unavailable`, and so does a
 * server too old to know the message. Either way a user who *did* set a
 * personal key should keep the picker they had, so `searchGifs` reports the
 * refusal and the caller decides.
 *
 * The one refusal that must **not** fall back is `throttled`. Falling back
 * there would use the user's own quota to route around the server's rate
 * limit, which is precisely the abuse the limit exists to prevent - so
 * `shouldFallBack` names the kinds rather than treating every failure alike.
 *
 * # Why it still wants the user's key
 *
 * The answers carry thumbnail *addresses* on the provider's CDN, not the
 * pictures, so drawing a page of results is the user's own machine asking
 * Klipy for two dozen images - with their IP address on every one. Until the
 * server sends thumbnails inline, as it does for link previews, a server search
 * is only made once the user has opted in to Klipy (see klipyConfig.ts).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { KLIPY_DISABLED_MESSAGE, klipyEnabled } from "./klipyConfig";

/** One result, as the server describes it. */
export interface ServerGif {
  id: string;
  title: string;
  /** Full size, for sending. */
  url: string;
  /** Grid size, for drawing the picker. */
  preview: string;
  /** Zero means the provider did not say. */
  width: number;
  height: number;
  preview_width: number;
  preview_height: number;
  mime: string;
}

interface GifPagePayload {
  request_id: string;
  results: ServerGif[];
  page: number;
  has_next: boolean;
  provider: string;
}

/** Why the server would not search. See the module docstring on fallback. */
export type RefusalKind = "unavailable" | "throttled" | "upstream" | "malformed";

interface GifRefusedPayload {
  request_id: string;
  reason: string;
  retry_after_ms: number;
  kind: RefusalKind;
}

/** A refusal, as an error the caller can branch on. */
export class GifRefusedError extends Error {
  readonly kind: RefusalKind;
  /** How long until asking again could work; 0 when waiting would not help. */
  readonly retryAfterMs: number;

  constructor(payload: GifRefusedPayload) {
    super(payload.reason || "the server would not search for GIFs");
    this.name = "GifRefusedError";
    this.kind = payload.kind;
    this.retryAfterMs = payload.retry_after_ms;
  }
}

/** One page of results. */
export interface ServerGifPage {
  items: ServerGif[];
  hasNext: boolean;
  /** Which provider answered, for attribution. */
  provider: string;
}

/**
 * How long to wait before concluding the server is never going to answer.
 *
 * A server that predates this feature does not refuse - it drops the frame,
 * because an unroutable type is silently discarded. So the timeout is not a
 * slow-network guard, it *is* the detection for an older server, and it is
 * treated exactly like `unavailable`.
 *
 * Generous, because the server may be making a real upstream call: eight
 * seconds is its own fetch timeout, plus room for the round trip.
 */
const ANSWER_TIMEOUT_MS = 12_000;

/** Requests still waiting for an answer, by correlation id. */
const pending = new Map<string, { resolve: (page: ServerGifPage) => void; reject: (error: Error) => void }>();

/** Whether the listeners are attached; they are, from the first search on. */
let listening: Promise<UnlistenFn[]> | null = null;

/**
 * What the server said last time, so a picker that opens on trending and then
 * searches does not pay a 12-second timeout per keystroke against a server
 * that has already said it does not do this.
 *
 * Reset on reconnect by {@link forgetServerGifSupport}, because the answer is
 * a property of the server, not of the client.
 */
let unavailable = false;

function attach(): Promise<UnlistenFn[]> {
  listening ??= Promise.all([
    listen<GifPagePayload>("gif-search-page", (event) => {
      const waiter = pending.get(event.payload.request_id);
      if (!waiter) return;
      pending.delete(event.payload.request_id);
      waiter.resolve({
        items: event.payload.results,
        hasNext: event.payload.has_next,
        provider: event.payload.provider,
      });
    }),
    listen<GifRefusedPayload>("gif-search-refused", (event) => {
      const waiter = pending.get(event.payload.request_id);
      if (!waiter) return;
      pending.delete(event.payload.request_id);
      if (event.payload.kind === "unavailable") unavailable = true;
      waiter.reject(new GifRefusedError(event.payload));
    }),
  ]);
  return listening;
}

/**
 * Forget whether this server does GIFs.
 *
 * Call on disconnect: the next server is a different server, and a cached
 * "no" would leave its perfectly good picker unused for the rest of the run.
 */
export function forgetServerGifSupport(): void {
  unavailable = false;
}

/** Whether the server has already said it cannot do this. */
export function serverGifsUnavailable(): boolean {
  return unavailable;
}

let counter = 0;

/**
 * Ask the server for one page. Empty `query` asks for trending.
 *
 * @throws {GifRefusedError} when the server declines. `kind` says whether
 * falling back to a personal API key is appropriate - use
 * {@link shouldFallBack} rather than deciding at each call site.
 */
export async function searchServerGifs(query: string, page = 1): Promise<ServerGifPage> {
  // A plain error, not a refusal: nothing should fall back to anything.
  if (!klipyEnabled()) throw new Error(KLIPY_DISABLED_MESSAGE);
  if (unavailable) {
    throw new GifRefusedError({
      request_id: "",
      reason: "this server has no GIF provider configured",
      retry_after_ms: 0,
      kind: "unavailable",
    });
  }
  await attach();

  counter += 1;
  const requestId = `gif-${Date.now().toString(36)}-${counter}`;
  return await new Promise<ServerGifPage>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.delete(requestId)) return;
      // Nothing came back at all, which is what an older server looks like:
      // it cannot read the message and drops it without a word. Remembered,
      // so this is paid once rather than per keystroke.
      unavailable = true;
      reject(
        new GifRefusedError({
          request_id: requestId,
          reason: "the server did not answer the GIF search",
          retry_after_ms: 0,
          kind: "unavailable",
        }),
      );
    }, ANSWER_TIMEOUT_MS);

    const settle = {
      resolve: (value: ServerGifPage) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error: Error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    pending.set(requestId, settle);

    invoke("request_gif_search", { query, page, requestId }).catch((error: unknown) => {
      if (!pending.delete(requestId)) return;
      // Not connected, or the command is missing: both mean this client cannot
      // use the server path right now, and a personal key still can.
      settle.reject(
        new GifRefusedError({
          request_id: requestId,
          reason: String(error),
          retry_after_ms: 0,
          kind: "unavailable",
        }),
      );
    });
  });
}

/**
 * Whether a failed server search should be retried with the user's own key.
 *
 * Only for "this server does not do this". A throttle must not be routed
 * around, and an upstream failure or a malformed query would fail the same way
 * against the same provider - so retrying either is a slower way to show the
 * same error, with the user's quota spent on it.
 */
export function shouldFallBack(error: unknown): boolean {
  return error instanceof GifRefusedError && error.kind === "unavailable";
}
