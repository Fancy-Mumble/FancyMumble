/**
 * Broadcast encoder settings shared by the source picker, the stream-config
 * menu and the `useScreenShare` hook. These map directly to the Rust
 * `EncodeSettings` (longest-edge cap + max fps); bitrate is derived from them
 * by the encoder, so it is not carried here.
 */

/** Resolution / frame-rate the broadcast encodes at. */
export interface StreamSettings {
  /** Longest output edge in pixels. `0` = Source (native, no downscale). */
  readonly maxDimension: number;
  /** Maximum frames per second. */
  readonly maxFps: number;
}

/** Quick-toggle presets shown as the SD / HD / Source segmented control. */
export type QualityPreset = "sd" | "hd" | "source";

export const QUALITY_PRESETS: Record<QualityPreset, StreamSettings> = {
  sd: { maxDimension: 1280, maxFps: 30 },
  hd: { maxDimension: 1920, maxFps: 60 },
  source: { maxDimension: 0, maxFps: 60 },
};

/** "Stream Mode" presets in the gear popover (Discord-style). */
export type StreamMode = "gaming" | "screenshare" | "custom";

export const MODE_PRESETS: Record<Exclude<StreamMode, "custom">, StreamSettings> = {
  // Smoother video: cap resolution, keep a normal frame rate.
  gaming: { maxDimension: 1280, maxFps: 30 },
  // Clearer text: full source resolution, low frame rate.
  screenshare: { maxDimension: 0, maxFps: 5 },
};

/** Screen-resolution choices for the Custom submenu (longest-edge caps). */
export const RESOLUTIONS: ReadonlyArray<{ key: string; maxDimension: number }> = [
  { key: "720p", maxDimension: 1280 },
  { key: "1080p", maxDimension: 1920 },
  { key: "1440p", maxDimension: 2560 },
  { key: "source", maxDimension: 0 },
];

/** Frame-rate choices for the Custom submenu. */
export const FRAME_RATES: readonly number[] = [15, 30, 60];

const eq = (a: StreamSettings, b: StreamSettings): boolean =>
  a.maxDimension === b.maxDimension && a.maxFps === b.maxFps;

/** Which quick preset (if any) a settings object exactly matches. */
export function presetOf(settings: StreamSettings): QualityPreset | null {
  for (const key of Object.keys(QUALITY_PRESETS) as QualityPreset[]) {
    if (eq(settings, QUALITY_PRESETS[key])) return key;
  }
  return null;
}

/** Which stream mode a settings object represents. */
export function modeOf(settings: StreamSettings): StreamMode {
  if (eq(settings, MODE_PRESETS.gaming)) return "gaming";
  if (eq(settings, MODE_PRESETS.screenshare)) return "screenshare";
  return "custom";
}

/** The resolution key a settings object currently uses. */
export function resolutionKeyOf(settings: StreamSettings): string {
  return RESOLUTIONS.find((r) => r.maxDimension === settings.maxDimension)?.key ?? "custom";
}
