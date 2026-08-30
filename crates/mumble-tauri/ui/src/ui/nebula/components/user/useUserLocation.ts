import { useEffect, useState } from "react";
import { useAppStore } from "@core/store";
import { geolocateIp, isPrivateAddress, type GeoLocation } from "@core/utils/geolocation";

/**
 * Where a person is connecting from.
 *
 * `pending` is a promise rather than a fact: there is an address and it is
 * still being turned into a place. Saying so lets a surface draw the map's
 * frame at once rather than growing one a moment after it settled.
 */
export type UserLocation =
  | { state: "pending" }
  | {
      state: "located";
      lat: number;
      lng: number;
      /** "Berlin, Germany" - what the lookup made of the coordinates. */
      place?: string;
    };

/** "Berlin, Germany" - the parts the lookup names, each said once. */
export function placeOf(geo: Pick<GeoLocation, "city" | "region" | "country">): string | undefined {
  const parts: string[] = [];
  for (const part of [geo.city, geo.region, geo.country]) {
    if (part && !parts.includes(part)) parts.push(part);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Where a person is connecting from, for the User Information sheet.
 *
 * The address is whatever the server put on the user's stats, which it does
 * only for the user themself and for those with Register on the root - so for
 * most people this is null and the sheet has no map. When there is one, the
 * lookup is the same `geolocateIp` Standard's User Information dialog uses,
 * and it is skipped outright - no promise of a place, nothing sent - when the
 * viewer has turned maps off in Privacy or is in streamer mode: the lookup is
 * the thing that leaves the machine, so the switch has to stop it, not hide
 * its result.
 */
export function useUserLocation(address: string | null | undefined): UserLocation | null {
  const suppressed = useAppStore((state) => state.disableOsmMaps || state.streamerMode);
  const active = !!address && !suppressed && !isPrivateAddress(address);
  const [location, setLocation] = useState<UserLocation | null>(null);

  useEffect(() => {
    if (!active) {
      setLocation(null);
      return;
    }
    setLocation({ state: "pending" });
    let cancelled = false;
    void geolocateIp(address).then((geo) => {
      if (cancelled) return;
      setLocation(geo ? { state: "located", lat: geo.lat, lng: geo.lng, place: placeOf(geo) } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [address, active]);

  return active ? location : null;
}
