import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelPersistenceState, PersistenceMode } from "@core/types";
import PersistenceBanner from "./PersistenceBanner";

const CHANNEL = 7;

const state = {
  channelPersistence: {} as Record<number, ChannelPersistenceState>,
  pchatHistoryLoading: new Set<number>(),
  loadOlderMessages: vi.fn(),
  messagesMoreBefore: false,
  messages: [] as unknown[],
};

vi.mock("@core/store", () => ({
  useAppStore: Object.assign(<T,>(select: (s: typeof state) => T) => select(state), {
    getState: () => state,
  }),
}));

vi.mock("@core/preferencesStorage", () => ({
  getDismissedBanners: () => Promise.resolve([] as number[]),
  dismissBanner: vi.fn(),
}));

function showChannelIn(mode: PersistenceMode) {
  state.channelPersistence = {
    [CHANNEL]: {
      mode,
      maxHistory: 0,
      retentionDays: 0,
      hasMore: false,
      isFetching: false,
      totalStored: 0,
    },
  };
}

beforeEach(() => {
  state.channelPersistence = {};
  state.pchatHistoryLoading = new Set();
  state.messagesMoreBefore = false;
  state.loadOlderMessages.mockClear();
});

afterEach(cleanup);

describe("PersistenceBanner", () => {
  // Every mode that renders the banner must name itself. A channel with no
  // retention limit and nothing stored yet drops both meta chips, so the mode
  // description is the only text left - a missing one leaves a shield icon
  // floating in an empty banner rather than a visibly broken string.
  it.each<[PersistenceMode, string]>([
    ["SERVER_MANAGED", "Messages are stored and encrypted by the server."],
    ["FANCY_V1_FULL_ARCHIVE", "All stored messages are visible to channel members."],
    ["SIGNAL_V1", "Messages are end-to-end encrypted using the Signal Protocol."],
  ])("describes %s", async (mode, description) => {
    showChannelIn(mode);
    render(<PersistenceBanner channelId={CHANNEL} />);
    expect(await screen.findByText(description)).toBeTruthy();
  });

  it("stays out of the way when a channel keeps nothing", () => {
    showChannelIn("NONE");
    const { container } = render(<PersistenceBanner channelId={CHANNEL} />);
    expect(container.textContent).toBe("");
  });
});
