import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@core/store";
import { placeOf, useUserLocation } from "./useUserLocation";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));

const geolocateIp = vi.fn();
vi.mock("@core/utils/geolocation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@core/utils/geolocation")>()),
  geolocateIp: (ip: string) => geolocateIp(ip),
}));

const BERLIN = { lat: 52.52, lng: 13.405, city: "Berlin", region: "Berlin", country: "Germany" };
const ADDRESS = "203.0.113.9";

/** Through the promise behind the lookup. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useUserLocation", () => {
  beforeEach(() => {
    geolocateIp.mockReset().mockResolvedValue(BERLIN);
    useAppStore.setState({ disableOsmMaps: false, streamerMode: false });
  });

  it("has nothing to say without an address", async () => {
    const { result } = renderHook(() => useUserLocation(null));
    await settle();
    expect(result.current).toBeNull();
    expect(geolocateIp).not.toHaveBeenCalled();
  });

  it("promises a place first, then delivers it", async () => {
    const { result } = renderHook(() => useUserLocation(ADDRESS));
    expect(result.current).toEqual({ state: "pending" });
    await settle();
    expect(geolocateIp).toHaveBeenCalledWith(ADDRESS);
    expect(result.current).toEqual({ state: "located", lat: 52.52, lng: 13.405, place: "Berlin, Germany" });
  });

  it("keeps the address at home when maps are off in Privacy", async () => {
    useAppStore.setState({ disableOsmMaps: true });
    const { result } = renderHook(() => useUserLocation(ADDRESS));
    expect(result.current).toBeNull();
    await settle();
    expect(result.current).toBeNull();
    expect(geolocateIp).not.toHaveBeenCalled();
  });

  it("keeps it at home in streamer mode too", async () => {
    useAppStore.setState({ streamerMode: true });
    const { result } = renderHook(() => useUserLocation(ADDRESS));
    await settle();
    expect(result.current).toBeNull();
    expect(geolocateIp).not.toHaveBeenCalled();
  });

  it("drops the row the moment maps are switched off", async () => {
    const { result } = renderHook(() => useUserLocation(ADDRESS));
    await settle();
    expect(result.current?.state).toBe("located");
    act(() => useAppStore.setState({ disableOsmMaps: true }));
    expect(result.current).toBeNull();
  });

  it("withdraws the row when the address has no place", async () => {
    geolocateIp.mockResolvedValue(null);
    const { result } = renderHook(() => useUserLocation(ADDRESS));
    await settle();
    expect(result.current).toBeNull();
  });

  it("promises nothing for an address the internet does not route", () => {
    const { result } = renderHook(() => useUserLocation("192.168.1.5"));
    expect(result.current).toBeNull();
  });
});

describe("placeOf", () => {
  it("names each part once", () => {
    expect(placeOf(BERLIN)).toBe("Berlin, Germany");
  });

  it("says nothing when the lookup named nothing", () => {
    expect(placeOf({})).toBeUndefined();
  });
});
