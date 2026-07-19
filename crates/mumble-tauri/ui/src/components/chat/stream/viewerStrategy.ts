/**
 * Strategy layer for HOW streams are received, rendered and measured.
 *
 * Two families exist today, each registering itself here at module load:
 *
 * - "webview" (useScreenShare.ts): RTCPeerConnection viewers decoding in the
 *   webview, rendered into `<video>` - the shipped Windows/WebView2 route.
 * - "native" (nativeStreamView.ts): a Rust-side peer per session with the
 *   webview only decoding (WebCodecs) / painting - the Linux route, where
 *   WebKitGTK has no WebRTC.
 *
 * Each strategy is also the ABSTRACT FACTORY for its per-session objects:
 * the receive transport (watch/unwatch) and the Stats-for-Nerds sampler.
 * The viewport component family is selected by `id` in ScreenShareViewer.
 *
 * Selection is capability-driven (webview when `RTCPeerConnection` exists)
 * with a RUNTIME feature-flag override, so e.g. a Windows build can be
 * switched to the native family without code changes once its backend
 * compiles there:
 *
 *     localStorage.setItem("fancy.streamViewerStrategy", "native")  // or "webview"
 *     localStorage.removeItem("fancy.streamViewerStrategy")        // back to auto
 *
 * (Reload after changing it; the choice is latched at first use so every
 * consumer of a session agrees on one family.)
 */
import type { StatsSample } from "./StreamStatsPanel";

/** Registered strategy families. */
export type StreamViewerStrategyId = "webview" | "native";

/** One Stats-for-Nerds probe, created per open panel by its strategy. */
export interface StatsSampler {
  /** One 1 Hz snapshot; null when the session has no live receive path. */
  sample(): Promise<{ sample: StatsSample; connectionState: string } | null>;
}

/** A stream-viewing family: receive transport + stats, per session. */
export interface StreamViewerStrategy {
  readonly id: StreamViewerStrategyId;
  /** Whether this strategy can work in this webview/build at all. */
  isAvailable(): boolean;
  /** Open the receive path for a broadcaster session ahead of (or outside)
   *  a mounted viewport - loopback preview, channel auto-connect. Families
   *  whose viewports own their transport lifecycle no-op here. */
  watch(session: number): Promise<void>;
  /** Whether `session` currently has an open non-viewport receive path. */
  isWatching(session: number): boolean;
  /** Close the non-viewport receive path for `session` (no-op when none). */
  unwatch(session: number): void;
  /** Factory: the Stats-for-Nerds sampler for one session. */
  createStatsSampler(session: number): StatsSampler;
}

/** Registry + latched selection, pinned on `globalThis`: registration is a
 *  module side effect, and a hot-swap that re-instanced this module with a
 *  fresh empty Map (while the registering modules didn't re-run) surfaced
 *  as "no stream viewer strategy registered". One shared instance per
 *  webview makes registration order/instancing irrelevant. */
interface StrategyGlobals {
  registry: Map<StreamViewerStrategyId, StreamViewerStrategy>;
  active: StreamViewerStrategy | null;
}

const globals: StrategyGlobals = ((
  globalThis as { __fancyStreamViewerStrategies?: StrategyGlobals }
).__fancyStreamViewerStrategies ??= { registry: new Map(), active: null });

/** Strategies self-register at module load (before any stream UI mounts).
 *  Idempotent per id, so a re-evaluated module just overwrites itself; the
 *  latched selection is dropped so it can never outlive its instance. */
export function registerStreamViewerStrategy(strategy: StreamViewerStrategy): void {
  globals.registry.set(strategy.id, strategy);
  if (globals.active?.id === strategy.id) {
    globals.active = null;
  }
}

// Singleton state (the registry feeds live components); a hot-swap must
// reload the page like useScreenShare does, not strand stale instances.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}

/** The runtime override flag, when set to a valid family name. */
function flaggedStrategyId(): StreamViewerStrategyId | null {
  try {
    const value = globalThis.localStorage?.getItem("fancy.streamViewerStrategy");
    return value === "webview" || value === "native" ? value : null;
  } catch {
    return null; // storage disabled
  }
}

/**
 * The strategy every stream consumer must use, chosen once per page load:
 * the flagged family when it is registered and available, else the first
 * available in preference order (webview, then native).
 */
export function activeStreamViewerStrategy(): StreamViewerStrategy {
  if (globals.active) return globals.active;

  const flagged = flaggedStrategyId();
  if (flagged) {
    const strategy = globals.registry.get(flagged);
    if (strategy?.isAvailable()) {
      console.info(`[stream] viewer strategy forced by flag: ${flagged}`);
      globals.active = strategy;
      return strategy;
    }
    console.warn(`[stream] flagged viewer strategy "${flagged}" unavailable; using auto selection`);
  }

  for (const id of ["webview", "native"] as const) {
    const strategy = globals.registry.get(id);
    if (strategy?.isAvailable()) {
      globals.active = strategy;
      return strategy;
    }
  }
  // Nothing claims availability (e.g. a webview without WebRTC on a
  // platform the native heuristic does not recognise): degrade to whatever
  // is registered rather than crashing the component tree from an effect.
  const fallback = globals.registry.get("native") ?? globals.registry.get("webview");
  if (fallback) {
    console.warn(`[stream] no viewer strategy reports available; falling back to ${fallback.id}`);
    globals.active = fallback;
    return fallback;
  }
  throw new Error("no stream viewer strategy registered");
}
