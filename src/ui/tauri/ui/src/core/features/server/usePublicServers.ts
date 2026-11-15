/**
 * The public server list: fetch, ping, search and sort, with no opinion about
 * how any of it looks.
 *
 * This lived inside Standard's `PublicServerList` until Nebula needed the same
 * list in its own table. Fetching a directory, throttling a ping per address
 * and sorting on the results is not a question a visual pack answers
 * differently - only the drawing is - so the state moved here and both packs
 * render it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PublicServer, ServerPingResult } from "@core/types";
import { fuzzyMatch } from "@core/utils/fuzzy";

export type PublicServerSortKey = "country" | "name" | "users" | "ping" | "version";
export type PublicServerSortDir = "asc" | "desc";

/** Module-level cache: "host:port" -> last ping epoch-ms. */
const publicPingCache = new Map<string, number>();

/** Don't re-ping an address this pack already pinged within the minute. */
const PING_THROTTLE_MS = 60_000;

/** Clear the throttle cache (for testing). */
export function clearPingCache() {
  publicPingCache.clear();
}

/** Country code to flag emoji. */
export function countryFlag(code: string): string {
  if (code.length !== 2) return "";
  const offset = 0x1f1e6 - 65; // 'A' = 65
  return String.fromCodePoint((code.codePointAt(0) ?? 65) + offset, (code.codePointAt(1) ?? 65) + offset);
}

/** The ping row an address gets when the probe itself failed. */
const PING_FAILED: ServerPingResult = {
  online: false,
  latency_ms: null,
  user_count: null,
  max_user_count: null,
  server_version: null,
};

/** Key an address the way the ping map does. */
export function serverKey(server: Pick<PublicServer, "ip" | "port">): string {
  return `${server.ip}:${server.port}`;
}

export interface PublicServersState {
  readonly servers: readonly PublicServer[];
  /** Ping results by `serverKey`, filled in as the probes land. */
  readonly pings: Readonly<Record<string, ServerPingResult>>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly search: string;
  readonly setSearch: (value: string) => void;
  readonly sortKey: PublicServerSortKey;
  readonly sortDir: PublicServerSortDir;
  /** Same key toggles direction; a new key sorts ascending. */
  readonly handleSort: (key: PublicServerSortKey) => void;
  /** `servers` filtered by `search` and ordered by the current sort. */
  readonly displayed: readonly PublicServer[];
}

/**
 * Drive the public list. `enabled` is the consent gate: nothing is fetched and
 * nothing is pinged until the caller says the user has agreed to reach out to
 * the directory.
 */
export function usePublicServers(enabled: boolean): PublicServersState {
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [pings, setPings] = useState<Record<string, ServerPingResult>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<PublicServerSortKey>("name");
  const [sortDir, setSortDir] = useState<PublicServerSortDir>("asc");

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    setError(null);

    invoke<PublicServer[]>("fetch_public_servers")
      .then((list) => {
        console.log(`[PublicServerList] Fetched ${list.length} servers`);
        setServers(list);
      })
      .catch((e) => {
        console.error("[PublicServerList] fetch failed:", e);
        setError(String(e));
      })
      .finally(() => setLoading(false));
  }, [enabled]);

  const pingServers = useCallback((list: readonly PublicServer[]) => {
    const now = Date.now();
    for (const s of list) {
      const key = serverKey(s);
      const last = publicPingCache.get(key);
      if (last !== undefined && now - last < PING_THROTTLE_MS) continue;
      publicPingCache.set(key, now);

      invoke<ServerPingResult>("ping_server", { host: s.ip, port: s.port })
        .then((result) => setPings((prev) => ({ ...prev, [key]: result })))
        .catch(() => setPings((prev) => ({ ...prev, [key]: PING_FAILED })));
    }
  }, []);

  useEffect(() => {
    if (servers.length > 0) pingServers(servers);
  }, [servers, pingServers]);

  const handleSort = useCallback(
    (key: PublicServerSortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey],
  );

  const displayed = useMemo(() => {
    const query = search.toLowerCase().trim();
    let list: readonly PublicServer[] = servers;

    if (query) {
      list = list.filter(
        (s) =>
          fuzzyMatch(query, s.name) ||
          fuzzyMatch(query, s.country) ||
          fuzzyMatch(query, s.region) ||
          fuzzyMatch(query, s.ip) ||
          fuzzyMatch(query, pings[serverKey(s)]?.server_version ?? ""),
      );
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "country") {
        cmp = a.country.localeCompare(b.country);
      } else if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name);
      } else if (sortKey === "users") {
        // An address that has not answered yet sorts below one reporting zero.
        const ua = pings[serverKey(a)]?.user_count ?? -1;
        const ub = pings[serverKey(b)]?.user_count ?? -1;
        cmp = ua - ub;
      } else if (sortKey === "ping") {
        const pa = pings[serverKey(a)]?.latency_ms ?? 9999;
        const pb = pings[serverKey(b)]?.latency_ms ?? 9999;
        cmp = pa - pb;
      } else if (sortKey === "version") {
        const va = pings[serverKey(a)]?.server_version ?? "";
        const vb = pings[serverKey(b)]?.server_version ?? "";
        cmp = va.localeCompare(vb, undefined, { numeric: true });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [servers, search, sortKey, sortDir, pings]);

  return {
    servers,
    pings,
    loading,
    error,
    search,
    setSearch,
    sortKey,
    sortDir,
    handleSort,
    displayed,
  };
}
