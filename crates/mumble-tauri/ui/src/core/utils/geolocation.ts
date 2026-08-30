/**
 * IP geolocation via the free ip-api.com service.
 *
 * Rate-limited to 45 requests per minute on the free tier.
 * Results are cached in-memory for the current session to avoid
 * redundant lookups.
 */

export interface GeoLocation {
  lat: number;
  lng: number;
  city?: string;
  region?: string;
  country?: string;
}

const cache = new Map<string, GeoLocation | null>();

/**
 * Whether an address is one the internet does not route - loopback, a LAN,
 * link-local, carrier NAT - and so has no place to look up.
 *
 * Checked before the lookup rather than after: a server on the same LAN
 * reports everyone at a private address, and asking a public service where
 * 192.168.1.5 is tells it nothing but that this client exists.
 */
export function isPrivateAddress(ip: string): boolean {
  let value = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (value.startsWith("::ffff:")) value = value.slice(7);
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return value === "::" || value === "::1" || /^f[cd]/.test(value) || /^fe[89ab]/.test(value);
}

/**
 * Resolve an IP address (v4 or v6) to geographic coordinates.
 *
 * Returns `null` if the lookup fails or the IP is a private/reserved
 * address that cannot be geolocated.
 */
export async function geolocateIp(ip: string): Promise<GeoLocation | null> {
  const key = ip.trim();
  if (isPrivateAddress(key)) return null;
  if (cache.has(key)) return cache.get(key)!;

  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(key)}?fields=status,lat,lon,city,regionName,country`,
    );
    if (!res.ok) {
      cache.set(key, null);
      return null;
    }

    const data = (await res.json()) as {
      status: string;
      lat?: number;
      lon?: number;
      city?: string;
      regionName?: string;
      country?: string;
    };

    if (data.status !== "success" || data.lat == null || data.lon == null) {
      cache.set(key, null);
      return null;
    }

    const geo: GeoLocation = {
      lat: data.lat,
      lng: data.lon,
      city: data.city,
      region: data.regionName,
      country: data.country,
    };
    cache.set(key, geo);
    return geo;
  } catch {
    cache.set(key, null);
    return null;
  }
}
