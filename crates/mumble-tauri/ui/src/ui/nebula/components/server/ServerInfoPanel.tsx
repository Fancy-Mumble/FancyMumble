/**
 * Nebula's server details, drawn as the right-hand panel the mock puts beside
 * the conversation - the same slot and the same 1px seam as the member list, so
 * opening it narrows the chat instead of displacing the window's layout.
 *
 * Standard's panel shows the same facts; only the frame differs, so the data
 * lives in `@shared/serverinfo/model` and this file is presentation only.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  IconButton,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { formatBandwidth, formatDuration } from "@core/utils/format";
import { maskSensitive } from "@core/utils/maskSensitive";
import { isOfficialPlugin } from "@core/plugins/tier1/official";
import { useAppStore } from "@core/store";
import type { PluginInfoRecord } from "@core/types";
import {
  activationKind,
  decodeFancyVersion,
  useLatencyGraph,
  useServerInfoModel,
  LATENCY_GRAPH_H,
  LATENCY_GRAPH_W,
  type LatencyPalette,
} from "@shared/serverinfo/model";
import { ChevronDownIcon, CloseIcon, RefreshCwIcon, ServerIcon, ShieldCheckIcon } from "@ui/icons";
import { NEBULA_MONO, radius } from "../../tokens";
import { SectionLabel, Stack } from "../primitives";

const ACTIVATION_LABELS = {
  ptt: "Push to Talk",
  vad: "Voice Activation",
  continuous: "Continuous",
} as const;

/** A titled group of facts, separated from its neighbours by a hairline. */
function Section({
  title,
  action,
  children,
}: Readonly<{
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}>) {
  return (
    <Box
      sx={(theme) => ({
        py: "14px",
        borderTop: `1px solid ${theme.palette.nebula.line}`,
        "&:first-of-type": { borderTop: "none", pt: "4px" },
      })}
    >
      {title && (
        <Stack direction="row" alignItems="center" sx={{ mb: "8px" }}>
          <SectionLabel>{title}</SectionLabel>
          {action && <Box sx={{ ml: "auto" }}>{action}</Box>}
        </Stack>
      )}
      {children}
    </Box>
  );
}

/** Two columns of label/value pairs. `mono` is for developer figures. */
function Facts({ mono, children }: Readonly<{ mono?: boolean; children: ReactNode }>) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: "14px",
        rowGap: mono ? "4px" : "6px",
        alignItems: "baseline",
      }}
    >
      {children}
    </Box>
  );
}

function Fact({
  label,
  value,
  mono,
}: Readonly<{
  label: string;
  value: string | number | boolean;
  mono?: boolean;
}>) {
  return (
    <>
      <Typography
        component="span"
        sx={(theme) => ({
          fontSize: mono ? 11.5 : 12.5,
          color: theme.palette.nebula.muted,
          whiteSpace: mono ? "nowrap" : "normal",
        })}
      >
        {label}
      </Typography>
      <Typography
        component="span"
        sx={{
          fontSize: mono ? 11.5 : 12.5,
          fontFamily: mono ? NEBULA_MONO : "inherit",
          wordBreak: "break-word",
        }}
      >
        {String(value)}
      </Typography>
    </>
  );
}

/** The panel's collapsible block: a card header that opens onto its body. */
function Fold({
  title,
  defaultExpanded,
  children,
}: Readonly<{
  title: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
}>) {
  // Controlled, and the body is only rendered while open: the latency fold
  // starts a ping test on mount, so a collapsed fold must not have mounted it.
  const [open, setOpen] = useState(defaultExpanded ?? false);
  return (
    <Accordion
      disableGutters
      expanded={open}
      onChange={(_event, next) => setOpen(next)}
      sx={(theme) => ({
        border: `1px solid ${theme.palette.nebula.line}`,
        borderRadius: radius("md"),
        overflow: "hidden",
        "&::before": { display: "none" },
      })}
    >
      <AccordionSummary
        expandIcon={<ChevronDownIcon width={13} height={13} />}
        sx={(theme) => ({
          minHeight: 0,
          px: "12px",
          background: theme.palette.nebula.card,
          "&:hover": { background: theme.palette.nebula.hover },
          "& .MuiAccordionSummary-content": { my: "9px", minWidth: 0 },
          "& .MuiAccordionSummary-expandIconWrapper": { color: theme.palette.nebula.dim },
        })}
      >
        <Typography component="span" sx={{ fontSize: 12, fontWeight: 600 }} noWrap>
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails
        sx={(theme) => ({
          px: "12px",
          py: "10px",
          borderTop: `1px solid ${theme.palette.nebula.line}`,
        })}
      >
        {open && children}
      </AccordionDetails>
    </Accordion>
  );
}

