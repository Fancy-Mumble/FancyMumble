/**
 * The loaded end of a thread.
 *
 * Opening a channel reads its newest messages and nothing else, and the way
 * back through the rest is a window that grows: out of the rows the backend is
 * already holding first, and only out of the server's archive once those run
 * out. Before this, every read handed the whole thread across the bridge and a
 * reader at the top of it went straight to the server for a page it already
 * had in memory.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessage } from "../../types";
import { LOADED_WINDOW, LOADED_WINDOW_STEP } from "../chat/chatWindowing";

interface PageArgs {
  request: { channelId: number; offsetFromTail: number; limit: number };
}

/** Every invoke the store made, in order. */
const calls: { cmd: string; args: unknown }[] = [];

/** How many rows the fake backend is holding, and what it says lies behind. */
const backend = { held: 0, moreBefore: false };

function makeMsg(idx: number): ChatMessage {
  return {
    sender_session: 10,
    sender_name: "User",
    body: `msg ${idx}`,
    channel_id: 1,
    is_own: false,
    dm_session: null,
    message_id: `m-${idx}`,
    timestamp: idx,
    is_legacy: false,
  };
}

const invokeMock = vi.fn((cmd: string, args?: unknown) => {
  calls.push({ cmd, args });
  if (cmd === "get_messages_page") {
    const { request } = args as PageArgs;
    const rows = Array.from({ length: Math.min(request.limit, backend.held) }, (_, i) => makeMsg(i));
    return Promise.resolve({
      rows,
      moreBefore: backend.moreBefore || rows.length < backend.held,
      moreAfter: false,
      atTail: true,
    });
  }
  return Promise.resolve(undefined);
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue("granted"),
  createChannel: vi.fn().mockResolvedValue(undefined),
  Importance: { Default: 3 },
  Visibility: { Public: 1 },
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Import after mocks.
import { useAppStore } from "../../store";

/** The page requests the store made, newest call last. */
function pageRequests(): PageArgs["request"][] {
  return calls.filter((c) => c.cmd === "get_messages_page").map((c) => (c.args as PageArgs).request);
}

beforeEach(() => {
  calls.length = 0;
  invokeMock.mockClear();
  backend.held = 0;
  backend.moreBefore = false;
  useAppStore.setState({
    selectedChannel: null,
    selectedDmUser: null,
    messages: [],
    messageLimit: LOADED_WINDOW,
    messagesMoreBefore: false,
    status: "connected",
  });
});

describe("the loaded message window", () => {
  it("opens a channel on its newest messages", async () => {
    backend.held = 1000;

    await useAppStore.getState().selectChannel(1);

    const [request] = pageRequests();
    expect(request).toEqual({ channelId: 1, offsetFromTail: 0, limit: LOADED_WINDOW });
    expect(useAppStore.getState().messages).toHaveLength(LOADED_WINDOW);
    expect(useAppStore.getState().messagesMoreBefore).toBe(true);
  });

  it("grows the window out of what the backend holds", async () => {
    backend.held = 1000;
    await useAppStore.getState().selectChannel(1);

    await useAppStore.getState().loadOlderMessages();

    expect(pageRequests().at(-1)?.limit).toBe(LOADED_WINDOW + LOADED_WINDOW_STEP);
    expect(useAppStore.getState().messageLimit).toBe(LOADED_WINDOW + LOADED_WINDOW_STEP);
    expect(
      calls.some((c) => c.cmd === "fetch_older_messages"),
      "the backend had rows to give, so the server was not asked",
    ).toBe(false);
  });

  it("asks the server once the backend has nothing left to hand over", async () => {
    // A window that comes back no bigger than it was, with history still
    // reported behind it: the rest of the archive is the server's.
    backend.held = 10;
    backend.moreBefore = true;
    await useAppStore.getState().selectChannel(1);

    await useAppStore.getState().loadOlderMessages();

    const fetch = calls.find((c) => c.cmd === "fetch_older_messages");
    expect(fetch, "the reader reached the head of the archive this client has").toBeTruthy();
    expect((fetch?.args as { beforeId: string }).beforeId).toBe("m-0");
  });

  it("leaves a thread with no history behind it alone", async () => {
    backend.held = 5;
    await useAppStore.getState().selectChannel(1);
    const before = pageRequests().length;

    await useAppStore.getState().loadOlderMessages();

    expect(pageRequests()).toHaveLength(before);
    expect(calls.some((c) => c.cmd === "fetch_older_messages")).toBe(false);
  });
});
