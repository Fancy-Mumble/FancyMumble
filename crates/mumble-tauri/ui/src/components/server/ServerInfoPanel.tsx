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

import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ServerInfo, DebugStats, AudioSettings, PluginInfoRecord } from "../../types";
import { getPreferences, getSavedAudioSettings } from "../../preferencesStorage";
import { formatBandwidth, formatDuration } from "../../utils/format";
import { useAppStore } from "../../store";
import { maskSensitive } from "../../utils/maskSensitive";
import { SafeHtml } from "../elements/SafeHtml";
import ActivityLog from "./ActivityLog";
import { useTranslation } from "react-i18next";
import styles from "./ServerInfoPanel.module.css";

function Accordion({ title, defaultOpen = false, children }: Readonly<{
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
      {caps.length > 0 && (
        <DebugRow label={t("infoPanel.plugins.capabilities")} value={caps.join(", ")} />
      )}
      {rows.map((row, i) => (
        <DebugRow key={`${row.label}-${i}`} label={row.label} value={row.value} />
      ))}
    </div>
  );
}

/** Decode a Mumble v2-encoded version into "major.minor.patch". */
function decodeFancyVersion(v: number): string {
  // Encoding: (major << 48) | (minor << 32) | (patch << 16)
  // JS bitwise ops are 32-bit, so use division for the upper bits.
  const major = Math.trunc(v / 2 ** 48) & 0xFFFF;
  const minor = Math.trunc(v / 2 ** 32) & 0xFFFF;
  const patch = Math.trunc(v / 2 ** 16) & 0xFFFF;
  return `${major}.${minor}.${patch}`;
}

// -- Latency graph ------------------------------------------------

const LATENCY_WINDOW_SECS = 10;
const GRAPH_W = 400;
const GRAPH_H = 100;
const PAD_L = 36;
const PAD_R = 4;
const PAD_T = 4;
const PAD_B = 16;

interface LatencyPoint {
  time: number;
  rtt: number;
}

interface CspViolationEntry {
  readonly id: number;
  readonly directive: string;
  readonly blockedUri: string;
  readonly source: string;
  readonly disposition: string;
}

function latencyColor(rtt: number): string {
  if (rtt < 50) return "#22c55e";
  if (rtt < 120) return "#eab308";
  return "#ef4444";
}

