/**
 * StreamStatsPanel - "Stats for Nerds" overlay for a live screen share.
 *
 * Modeled after YouTube's panel of the same name, adapted to a live
 * WebRTC stream: alongside the familiar viewport / resolution / codec /
 * connection-speed / network-activity / buffer-health rows (the last
 * three with YouTube-style scrolling bar graphs) it surfaces the
 * numbers that matter for a realtime stream - network latency (RTT,
 * also graphed), packet loss, jitter and the selected ICE path.
 *
 * Samples `RTCPeerConnection.getStats()` at 1 Hz through a `getPc`
 * getter (re-read every tick so viewer reconnects are picked up
 * transparently). The stats parsing and per-interval derivation are
 * exported as pure functions for unit tests.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "../../../icons";
import styles from "./StreamStatsPanel.module.css";

// ---------------------------------------------------------------------------
// Pure stats extraction (exported for tests)
// ---------------------------------------------------------------------------

type StatsDict = Record<string, unknown>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** One absolute snapshot of the connection's receive-side counters. */
export interface StatsSample {
  timestampMs: number;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  framesDecoded: number;
  /** Frames the receive pipeline discarded before/at decode. Render-side
   *  drops are NOT in here - see `getVideoPlaybackQuality()` in the panel. */
  framesDropped: number;
  /** Stream freezes (inter-frame gap far above average) - the stat that
   *  actually captures visible stutter on a live stream. */
  freezeCount: number;
  /** Total seconds the stream spent frozen (cumulative). */
  totalFreezesDurationS: number;
  /** Video + audio bytes combined (cumulative). */
  bytesReceived: number;
  packetsReceived: number;
  packetsLost: number;
  jitterMs: number | null;
  /** Cumulative jitter-buffer delay in seconds (spec: sum over emitted samples). */
  jitterBufferDelay: number;
  jitterBufferEmittedCount: number;
  videoCodec: string | null;
  audioCodec: string | null;
  rttMs: number | null;
  /** Selected ICE candidate types, "local / remote" (e.g. "host / srflx"). */
  icePath: string | null;
}

/** "video/H264" + "…profile-level-id=42e01f…" becomes "H264 (42e01f)". */
function formatCodec(codec: StatsDict): string | null {
  const mime = str(codec.mimeType);
  if (!mime) return null;
  const name = mime.split("/")[1] ?? mime;
  const fmtp = str(codec.sdpFmtpLine);
  const profile = fmtp ? /profile-level-id=([0-9a-fA-F]+)/.exec(fmtp)?.[1] : null;
  return profile ? `${name} (${profile})` : name;
}

/**
 * Reduce a `pc.getStats()` report (any iterable of stats dictionaries)
 * to the snapshot the panel displays.
 */
export function parseStatsReports(reports: Iterable<StatsDict>, timestampMs: number): StatsSample {
  const byId = new Map<string, StatsDict>();
  const all: StatsDict[] = [];
  for (const report of reports) {
    all.push(report);
    const id = str(report.id);
    if (id) byId.set(id, report);
  }

  const sample: StatsSample = {
    timestampMs,
    frameWidth: null,
    frameHeight: null,
    framesPerSecond: null,
    framesDecoded: 0,
    framesDropped: 0,
    freezeCount: 0,
    totalFreezesDurationS: 0,
    bytesReceived: 0,
    packetsReceived: 0,
    packetsLost: 0,
    jitterMs: null,
    jitterBufferDelay: 0,
    jitterBufferEmittedCount: 0,
    videoCodec: null,
    audioCodec: null,
    rttMs: null,
    icePath: null,
  };

  extractSelectedPair(all, byId, sample);
  for (const r of all) {
    if (r.type !== "inbound-rtp") continue;
    const kind = str(r.kind) ?? str(r.mediaType);
    sample.bytesReceived += num(r.bytesReceived) ?? 0;
    const codecId = str(r.codecId);
    const codec = codecId ? byId.get(codecId) : undefined;
    if (kind === "video") {
      extractVideoInbound(r, codec, sample);
    } else if (kind === "audio" && codec) {
      sample.audioCodec = formatCodec(codec);
    }
  }
  return sample;
}

/**
 * Selected ICE pair: `transport.selectedCandidatePairId` is the modern
 * route; fall back to scanning for the nominated succeeded pair.
 */
