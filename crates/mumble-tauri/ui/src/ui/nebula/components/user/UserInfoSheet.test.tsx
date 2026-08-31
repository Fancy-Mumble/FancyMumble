import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UserEntry, UserStats } from "@core/types";
import type { UserMenuActions } from "../../selectors";
import { withNebulaTheme } from "../../testTheme";
import { sampleOf } from "./userInfoModel";
import { UserInfoSheet, type UserInfoSheetProps } from "./UserInfoSheet";

vi.mock("@core/lazyBlobs", () => ({ useUserAvatar: () => null }));
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
  priority_speaker: true,
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
  strong_certificate: false,
  opus: true,
  version: "Fancy Mumble 0.4.0",
  os: "Linux",
  os_version: "6.9",
  address: "2a00:e180:16a8:c200:7706:3a5d:a015:1d18",
  from_client: { good: 346, late: 0, lost: 2, resync: 0 },
  from_server: { good: 8006, late: 1, lost: 0, resync: 0 },
};

const NOBODY: UserMenuActions = {
  isSelf: false,
  userChannel: null,
  canJoinChannel: true,
  canMuteDeafen: false,
  canMove: false,
  canKick: false,
  canBan: false,
  canRegister: false,
  canUnregister: false,
  canResetContent: false,
  hasModeration: false,
};

const ADMIN: UserMenuActions = {
  ...NOBODY,
  canMuteDeafen: true,
  canMove: true,
  canKick: true,
  canBan: true,
  hasModeration: true,
};

function renderSheet(overrides: Partial<UserInfoSheetProps> = {}) {
  const props: UserInfoSheetProps = {
    user: USER,
    avatar: null,
    profile: null,
    bio: "<p>Mid-lane or feed, no in between.</p>",
    channelName: "Gaming",
    talking: false,
    stats: STATS,
    samples: [sampleOf(STATS, 1), sampleOf({ ...STATS, udp_ping_avg: 21 }, 2)],
    location: { state: "located", lat: 51.9, lng: 8.38, place: "Gütersloh, North Rhine-Westphalia, DE" },
    reverseDns: "dyn-c200.hsi.magenta.de",
    groups: ["admin", "mods"],
    bans: { count: 1, note: { key: "nebulaUser:info.bansExpired", date: "12 Jun" } },
    admin: true,
    streamerMode: false,
    actions: ADMIN,
    onClose: vi.fn(),
    onModerate: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  };
  render(withNebulaTheme(<UserInfoSheet {...props} />));
  return props;
}

describe("UserInfoSheet", () => {
  it("names the person, their standing and where they are", () => {
    renderSheet();
    expect(screen.getByText("Sebi")).toBeTruthy();
    expect(screen.getByText("PRIORITY")).toBeTruthy();
    expect(screen.getByText("In voice · #Gaming")).toBeTruthy();
    expect(screen.getByText("Viewing as admin")).toBeTruthy();
    expect(screen.getByText("Mid-lane or feed, no in between.")).toBeTruthy();
  });

  it("lays out the session and the client", () => {
    renderSheet();
    expect(screen.getByText("Yes · id 6")).toBeTruthy();
    expect(screen.getByText("Fancy Mumble 0.4.0")).toBeTruthy();
    expect(screen.getByText("Linux 6.9")).toBeTruthy();
    expect(screen.getByText("Weak / None")).toBeTruthy();
  });

  it("puts the address, its name, the place, the groups and the map under Network", () => {
    renderSheet();
    expect(screen.getByText("2a00:e180:16a8:c200:7706:3a5d:a015:1d18")).toBeTruthy();
    expect(screen.getByText("dyn-c200.hsi.magenta.de")).toBeTruthy();
    expect(screen.getByText("Gütersloh, North Rhine-Westphalia, DE")).toBeTruthy();
    expect(screen.getByText("admin, mods")).toBeTruthy();
    expect(screen.getByTestId("tiles")).toBeTruthy();
    expect(screen.getByText("Gütersloh — approx. from IP")).toBeTruthy();
  });

  it("draws the live figures and both tables", () => {
    renderSheet();
    expect(screen.getByText("LIVE")).toBeTruthy();
    // The headline is the latest reading; the table carries the server's average.
    expect(screen.getByText("21.0 ms")).toBeTruthy();
    expect(screen.getByText("19.2 ms")).toBeTruthy();
    // Once as the headline, and once more on the newest bar's tooltip.
    expect(screen.getAllByText("0.57%").length).toBeGreaterThan(0);
    expect(screen.getByText("Inbound")).toBeTruthy();
    expect(screen.getByText("8006")).toBeTruthy();
    expect(screen.getByText("Opus 48 kHz")).toBeTruthy();
    expect(screen.getByRole("img", { name: /^Round trip over the last 45 seconds/ })).toBeTruthy();
  });

  it("rests the chart until there are two readings", () => {
    renderSheet({ samples: [] });
    expect(screen.getByText("Collecting readings…")).toBeTruthy();
  });

  it("offers only the moderation the server has granted, and says what is on record", () => {
    const { onModerate, onMove } = renderSheet({ actions: { ...ADMIN, canKick: false } });
    expect(screen.getByText("1 · expired 12 Jun")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kick" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(onModerate).toHaveBeenCalledWith("mute");
    fireEvent.click(screen.getByRole("button", { name: "Move…" }));
    expect(onMove).toHaveBeenCalled();
  });

  it("shows no admin rows to someone the server told nothing", () => {
    renderSheet({
      stats: { ...STATS, address: null },
      location: null,
      reverseDns: null,
      groups: [],
      bans: null,
      admin: false,
      actions: NOBODY,
    });
    expect(screen.queryByText("Viewing as admin")).toBeNull();
    expect(screen.queryByText("Network & location")).toBeNull();
    expect(screen.queryByText("Moderation")).toBeNull();
    expect(screen.getByText("Connection quality")).toBeTruthy();
  });

  it("masks the address and drops the map in streamer mode", () => {
    renderSheet({ streamerMode: true });
    expect(screen.queryByText("2a00:e180:16a8:c200:7706:3a5d:a015:1d18")).toBeNull();
    expect(screen.queryByText("dyn-c200.hsi.magenta.de")).toBeNull();
    expect(screen.queryByTestId("tiles")).toBeNull();
  });

  it("waits for the server before claiming anything about the client", () => {
    renderSheet({ stats: null, samples: [], location: null, reverseDns: null });
    expect(screen.queryByText("Client")).toBeNull();
    expect(screen.queryByText("Connection quality")).toBeNull();
    expect(screen.getByText("Registered")).toBeTruthy();
  });

  it("closes from the banner", () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