function drawGraph(
  buffer: LatencyPoint[],
  svgRef: React.RefObject<SVGSVGElement | null>,
) {
  const svg = svgRef.current;
  if (!svg) return;

  const plotW = GRAPH_W - PAD_L - PAD_R;
  const plotH = GRAPH_H - PAD_T - PAD_B;

  const maxRtt = buffer.reduce((m, p) => Math.max(m, p.rtt), 0);
  const yMax = Math.max(Math.ceil(maxRtt / 10) * 10, 20);

  const now = buffer.length > 0 ? buffer[buffer.length - 1].time : performance.now();
  const tMin = now - LATENCY_WINDOW_SECS * 1000;

  let polyPoints = "";
  for (const p of buffer) {
    const x = PAD_L + ((p.time - tMin) / (LATENCY_WINDOW_SECS * 1000)) * plotW;
    const y = PAD_T + plotH - (p.rtt / yMax) * plotH;
    polyPoints += `${x},${y} `;
  }

  const gridSteps = 4;
  let gridSvg = "";
  for (let i = 0; i <= gridSteps; i++) {
    const y = PAD_T + (i / gridSteps) * plotH;
    const val = Math.round(yMax * (1 - i / gridSteps));
    gridSvg += `<line x1="${PAD_L}" y1="${y}" x2="${GRAPH_W - PAD_R}" y2="${y}" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>`;
    gridSvg += `<text x="${PAD_L - 4}" y="${y + 3}" text-anchor="end" fill="rgba(255,255,255,0.35)" font-size="8">${val}</text>`;
  }
  gridSvg += `<text x="${PAD_L - 4}" y="${GRAPH_H - 1}" text-anchor="end" fill="rgba(255,255,255,0.25)" font-size="7">ms</text>`;

  const latest = buffer.length > 0 ? buffer[buffer.length - 1].rtt : 0;
  const latestColor = latencyColor(latest);

  svg.innerHTML =
    gridSvg +
    `<polyline points="${polyPoints}" fill="none" stroke="${latestColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    (buffer.length > 0
      ? `<text x="${GRAPH_W - PAD_R}" y="${PAD_T + 10}" text-anchor="end" fill="${latestColor}" font-size="10" font-weight="600">${latest.toFixed(0)} ms</text>`
      : "");
}

function LatencyAccordion() {
  const bufferRef = useRef<LatencyPoint[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const rafId = useRef(0);

  useEffect(() => {
    invoke("start_latency_test").catch(() => {});
    return () => {
      invoke("stop_latency_test").catch(() => {});
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<{ rtt_ms: number }>("ping-latency", (ev) => {
      const buf = bufferRef.current;
      buf.push({ time: performance.now(), rtt: ev.payload.rtt_ms });
      const cutoff = performance.now() - LATENCY_WINDOW_SECS * 1000;
      while (buf.length > 0 && buf[0].time < cutoff) buf.shift();

      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => drawGraph(buf, svgRef));
    });

    return () => {
      cancelAnimationFrame(rafId.current);
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <svg
      ref={svgRef}
      className={styles.latencyGraph}
      viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
      preserveAspectRatio="none"
    />
  );
}

function resolveActivationLabel(
  settings: { push_to_talk: boolean; noise_suppression?: boolean },
  t: (key: string) => string,
): string {
  if (settings.push_to_talk) return t("infoPanel.activationPtt");
  if (settings.noise_suppression) return t("infoPanel.activationVad");
  return t("infoPanel.activationContinuous");
}

interface ServerInfoPanelProps {
  readonly onClose: () => void;
}

export default function ServerInfoPanel({ onClose }: ServerInfoPanelProps) {
  const udpActive = useAppStore((s) => s.udpActive);
  const capabilities = useAppStore((s) => s.fileServerCapabilities);
  const streamerMode = useAppStore((s) => s.streamerMode);
  const pluginInfos = useAppStore((s) => s.pluginInfos);
  // The plugin registry is re-broadcast on every enable/disable, so it is the
  // live source of "which plugins are currently loaded".  `pluginInfos` is only
  // sent once on connect and goes stale when a plugin is disabled at runtime,
  // so filter the advertised infos down to plugins still in the registry.
  // (Fall back to all advertised infos when no registry was sent at all.)
  const pluginRegistry = useAppStore((s) => s.pluginRegistry);
  const livePlugins = useMemo(() => {
    const all = [...pluginInfos.values()];
    if (pluginRegistry.length === 0) return all;
    const loaded = new Set(pluginRegistry.map((r) => r.pluginName));
    return all.filter((p) => loaded.has(p.name));
  }, [pluginInfos, pluginRegistry]);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [debugStats, setDebugStats] = useState<DebugStats | null>(null);
  const [audioSettings, setAudioSettings] = useState<AudioSettings | null>(null);
  const [welcomeText, setWelcomeText] = useState<string | null>(null);
  const [cspViolations, setCspViolations] = useState<CspViolationEntry[]>([]);
  const nextCspId = useRef(0);
  const { t } = useTranslation("server");

  // Load server info and developer-mode preference on mount.
  useEffect(() => {
    invoke<ServerInfo>("get_server_info")
      .then(setInfo)
      .catch((e) => console.error("get_server_info error:", e));

    invoke<string | null>("get_welcome_text")
      .then(setWelcomeText)
      .catch(() => {});

    getPreferences()
      .then((prefs) => {
        if (prefs.userMode === "developer") {
          setDevMode(true);
        }
      })
      .catch(() => {});

    // Load audio settings for the debug overview.
    Promise.all([
      getSavedAudioSettings(),
      invoke<AudioSettings>("get_audio_settings"),
    ]).then(([saved, backend]) => {
      setAudioSettings(saved ?? backend);
    }).catch(() => {});
  }, []);

  // Fetch debug stats when developer mode is active, refresh periodically.
  useEffect(() => {
    if (!devMode) return;

    const fetchStats = () => {
      invoke<DebugStats>("get_debug_stats")
        .then(setDebugStats)
        .catch((e) => console.error("get_debug_stats error:", e));
    };

    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, [devMode]);

  const handleRefreshStats = useCallback(() => {
    invoke<DebugStats>("get_debug_stats")
      .then(setDebugStats)
      .catch((e) => console.error("get_debug_stats error:", e));
  }, []);

  // Capture CSP violations while in developer mode.
  useEffect(() => {
    if (!devMode) return;

    const MAX_ENTRIES = 100;
    const handler = (ev: SecurityPolicyViolationEvent) => {
      setCspViolations((prev) => {
        const entry: CspViolationEntry = {
          id: nextCspId.current++,
          directive: ev.violatedDirective,
          blockedUri: ev.blockedURI,
          source: ev.sourceFile ? `${ev.sourceFile}:${ev.lineNumber}` : "(inline)",
          disposition: ev.disposition,
        };
        const next = [entry, ...prev];
        return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
      });
    };

    document.addEventListener("securitypolicyviolation", handler);
    return () => document.removeEventListener("securitypolicyviolation", handler);
  }, [devMode]);

  return (
    <aside className={styles.panel}>
      {/* Close button */}
      <button
        className={styles.closeBtn}
        onClick={onClose}
        aria-label={t("infoPanel.closeAriaLabel")}
      >
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
              <span className={styles.infoValue}>
                {streamerMode ? maskSensitive(info.host) : info.host}
              </span>

              <span className={styles.infoLabel}>{t("infoPanel.labelPort")}</span>
              <span className={styles.infoValue}>
                {streamerMode ? maskSensitive(info.port) : info.port}
              </span>

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
                  <span className={styles.infoValue}>
                    {formatBandwidth(info.max_bandwidth)}
                  </span>
                </>
              )}

              <span className={styles.infoLabel}>{t("infoPanel.labelCodec")}</span>
              <span className={styles.infoValue}>
                {info.opus ? "Opus" : "CELT"}
              </span>
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
                  onClick={handleRefreshStats}
                  aria-label={t("infoPanel.refreshAriaLabel")}
                  title={t("infoPanel.refreshTitle")}
                >
                  <RefreshCwIcon width={14} height={14} />
                </button>
              </div>

              <Accordion title={t("infoPanel.accordionAudioTransport")}>
                <div className={styles.debugGrid}>
                  <DebugRow label={t("infoPanel.debug.transport")} value={udpActive ? t("infoPanel.transportUdp") : t("infoPanel.transportTcp")} />
                  <DebugRow label={t("infoPanel.debug.forceTcp")} value={audioSettings?.force_tcp_audio ?? false} />
                </div>
              </Accordion>

              {audioSettings && (
                <Accordion title={t("infoPanel.accordionAudioSettings")}>
                  <div className={styles.debugGrid}>
                    <DebugRow label={t("infoPanel.debug.inputDevice")} value={audioSettings.selected_device ?? t("infoPanel.systemDefault")} />
                    <DebugRow label={t("infoPanel.debug.bitrate")} value={`${audioSettings.bitrate_bps / 1000} kb/s`} />
                    <DebugRow label={t("infoPanel.debug.frameSize")} value={`${audioSettings.frame_size_ms} ms`} />
                    <DebugRow label={t("infoPanel.debug.vadThreshold")} value={`${(audioSettings.vad_threshold * 100).toFixed(1)}%`} />
                    <DebugRow label={t("infoPanel.debug.autoGain")} value={audioSettings.auto_gain} />
                    <DebugRow label={t("infoPanel.debug.maxGain")} value={`${audioSettings.max_gain_db} dB`} />
                    <DebugRow label={t("infoPanel.debug.activation")} value={resolveActivationLabel(audioSettings, t as (key: string) => string)} />
                    <DebugRow label={t("infoPanel.debug.gateCloseRatio")} value={`${(audioSettings.noise_gate_close_ratio * 100).toFixed(0)}%`} />
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
                      <DebugRow label={t("infoPanel.debug.connectionEpoch")} value={debugStats.connection_epoch} />
                      <DebugRow label={t("infoPanel.debug.appUptime")} value={formatDuration(debugStats.uptime_seconds)} />
                      <DebugRow label={t("infoPanel.debug.users")} value={debugStats.user_count} />
                      <DebugRow label={t("infoPanel.debug.channels")} value={debugStats.channel_count} />
                    </div>
                  </Accordion>

                  <Accordion title={t("infoPanel.accordionMessages")}>
                    <div className={styles.debugGrid}>
                      <DebugRow label={t("infoPanel.debug.channelMessages")} value={debugStats.channel_message_count} />
                      <DebugRow label={t("infoPanel.debug.dmMessages")} value={debugStats.dm_message_count} />
                      <DebugRow label={t("infoPanel.debug.totalMessages")} value={debugStats.total_message_count} />
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
                    <DebugRow label={t("infoPanel.debug.plugin")} value={`${capabilities.plugin.name} v${capabilities.plugin.version}`} />
                    <DebugRow label={t("infoPanel.debug.mumbleVersion")} value={capabilities.mumble_version.display} />
                    <DebugRow label={t("infoPanel.debug.fancyVersion")} value={capabilities.fancy_version.display} />
                    <DebugRow label={t("infoPanel.debug.maxFileSize")} value={`${(capabilities.limits.max_file_size_bytes / 1024 / 1024).toFixed(0)} MB`} />
                    <DebugRow label={t("infoPanel.debug.maxStorage")} value={`${(capabilities.limits.max_total_storage_bytes / 1024 / 1024).toFixed(0)} MB`} />
                    <DebugRow label={t("infoPanel.debug.fileTtl")} value={capabilities.features.file_ttl ? `${capabilities.limits.ttl_seconds}s` : t("infoPanel.disabled")} />
                    <DebugRow label={t("infoPanel.debug.deleteOnDownload")} value={capabilities.features.delete_on_download} />
                    <DebugRow label={t("infoPanel.debug.deleteOnDisconnect")} value={capabilities.features.delete_on_disconnect} />
                    <DebugRow label={t("infoPanel.debug.customEmotes")} value={capabilities.features.custom_emotes} />
                  </div>
                </Accordion>
              )}

              <Accordion title={t("infoPanel.accordionCspViolations", { defaultValue: "CSP Violations" })}>
                <div className={styles.devHeader} style={{ marginBottom: "6px" }}>
                  <span className={styles.debugLabel}>
                    {cspViolations.length === 0
                      ? t("infoPanel.cspNoViolations", { defaultValue: "No violations recorded." })
                      : t("infoPanel.cspViolationCount", { count: cspViolations.length, defaultValue: "{{count}} violation(s)" })}
                  </span>
                  {cspViolations.length > 0 && (
                    <button
                      type="button"
                      className={styles.refreshBtn}
                      onClick={() => setCspViolations([])}
                      title={t("infoPanel.cspClearTitle", { defaultValue: "Clear violations" })}
                    >
                      <CloseIcon width={12} height={12} />
                    </button>
                  )}
                </div>
                {cspViolations.map((v) => (
                  <div key={v.id} className={styles.debugGrid} style={{ marginBottom: "4px", padding: "4px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
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