function extractSelectedPair(all: StatsDict[], byId: Map<string, StatsDict>, sample: StatsSample): void {
  const transport = all.find((r) => r.type === "transport" && str(r.selectedCandidatePairId));
  const pairId = transport ? str(transport.selectedCandidatePairId) : null;
  const pair = (pairId ? byId.get(pairId) : undefined)
    ?? all.find((r) => r.type === "candidate-pair" && r.state === "succeeded" && r.nominated === true);
  if (!pair) return;
  const rtt = num(pair.currentRoundTripTime);
  if (rtt !== null) sample.rttMs = rtt * 1000;
  const localId = str(pair.localCandidateId);
  const remoteId = str(pair.remoteCandidateId);
  const localType = localId ? str(byId.get(localId)?.candidateType) : null;
  const remoteType = remoteId ? str(byId.get(remoteId)?.candidateType) : null;
  if (localType || remoteType) sample.icePath = `${localType ?? "?"} / ${remoteType ?? "?"}`;
}

function extractVideoInbound(r: StatsDict, codec: StatsDict | undefined, sample: StatsSample): void {
  sample.frameWidth = num(r.frameWidth);
  sample.frameHeight = num(r.frameHeight);
  sample.framesPerSecond = num(r.framesPerSecond);
  sample.framesDecoded = num(r.framesDecoded) ?? 0;
  sample.framesDropped = num(r.framesDropped) ?? 0;
  sample.freezeCount = num(r.freezeCount) ?? 0;
  sample.totalFreezesDurationS = num(r.totalFreezesDuration) ?? 0;
  sample.packetsReceived = num(r.packetsReceived) ?? 0;
  sample.packetsLost = num(r.packetsLost) ?? 0;
  const jitter = num(r.jitter);
  sample.jitterMs = jitter === null ? null : jitter * 1000;
  sample.jitterBufferDelay = num(r.jitterBufferDelay) ?? 0;
  sample.jitterBufferEmittedCount = num(r.jitterBufferEmittedCount) ?? 0;
  if (codec) sample.videoCodec = formatCodec(codec);
}

/** Rates derived from two consecutive snapshots. */
export interface IntervalStats {
  /** Total inbound bitrate over the interval, kbit/s. */
  bitrateKbps: number | null;
  /** Bytes moved over the interval, KiB/s. */
  networkKBps: number | null;
  /** Reported FPS, or derived from the decode delta when absent. */
  fps: number | null;
  /** Packets lost in the interval as % of packets expected in it. */
  lossPct: number | null;
  /** Mean jitter-buffer (playout) delay over the interval, ms. */
  bufferMs: number | null;
}

export function deriveIntervalStats(prev: StatsSample | null, curr: StatsSample): IntervalStats {
  const out: IntervalStats = {
    bitrateKbps: null,
    networkKBps: null,
    fps: curr.framesPerSecond,
    lossPct: null,
    bufferMs: null,
  };
  if (!prev) return out;
  const dt = (curr.timestampMs - prev.timestampMs) / 1000;
  if (dt <= 0) return out;

  // Clamp deltas at 0: counters reset when the viewer PC is rebuilt after
  // a reconnect, and packetsLost may even decrease when RTX recovers a
  // packet that was already counted as lost.
  const dBytes = Math.max(0, curr.bytesReceived - prev.bytesReceived);
  out.bitrateKbps = (dBytes * 8) / dt / 1000;
  out.networkKBps = dBytes / dt / 1024;

  out.fps ??= Math.max(0, curr.framesDecoded - prev.framesDecoded) / dt;

  const dLost = Math.max(0, curr.packetsLost - prev.packetsLost);
  const dReceived = Math.max(0, curr.packetsReceived - prev.packetsReceived);
  if (dLost + dReceived > 0) out.lossPct = (dLost / (dLost + dReceived)) * 100;

  const dEmitted = curr.jitterBufferEmittedCount - prev.jitterBufferEmittedCount;
  const dDelay = curr.jitterBufferDelay - prev.jitterBufferDelay;
  if (dEmitted > 0 && dDelay >= 0) out.bufferMs = (dDelay / dEmitted) * 1000;

  return out;
}

