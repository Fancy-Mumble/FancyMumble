/**
 * Opening a channel that keeps its history on the server reads that history,
 * without joining the channel.
 *
 * The backend fetched a kept channel's archive only when its own user joined
 * it, so opening one from the channel list showed "This is the start of" a
 * channel full of messages. The server serves the archive to anyone allowed
 * to enter, so opening is enough to ask.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChannelEntry, ChatMessage } from "../../types";

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

function channel(id: number, pchat_protocol?: ChannelEntry["pchat_protocol"]): ChannelEntry {
  return {
    id,
    parent_id: 0,
    name: `c${id}`,
    description_size: null,
    user_count: 0,
    permissions: null,
    temporary: false,
    position: 0,
    max_users: 0,
    pchat_protocol,
  };
}

const peeks = () => calls.filter((c) => c.cmd === "peek_pchat_channel").map((c) => c.args);

beforeEach(() => {
  calls.length = 0;
  invokeMock.mockClear();
  useAppStore.setState({
    selectedChannel: null,
    selectedDmUser: null,
    messages: [],
    status: "connected",
    currentChannel: 0,
    channels: [channel(0), channel(1, "server_managed"), channel(2, "fancy_v1_full_archive"), channel(3)],
  });
});

describe("opening a channel that keeps its history", () => {
  it("asks for the history of a server-kept channel it is not in", async () => {
    await useAppStore.getState().selectChannel(1);
    expect(peeks()).toEqual([{ channelId: 1 }]);
  });

  it("leaves the channel it is in to the join that already fetched it", async () => {
    useAppStore.setState({ currentChannel: 1 });
    await useAppStore.getState().selectChannel(1);
    expect(peeks()).toEqual([]);
  });

  it("asks nothing of a channel that keeps nothing, or keeps it sealed", async () => {
    await useAppStore.getState().selectChannel(3);
    await useAppStore.getState().selectChannel(2);
    expect(peeks()).toEqual([]);
  });
});
