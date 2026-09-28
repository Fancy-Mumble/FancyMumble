import { ChevronRightIcon, CloseIcon, RefreshCwIcon, ServerIcon } from "../../icons";
import { OfficialBadge, isOfficialPlugin } from "../elements/OfficialBadge";
/**
 * Right-side panel showing server connection details.
 *
 * Mirrors the layout of UserProfileView (close button, sections,
 * info grid) but displays server metadata instead of a user profile.
 *
 * When Developer Mode is active (Settings > Advanced > Developer Mode),
 * an extra "Developer" section is shown with debug statistics fetched
 * from the backend.
 */

import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { PluginInfoRecord } from "@core/types";
import { formatBandwidth, formatDuration } from "@core/utils/format";
import { maskSensitive } from "@core/utils/maskSensitive";
import {
  activationKind,
  decodeFancyVersion,
  useLatencyFeed,
  useServerInfoModel,
} from "@shared/serverinfo/model";
import { LatencyChart, type LatencyPalette } from "@shared/serverinfo/LatencyChart";
import { useServerFeatures, type FeatureSupport } from "@shared/serverinfo/features";
import { SafeHtml } from "../elements/SafeHtml";
import ActivityLog from "./ActivityLog";
import { useTranslation } from "react-i18next";
import styles from "./ServerInfoPanel.module.css";

function Accordion({
  title,
  defaultOpen = false,
  children,
}: Readonly<{
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={styles.accordion}>
      <button
        type="button"
        className={styles.accordionHeader}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <ChevronRightIcon
          className={`${styles.accordionChevron} ${open ? styles.accordionChevronOpen : ""}`}
          width={14}
          height={14}
        />
        <span>{title}</span>
      </button>
      {open && <div className={styles.accordionBody}>{children}</div>}
    </div>
  );
}

function DebugRow({ label, value }: Readonly<{ label: string; value: string | number | boolean }>) {
  return (
    <>
      <span className={styles.debugLabel}>{label}</span>
      <span className={styles.debugValue}>{String(value)}</span>
    </>
  );
}

function PluginInfoCard({ plugin }: Readonly<{ plugin: PluginInfoRecord }>) {
  const { t } = useTranslation("server");
  const info = plugin.info;
  const rows = Array.isArray(info.debug_rows) ? info.debug_rows : [];
  const caps = Array.isArray(info.capabilities) ? info.capabilities : [];
  return (
    <div className={styles.debugGrid}>
      {typeof info.description === "string" && info.description.length > 0 && (
        <DebugRow label={t("infoPanel.plugins.description")} value={info.description} />
      )}
      {typeof info.author === "string" && info.author.length > 0 && (
        <DebugRow label={t("infoPanel.plugins.author")} value={info.author} />
      )}
      {typeof info.homepage === "string" && info.homepage.length > 0 && (
        <DebugRow label={t("infoPanel.plugins.homepage")} value={info.homepage} />
      )}
      {caps.length > 0 && <DebugRow label={t("infoPanel.plugins.capabilities")} value={caps.join(", ")} />}
      {rows.map((row, i) => (
        <DebugRow key={`${row.label}-${i}`} label={row.label} value={row.value} />
      ))}
    </div>
  );
}

const ACTIVATION_KEYS = {
  ptt: "infoPanel.activationPtt",
  vad: "infoPanel.activationVad",
  continuous: "infoPanel.activationContinuous",
} as const;

/**
 * Standard's colours reach the chart as values rather than as `var(--...)`:
 * a canvas gradient stop is parsed by the 2D context, which knows nothing of
 * the document's custom properties.
 */
function readLatencyPalette(): LatencyPalette {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    accent: token("--color-accent", "#468cdc"),
    surface: token("--color-overlay-light", "rgba(0, 0, 0, 0.2)"),
    grid: token("--color-glass-border", "rgba(255, 255, 255, 0.08)"),
    dim: token("--color-text-muted", "rgba(255, 255, 255, 0.4)"),
    text: token("--color-text-primary", "#ffffff"),
    tooltip: token("--color-bg-elevated", "#303030"),
    tooltipLine: token("--color-glass-border", "rgba(255, 255, 255, 0.08)"),
    good: token("--color-online", "#3dbc5c"),
    fair: token("--color-warning", "#d4a020"),
    poor: token("--color-danger", "#e04848"),
    radius: "4px",
  };
}

