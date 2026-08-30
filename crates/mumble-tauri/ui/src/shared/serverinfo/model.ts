/**
 * The facts behind "Server Info", independent of how a UI pack draws them.
 *
 * Standard and Nebula show the same connection, audio and developer figures in
 * very different frames, so the invokes, the developer-mode poll, the CSP
 * listener and the latency graph live here once and each pack owns only its
 * own markup.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getPreferences, getSavedAudioSettings } from "@core/preferencesStorage";
import { useAppStore } from "@core/store";
import type {
  AudioSettings,
  DebugStats,
  FileServerCapabilities,
  PluginInfoRecord,
  ServerInfo,
} from "@core/types";

export interface CspViolationEntry {
  readonly id: number;
  readonly directive: string;
  readonly blockedUri: string;
  readonly source: string;
  readonly disposition: string;
}

export interface ServerInfoModel {
  readonly info: ServerInfo | null;
  readonly welcomeText: string | null;
  /** Settings > Advanced > Developer Mode; gates the whole debug section. */
  readonly devMode: boolean;
  readonly debugStats: DebugStats | null;
  readonly audioSettings: AudioSettings | null;
  /** Advertised plugin infos filtered down to plugins still loaded. */
  readonly livePlugins: readonly PluginInfoRecord[];
  readonly cspViolations: readonly CspViolationEntry[];
  readonly clearCspViolations: () => void;
  readonly refreshStats: () => void;
  readonly udpActive: boolean;
  /** Cipher encrypting UDP audio; null while audio rides the TCP tunnel. */
  readonly udpCipher: string | null;
  readonly capabilities: FileServerCapabilities | null;
  readonly streamerMode: boolean;
}

const MAX_CSP_ENTRIES = 100;
const STATS_POLL_MS = 2000;

export function useServerInfoModel(): ServerInfoModel {
  const udpActive = useAppStore((s) => s.udpActive);
  const udpCipher = useAppStore((s) => s.udpCipher);
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
        if (prefs.userMode === "developer") setDevMode(true);
      })
      .catch(() => {});

    // Load audio settings for the debug overview.
    Promise.all([getSavedAudioSettings(), invoke<AudioSettings>("get_audio_settings")])
      .then(([saved, backend]) => setAudioSettings(saved ?? backend))
      .catch(() => {});
  }, []);

  const refreshStats = useCallback(() => {
    invoke<DebugStats>("get_debug_stats")
      .then(setDebugStats)
      .catch((e) => console.error("get_debug_stats error:", e));
  }, []);

  // Fetch debug stats when developer mode is active, refresh periodically.
  useEffect(() => {
    if (!devMode) return;
    refreshStats();
    const interval = setInterval(refreshStats, STATS_POLL_MS);
    return () => clearInterval(interval);
  }, [devMode, refreshStats]);

  // Capture CSP violations while in developer mode.
  useEffect(() => {
    if (!devMode) return;

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
        return next.length > MAX_CSP_ENTRIES ? next.slice(0, MAX_CSP_ENTRIES) : next;
      });
    };

    document.addEventListener("securitypolicyviolation", handler);
    return () => document.removeEventListener("securitypolicyviolation", handler);
  }, [devMode]);

  const clearCspViolations = useCallback(() => setCspViolations([]), []);

  return {
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
  };
}

/** Decode a Mumble v2-encoded version into "major.minor.patch". */
export function decodeFancyVersion(v: number): string {
  // Encoding: (major << 48) | (minor << 32) | (patch << 16)
  // JS bitwise ops are 32-bit, so use division for the upper bits.
  const major = Math.trunc(v / 2 ** 48) & 0xffff;
  const minor = Math.trunc(v / 2 ** 32) & 0xffff;
  const patch = Math.trunc(v / 2 ** 16) & 0xffff;
  return `${major}.${minor}.${patch}`;
}

export type ActivationKind = "ptt" | "vad" | "continuous";

/** How the mic opens, as one of three named modes. Packs supply the wording. */
export function activationKind(settings: {
  push_to_talk: boolean;
  noise_suppression?: boolean;
}): ActivationKind {
  if (settings.push_to_talk) return "ptt";
  if (settings.noise_suppression) return "vad";
  return "continuous";
}

// -- Latency graph ------------------------------------------------

export const LATENCY_WINDOW_SECS = 10;
export const LATENCY_GRAPH_W = 400;
export const LATENCY_GRAPH_H = 100;

const PAD_L = 36;
const PAD_R = 4;
const PAD_T = 4;
const PAD_B = 16;

interface LatencyPoint {
  time: number;
  rtt: number;
}

/** Colours the graph paints with, so each pack can stay on its own palette. */
export interface LatencyPalette {
  readonly good: string;
  readonly warn: string;
  readonly bad: string;
  readonly grid: string;
  readonly axis: string;
  readonly unit: string;
}

export const DEFAULT_LATENCY_PALETTE: LatencyPalette = {
  good: "#22c55e",
  warn: "#eab308",
  bad: "#ef4444",
  grid: "rgba(255,255,255,0.08)",
  axis: "rgba(255,255,255,0.35)",
  unit: "rgba(255,255,255,0.25)",
};

function latencyColor(rtt: number, palette: LatencyPalette): string {
  if (rtt < 50) return palette.good;
  if (rtt < 120) return palette.warn;
  return palette.bad;
}

function drawGraph(buffer: readonly LatencyPoint[], svg: SVGSVGElement, palette: LatencyPalette): void {
  const plotW = LATENCY_GRAPH_W - PAD_L - PAD_R;
  const plotH = LATENCY_GRAPH_H - PAD_T - PAD_B;

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
    gridSvg += `<line x1="${PAD_L}" y1="${y}" x2="${LATENCY_GRAPH_W - PAD_R}" y2="${y}" stroke="${palette.grid}" stroke-width="0.5"/>`;
    gridSvg += `<text x="${PAD_L - 4}" y="${y + 3}" text-anchor="end" fill="${palette.axis}" font-size="8">${val}</text>`;
  }
  gridSvg += `<text x="${PAD_L - 4}" y="${LATENCY_GRAPH_H - 1}" text-anchor="end" fill="${palette.unit}" font-size="7">ms</text>`;

  const latest = buffer.length > 0 ? buffer[buffer.length - 1].rtt : 0;
  const latestColor = latencyColor(latest, palette);

  svg.innerHTML =
    gridSvg +
    `<polyline points="${polyPoints}" fill="none" stroke="${latestColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    (buffer.length > 0
      ? `<text x="${LATENCY_GRAPH_W - PAD_R}" y="${PAD_T + 10}" text-anchor="end" fill="${latestColor}" font-size="10" font-weight="600">${latest.toFixed(0)} ms</text>`
      : "");
}

/**
 * Run the ping test while mounted and paint every sample into `svgRef`.
 *
 * The samples arrive faster than React should re-render, so the buffer is a ref
 * and the graph is drawn straight into the element on an animation frame.
 */
export function useLatencyGraph(
  svgRef: React.RefObject<SVGSVGElement | null>,
  palette: LatencyPalette = DEFAULT_LATENCY_PALETTE,
): void {
  const bufferRef = useRef<LatencyPoint[]>([]);
  const rafId = useRef(0);
  // Read through a ref so a caller passing a fresh palette object each render
  // does not tear down the listener.
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

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
      rafId.current = requestAnimationFrame(() => {
        const svg = svgRef.current;
        if (svg) drawGraph(buf, svg, paletteRef.current);
      });
    });

    return () => {
      cancelAnimationFrame(rafId.current);
      unlisten.then((f) => f());
    };
  }, [svgRef]);
}
