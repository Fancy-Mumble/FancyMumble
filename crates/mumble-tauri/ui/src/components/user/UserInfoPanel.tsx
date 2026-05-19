/**
 * Detailed user information panel for admins.
 *
 * Shows connection info, ping statistics, UDP network stats, and
 * bandwidth - mirroring the original Mumble "User Information" dialog.
 */

import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UserStats, PacketStats } from "../../types";
import type { GeoLocation } from "../../utils/geolocation";
import { geolocateIp } from "../../utils/geolocation";
import { getPreferences } from "../../preferencesStorage";
import { formatDuration, formatBandwidth } from "../../utils/format";
import { useAppStore } from "../../store";
import { maskSensitive } from "../../utils/maskSensitive";
import styles from "./UserInfoPanel.module.css";

const OsmMap = lazy(() => import("../elements/OsmMap"));

// -- Helpers -------------------------------------------------------

/** Compute a percentage, returning 0 when the total is 0. */
function pct(part: number, total: number): string {
  if (total === 0) return "0.0";
  return ((part / total) * 100).toFixed(1);
}

/** Pick a CSS class based on loss severity. */
function lossClass(part: number, total: number): string {
  if (total === 0) return styles.lossGood;
  const ratio = part / total;
  if (ratio >= 0.05) return styles.lossBad;
  if (ratio >= 0.01) return styles.lossWarn;
  return styles.lossGood;
}

// -- Component -----------------------------------------------------

interface Props {
  stats: UserStats;
}

export default function UserInfoPanel({ stats }: Readonly<Props>) {
  return (
    <>
      {/* Connection Information */}
      <ConnectionInfo stats={stats} />

      {/* Ping Statistics */}
      <PingStats stats={stats} />

      {/* UDP Network Statistics */}
      {(stats.from_client || stats.from_server) && (
        <UdpNetworkStats stats={stats} />
      )}

      {/* Bandwidth */}
      <BandwidthInfo stats={stats} />
    </>
  );
}

// -- Sub-sections --------------------------------------------------

function ConnectionInfo({ stats }: Readonly<Props>) {
  const hasVersion = stats.version || stats.os;
  const [geo, setGeo] = useState<GeoLocation | null>(null);
  const streamerMode = useAppStore((s) => s.streamerMode);
  const { t } = useTranslation("sidebar");

  useEffect(() => {
    if (!stats.address) {
      setGeo(null);
      return;
    }
    let cancelled = false;
    getPreferences().then((prefs) => {
      if (cancelled || prefs.disableOsmMaps || streamerMode) {
        if (!cancelled) setGeo(null);
        return;
      }
      geolocateIp(stats.address!).then((result) => {
        if (!cancelled) setGeo(result);
      });
    });
    return () => { cancelled = true; };
  }, [stats.address, streamerMode]);

  if (!hasVersion && !stats.address) return null;

  const osDisplay = [stats.os, stats.os_version]
    .filter(Boolean)
    .join(" ");

  const popupLabel = [geo?.city, geo?.region, geo?.country]
    .filter(Boolean)
    .join(", ");

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("userInfo.connectionInfo")}</h3>
      <div className={styles.infoGrid}>
        {stats.version && (
          <>
            <span className={styles.infoLabel}>{t("userInfo.labelVersion")}</span>
            <span className={styles.infoValue}>{stats.version}</span>
          </>
        )}
        {osDisplay && (
          <>
            <span className={styles.infoLabel}>{t("userInfo.labelOs")}</span>
            <span className={styles.infoValue}>{osDisplay}</span>
          </>
        )}
        {stats.address && (
          <>
            <span className={styles.infoLabel}>{t("userInfo.labelAddress")}</span>
            <span className={styles.infoValue}>
              {streamerMode ? maskSensitive(stats.address) : stats.address}
            </span>
          </>
        )}
        {geo && !streamerMode && (
          <>
            <span className={styles.infoLabel}>{t("userInfo.labelLocation")}</span>
            <span className={styles.infoValue}>{popupLabel}</span>
          </>
        )}
        <>
          <span className={styles.infoLabel}>{t("userInfo.labelCertificate")}</span>
          <span className={styles.infoValue}>
            {stats.strong_certificate ? t("userInfo.certStrong") : t("userInfo.certWeak")}
          </span>
        </>
        <>
          <span className={styles.infoLabel}>{t("userInfo.labelOpus")}</span>
          <span className={styles.infoValue}>
            {stats.opus ? t("userProfile.yes") : t("userProfile.no")}
          </span>
        </>
      </div>
      {geo && !streamerMode && (
        <div className={styles.mapWrapper}>
          <Suspense fallback={null}>
            <OsmMap lat={geo.lat} lng={geo.lng} popupLabel={popupLabel} />
          </Suspense>
        </div>
      )}
    </section>
  );
}

