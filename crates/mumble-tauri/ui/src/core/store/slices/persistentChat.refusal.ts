/**
 * A refused page of persistent-chat history, and what the view does about it.
 *
 * The server answers a page it will not serve with `pchat-fetch-refused`
 * instead of nothing. That is not the end of the archive: a rate-limited page
 * is asked for again once, after the delay the server named; any other refusal
 * is shown beside the history with a way to ask again. The backend cannot do
 * the asking - only the view knows which page it wanted - so the request is
 * remembered here when it is made.
 */

import type { AppState } from "..";

/** Why the server refused a page, as the backend names it. */
export type HistoryRefusalKind = "rate_limited" | "permission" | "limit" | "invalid" | "other";

/** The `pchat-fetch-refused` payload. */
export interface PchatFetchRefusedEvent {
  channel_id: number;
  kind: HistoryRefusalKind;
  /** The server's own words; empty when it gave none. */
  detail: string;
  /** Only meaningful for `rate_limited`. */
  retry_after_ms: number;
}

/** A refusal the reader is shown, until the next page arrives. */
export interface HistoryRefusal {
  kind: HistoryRefusalKind;
  detail: string;
}

/** Sooner than this the server is still counting the last ask. */
export const MIN_RETRY_DELAY_MS = 250;
/** Later than this the reader has stopped waiting; the notice is the better answer. */
export const MAX_RETRY_DELAY_MS = 30_000;

/** The server's retry delay, kept within what is worth waiting for. */
export function clampRetryDelay(ms: number): number {
  if (!Number.isFinite(ms)) return MIN_RETRY_DELAY_MS;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(MIN_RETRY_DELAY_MS, ms));
}

/** At most one pending re-ask per channel. */
export class HistoryRetryTimers {
  private readonly pending = new Map<number, ReturnType<typeof setTimeout>>();

  /** Schedules `run`; false when this channel already has a re-ask waiting. */
  schedule(channelId: number, delayMs: number, run: () => void): boolean {
    if (this.pending.has(channelId)) return false;
    const timer = setTimeout(() => {
      this.pending.delete(channelId);
      run();
    }, clampRetryDelay(delayMs));
    this.pending.set(channelId, timer);
    return true;
  }

  cancel(channelId: number): void {
    const timer = this.pending.get(channelId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.pending.delete(channelId);
  }

  cancelAll(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }
}

/**
 * The page each channel last asked for (`undefined`: the newest).
 *
 * Forgotten when a page arrives, so a refusal of a fetch the backend started
 * on its own (opening a channel) re-asks for the newest page rather than for
 * an older one the reader asked for long ago.
 */
export class HistoryPageRequests {
  private readonly before = new Map<number, string | undefined>();

  remember(channelId: number, beforeId: string | undefined): void {
    this.before.set(channelId, beforeId);
  }

  last(channelId: number): string | undefined {
    return this.before.get(channelId);
  }

  forget(channelId: number): void {
    this.before.delete(channelId);
  }

  clear(): void {
    this.before.clear();
  }
}

export const historyRetryTimers = new HistoryRetryTimers();
export const historyPageRequests = new HistoryPageRequests();

/** The store surface a refusal touches. */
interface RefusalStore {
  getState: () => AppState;
  setState: (partial: (prev: AppState) => Partial<AppState>) => void;
}

/**
 * Applies a refused page to the store.
 *
 * Loading ends either way. A rate-limited page of the open channel is asked
 * for again once, after the server's delay; anything else, or a rate-limited
 * page of a channel not on screen, becomes the notice.
 */
export function applyHistoryRefusal(store: RefusalStore, refusal: PchatFetchRefusedEvent): void {
  const { channel_id: channelId, kind, detail, retry_after_ms: retryAfterMs } = refusal;
  const retryNow = kind === "rate_limited" && store.getState().selectedChannel === channelId;
  store.setState((prev) => {
    const loading = new Set(prev.pchatHistoryLoading);
    loading.delete(channelId);
    const { [channelId]: _shown, ...otherRefusals } = prev.pchatHistoryRefused;
    return {
      pchatHistoryLoading: loading,
      channelPersistence: {
        ...prev.channelPersistence,
        [channelId]: { ...prev.channelPersistence[channelId], isFetching: false },
      },
      pchatHistoryRefused: retryNow ? otherRefusals : { ...otherRefusals, [channelId]: { kind, detail } },
    };
  });
  if (!retryNow) return;
  historyRetryTimers.schedule(channelId, retryAfterMs, () => {
    // Switching channel cancels the timer; this is the belt to that brace.
    if (store.getState().selectedChannel !== channelId) return;
    void store.getState().retryHistoryFetch(channelId);
  });
}
