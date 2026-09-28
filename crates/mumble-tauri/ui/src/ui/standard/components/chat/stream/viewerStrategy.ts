/**
 * Strategy layer for HOW streams are received, rendered and measured.
 *
 * Two families exist today, each registering itself here at module load:
 *
 * - Webview (useScreenShare.ts): RTCPeerConnection viewers decoding in the
 *   webview, rendered into `<video>` - the browser-signaling route and the
 *   Windows/WebView2 default.
 * - Native (nativeStreamView.ts): a Rust-side peer per session with the
 *   webview only decoding (WebCodecs) / painting - mandatory on Linux, where
 *   WebKitGTK has no WebRTC, and selectable on Windows.
 *
 * Each strategy is the ABSTRACT FACTORY for its per-session product family:
 * the receive transport ({@link ReceiveTransport}) and the Stats-for-Nerds
 * sampler ({@link StatsSampler}). Consumers only ever hold the abstract
 * product interfaces, so a family can never be half-selected: every product
 * for a session comes from the same concrete factory. The viewport component
 * family is selected by `id` in ScreenShareViewer.
 *
 * Selection is capability-driven (webview preferred when `RTCPeerConnection`
 * exists) with a persisted user override - the "Stream viewer backend"
 * setting in Settings -> Advanced (shown wherever both families are
 * available, i.e. Windows). The override is stored under the same
 * `localStorage` key that always served as the runtime flag, so the manual
 * escape hatch still works and older flags stay honoured:
 *
 *     localStorage.setItem("fancy.streamViewerStrategy", "native")  // or "webview"
 *     localStorage.removeItem("fancy.streamViewerStrategy")        // back to auto
 *
 * (Reload after changing it; the choice is latched at first use so every
 * consumer of a session agrees on one family.)
 */
import type { StatsSample } from "./StreamStatsPanel";

/** Registered strategy families. String-valued so the enum members double
 *  as the persisted wire/storage values; compare against the members, never
 *  raw literals. */
export enum StreamViewerStrategyId {
  Webview = "webview",
  Native = "native",
}

/** The "no explicit choice" preference: capability picks the family. */
export const STRATEGY_AUTO = "auto";

/** The persisted selection: a concrete family, or automatic. Narrowing away
 *  {@link STRATEGY_AUTO} leaves a plain {@link StreamViewerStrategyId}. */
export type StreamViewerStrategyPreference = StreamViewerStrategyId | typeof STRATEGY_AUTO;

/** The member of {@link StreamViewerStrategyId} a raw (storage/DOM) string
 *  denotes, or null. The single place raw strings become enum values. */
export function parseStreamViewerStrategyId(value: string | null | undefined): StreamViewerStrategyId | null {
  return Object.values(StreamViewerStrategyId).includes(value as StreamViewerStrategyId)
    ? (value as StreamViewerStrategyId)
    : null;
}

/** One Stats-for-Nerds probe, created per open panel by its strategy. */
export interface StatsSampler {
  /** One 1 Hz snapshot; null when the session has no live receive path. */
  sample(): Promise<{ sample: StatsSample; connectionState: string } | null>;
}

/** The non-viewport receive path for one broadcaster session - loopback
 *  preview, channel auto-connect. Families whose viewports own their
 *  transport lifecycle (the native family) return a no-op product. */
export interface ReceiveTransport {
  /** Open the receive path ahead of (or outside) a mounted viewport. */
  open(): Promise<void>;
  /** Whether the session currently has an open non-viewport receive path. */
  isOpen(): boolean;
  /** Close the receive path (no-op when none). */
  close(): void;
}

/** A stream-viewing family: strategy (how streams are received) and
 *  abstract factory (creates the family's per-session products). */
export interface StreamViewerStrategy {
  readonly id: StreamViewerStrategyId;
  /** Whether this strategy can work in this webview/build at all. */
  isAvailable(): boolean;
  /** Factory: the receive transport for one broadcaster session. */
  createReceiveTransport(session: number): ReceiveTransport;
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

/** `localStorage` key holding the persisted preference (absent = auto).
 *  Same key as the original runtime feature flag - see the module doc. */
const PREFERENCE_KEY = "fancy.streamViewerStrategy";

/** The persisted strategy preference (auto when unset or unreadable). */
export function getStreamViewerStrategyPreference(): StreamViewerStrategyPreference {
  try {
    const stored = globalThis.localStorage?.getItem(PREFERENCE_KEY);
    return parseStreamViewerStrategyId(stored) ?? STRATEGY_AUTO;
  } catch {
    return STRATEGY_AUTO; // storage disabled
  }
}

/** Persist the strategy preference (the Settings -> Advanced switch).
 *  Takes effect on the next page load - the active strategy is latched at
 *  first use, so mid-session consumers all stay in one family. */
export function setStreamViewerStrategyPreference(preference: StreamViewerStrategyPreference): void {
  try {
    if (preference === STRATEGY_AUTO) {
      globalThis.localStorage?.removeItem(PREFERENCE_KEY);
    } else {
      globalThis.localStorage?.setItem(PREFERENCE_KEY, preference);
    }
  } catch {
    // Storage disabled: the preference simply cannot persist.
  }
}

/** Families a user could select here (registered AND available) - drives
 *  whether the settings switch is offered at all (it needs >= 2). */
export function selectableStreamViewerStrategyIds(): StreamViewerStrategyId[] {
  return [...globals.registry.values()].filter((s) => s.isAvailable()).map((s) => s.id);
}

/** Auto-selection order: webview (browser WebRTC) first, then native. */
const AUTO_ORDER = [StreamViewerStrategyId.Webview, StreamViewerStrategyId.Native] as const;

/**
 * The strategy every stream consumer must use, chosen once per page load:
 * the preferred family when it is registered and available, else the first
 * available in {@link AUTO_ORDER}.
 */
export function activeStreamViewerStrategy(): StreamViewerStrategy {
  if (globals.active) return globals.active;

  const preferred = getStreamViewerStrategyPreference();
  if (preferred !== STRATEGY_AUTO) {
    const strategy = globals.registry.get(preferred);
    if (strategy?.isAvailable()) {
      console.info(`[stream] viewer strategy selected by preference: ${preferred}`);
      globals.active = strategy;
      return strategy;
    }
    console.warn(`[stream] preferred viewer strategy "${preferred}" unavailable; using auto selection`);
  }

  for (const id of AUTO_ORDER) {
    const strategy = globals.registry.get(id);
    if (strategy?.isAvailable()) {
      globals.active = strategy;
      return strategy;
    }
  }
  // Nothing claims availability (e.g. a webview without WebRTC on a
  // platform the native heuristic does not recognise): degrade to whatever
  // is registered rather than crashing the component tree from an effect.
  const fallback =
    globals.registry.get(StreamViewerStrategyId.Native) ??
    globals.registry.get(StreamViewerStrategyId.Webview);
  if (fallback) {
    console.warn(`[stream] no viewer strategy reports available; falling back to ${fallback.id}`);
    globals.active = fallback;
    return fallback;
  }
  throw new Error("no stream viewer strategy registered");
}
