/**
 * The facts behind "Server Info", independent of how a UI pack draws them.
 *
 * Standard and Nebula show the same connection, audio and developer figures in
 * very different frames, so the invokes, the developer-mode poll, the CSP
 * listener and the latency feed live here once and each pack owns only its
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
export { fancyVersionDecode as decodeFancyVersion } from "@core/utils/version";

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

// -- Latency ------------------------------------------------------

/** How much of the recent past the chart keeps, in seconds. */
export const LATENCY_WINDOW_SECS = 60;

/** Round trips under this read as a healthy link. */
export const LATENCY_GOOD_MS = 50;
/** Round trips under this are still usable; at or over it the link is poor. */
export const LATENCY_FAIR_MS = 120;

/** One round-trip reading: when it landed, and what it measured. */
export interface LatencySample {
  /**
   * `performance.now()` when the reading arrived.
   *
   * A monotonic clock rather than the wall one, so a system clock stepped
   * while the panel is open cannot empty the window or stretch the axis.
   */
  readonly at: number;
  /** Round trip in milliseconds. */
  readonly rtt: number;
}

/** The three named bands, so a reading is described and not only coloured. */
export type LatencyGrade = "good" | "fair" | "poor";

export function latencyGrade(rtt: number): LatencyGrade {
  if (rtt < LATENCY_GOOD_MS) return "good";
  if (rtt < LATENCY_FAIR_MS) return "fair";
  return "poor";
}

/** The figures the readout states in text, beside the line that draws them. */
export interface LatencySummary {
  /** The most recent reading, or null before the first one lands. */
  readonly latest: number | null;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  readonly count: number;
}

export function summariseLatency(samples: readonly LatencySample[]): LatencySummary {
  if (samples.length === 0) {
    return { latest: null, min: 0, max: 0, avg: 0, count: 0 };
  }
  let min = Infinity;
  let max = 0;
  let total = 0;
  for (const sample of samples) {
    if (sample.rtt < min) min = sample.rtt;
    if (sample.rtt > max) max = sample.rtt;
    total += sample.rtt;
  }
  return {
    latest: samples[samples.length - 1].rtt,
    min,
    max,
    avg: total / samples.length,
    count: samples.length,
  };
}

/** What the chart is given: the window's readings, and why there are none. */
export interface LatencyFeed {
  readonly samples: readonly LatencySample[];
  /** The reason the ping test would not start, or null while it is running. */
  readonly error: string | null;
}

/**
 * Run the ping test for as long as something is showing it, and keep the
 * readings it produces.
 *
 * Two details are load-bearing. The listener goes up *before* the test is
 * asked to start, because a server on the same machine answers in well under
 * a millisecond and Tauri does not replay an event that arrived before
 * anything was listening. And the failure to start is kept rather than
 * swallowed: a panel that silently draws nothing looks exactly like a
 * connection with no latency to report, which is how an empty graph went
 * unexplained for as long as it did.
 */
export function useLatencyFeed(): LatencyFeed {
  const [samples, setSamples] = useState<LatencySample[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;

    void (async () => {
      const off = await listen<{ rtt_ms: number }>("ping-latency", (event) => {
        const at = performance.now();
        const cutoff = at - LATENCY_WINDOW_SECS * 1000;
        setSamples((current) => {
          const next = current.filter((sample) => sample.at >= cutoff);
          next.push({ at, rtt: event.payload.rtt_ms });
          return next;
        });
      });
      if (!live) {
        off();
        return;
      }
      unlisten = off;
      try {
        await invoke("start_latency_test");
        if (live) setError(null);
      } catch (e) {
        if (live) setError(String(e));
      }
    })();

    return () => {
      live = false;
      unlisten?.();
      invoke("stop_latency_test").catch(() => undefined);
    };
  }, []);

  return { samples, error };
}
