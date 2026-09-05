import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { TID } from "@core/testids";
import { withNebulaTheme } from "../../testTheme";
import { SessionStatus } from "./SessionStatus";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));

const SESSION = {
  id: "s1",
  host: "magical.rocks",
  port: 64738,
  username: "alice",
  label: "magical.rocks",
  status: "disconnected",
  certLabel: null,
};

function settle(next: Partial<ReturnType<typeof useAppStore.getState>>) {
  act(() => {
    useAppStore.setState(next);
  });
}

/** A session that exists and has ended, which is what the gate renders on. */
function ended(reason: string | null) {
  settle({
    status: "disconnected",
    bootstrapStage: null,
    error: reason,
    sessionErrors: reason === null ? {} : { s1: reason },
    activeServerId: "s1",
    sessions: [SESSION] as never,
    pendingConnect: null,
    reconnectScheduled: false,
    nextReconnectAt: null,
    reconnectAttempts: 0,
  });
}

afterEach(() => {
  settle({
    status: "disconnected",
    error: null,
    sessionErrors: {},
    activeServerId: null,
    sessions: [],
    pendingConnect: null,
    reconnectScheduled: false,
    bootstrapStage: null,
  });
});

describe("Nebula SessionStatus", () => {
  it("names the server's own reason for ending the session", () => {
    // The eviction this was built for: the same account signing in elsewhere.
    ended("You connected to the server from another device");
    render(withNebulaTheme(<SessionStatus onOpenServers={() => {}} />));

    expect(screen.getByTestId(TID.sessionStatus)).toBeTruthy();
    expect(screen.getByText("Connection failed")).toBeTruthy();
    expect(screen.getByText("You connected to the server from another device")).toBeTruthy();
    expect(screen.getByText("alice · magical.rocks:64738")).toBeTruthy();
  });

  it("still says the session ended when the server gave no reason", () => {
    // A bare socket close - which is all a stock server sends an evicted
    // client - leaves nothing to quote, and silence is what was being fixed.
    ended(null);
    render(withNebulaTheme(<SessionStatus onOpenServers={() => {}} />));

    expect(screen.getByText("Disconnected")).toBeTruthy();
  });

  it("offers a way back and a way elsewhere", () => {
    ended("Connection to server was lost.");
    const onOpenServers = vi.fn();
    render(withNebulaTheme(<SessionStatus onOpenServers={onOpenServers} />));

    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    act(() => {
      screen.getByRole("button", { name: "Choose another server" }).click();
    });
    expect(onOpenServers).toHaveBeenCalled();
  });

  it("counts down instead of blaming the connection while a retry is pending", () => {
    ended("Connection to server was lost.");
    settle({ reconnectScheduled: true, nextReconnectAt: Date.now() + 3000, reconnectAttempts: 2 });
    render(withNebulaTheme(<SessionStatus onOpenServers={() => {}} />));

    expect(screen.getByText("Reconnecting…")).toBeTruthy();
    expect(screen.getByText(/attempt 3/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry now" })).toBeTruthy();
  });

  it("reports the handshake stage while the session is still coming up", () => {
    // `connected` arrives before ServerSync does, and that window used to look
    // exactly like the broken state this surface exists to report.
    ended(null);
    settle({ status: "connected", bootstrapStage: "Fetching channels…" });
    render(withNebulaTheme(<SessionStatus onOpenServers={() => {}} />));

    expect(screen.getByText("Connecting…")).toBeTruthy();
    expect(screen.getByText("Fetching channels…")).toBeTruthy();
    // Nothing to retry: it has not failed.
    expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull();
  });
});
