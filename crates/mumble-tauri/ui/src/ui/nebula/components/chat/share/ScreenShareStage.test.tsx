/**
 * The stage's way into its menu.
 *
 * The rows themselves are pinned in `StageMenu.test.tsx`; what is worth
 * pinning here is that a right-click on the picture answers with them at all -
 * a webview that is left to answer it puts Back / Refresh / Inspect over
 * someone's shared screen - and that a right-click on a filmstrip tile is
 * about that tile, which is what putting it on the stage first guarantees.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TID } from "@core/testids";
import { useAppStore } from "@core/store";
import { withNebulaTheme } from "../../../testTheme";
import type { ScreenShareHook } from "@standard/components/chat/stream/useScreenShare";

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => undefined),
}));
// The surface binds MediaStreams and canvases to a transport; the stage's
// chrome is what is under test, and jsdom has neither.
vi.mock("./StreamSurface", () => ({
  StreamSurface: () => <div data-testid="surface" />,
  usesNativeSurface: () => false,
}));
// No transport, so no numbers to read off one: the caption is not what is
// under test, and the sampler is chosen by a strategy nothing registers here.
vi.mock("./useFeedStats", () => ({
  useFeedStats: () => ({ width: null, height: null, fps: null, rttMs: null }),
}));
vi.mock("@standard/components/chat/stream/viewerStrategy", async (original) => ({
  ...(await original<typeof import("@standard/components/chat/stream/viewerStrategy")>()),
  activeStreamViewerStrategy: () => ({ createStatsSampler: () => null }),
}));

import { ScreenShareStage } from "./ScreenShareStage";
import type { StreamFeed } from "./feeds";

const feed = (session: number, name: string, own: boolean): StreamFeed => ({
  key: `${session}:display`,
  session,
  slot: "display",
  kind: "screen",
  name,
  own,
  stream: null,
  canvasRef: { current: null },
  live: true,
  failed: false,
});

const FEEDS = [feed(1, "Ada", false), feed(2, "Grace", false)];

const SHARE = {
  isBroadcasting: false,
  isBroadcastingFromOtherTab: false,
  broadcastingSessions: new Set<number>(),
  watchingSession: null,
  localStream: null,
  pickerOpen: false,
  portalPicker: false,
  pickerDeviceOnly: false,
  settings: {},
  activeSources: null,
  startSharing: vi.fn(),
  startCameraSharing: vi.fn(),
  cancelPicker: vi.fn(),
  confirmSource: vi.fn(async () => {}),
  changeSettings: vi.fn(),
  stopSharing: vi.fn(),
  watchBroadcast: vi.fn(),
  stopWatching: vi.fn(),
} as unknown as ScreenShareHook;

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;
  useAppStore.setState({ ownSession: 9, activeServerId: "s1", currentChannel: 3 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mount = () =>
  render(withNebulaTheme(<ScreenShareStage feeds={FEEDS} share={SHARE} onOpenQuality={vi.fn()} />));

/** The menu's own heading, which names the feed its rows act on. The stage
 *  prints the same caption over the picture, so this reads it inside the
 *  menu rather than wherever it appears first. */
const heading = () => within(screen.getByRole("menu")).getByText(/·\s*screen$/).textContent;

describe("ScreenShareStage", () => {
  it("answers a right-click on the picture with the stage menu", () => {
    mount();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getAllByTestId("surface")[0]!, { clientX: 120, clientY: 90 });
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(heading()).toBe("Ada · screen");
  });

  it("puts a right-clicked filmstrip tile on the stage, and opens its menu", () => {
    mount();
    const tiles = screen.getAllByTestId(TID.streamWatchTile);
    const grace = tiles.find((tile) => tile.getAttribute("data-session") === "2");
    fireEvent.contextMenu(grace!, { clientX: 40, clientY: 40 });
    expect(heading()).toBe("Grace · screen");
  });

  it("opens the same menu from the kebab", () => {
    mount();
    fireEvent.click(screen.getByTestId(TID.streamConfigMenu));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("Stats for Nerds")).toBeTruthy();
  });
});
