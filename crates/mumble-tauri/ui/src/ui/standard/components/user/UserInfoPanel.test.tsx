import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UserStats } from "@core/types";
import UserInfoPanel from "./UserInfoPanel";

vi.mock("@core/preferencesStorage", () => ({
  getPreferences: () => Promise.resolve({ disableOsmMaps: true }),
}));
vi.mock("@core/utils/geolocation", () => ({ geolocateIp: vi.fn().mockResolvedValue(null) }));

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
  os: "Linux",
};

describe("Standard UserInfoPanel", () => {
  it("draws no Devices section for an account on one device", () => {
    render(<UserInfoPanel stats={STATS} />);
    expect(screen.queryByText("Devices")).toBeNull();
  });

  it("lists each device by name, and opens one to its own stats", () => {
    render(
      <UserInfoPanel
        stats={{
          ...STATS,
          devices: [
            { ...STATS, device_name: "Laptop" },
            { ...STATS, session: 31, device_name: null, os: "Android", os_version: "15" },
          ],
        }}
      />,
    );
    expect(screen.getByText("Devices")).toBeTruthy();
    expect(screen.getByText("Laptop")).toBeTruthy();
    const phone = screen.getByText("Device 31");
    const details = phone.closest("details");
    expect(details?.open).toBe(false);
    fireEvent.click(phone);
    expect(details?.open).toBe(true);
    expect(screen.getByText("Android 15")).toBeTruthy();
  });
});