function LatencyAccordion() {
  const { samples, error } = useLatencyFeed();
  // Themes are swapped by rewriting `data-theme` on the root, so the tokens are
  // re-read when it changes rather than frozen at whichever theme was first.
  const [palette, setPalette] = useState(readLatencyPalette);
  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(readLatencyPalette()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return <LatencyChart samples={samples} error={error} palette={palette} />;
}

/** The dot beside a feature; the state is also spelled out beside it. */
const SUPPORT_CLASS: Record<FeatureSupport, string> = {
  yes: styles.supportYes,
  partial: styles.supportPartial,
  no: styles.supportNo,
  unknown: styles.supportUnknown,
};

/** What this server can do, one row per feature and how it was found out. */
function ServerFeatures() {
  const features = useServerFeatures();
  return (
    <div className={styles.debugGrid}>
      {features.map((feature) => (
        <Fragment key={feature.id}>
          <span className={styles.debugLabel}>{feature.label}</span>
          <span className={styles.featureValue}>
            <span className={`${styles.featureDot} ${SUPPORT_CLASS[feature.support]}`} aria-hidden="true" />
            {feature.value}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

interface ServerInfoPanelProps {
  readonly onClose: () => void;
}

export default function ServerInfoPanel({ onClose }: ServerInfoPanelProps) {
  const {
    info,
    welcomeText,
    devMode,
    debugStats,
    audioSettings,
    livePlugins,
    cspViolations,
    clearCspViolations,
    refreshStats,
    udpActive,
    udpCipher,
    capabilities,
    streamerMode,
  } = useServerInfoModel();
  const { t } = useTranslation("server");

  return (
    <aside className={styles.panel}>
      {/* Close button */}
      <button className={styles.closeBtn} onClick={onClose} aria-label={t("infoPanel.closeAriaLabel")}>
        <CloseIcon width={18} height={18} />
      </button>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.serverIcon}>
          <ServerIcon width={32} height={32} strokeWidth={1.5} />
        </div>
        <h2 className={styles.title}>{t("infoPanel.heading")}</h2>
      </div>

      {info && (
        <>
          {/* Connection section */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t("infoPanel.sectionConnection")}</h3>
            <div className={styles.infoGrid}>
              <span className={styles.infoLabel}>{t("infoPanel.labelHost")}</span>
              <span className={styles.infoValue}>{streamerMode ? maskSensitive(info.host) : info.host}</span>

              <span className={styles.infoLabel}>{t("infoPanel.labelPort")}</span>
              <span className={styles.infoValue}>{streamerMode ? maskSensitive(info.port) : info.port}</span>

              <span className={styles.infoLabel}>{t("infoPanel.labelUsers")}</span>
              <span className={styles.infoValue}>
                {info.user_count}
                {info.max_users == null ? "" : ` / ${info.max_users}`}
              </span>
            </div>
          </section>

          {/* Server section */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t("infoPanel.sectionServer")}</h3>
            <div className={styles.infoGrid}>
              {info.release && (
                <>
                  <span className={styles.infoLabel}>{t("infoPanel.labelRelease")}</span>
                  <span className={styles.infoValue}>{info.release}</span>
                </>
              )}

              {info.os && (
                <>
                  <span className={styles.infoLabel}>{t("infoPanel.labelOs")}</span>
                  <span className={styles.infoValue}>{info.os}</span>
                </>
              )}

              {info.protocol_version && (
                <>
                  <span className={styles.infoLabel}>{t("infoPanel.labelProtocol")}</span>
                  <span className={styles.infoValue}>{info.protocol_version}</span>
                </>
              )}

              <span className={styles.infoLabel}>{t("infoPanel.labelFancyMumble")}</span>
              <span className={styles.infoValue}>
                {info.fancy_version == null
                  ? t("infoPanel.notSupported")
                  : `v${decodeFancyVersion(info.fancy_version)}`}
              </span>
            </div>
          </section>

          {/* Audio section */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t("infoPanel.sectionAudio")}</h3>
            <div className={styles.infoGrid}>
              {info.max_bandwidth == null ? null : (
                <>
                  <span className={styles.infoLabel}>{t("infoPanel.labelMaxBandwidth")}</span>
                  <span className={styles.infoValue}>{formatBandwidth(info.max_bandwidth)}</span>
                </>
              )}

              <span className={styles.infoLabel}>{t("infoPanel.labelCodec")}</span>
              <span className={styles.infoValue}>{info.opus ? "Opus" : "CELT"}</span>
            </div>
          </section>

          {/* Server welcome text */}
          {welcomeText && (
            <section className={styles.section}>
              <Accordion title={t("infoPanel.accordionWelcome")}>
                <SafeHtml html={welcomeText} className={styles.welcomeText} />
              </Accordion>
            </section>
          )}

          {/* Server plugins - only those currently loaded (live registry). */}
          {livePlugins.length > 0 && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{t("infoPanel.sectionPlugins")}</h3>
              {livePlugins.map((plugin) => (
                <Accordion
                  key={plugin.name}
                  title={
                    <span className={styles.pluginAccordionTitle}>
                      {`${plugin.name} v${plugin.version}`}
                      {isOfficialPlugin(plugin.name) && <OfficialBadge />}
                    </span>
                  }
                >
                  <PluginInfoCard plugin={plugin} />
                </Accordion>
              ))}
            </section>
          )}

          {/* Activity Log */}
          <section className={styles.section}>
            <Accordion title={t("infoPanel.accordionActivityLog")} defaultOpen>
              <ActivityLog />
            </Accordion>
          </section>

          {/* Developer section (developer mode only) */}
          {devMode && (
            <section className={styles.section}>
              <div className={styles.devHeader}>
                <h3 className={styles.sectionTitle}>{t("infoPanel.sectionDeveloper")}</h3>
                <button
                  type="button"
                  className={styles.refreshBtn}
                  onClick={refreshStats}
                  aria-label={t("infoPanel.refreshAriaLabel")}
                  title={t("infoPanel.refreshTitle")}
                >
                  <RefreshCwIcon width={14} height={14} />
                </button>
              </div>

              <Accordion title={t("infoPanel.accordionFeatures")}>
                <ServerFeatures />
              </Accordion>

              <Accordion title={t("infoPanel.accordionAudioTransport")}>
                <div className={styles.debugGrid}>
                  <DebugRow
                    label={t("infoPanel.debug.transport")}
                    value={udpActive ? t("infoPanel.transportUdp") : t("infoPanel.transportTcp")}
                  />
                  {udpActive && (
                    <DebugRow
                      label={t("infoPanel.debug.encryption")}
                      value={udpCipher ?? t("infoPanel.encryptionUnknown")}
                    />
                  )}
                  <DebugRow
                    label={t("infoPanel.debug.forceTcp")}
                    value={audioSettings?.force_tcp_audio ?? false}
                  />
                </div>
              </Accordion>

              {audioSettings && (
                <Accordion title={t("infoPanel.accordionAudioSettings")}>
                  <div className={styles.debugGrid}>
                    <DebugRow
                      label={t("infoPanel.debug.inputDevice")}
                      value={audioSettings.selected_device ?? t("infoPanel.systemDefault")}
                    />
                    <DebugRow
                      label={t("infoPanel.debug.bitrate")}
                      value={`${audioSettings.bitrate_bps / 1000} kb/s`}
                    />
                    <DebugRow
                      label={t("infoPanel.debug.frameSize")}
                      value={`${audioSettings.frame_size_ms} ms`}
                    />
                    <DebugRow
                      label={t("infoPanel.debug.vadThreshold")}
                      value={`${(audioSettings.vad_threshold * 100).toFixed(1)}%`}
                    />
                    <DebugRow label={t("infoPanel.debug.autoGain")} value={audioSettings.auto_gain} />
                    <DebugRow
                      label={t("infoPanel.debug.maxGain")}
                      value={`${audioSettings.max_gain_db} dB`}
                    />
                    <DebugRow
                      label={t("infoPanel.debug.activation")}
                      value={t(ACTIVATION_KEYS[activationKind(audioSettings)])}
                    />
                    <DebugRow
                      label={t("infoPanel.debug.gateCloseRatio")}
                      value={`${(audioSettings.noise_gate_close_ratio * 100).toFixed(0)}%`}
                    />
                    <DebugRow label={t("infoPanel.debug.holdFrames")} value={audioSettings.hold_frames} />
                    <DebugRow label={t("infoPanel.debug.pushToTalk")} value={audioSettings.push_to_talk} />
                    {audioSettings.push_to_talk_key && (
                      <DebugRow label={t("infoPanel.debug.pttKey")} value={audioSettings.push_to_talk_key} />
                    )}
                  </div>
                </Accordion>
              )}

              {debugStats && (
                <>
                  <Accordion title={t("infoPanel.accordionConnectionState")}>
                    <div className={styles.debugGrid}>
                      <DebugRow label={t("infoPanel.debug.voiceState")} value={debugStats.voice_state} />
                      <DebugRow
                        label={t("infoPanel.debug.connectionEpoch")}
                        value={debugStats.connection_epoch}
                      />
                      <DebugRow
                        label={t("infoPanel.debug.appUptime")}
                        value={formatDuration(debugStats.uptime_seconds)}
                      />
                      <DebugRow label={t("infoPanel.debug.users")} value={debugStats.user_count} />
                      <DebugRow label={t("infoPanel.debug.channels")} value={debugStats.channel_count} />
                    </div>
                  </Accordion>

                  <Accordion title={t("infoPanel.accordionMessages")}>
                    <div className={styles.debugGrid}>
                      <DebugRow
                        label={t("infoPanel.debug.channelMessages")}
                        value={debugStats.channel_message_count}
                      />
                      <DebugRow label={t("infoPanel.debug.dmMessages")} value={debugStats.dm_message_count} />
                      <DebugRow
                        label={t("infoPanel.debug.totalMessages")}
                        value={debugStats.total_message_count}
                      />
                      <DebugRow label={t("infoPanel.debug.offloaded")} value={debugStats.offloaded_count} />
                    </div>
                  </Accordion>

                  <Accordion title={t("infoPanel.accordionLatency")}>
                    <LatencyAccordion />
                  </Accordion>
                </>
              )}

              {capabilities && (
                <Accordion title={t("infoPanel.accordionFileServer")}>
                  <div className={styles.debugGrid}>
                    <DebugRow
                      label={t("infoPanel.debug.plugin")}
                      value={`${capabilities.plugin.name} v${capabilities.plugin.version}`}
                    />
                    <DebugRow
                      label={t("infoPanel.debug.mumbleVersion")}
                      value={capabilities.mumble_version.display}
                    />
                    <DebugRow
                      label={t("infoPanel.debug.fancyVersion")}
                      value={capabilities.fancy_version.display}
                    />
                    <DebugRow
                      label={t("infoPanel.debug.maxFileSize")}
                      value={`${(capabilities.limits.max_file_size_bytes / 1024 / 1024).toFixed(0)} MB`}
                    />
                    <DebugRow
                      label={t("infoPanel.debug.maxStorage")}
                      value={`${(capabilities.limits.max_total_storage_bytes / 1024 / 1024).toFixed(0)} MB`}
                    />
                    <DebugRow
                      label={t("infoPanel.debug.fileTtl")}
                      value={
                        capabilities.features.file_ttl
                          ? `${capabilities.limits.ttl_seconds}s`
                          : t("infoPanel.disabled")
                      }
                    />
                    <DebugRow
                      label={t("infoPanel.debug.deleteOnDownload")}
                      value={capabilities.features.delete_on_download}
                    />
                    <DebugRow
                      label={t("infoPanel.debug.deleteOnDisconnect")}
                      value={capabilities.features.delete_on_disconnect}
                    />
                    <DebugRow
                      label={t("infoPanel.debug.customEmotes")}
                      value={capabilities.features.custom_emotes}
                    />
                  </div>
                </Accordion>
              )}

              <Accordion title={t("infoPanel.accordionCspViolations", { defaultValue: "CSP Violations" })}>
                <div className={styles.devHeader} style={{ marginBottom: "6px" }}>
                  <span className={styles.debugLabel}>
                    {cspViolations.length === 0
                      ? t("infoPanel.cspNoViolations", { defaultValue: "No violations recorded." })
                      : t("infoPanel.cspViolationCount", {
                          count: cspViolations.length,
                          defaultValue: "{{count}} violation(s)",
                        })}
                  </span>
                  {cspViolations.length > 0 && (
                    <button
                      type="button"
                      className={styles.refreshBtn}
                      onClick={clearCspViolations}
                      title={t("infoPanel.cspClearTitle", { defaultValue: "Clear violations" })}
                    >
                      <CloseIcon width={12} height={12} />
                    </button>
                  )}
                </div>
                {cspViolations.map((v) => (
                  <div
                    key={v.id}
                    className={styles.debugGrid}
                    style={{
                      marginBottom: "4px",
                      padding: "4px 0",
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <DebugRow label="directive" value={v.directive} />
                    <DebugRow label="blocked" value={v.blockedUri || "(empty)"} />
                    <DebugRow label="source" value={v.source} />
                    <DebugRow label="disposition" value={v.disposition} />
                  </div>
                ))}
              </Accordion>
            </section>
          )}
        </>
      )}
    </aside>
  );
}