// ---------------------------------------------------------------------------
// Scrolling bar graph (YouTube-style)
// ---------------------------------------------------------------------------

/** Samples kept per graph (one per second - a one-minute window). */
const HISTORY_LEN = 60;

function Sparkline({ values, color }: { readonly values: readonly number[]; readonly color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = globalThis.devicePixelRatio ?? 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(...values, 1e-6);
    const barW = w / HISTORY_LEN;
    ctx.fillStyle = color;
    // Newest sample on the right, scrolling left.
    for (const [i, value] of values.entries()) {
      const x = w - (values.length - i) * barW;
      const barH = Math.max(1, (value / max) * (h - 1));
      ctx.fillRect(x, h - barH, Math.max(1, barW - 1), barH);
    }
  }, [values, color]);
  return <canvas ref={canvasRef} className={styles.sparkline} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Panel component
// ---------------------------------------------------------------------------

interface Histories {
  bitrate: number[];
  network: number[];
  buffer: number[];
  rtt: number[];
}

interface PanelData {
  sample: StatsSample;
  interval: IntervalStats;
  connectionState: string;
  /** Copied per tick so React re-renders see fresh arrays. */
  hist: Histories;
}

function pushHistory(arr: number[], value: number | null): void {
  arr.push(value ?? 0);
  if (arr.length > HISTORY_LEN) arr.splice(0, arr.length - HISTORY_LEN);
}

function fmt(value: number | null, digits = 0): string {
  return value === null ? "–" : value.toFixed(digits);
}

interface VideoElementInfo {
  viewport: string;
  volume: string;
  /** Render-pipeline drop counters from `getVideoPlaybackQuality()` -
   *  frames the compositor skipped because they were presented too late.
   *  This is what YouTube's "dropped" counts; the RTP `framesDropped`
   *  counter only covers decoder-side discards and stays near zero even
   *  on a visibly stuttering stream. */
  droppedFrames: number | null;
  totalFrames: number | null;
}

function describeVideoElement(video: HTMLVideoElement | null, mutedLabel: string): VideoElementInfo {
  if (!video) {
    return { viewport: "–", volume: "–", droppedFrames: null, totalFrames: null };
  }
  const viewport = video.clientWidth > 0 ? `${video.clientWidth}×${video.clientHeight}` : "–";
  const volume = video.muted ? `0% (${mutedLabel})` : `${Math.round(video.volume * 100)}%`;
  const quality = video.getVideoPlaybackQuality?.();
  return {
    viewport,
    volume,
    droppedFrames: quality?.droppedVideoFrames ?? null,
    totalFrames: quality?.totalVideoFrames ?? null,
  };
}

interface StreamStatsPanelProps {
  /** Re-read every tick so a rebuilt viewer PC (reconnect) is picked up. */
  readonly getPc: () => RTCPeerConnection | null;
  /** The video element, for viewport size and volume rows. */
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly onClose: () => void;
}

