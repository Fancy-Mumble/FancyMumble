import { afterEach, describe, expect, it, vi } from "vitest";
import { geolocateIp, isPrivateAddress } from "@core/utils/geolocation";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.9",
    "172.31.255.1",
    "192.168.1.5",
    "169.254.10.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fc00::1",
    "fd12::3",
    "fe80::1",
    "[::ffff:192.168.1.5]",
    "::ffff:10.0.0.1",
  ])("keeps %s at home", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["203.0.113.9", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:db8::1", "::ffff:203.0.113.9"])(
    "lets %s out",
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe("geolocateIp", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks nobody where a private address is", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await geolocateIp("192.168.1.5")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