/** Vertical rhythm between stacked folds. */
function Folds({ children }: Readonly<{ children: ReactNode }>) {
  return <Stack gap={1}>{children}</Stack>;
}

function PluginFacts({ plugin }: Readonly<{ plugin: PluginInfoRecord }>) {
  const info = plugin.info;
  const rows = Array.isArray(info.debug_rows) ? info.debug_rows : [];
  const caps = Array.isArray(info.capabilities) ? info.capabilities : [];
  return (
    <Facts mono>
      {typeof info.description === "string" && info.description.length > 0 && (
        <Fact mono label="Description" value={info.description} />
      )}
      {typeof info.author === "string" && info.author.length > 0 && (
        <Fact mono label="Author" value={info.author} />
      )}
      {typeof info.homepage === "string" && info.homepage.length > 0 && (
        <Fact mono label="Homepage" value={info.homepage} />
      )}
      {caps.length > 0 && <Fact mono label="Capabilities" value={caps.join(", ")} />}
      {rows.map((row, i) => (
        <Fact mono key={`${row.label}-${i}`} label={row.label} value={row.value} />
      ))}
    </Facts>
  );
}

/** The server's own message, as HTML it authored - sanitised before it lands. */
function WelcomeText({ html }: Readonly<{ html: string }>) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  if (!clean) return null;
  return (
    <Box
      sx={(theme) => ({
        maxHeight: 200,
        overflowY: "auto",
        fontSize: 12.5,
        lineHeight: 1.5,
        wordBreak: "break-word",
        "& a": { color: theme.palette.nebula.accent, textDecoration: "none" },
        "& a:hover": { textDecoration: "underline" },
        "& img": { maxWidth: "100%" },
      })}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

function ActivityLog() {
  const serverLog = useAppStore((s) => s.serverLog);
  const listRef = useRef<HTMLDivElement>(null);

  // Newest lines matter most, so the view sits at the bottom as entries land.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [serverLog]);

  if (serverLog.length === 0) {
    return (
      <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.dim })}>
        No activity yet
      </Typography>
    );
  }

  return (
    <Box ref={listRef} sx={{ maxHeight: 170, overflowY: "auto", display: "grid", gap: "3px" }}>
      {serverLog.map((entry, i) => (
        <Stack direction="row" gap={1} key={`${entry.timestamp_ms}-${i}`}>
          <Typography
            component="span"
            sx={(theme) => ({
              flex: "none",
              fontSize: 10.5,
              fontFamily: NEBULA_MONO,
              color: theme.palette.nebula.dim,
            })}
          >
            {new Date(entry.timestamp_ms).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </Typography>
          <Typography component="span" sx={{ fontSize: 11.5, wordBreak: "break-word" }}>
            {entry.message}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}

/** The graph in Nebula's own colours rather than the shared defaults. */
function useLatencyPalette(): LatencyPalette {
  const { nebula } = useTheme().palette;
  return useMemo(
    () => ({
      good: nebula.ok,
      warn: nebula.warn,
      bad: nebula.bad,
      grid: alpha(nebula.text, 0.08),
      axis: alpha(nebula.text, 0.35),
      unit: alpha(nebula.text, 0.25),
    }),
    [nebula],
  );
}

function LatencyGraph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const palette = useLatencyPalette();
  useLatencyGraph(svgRef, palette);
  return (
    <Box
      component="svg"
      ref={svgRef}
      viewBox={`0 0 ${LATENCY_GRAPH_W} ${LATENCY_GRAPH_H}`}
      preserveAspectRatio="none"
      sx={(theme) => ({
        width: "100%",
        height: 100,
        borderRadius: radius("md"),
        background: theme.palette.nebula.card2,
      })}
    />
  );
}

interface ServerInfoPanelProps {
  readonly onClose: () => void;
}

export function ServerInfoPanel({ onClose }: Readonly<ServerInfoPanelProps>) {
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
    capabilities,
    streamerMode,
  } = useServerInfoModel();

  return (
    <Stack
      component="aside"
      aria-label="Server info"
      sx={(theme) => ({
        width: 320,
        flex: "none",
        minHeight: 0,
        borderLeft: `1px solid ${theme.palette.nebula.line}`,
        background: theme.palette.nebula.panel,
      })}
    >
      <Stack direction="row" alignItems="center" gap={1.25} sx={{ px: "14px", pt: "14px", pb: "10px" }}>
        <Box
          sx={(theme) => ({
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            borderRadius: radius("md"),
            background: theme.palette.nebula.accentSoft,
            color: theme.palette.nebula.accent,
          })}
        >
          <ServerIcon width={16} height={16} strokeWidth={1.5} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 600 }} noWrap>
            Server info
          </Typography>
          {info && (
            <Typography sx={(theme) => ({ fontSize: 11, color: theme.palette.nebula.muted })} noWrap>
              {streamerMode ? maskSensitive(info.host) : info.host}
            </Typography>
          )}
        </Box>
        <IconButton size="small" aria-label="Close server info" sx={{ ml: "auto" }} onClick={onClose}>
          <CloseIcon width={13} height={13} />
        </IconButton>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: "14px", pb: "14px" }}>
        {info && (
          <>
            <Section title="Connection">
              <Facts>
                <Fact label="Host" value={streamerMode ? maskSensitive(info.host) : info.host} />
                <Fact label="Port" value={streamerMode ? maskSensitive(info.port) : info.port} />
                <Fact
                  label="Users"
                  value={`${info.user_count}${info.max_users == null ? "" : ` / ${info.max_users}`}`}
                />
              </Facts>
            </Section>

            <Section title="Server">
              <Facts>
                {info.release && <Fact label="Release" value={info.release} />}
                {info.os && <Fact label="OS" value={info.os} />}
                {info.protocol_version && <Fact label="Protocol" value={info.protocol_version} />}
                <Fact
                  label="Fancy Mumble"
                  value={
                    info.fancy_version == null
                      ? "Not supported"
                      : `v${decodeFancyVersion(info.fancy_version)}`
                  }
                />
              </Facts>
            </Section>

            <Section title="Audio">
              <Facts>
                {info.max_bandwidth != null && (
                  <Fact label="Max bandwidth" value={formatBandwidth(info.max_bandwidth)} />
                )}
                <Fact label="Codec" value={info.opus ? "Opus" : "CELT"} />
              </Facts>
            </Section>

            {welcomeText && (
              <Section>
                <Fold title="Welcome">
                  <WelcomeText html={welcomeText} />
                </Fold>
              </Section>
            )}

            {livePlugins.length > 0 && (
              <Section title="Plugins">
                <Folds>
                  {livePlugins.map((plugin) => (
                    <Fold
                      key={plugin.name}
                      title={
                        <Box
                          component="span"
                          sx={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                        >
                          {`${plugin.name} v${plugin.version}`}
                          {isOfficialPlugin(plugin.name) && (
                            <Tooltip title="Official first-party plugin">
                              <Box
                                component="span"
                                sx={(theme) => ({ display: "inline-flex", color: theme.palette.nebula.ok })}
                              >
                                <ShieldCheckIcon width={11} height={11} />
                              </Box>
                            </Tooltip>
                          )}
                        </Box>
                      }
                    >
                      <PluginFacts plugin={plugin} />
                    </Fold>
                  ))}
                </Folds>
              </Section>
            )}

            <Section>
              <Fold title="Activity log" defaultExpanded>
                <ActivityLog />
              </Fold>
            </Section>

            {devMode && (
              <Section
                title="Developer"
                action={
                  <Tooltip title="Refresh">
                    <IconButton size="small" aria-label="Refresh debug stats" onClick={refreshStats}>
                      <RefreshCwIcon width={13} height={13} />
                    </IconButton>
                  </Tooltip>
                }
              >
                <Folds>
                  <Fold title="Audio transport">
                    <Facts mono>
                      <Fact mono label="Transport" value={udpActive ? "UDP (encrypted)" : "TCP tunnel"} />
                      <Fact mono label="Force TCP" value={audioSettings?.force_tcp_audio ?? false} />
                    </Facts>
                  </Fold>

                  {audioSettings && (
                    <Fold title="Audio settings">
                      <Facts mono>
                        <Fact
                          mono
                          label="Input device"
                          value={audioSettings.selected_device ?? "System default"}
                        />
                        <Fact mono label="Bitrate" value={`${audioSettings.bitrate_bps / 1000} kb/s`} />
                        <Fact mono label="Frame size" value={`${audioSettings.frame_size_ms} ms`} />
                        <Fact
                          mono
                          label="VAD threshold"
                          value={`${(audioSettings.vad_threshold * 100).toFixed(1)}%`}
                        />
                        <Fact mono label="Auto gain" value={audioSettings.auto_gain} />
                        <Fact mono label="Max gain" value={`${audioSettings.max_gain_db} dB`} />
                        <Fact
                          mono
                          label="Activation"
                          value={ACTIVATION_LABELS[activationKind(audioSettings)]}
                        />
                        <Fact
                          mono
                          label="Gate close ratio"
                          value={`${(audioSettings.noise_gate_close_ratio * 100).toFixed(0)}%`}
                        />
                        <Fact mono label="Hold frames" value={audioSettings.hold_frames} />
                        <Fact mono label="Push to talk" value={audioSettings.push_to_talk} />
                        {audioSettings.push_to_talk_key && (
                          <Fact mono label="PTT key" value={audioSettings.push_to_talk_key} />
                        )}
                      </Facts>
                    </Fold>
                  )}

                  {debugStats && (
                    <>
                      <Fold title="Connection & state">
                        <Facts mono>
                          <Fact mono label="Voice state" value={debugStats.voice_state} />
                          <Fact mono label="Connection epoch" value={debugStats.connection_epoch} />
                          <Fact mono label="App uptime" value={formatDuration(debugStats.uptime_seconds)} />
                          <Fact mono label="Users" value={debugStats.user_count} />
                          <Fact mono label="Channels" value={debugStats.channel_count} />
                        </Facts>
                      </Fold>

                      <Fold title="Messages">
                        <Facts mono>
                          <Fact mono label="Channel messages" value={debugStats.channel_message_count} />
                          <Fact mono label="DM messages" value={debugStats.dm_message_count} />
                          <Fact mono label="Total messages" value={debugStats.total_message_count} />
                          <Fact mono label="Offloaded" value={debugStats.offloaded_count} />
                        </Facts>
                      </Fold>

                      <Fold title="Network latency">
                        <LatencyGraph />
                      </Fold>
                    </>
                  )}

                  {capabilities && (
                    <Fold title="File server">
                      <Facts mono>
                        <Fact
                          mono
                          label="Plugin"
                          value={`${capabilities.plugin.name} v${capabilities.plugin.version}`}
                        />
                        <Fact mono label="Mumble version" value={capabilities.mumble_version.display} />
                        <Fact mono label="Fancy version" value={capabilities.fancy_version.display} />
                        <Fact
                          mono
                          label="Max file size"
                          value={`${(capabilities.limits.max_file_size_bytes / 1024 / 1024).toFixed(0)} MB`}
                        />
                        <Fact
                          mono
                          label="Max storage"
                          value={`${(capabilities.limits.max_total_storage_bytes / 1024 / 1024).toFixed(0)} MB`}
                        />
                        <Fact
                          mono
                          label="File TTL"
                          value={
                            capabilities.features.file_ttl
                              ? `${capabilities.limits.ttl_seconds}s`
                              : "disabled"
                          }
                        />
                        <Fact
                          mono
                          label="Delete on download"
                          value={capabilities.features.delete_on_download}
                        />
                        <Fact
                          mono
                          label="Delete on disconnect"
                          value={capabilities.features.delete_on_disconnect}
                        />
                        <Fact mono label="Custom emotes" value={capabilities.features.custom_emotes} />
                      </Facts>
                    </Fold>
                  )}

                  <Fold title="CSP violations">
                    <Stack direction="row" alignItems="center" sx={{ mb: "6px" }}>
                      <Typography sx={(theme) => ({ fontSize: 11.5, color: theme.palette.nebula.muted })}>
                        {cspViolations.length === 0
                          ? "No violations recorded."
                          : `${cspViolations.length} violation(s)`}
                      </Typography>
                      {cspViolations.length > 0 && (
                        <Tooltip title="Clear violations">
                          <IconButton
                            size="small"
                            aria-label="Clear violations"
                            sx={{ ml: "auto" }}
                            onClick={clearCspViolations}
                          >
                            <CloseIcon width={12} height={12} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                    {cspViolations.map((violation) => (
                      <Box
                        key={violation.id}
                        sx={(theme) => ({
                          py: "4px",
                          borderTop: `1px solid ${theme.palette.nebula.line}`,
                        })}
                      >
                        <Facts mono>
                          <Fact mono label="directive" value={violation.directive} />
                          <Fact mono label="blocked" value={violation.blockedUri || "(empty)"} />
                          <Fact mono label="source" value={violation.source} />
                          <Fact mono label="disposition" value={violation.disposition} />
                        </Facts>
                      </Box>
                    ))}
                  </Fold>
                </Folds>
              </Section>
            )}
          </>
        )}
      </Box>
    </Stack>
  );
}
