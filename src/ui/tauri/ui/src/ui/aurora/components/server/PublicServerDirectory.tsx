import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PublicServer, ServerPingResult } from "@core/types";
import { Button, TextField } from "../primitives";
import { ServerIcon } from "@ui/icons";
import styles from "../../AuroraClientExtensions.module.css";

type SortKey = "name" | "country" | "users" | "latency";

function flag(code: string): string {
  if (!/^[a-z]{2}$/i.test(code)) return "";
  const offset = 0x1f1e6 - 65;
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((letter) => letter.charCodeAt(0) + offset),
  );
}

export interface PublicServerDirectoryProps {
  disabled?: boolean;
  username: string;
  onUsernameChange: (username: string) => void;
  onConnect: (server: PublicServer) => Promise<void> | void;
}

export default function PublicServerDirectory({
  disabled,
  username,
  onUsernameChange,
  onConnect,
}: PublicServerDirectoryProps) {
  const [consented, setConsented] = useState(false);
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [pings, setPings] = useState<Record<string, ServerPingResult>>({});
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!consented) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void invoke<PublicServer[]>("fetch_public_servers")
      .then((result) => {
        if (cancelled) return;
        setServers(result);
        for (const server of result) {
          const key = `${server.ip}:${server.port}`;
          void invoke<ServerPingResult>("ping_server", { host: server.ip, port: server.port })
            .then((ping) => {
              if (!cancelled) setPings((current) => ({ ...current, [key]: ping }));
            })
            .catch(() => {
              if (!cancelled)
                setPings((current) => ({
                  ...current,
                  [key]: {
                    online: false,
                    latency_ms: null,
                    user_count: null,
                    max_user_count: null,
                    server_version: null,
                  },
                }));
            });
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [consented]);

  const displayed = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = servers.filter(
      (server) =>
        !needle ||
        [server.name, server.country, server.region, server.ip].some((value) =>
          value.toLocaleLowerCase().includes(needle),
        ),
    );
    return [...filtered].sort((left, right) => {
      if (sort === "country") return left.country.localeCompare(right.country);
      if (sort === "users")
        return (
          (pings[`${right.ip}:${right.port}`]?.user_count ?? -1) -
          (pings[`${left.ip}:${left.port}`]?.user_count ?? -1)
        );
      if (sort === "latency")
        return (
          (pings[`${left.ip}:${left.port}`]?.latency_ms ?? Number.MAX_SAFE_INTEGER) -
          (pings[`${right.ip}:${right.port}`]?.latency_ms ?? Number.MAX_SAFE_INTEGER)
        );
      return left.name.localeCompare(right.name);
    });
  }, [pings, query, servers, sort]);

  if (!consented)
    return (
      <section className={styles.publicConsent}>
        <span className={styles.publicConsentIcon}>
          <ServerIcon />
        </span>
        <h3>Explore public Mumble servers</h3>
        <p>
          The directory request contacts the public Mumble server-list service. Server addresses are only
          fetched after you consent.
        </p>
        <Button variant="primary" onClick={() => setConsented(true)}>
          Load public directory
        </Button>
      </section>
    );

  return (
    <section className={styles.publicDirectory}>
      <div className={styles.directoryToolbar}>
        <TextField
          label="Search directory"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, country, region, or address"
        />
        <TextField
          label="Display name"
          value={username}
          onChange={(event) => onUsernameChange(event.target.value)}
          placeholder="Required to connect"
        />
        <label className={styles.sortField}>
          Sort by
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="name">Name</option>
            <option value="country">Country</option>
            <option value="users">Users</option>
            <option value="latency">Latency</option>
          </select>
        </label>
      </div>
      {loading && <div className={styles.directoryState}>Loading public servers…</div>}
      {error && (
        <div className={styles.directoryError} role="alert">
          Could not load the directory: {error}
        </div>
      )}
      {!loading && !error && (
        <div className={styles.directoryList}>
          {displayed.map((server) => {
            const ping = pings[`${server.ip}:${server.port}`];
            return (
              <article className={styles.publicServer} key={`${server.ip}:${server.port}`}>
                <span className={styles.countryFlag}>{flag(server.country_code)}</span>
                <div>
                  <strong>{server.name}</strong>
                  <small>
                    {server.country}
                    {server.region ? ` · ${server.region}` : ""}
                  </small>
                </div>
                <span className={ping?.online ? styles.onlinePing : styles.unknownPing}>
                  {ping ? (ping.online ? `${ping.latency_ms ?? "-"} ms` : "Offline") : "Checking…"}
                </span>
                <span className={styles.userCapacity}>
                  {ping?.user_count ?? "-"}
                  {ping?.max_user_count ? ` / ${ping.max_user_count}` : ""} users
                </span>
                <Button
                  variant="bare"
                  className={styles.primarySmall}
                  disabled={disabled || !username.trim() || ping?.online === false}
                  onClick={() => void onConnect(server)}
                >
                  Connect
                </Button>
              </article>
            );
          })}
          {displayed.length === 0 && (
            <div className={styles.directoryState}>No servers match that search.</div>
          )}
        </div>
      )}
    </section>
  );
}
