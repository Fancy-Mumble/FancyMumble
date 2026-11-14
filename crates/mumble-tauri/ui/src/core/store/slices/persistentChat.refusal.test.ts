/**
 * A refused page of persistent-chat history is not the end of the archive.
 *
 * The server answers a page it will not serve with `pchat-fetch-refused`.
 * Unhandled, scrolling back simply stopped. A rate-limited page is asked for
 * again once, after the server's delay; any other refusal is shown, with a
 * way to ask again, until a page arrives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn((_cmd: string, _args?: unknown) => Promise.resolve(undefined)));
const handlers = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => unknown>());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: unknown }) => unknown) => {
    handlers.set(name, handler);
    return Promise.resolve(() => handlers.delete(name));
  }),
}));

// Import after mocks.
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "..";
import { registerPersistentChatEvents } from "./persistentChat.events";
import type { PchatFetchRefusedEvent } from "./persistentChat.refusal";

const CHANNEL = 4;

/** The `before_id` of every page the store asked the backend for. */
function pagesAsked(): (string | null)[] {
  return invokeMock.mock.calls
    .filter(([cmd]) => cmd === "fetch_older_messages")
    .map(([, args]) => (args as { beforeId: string | null }).beforeId);
}

function emit(name: string, payload: unknown): void {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`no listener for ${name}`);
  void handler({ payload });
}

function refuse(partial: Partial<PchatFetchRefusedEvent>): void {
  emit("pchat-fetch-refused", {
    channel_id: CHANNEL,
    kind: "rate_limited",
    detail: "",
    retry_after_ms: 1_500,
    ...partial,
  });
}

let unlisteners: UnlistenFn[] = [];

beforeEach(async () => {
  vi.useFakeTimers();
  invokeMock.mockClear();
  useAppStore.setState({
    selectedChannel: CHANNEL,
    pchatHistoryRefused: {},
    pchatHistoryLoading: new Set([CHANNEL]),
  });
  unlisteners = [];
  await registerPersistentChatEvents(unlisteners);
});

afterEach(() => {
  for (const unlisten of unlisteners) unlisten();
  vi.useRealTimers();
});

describe("a rate-limited history refusal", () => {
  it("re-runs the same load once after the server's delay", async () => {
    await useAppStore.getState().fetchHistory(CHANNEL, "m-10");
    refuse({ retry_after_ms: 1_500 });
    // A second refusal while the first re-ask waits does not add another.
    refuse({ retry_after_ms: 1_500 });

    expect(useAppStore.getState().pchatHistoryLoading.has(CHANNEL)).toBe(false);
    expect(useAppStore.getState().pchatHistoryRefused[CHANNEL]).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1_499);
    expect(pagesAsked()).toEqual(["m-10"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(pagesAsked()).toEqual(["m-10", "m-10"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pagesAsked()).toEqual(["m-10", "m-10"]);
  });

  it("waits at least 250 ms and at most 30 s", async () => {
    refuse({ retry_after_ms: 0 });
    await vi.advanceTimersByTimeAsync(249);
    expect(pagesAsked()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    // Nothing was asked for by the view, so the newest page is asked again.
    expect(pagesAsked()).toEqual([null]);

    refuse({ retry_after_ms: 120_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pagesAsked()).toEqual([null, null]);
  });

  it("is dropped when the reader switches channel", async () => {
    refuse({ retry_after_ms: 1_000 });
    useAppStore.setState({ selectedChannel: CHANNEL + 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pagesAsked()).toEqual([]);
  });
});

describe("any other history refusal", () => {
  it("shows the notice and Retry re-runs the load", async () => {
    await useAppStore.getState().fetchHistory(CHANNEL, "m-10");
    refuse({ kind: "permission", detail: "not allowed", retry_after_ms: 0 });

    expect(useAppStore.getState().pchatHistoryLoading.has(CHANNEL)).toBe(false);
    expect(useAppStore.getState().pchatHistoryRefused[CHANNEL]).toEqual({
      kind: "permission",
      detail: "not allowed",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pagesAsked()).toEqual(["m-10"]);

    await useAppStore.getState().retryHistoryFetch(CHANNEL);
    expect(pagesAsked()).toEqual(["m-10", "m-10"]);
    expect(useAppStore.getState().pchatHistoryRefused[CHANNEL]).toBeUndefined();
  });

  it("is hidden by the next page that arrives", () => {
    refuse({ kind: "limit", detail: "" });
    expect(useAppStore.getState().pchatHistoryRefused[CHANNEL]).toBeDefined();

    emit("pchat-fetch-complete", { channel_id: CHANNEL, has_more: true, total_stored: 80 });
    expect(useAppStore.getState().pchatHistoryRefused[CHANNEL]).toBeUndefined();
  });
});