function PingStats({ stats }: Readonly<Props>) {
  const { t } = useTranslation("sidebar");
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("userInfo.pingStats")}</h3>
      <table className={styles.statsTable}>
        <thead>
          <tr>
            <th />
            <th>{t("userInfo.colPackets")}</th>
            <th>{t("userInfo.colAvgPing")}</th>
            <th>{t("userInfo.colDeviation")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={styles.rowLabel}>{t("userInfo.rowTcp")}</td>
            <td>{stats.tcp_packets}</td>
            <td>{stats.tcp_ping_avg.toFixed(1)} ms</td>
            <td>{stats.tcp_ping_var.toFixed(1)} ms</td>
          </tr>
          {stats.udp_packets > 0 && (
            <tr>
              <td className={styles.rowLabel}>{t("userInfo.rowUdp")}</td>
              <td>{stats.udp_packets}</td>
              <td>{stats.udp_ping_avg.toFixed(1)} ms</td>
              <td>{stats.udp_ping_var.toFixed(1)} ms</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function UdpNetworkStats({ stats }: Readonly<Props>) {
  const { t } = useTranslation("sidebar");
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("userInfo.udpStats")}</h3>
      <table className={styles.statsTable}>
        <thead>
          <tr>
            <th />
            <th>{t("userInfo.colGood")}</th>
            <th>{t("userInfo.colLate")}</th>
            <th>{t("userInfo.colLost")}</th>
            <th>{t("userInfo.colResync")}</th>
          </tr>
        </thead>
        <tbody>
          {stats.from_client && (
            <PacketStatsRow label={t("userInfo.rowFromClient")} data={stats.from_client} />
          )}
          {stats.from_server && (
            <PacketStatsRow label={t("userInfo.rowToClient")} data={stats.from_server} />
          )}
          {stats.rolling_stats && (
            <>
              <tr className={styles.subHeader}>
                <td colSpan={5}>
                  {t("userInfo.rollingWindow", { seconds: stats.rolling_stats.time_window })}
                </td>
              </tr>
              <PacketStatsRow
                label={t("userInfo.rowFromClient")}
                data={stats.rolling_stats.from_client}
              />
              <PacketStatsRow
                label={t("userInfo.rowToClient")}
                data={stats.rolling_stats.from_server}
              />
            </>
          )}
        </tbody>
      </table>
    </section>
  );
}

function PacketStatsRow({
  label,
  data,
}: Readonly<{ label: string; data: PacketStats }>) {
  const total = data.good + data.late + data.lost;
  return (
    <tr>
      <td className={styles.rowLabel}>{label}</td>
      <td>{data.good}</td>
      <td>
        {data.late}{" "}
        <span className={lossClass(data.late, total)}>
          ({pct(data.late, total)}%)
        </span>
      </td>
      <td>
        {data.lost}{" "}
        <span className={lossClass(data.lost, total)}>
          ({pct(data.lost, total)}%)
        </span>
      </td>
      <td>{data.resync}</td>
    </tr>
  );
}

function BandwidthInfo({ stats }: Readonly<Props>) {
  const { t } = useTranslation("sidebar");
  const hasBandwidth = stats.bandwidth != null;
  const hasTime = stats.onlinesecs != null;

  if (!hasBandwidth && !hasTime) return null;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{t("userInfo.bandwidth")}</h3>
      <div className={styles.infoGrid}>
        {hasBandwidth && (
          <>
            <span className={styles.infoLabel}>{t("userInfo.labelCurrent")}</span>
            <span className={styles.infoValue}>
              {formatBandwidth(stats.bandwidth! * 8)}
            </span>
          </>
        )}
        {hasTime && (
          <>
            <span className={styles.infoLabel}>{t("userInfo.labelOnline")}</span>
            <span className={styles.infoValue}>
              {formatDuration(stats.onlinesecs!)}
              {stats.idlesecs != null && stats.idlesecs > 0 && (
                <> {t("userInfo.idle", { duration: formatDuration(stats.idlesecs) })}</>
              )}
            </span>
          </>
        )}
      </div>
    </section>
  );
}
