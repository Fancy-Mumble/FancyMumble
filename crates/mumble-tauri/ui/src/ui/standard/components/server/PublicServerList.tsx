import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ServerPingResult } from "@core/types";
import {
  countryFlag,
  serverKey,
  usePublicServers,
  type PublicServerSortKey,
} from "@core/features/server/usePublicServers";
import styles from "./PublicServerList.module.css";

// Fetching, pinging, filtering and sorting are shared with Nebula, which
// draws the same list as a MUI table - see `usePublicServers`. Re-exported
// because this module was where callers (and the tests) already reached for
// the throttle reset.
export { clearPingCache } from "@core/features/server/usePublicServers";

interface Props {
  onConnect: (host: string, port: number) => void;
  onBack: () => void;
  disabled?: boolean;
}

export default function PublicServerList({ onConnect, onBack, disabled }: Readonly<Props>) {
  const { t } = useTranslation("server");
  const [consented, setConsented] = useState(false);
  const { servers, pings, loading, error, search, setSearch, sortKey, sortDir, handleSort, displayed } =
    usePublicServers(consented);

  const sortIndicator = (key: PublicServerSortKey) => {
    if (sortKey !== key) return null;
    return <span className={styles.sortIndicator}>{sortDir === "asc" ? "▲" : "▼"}</span>;
  };

  // -- Consent gate ----------------------------------------------
  if (!consented) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <span className={styles.heading}>{t("public.title")}</span>
          <button className={styles.backLink} onClick={onBack} type="button">
            {t("public.savedServers")}
          </button>
        </div>

        <div className={styles.consent}>
          <p className={styles.consentText}>{t("public.consentText")}</p>
          <div className={styles.consentWarning}>
            <span className={styles.consentWarningIcon}>&#x26A0;&#xFE0F;</span>
            <span>{t("public.consentWarning")}</span>
          </div>
          <button className={styles.consentButton} onClick={() => setConsented(true)} type="button">
            {t("public.consentButton")}
          </button>
        </div>
      </div>
    );
  }

  // -- Main list view --------------------------------------------
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.heading}>{t("public.title")}</span>
        <button className={styles.backLink} onClick={onBack} type="button">
          {t("public.savedServers")}
        </button>
      </div>

      {/* Search bar */}
      <div className={styles.searchBar}>
        <span className={styles.searchIcon}>&#128269;</span>
        <input
          className={styles.searchInput}
          type="text"
          placeholder={t("public.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Loading / error / table */}
      {loading && (
        <div className={styles.statusRow}>
          <span className={styles.spinner} /> {t("public.loading")}
        </div>
      )}

      {error && <div className={styles.statusRow}>{t("public.loadingError", { error })}</div>}

      {!loading && !error && servers.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => handleSort("country")}>
                  {t("public.colCountry")}
                  {sortIndicator("country")}
                </th>
                <th onClick={() => handleSort("name")}>
                  {t("public.colServer")}
                  {sortIndicator("name")}
                </th>
                <th onClick={() => handleSort("users")}>
                  {t("public.colUsers")}
                  {sortIndicator("users")}
                </th>
                <th onClick={() => handleSort("ping")}>
                  {t("public.colPing")}
                  {sortIndicator("ping")}
                </th>
                <th onClick={() => handleSort("version")}>
                  {t("public.colVersion")}
                  {sortIndicator("version")}
                </th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((s) => {
                const key = serverKey(s);
                const ping = pings[key];
                return (
                  <tr key={key} onClick={() => !disabled && onConnect(s.ip, s.port)}>
                    <td>
                      <span className={styles.countryCell}>
                        <span className={styles.flag}>{countryFlag(s.country_code)}</span>
                        {s.country}
                      </span>
                    </td>
                    <td title={s.name}>{s.name}</td>
                    <td className={styles.usersCell}>
                      <UsersCell ping={pings[serverKey(s)]} />
                    </td>
                    <td>
                      <PingCell ping={ping} />
                    </td>
                    <td className={styles.versionCell}>
                      <VersionCell ping={ping} />
                    </td>
                  </tr>
                );
              })}
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={5} className={styles.statusRow}>
                    {t("public.noMatch")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && servers.length === 0 && (
        <div className={styles.statusRow}>{t("public.noResults")}</div>
      )}
    </div>
  );
}

function PingCell({ ping }: Readonly<{ ping?: ServerPingResult }>) {
  if (!ping) {
    return <span className={styles.pingNa}>...</span>;
  }
  if (!ping.online || ping.latency_ms == null) {
    return <span className={styles.pingNa}>N/A</span>;
  }
  const ms = ping.latency_ms;
  let cls = styles.pingGood;
  if (ms >= 70) cls = styles.pingPoor;
  else if (ms >= 30) cls = styles.pingOkay;

  return <span className={`${styles.pingValue} ${cls}`}>{ms} ms</span>;
}

function UsersCell({ ping }: Readonly<{ ping?: ServerPingResult }>) {
  if (!ping) {
    return <span className={styles.pingNa}>...</span>;
  }
  if (ping.user_count == null) {
    return <span className={styles.pingNa}>-</span>;
  }
  const max = ping.max_user_count;
  return (
    <span>
      {ping.user_count}
      {max != null && max > 0 ? `/${max}` : ""}
    </span>
  );
}

function VersionCell({ ping }: Readonly<{ ping?: ServerPingResult }>) {
  if (!ping) {
    return <span className={styles.pingNa}>...</span>;
  }
  if (!ping.server_version) {
    return <span className={styles.pingNa}>-</span>;
  }
  return <span>{ping.server_version}</span>;
}
