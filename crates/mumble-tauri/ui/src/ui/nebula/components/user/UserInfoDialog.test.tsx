import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import type { UserEntry, UserStats } from "@core/types";
import { withNebulaTheme } from "../../testTheme";
import { UserInfoDialog } from "./UserInfoDialog";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

/** Every listener registered by name, so a test can hand it an event. */
const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  }),
}));
vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null, useUserComment: () => null }));
vi.mock("@ui/standard/hooks/useAclGroups", () => ({ useAclGroups: () => [] }));
vi.mock("@core/utils/geolocation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/utils/geolocation")>()),
  geolocateIp: vi.fn().mockResolvedValue(null),
}));
vi.mock("./LocationMap", () => ({ default: () => <div data-testid="tiles" /> }));

const USER: UserEntry = {
  session: 26,
  name: "Sebi",
  channel_id: 1,
  user_id: 6,
  texture_size: null,
  mute: false,
  deaf: false,
  suppress: false,
  self_mute: false,
  self_deaf: false,
  priority_speaker: false,
  hash: "abc",
};

const STATS: UserStats = {
  session: 26,
  tcp_packets: 191,
  udp_packets: 346,
  tcp_ping_avg: 23.5,
  tcp_ping_var: 5.1,
  udp_ping_avg: 19.2,
  udp_ping_var: 3.2,
  bandwidth: 6625,
  onlinesecs: 2719,
  idlesecs: 1,
  strong_certificate: true,
  opus: true,
  version: "Fancy Mumble 0.4.0",
  address: "203.0.113.9",
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("UserInfoDialog", () => {
  beforeEach(() => {
    listeners.clear();
    invoke.mockReset().mockImplementation(async (command: string) => {
      if (command === "reverse_dns") return "host.example.net";
      return null;
    });
    useAppStore.setState({
      users: [USER],
      channels: [
        {
          id: 0,
          parent_id: null,
          name: "Root",
          user_count: 0,
          position: 0,
          permissions: 0x1 | 0x20000,
        } as never,
        { id: 1, parent_id: 0, name: "Gaming", user_count: 1, position: 0, permissions: 0x10 } as never,
      ],
      ownSession: 1,
      currentChannel: 1,
      disableOsmMaps: false,
      streamerMode: false,
    });
  });

  it("asks the server about the person and draws what comes back", async () => {
    render(withNebulaTheme(<UserInfoDialog session={26} onClose={vi.fn()} />));
    await flush();
    expect(invoke).toHaveBeenCalledWith("request_user_stats", { session: 26 });
    // An admin also gets the ban list, to say what is on record.
    expect(invoke).toHaveBeenCalledWith("request_ban_list");

    await act(async () => {
      listeners.get("user-stats")?.({ payload: STATS });
    });
    expect(screen.getByText("Fancy Mumble 0.4.0")).toBeTruthy();
    expect(screen.getByText("203.0.113.9")).toBeTruthy();
    expect(screen.getByText("Viewing as admin")).toBeTruthy();

    await flush();
    expect(invoke).toHaveBeenCalledWith("reverse_dns", { address: "203.0.113.9" });
    expect(await screen.findByText("host.example.net")).toBeTruthy();
  });

  it("ignores another session's figures", async () => {
    render(withNebulaTheme(<UserInfoDialog session={26} onClose={vi.fn()} />));
    await flush();
    await act(async () => {
      listeners.get("user-stats")?.({ payload: { ...STATS, session: 99 } });
    });
    expect(screen.queryByText("Fancy Mumble 0.4.0")).toBeNull();
  });

  it("closes when the person is no longer on the server", async () => {
    const onClose = vi.fn();
    render(withNebulaTheme(<UserInfoDialog session={26} onClose={onClose} />));
    await flush();
    act(() => useAppStore.setState({ users: [] }));
    expect(onClose).toHaveBeenCalled();
  });

  it("draws nothing while closed", () => {
    render(withNebulaTheme(<UserInfoDialog session={null} onClose={vi.fn()} />));
    expect(screen.queryByText("Session")).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("request_user_stats", expect.anything());
  });
});
