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
 * Samples at 1 Hz through a {@link StatsSampler} created by the active
 * stream-viewer strategy's factory - the webview family samples
 * `RTCPeerConnection.getStats()`, the native family the Rust peer plus the
 * viewport's decode metrics. The stats parsing and per-interval derivation
 * are exported as pure functions for unit tests.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "../../../icons";
import { TID } from "../../../testids";
import type { StatsSampler } from "./viewerStrategy";
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

/** Per-video-track receive-side counters. A screen+camera share has one of
 *  these per inbound video track, so the panel can show BOTH. */
export interface VideoTrackStats {
  /** SDP mid of the inbound track (maps to screen/camera content). */
  mid: string | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  framesDecoded: number;
  framesDropped: number;
  freezeCount: number;
  totalFreezesDurationS: number;
  packetsReceived: number;
  packetsLost: number;
  jitterMs: number | null;
  videoCodec: string | null;
  /** Decoder backend name reported by the UA, e.g. "ExternalDecoder"
   *  (hardware) vs "libvpx"/"FFmpeg"/"OpenH264" (software). */
  decoderImplementation: string | null;
  /** True when the UA decodes this track on a power-efficient (hardware)
   *  path. The single clearest "is decode accelerated?" signal. */
  powerEfficient: boolean | null;
  /** Cumulative decode time in seconds (spec: summed per decoded frame).
   *  Divided by framesDecoded it yields ms/frame - a HW decoder does ~2 MP in
   *  1-3 ms, software 15-30 ms - so it exposes software fallback even when the
   *  UA omits `decoderImplementation`. */
  totalDecodeTimeS: number;
}