export default function StreamStatsPanel({ getPc, videoRef, onClose }: StreamStatsPanelProps) {
  const { t } = useTranslation("chat");
  const [data, setData] = useState<PanelData | null>(null);
  const prevSampleRef = useRef<StatsSample | null>(null);
  const historiesRef = useRef<Histories>({ bitrate: [], network: [], buffer: [], rtt: [] });

  const tick = useCallback(async () => {
    const pc = getPc();
    if (!pc || pc.connectionState === "closed") {
      prevSampleRef.current = null;
      setData(null);
      return;
    }
    let report: RTCStatsReport;
    try {
      report = await pc.getStats();
    } catch {
      return; // e.g. the PC closed mid-call; the next tick handles it
    }
    const sample = parseStatsReports(report.values() as Iterable<StatsDict>, performance.now());
    const interval = deriveIntervalStats(prevSampleRef.current, sample);
    prevSampleRef.current = sample;
    const hist = historiesRef.current;
    pushHistory(hist.bitrate, interval.bitrateKbps);
    pushHistory(hist.network, interval.networkKBps);
    pushHistory(hist.buffer, interval.bufferMs);
    pushHistory(hist.rtt, sample.rttMs);
    setData({
      sample,
      interval,
      connectionState: pc.connectionState,
      hist: {
        bitrate: [...hist.bitrate],
        network: [...hist.network],
        buffer: [...hist.buffer],
        rtt: [...hist.rtt],
      },
    });
  }, [getPc]);

  useEffect(() => {
    let cancelled = false;
    const run = () => { if (!cancelled) void tick(); };
    run();
    const id = setInterval(run, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tick]);

  const info = describeVideoElement(videoRef.current, t("screenShare.stats.muted"));

  const rows: { key: string; label: string; value: string; graph?: readonly number[]; color?: string }[] = [];
  if (data) {
    const { sample, interval, hist } = data;
    // Prefer the render-side counters (what the user actually saw miss its
    // deadline); fall back to the RTP decode counters when unavailable.
    const droppedFrames = info.droppedFrames ?? sample.framesDropped;
    const totalFrames = info.totalFrames ?? sample.framesDropped + sample.framesDecoded;
    const currentRes = sample.frameWidth && sample.frameHeight
      ? `${sample.frameWidth}×${sample.frameHeight}@${fmt(interval.fps)}`
      : "–";
    const icePathSuffix = sample.icePath ? ` (${sample.icePath})` : "";
    rows.push(
      {
        key: "viewportFrames",
        label: t("screenShare.stats.viewportFrames"),
        value: `${info.viewport} / ${t("screenShare.stats.dropped", {
          dropped: droppedFrames,
          total: totalFrames,
        })}`,
      },
      {
        key: "currentRes",
        label: t("screenShare.stats.currentRes"),
        value: currentRes,
      },
      { key: "volume", label: t("screenShare.stats.volume"), value: info.volume },
      {
        key: "codecs",
        label: t("screenShare.stats.codecs"),
        value: `${sample.videoCodec ?? "–"} / ${sample.audioCodec ?? "–"}`,
      },
      {
        key: "connection",
        label: t("screenShare.stats.connection"),
        value: data.connectionState + icePathSuffix,
      },
      {
        key: "connectionSpeed",
        label: t("screenShare.stats.connectionSpeed"),
        value: `${fmt(interval.bitrateKbps)} kbps`,
        graph: hist.bitrate,
        color: "#7ab8ff",
      },
      {
        key: "networkActivity",
        label: t("screenShare.stats.networkActivity"),
        value: `${fmt(interval.networkKBps)} KB/s`,
        graph: hist.network,
        color: "#4dd0a6",
      },
      {
        key: "bufferHealth",
        label: t("screenShare.stats.bufferHealth"),
        value: `${fmt(interval.bufferMs)} ms`,
        graph: hist.buffer,
        color: "#b7d84b",
      },
      {
        key: "latency",
        label: t("screenShare.stats.latency"),
        value: `${fmt(sample.rttMs)} ms`,
        graph: hist.rtt,
        color: "#ff9f43",
      },
      {
        key: "packetLoss",
        label: t("screenShare.stats.packetLoss"),
        value: t("screenShare.stats.packetLossValue", {
          pct: (interval.lossPct ?? 0).toFixed(1),
          total: sample.packetsLost,
        }),
      },
      {
        key: "freezes",
        label: t("screenShare.stats.freezes"),
        value: t("screenShare.stats.freezesValue", {
          n: sample.freezeCount,
          seconds: sample.totalFreezesDurationS.toFixed(1),
        }),
      },
      { key: "jitter", label: t("screenShare.stats.jitter"), value: `${fmt(sample.jitterMs, 1)} ms` },
      { key: "date", label: t("screenShare.stats.date"), value: new Date().toString() },
    );
  }

  return (
    <div className={styles.panel} data-testid="stream-stats-panel">
      <div className={styles.header}>
        <span className={styles.title}>{t("screenShare.stats.toggle")}</span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          title={t("screenShare.stats.close")}
          aria-label={t("screenShare.stats.close")}
        >
          <CloseIcon width={13} height={13} />
        </button>
      </div>
      {data ? (
        <div className={styles.grid}>
          {rows.map((row) => (
            <div key={row.key} className={styles.row}>
              <span className={styles.label}>{row.label}</span>
              <span className={styles.value}>
                {row.graph && <Sparkline values={row.graph} color={row.color ?? "#ddd"} />}
                <span className={styles.valueText}>{row.value}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.waiting}>{t("screenShare.stats.waiting")}</div>
      )}
    </div>
  );
}
