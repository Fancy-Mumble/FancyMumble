import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "@core/store";
import type { WatchSession } from "@core/features/chat/watch/watchTypes";
import { withNebulaTheme } from "../../../testTheme";
import { WatchDock } from "./WatchDock";

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(args[0] as string, args[1]),
}));

// A player with a length and a position, so the transport has something real
// to draw - jsdom has no playback of its own.
let volume = 1;
let muted = false;
let rate = 1;
const adapter = {
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  seek: vi.fn().mockResolvedValue(undefined),
  currentTime: () => 30,
  duration: () => 120,
  buffered: () => 60,
  volume: () => volume,
  setVolume: (v: number) => {
    volume = v;
  },
  muted: () => muted,
  setMuted: (m: boolean) => {
    muted = m;
  },
  rate: () => rate,
  setRate: (r: number) => {
    rate = r;
  },
  quality: () => "1080p",
  setOnLocalEvent: () => undefined,
  destroy: () => undefined,
};
vi.mock("@core/features/chat/watch/createPlayerAdapter", () => ({
  createPlayerAdapter: () => adapter,
}));

function session(partial: Partial<WatchSession> = {}): WatchSession {
  return {
    sessionId: "s1",
    channelId: 1,
    hostSession: 1,
    sourceUrl: "https://example.org/clip.mp4",
    sourceKind: "directMedia",
    title: "Stargazer",
    participants: new Set([1, 2]),
    state: "paused",
    currentTime: 0,
    updatedAtMs: Date.now(),
    ...partial,
  };
}

function put(one: WatchSession, ownSession = 1) {
  useAppStore.setState({
    ownSession,
    currentChannel: 1,
    users: [
      { session: 1, name: "Zewi", channel_id: 1, texture_size: null },
      { session: 2, name: "Jonas", channel_id: 1, texture_size: null },
    ] as never,
    watchSessions: new Map([[one.sessionId, one]]),
    watchSessionsVersion: 1,
  });
}

function draw() {
  render(withNebulaTheme(<WatchDock />));
}

describe("WatchDock", () => {
  beforeEach(() => {
    cleanup();
    invokeMock.mockClear();
    adapter.play.mockClear();
    adapter.pause.mockClear();
    adapter.seek.mockClear();
    volume = 1;
    muted = false;
    rate = 1;
    useAppStore.setState({
      ownSession: 1,
      currentChannel: 1,
      users: [],
      watchSessions: new Map(),
      watchSessionsVersion: 0,
      enableExternalEmbeds: true,
    });
  });

  it("stays out of the way while nothing is being watched", () => {
    draw();
    expect(screen.queryByText("Watch together")).toBeNull();
  });

  it("ignores a session running in another channel", () => {
    put(session({ channelId: 9 }));
    draw();
    expect(screen.queryByText("Watch together")).toBeNull();
  });

  it("names the session and who is in it", () => {
    put(session());
    draw();

    expect(screen.getByText("Watch together")).toBeTruthy();
    expect(screen.getByText("Stargazer")).toBeTruthy();
    expect(screen.getByText("HOST")).toBeTruthy();
    expect(screen.getByText("· 2 watching")).toBeTruthy();
  });

  it("keeps the host badge off a session someone else is running", () => {
    put(session(), 2);
    draw();
    expect(screen.queryByText("HOST")).toBeNull();
  });

  it("draws the position and the length the player reports", () => {
    put(session());
    draw();
    expect(screen.getByText("0:30 / 2:00")).toBeTruthy();
  });

  it("collapses to a pill and comes back", () => {
    put(session());
    draw();

    fireEvent.click(screen.getByLabelText("Collapse"));
    expect(screen.queryByLabelText("Seek")).toBeNull();

    fireEvent.click(screen.getByText("Watch together"));
    expect(screen.getByLabelText("Seek")).toBeTruthy();
  });

  it("plays for the host and tells the channel", async () => {
    put(session({ state: "paused" }));
    draw();

    await act(async () => {
      fireEvent.click(screen.getAllByLabelText("Play video")[0]);
    });

    expect(adapter.play).toHaveBeenCalledWith(30);
    expect(invokeMock).toHaveBeenCalledWith(
      "send_watch_sync",
      expect.objectContaining({
        event: expect.objectContaining({ type: "state", state: "playing", currentTime: 30 }),
      }),
    );
  });

  it("stops offering Play once the host has actually started it", async () => {
    put(session({ state: "paused" }));
    draw();

    await act(async () => {
      fireEvent.click(screen.getAllByLabelText("Play video")[0]);
    });

    // The server does not echo the host's own event back, so without applying
    // it locally the dock would go on drawing Play over a running video.
    expect(useAppStore.getState().watchSessions.get("s1")?.state).toBe("playing");
    expect(screen.getAllByLabelText("Pause").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Play video")).toBeNull();
  });

  it("skips ten seconds at a time, from where the player actually is", async () => {
    put(session());
    draw();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Forward 10 seconds"));
    });
    expect(adapter.seek).toHaveBeenCalledWith(40);

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Back 10 seconds"));
    });
    expect(adapter.seek).toHaveBeenCalledWith(20);
  });

  it("offers a guest no transport at all", () => {
    // Guests follow the host; a control here would be undone by the next sync.
    put(session({ state: "paused" }), 2);
    draw();

    expect(screen.queryByLabelText("Play video")).toBeNull();
    expect(screen.queryByLabelText("Seek")).toBeNull();
  });

  it("gives a guest the sync lock instead, and resyncs on the way back", () => {
    put(session(), 2);
    draw();

    const lock = screen.getByText("Synced");
    fireEvent.click(lock);
    expect(screen.getByText("Free")).toBeTruthy();

    invokeMock.mockClear();
    fireEvent.click(screen.getByText("Free"));
    // Rejoining the host's timeline asks where everyone actually is.
    expect(invokeMock).toHaveBeenCalledWith("send_watch_sync", expect.anything());
  });

  it("keeps volume and mute to this viewer, off the wire", () => {
    put(session());
    draw();

    invokeMock.mockClear();
    fireEvent.click(screen.getAllByLabelText("Mute")[0]);

    expect(muted).toBe(true);
    // Nothing about how loud one person plays it belongs on the wire.
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("switches to theater and back without rebuilding the player", () => {
    put(session());
    draw();

    const video = document.querySelector("[data-wt-player]");
    fireEvent.click(screen.getAllByLabelText("Theater")[0]);
    expect(screen.getByText("WATCH PARTY")).toBeTruthy();
    expect(screen.getByText("WATCHING")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Mini"));
    // The very same node: tearing it down would restart playback for everyone.
    expect(document.querySelector("[data-wt-player]")).toBe(video);
  });

  it("lists everyone watching once the theater is open", () => {
    put(session());
    draw();

    fireEvent.click(screen.getAllByLabelText("Theater")[0]);
    // Each row is a name beside an avatar that also carries it, so both match.
    expect(screen.getAllByText("Zewi").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jonas").length).toBeGreaterThan(0);
  });
});