/** One absolute snapshot of the connection's receive-side counters. The
 *  connection-level fields (bytes, RTT, ICE path, audio) are shared; the
 *  per-track video counters live in {@link videos}. The top-level video
 *  fields mirror the FIRST video track for backward compatibility. */
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
  /** One entry per inbound video track (screen and/or camera). */
  videos: VideoTrackStats[];
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
    videos: [],
  };

  extractSelectedPair(all, byId, sample);
  let jitterBufferDelay = 0;
  let jitterBufferEmittedCount = 0;
  for (const r of all) {
    if (r.type !== "inbound-rtp") continue;
    const kind = str(r.kind) ?? str(r.mediaType);
    sample.bytesReceived += num(r.bytesReceived) ?? 0;
    const codecId = str(r.codecId);
    const codec = codecId ? byId.get(codecId) : undefined;
    if (kind === "video") {
      sample.videos.push(extractVideoTrack(r, codec));
      // Jitter-buffer delay is summed across video tracks for the (shared)
      // buffer-health graph.
      jitterBufferDelay += num(r.jitterBufferDelay) ?? 0;
      jitterBufferEmittedCount += num(r.jitterBufferEmittedCount) ?? 0;
    } else if (kind === "audio" && codec) {
      sample.audioCodec = formatCodec(codec);
    }
  }
  sample.jitterBufferDelay = jitterBufferDelay;
  sample.jitterBufferEmittedCount = jitterBufferEmittedCount;

  // Mirror the first video track into the legacy top-level fields, and
  // aggregate packet counters across tracks for the connection-level loss %.
  const first = sample.videos[0];
  if (first) {
    sample.frameWidth = first.frameWidth;
    sample.frameHeight = first.frameHeight;
    sample.framesPerSecond = first.framesPerSecond;
    sample.framesDecoded = first.framesDecoded;
    sample.framesDropped = first.framesDropped;
    sample.freezeCount = first.freezeCount;
    sample.totalFreezesDurationS = first.totalFreezesDurationS;
    sample.jitterMs = first.jitterMs;
    sample.videoCodec = first.videoCodec;
  }
  for (const v of sample.videos) {
    sample.packetsReceived += v.packetsReceived;
    sample.packetsLost += v.packetsLost;
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

function extractVideoTrack(r: StatsDict, codec: StatsDict | undefined): VideoTrackStats {
  const jitter = num(r.jitter);
  return {
    mid: str(r.mid),
    frameWidth: num(r.frameWidth),
    frameHeight: num(r.frameHeight),
    framesPerSecond: num(r.framesPerSecond),
    framesDecoded: num(r.framesDecoded) ?? 0,
    framesDropped: num(r.framesDropped) ?? 0,
    freezeCount: num(r.freezeCount) ?? 0,
    totalFreezesDurationS: num(r.totalFreezesDuration) ?? 0,
    packetsReceived: num(r.packetsReceived) ?? 0,
    packetsLost: num(r.packetsLost) ?? 0,
    jitterMs: jitter === null ? null : jitter * 1000,
    videoCodec: codec ? formatCodec(codec) : null,
    decoderImplementation: str(r.decoderImplementation),
    powerEfficient: typeof r.powerEfficientDecoder === "boolean" ? r.powerEfficientDecoder : null,
    totalDecodeTimeS: num(r.totalDecodeTime) ?? 0,
  };
}

/** Decoder diagnostic string: implementation name (when the UA exposes it),
 *  HW/SW power-efficiency, and average decode time per frame. The ms/frame is
 *  the reliable part - it exposes a software decoder even when the name and
 *  power-efficient flag are absent (WebView2 commonly omits both). */
function formatDecoder(v: VideoTrackStats): string {
  const parts: string[] = [];
  if (v.decoderImplementation) parts.push(v.decoderImplementation);
  if (v.powerEfficient === true) parts.push("HW");
  else if (v.powerEfficient === false) parts.push("SW");
  if (v.framesDecoded > 0 && v.totalDecodeTimeS > 0) {
    parts.push(`${((v.totalDecodeTimeS / v.framesDecoded) * 1000).toFixed(1)} ms/frame`);
  }
  return parts.length > 0 ? parts.join(" · ") : "–";
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
  fps: number[];
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

/** Sampler over one webview `RTCPeerConnection` - the webview strategy's
 *  factory product, and directly usable for standalone PCs (stream popout). */
export function createPcStatsSampler(getPc: () => RTCPeerConnection | null): StatsSampler {
  return {
    async sample() {
      const pc = getPc();
      if (!pc || pc.connectionState === "closed") return null;
      let report: RTCStatsReport;
      try {
        report = await pc.getStats();
      } catch {
        return null; // PC closed mid-call; the next tick handles it
      }
      return {
        sample: parseStatsReports(report.values() as Iterable<StatsDict>, performance.now()),
        connectionState: pc.connectionState,
      };
    },
  };
}

interface StreamStatsPanelProps {
  /** Per-session probe from the active viewer strategy's factory
   *  (`activeStreamViewerStrategy().createStatsSampler(session)`). */
  readonly sampler: StatsSampler;
  /** The video element, for viewport size and volume rows (webview family;
   *  the native canvas viewport has none). */
  readonly videoRef?: React.RefObject<HTMLVideoElement | null>;
  /** SDP-mid -> content, so each inbound video track is labelled screen /
   *  camera in a screen+camera share. */
  readonly contentByMid?: Readonly<Record<string, "screen" | "camera">>;
  readonly onClose: () => void;
}

export default function StreamStatsPanel({ sampler, videoRef, contentByMid, onClose }: StreamStatsPanelProps) {
  const { t } = useTranslation("chat");
  const [data, setData] = useState<PanelData | null>(null);
  const prevSampleRef = useRef<StatsSample | null>(null);
  const historiesRef = useRef<Histories>({ bitrate: [], network: [], buffer: [], rtt: [], fps: [] });

  const tick = useCallback(async () => {
    let result: Awaited<ReturnType<StatsSampler["sample"]>>;
    try {
      result = await sampler.sample();
    } catch {
      return; // transient sampler failure; the next tick handles it
    }
    if (!result) {
      prevSampleRef.current = null;
      setData(null);
      return;
    }
    const { sample, connectionState } = result;
    const interval = deriveIntervalStats(prevSampleRef.current, sample);
    prevSampleRef.current = sample;
    const hist = historiesRef.current;
    pushHistory(hist.bitrate, interval.bitrateKbps);
    pushHistory(hist.network, interval.networkKBps);
    pushHistory(hist.buffer, interval.bufferMs);
    pushHistory(hist.rtt, sample.rttMs);
    pushHistory(hist.fps, interval.fps);
    setData({
      sample,
      interval,
      connectionState,
      hist: {
        bitrate: [...hist.bitrate],
        network: [...hist.network],
        buffer: [...hist.buffer],
        rtt: [...hist.rtt],
        fps: [...hist.fps],
      },
    });
  }, [sampler]);

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

  const info = describeVideoElement(videoRef?.current ?? null, t("screenShare.stats.muted"));

  interface Row {
    key: string;
    label: string;
    value: string;
    graph?: readonly number[];
    color?: string;
    /** Renders as a sub-heading separating one video track's rows. */
    heading?: boolean;
    testid?: string;
  }
  const rows: Row[] = [];
  if (data) {
    const { sample, interval, hist } = data;
    // Prefer the render-side counters (what the user actually saw miss its
    // deadline); fall back to the RTP decode counters when unavailable.
    const droppedFrames = info.droppedFrames ?? sample.framesDropped;
    const totalFrames = info.totalFrames ?? sample.framesDropped + sample.framesDecoded;
    const icePathSuffix = sample.icePath ? ` (${sample.icePath})` : "";

    // Connection-level rows (shared by all tracks).
    rows.push(
      {
        key: "viewportFrames",
        label: t("screenShare.stats.viewportFrames"),
        value: `${info.viewport} / ${t("screenShare.stats.dropped", {
          dropped: droppedFrames,
          total: totalFrames,
        })}`,
      },
      { key: "volume", label: t("screenShare.stats.volume"), value: info.volume },
      {
        key: "fps",
        label: t("screenShare.stats.fps"),
        value: `${fmt(interval.fps, 1)} fps`,
        graph: hist.fps,
        color: "#e678d8",
        testid: TID.streamStatsFps,
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
      { key: "audioCodec", label: t("screenShare.stats.audioCodec"), value: sample.audioCodec ?? "–" },
    );

    // Per-video-track rows - a screen+camera share lists BOTH. Each group is
    // headed by what the track shows (screen / camera). Only announced tracks
    // are shown: after a track is removed (e.g. the screen ended) its inbound
    // stats linger for a while with the old resolution, so - exactly like the
    // video display in `computeStreams` - we drop any track whose mid is no
    // longer in the content map.
    const videos = contentByMid
      ? sample.videos.filter((v) => v.mid == null || contentByMid[v.mid] !== undefined)
      : sample.videos;
    videos.forEach((v, i) => {
      const content = v.mid != null ? contentByMid?.[v.mid] : undefined;
      const heading = content === "camera"
        ? t("screenShare.stats.trackCamera")
        : content === "screen"
          ? t("screenShare.stats.trackScreen")
          : t("screenShare.stats.trackVideo", { n: i + 1 });
      const res = v.frameWidth && v.frameHeight
        ? `${v.frameWidth}×${v.frameHeight}@${fmt(v.framesPerSecond)}`
        : "–";
      rows.push(
        { key: `t${i}-h`, label: heading, value: "", heading: true },
        {
          key: `t${i}-res`,
          label: t("screenShare.stats.currentRes"),
          value: res,
          testid: TID.streamStatsResolution,
        },
        { key: `t${i}-codec`, label: t("screenShare.stats.codec"), value: v.videoCodec ?? "–" },
        {
          key: `t${i}-decoder`,
          // Untranslated on purpose: a technical diagnostic. Shows the UA's
          // decoder backend, whether it is power-efficient (hardware), and the
          // average per-frame decode time. Slow ms/frame (>~10 ms for ~2 MP)
          // means a software decoder, the usual cause of render-sink frame
          // drops on otherwise-capable hardware - and it is present even when
          // the UA omits the implementation name (which WebView2 often does).
          label: "Decoder",
          value: formatDecoder(v),
        },
        {
          key: `t${i}-freezes`,
          label: t("screenShare.stats.freezes"),
          value: t("screenShare.stats.freezesValue", {
            n: v.freezeCount,
            seconds: v.totalFreezesDurationS.toFixed(1),
          }),
          testid: TID.streamStatsFreezes,
        },
        { key: `t${i}-jitter`, label: t("screenShare.stats.jitter"), value: `${fmt(v.jitterMs, 1)} ms` },
      );
    });

    rows.push({ key: "date", label: t("screenShare.stats.date"), value: new Date().toString() });
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
            row.heading ? (
              <div key={row.key} className={styles.trackHeading}>{row.label}</div>
            ) : (
              <div key={row.key} className={styles.row} data-testid={row.testid}>
                <span className={styles.label}>{row.label}</span>
                <span className={styles.value}>
                  {row.graph && <Sparkline values={row.graph} color={row.color ?? "#ddd"} />}
                  <span className={styles.valueText}>{row.value}</span>
                </span>
              </div>
            )
          ))}
        </div>
      ) : (
        <div className={styles.waiting}>{t("screenShare.stats.waiting")}</div>
      )}
    </div>
  );
}
