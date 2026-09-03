import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import { setKlipyApiKey } from "@core/features/chat/gif/klipyConfig";
import { applyGameOverlaySettings } from "@core/features/overlay/gameOverlay";
import { useAppStore } from "@core/store";
import type { GameOverlaySettings, UserPreferences } from "@core/types";

/**
 * The values these pages assume are always present.
 *
 * Nearly every field on `UserPreferences` is optional, because the stored file
 * may predate the field. `preferencesStorage` already merges its own defaults
 * on load, so at runtime they *are* there - but the type still says `boolean |
 * undefined`, and a page that believes the type ends up writing `?? false` at
 * every call site and, worse, disagreeing with storage about what the fallback
 * is. Naming the fallbacks once here settles it for the whole surface, and
 * `ResolvedPreferences` hands the pages a type that matches what they get.
 */
/** Typed apart from the table below, so `ResolvedPreferences` carries
 *  `GameOverlaySettings` rather than the literal types an inline object
 *  literal would infer (`mode: "off"`, `hideFromCapture: true`). */
const GAME_OVERLAY_DEFAULTS: GameOverlaySettings = {
  mode: "off",
  corner: "topRight",
  showLastMessage: true,
  hideFromCapture: true,
  rules: {},
  asked: [],
};

const PAGE_DEFAULTS = {
  klipyApiKey: "",
  dateFormat: "auto",
  numberFormat: "auto",
  enableNotifications: true,
  enableDualPath: false,
  logLevel: "info",
  logToFile: false,
  terminalLogging: false,
  autoZipLogs: false,
  disableReadReceipts: false,
  disableTypingIndicators: false,
  disableOsmMaps: false,
  disableLinkPreviews: false,
  enableExternalEmbeds: false,
  streamerMode: false,
  enableRichPresence: false,
  richPresenceArtwork: true,
  autoReconnect: false,
  autoUpdateOnStartup: false,
  persistDms: false,
  showDisconnectWarning: true,
  welcomeMessageDisplay: "once",
  gameOverlay: GAME_OVERLAY_DEFAULTS,
} satisfies Partial<UserPreferences>;

/** `UserPreferences`, with the keys above narrowed to non-optional. */
export type ResolvedPreferences = UserPreferences & typeof PAGE_DEFAULTS;

/**
 * The keys `toggle` accepts: every preference whose resolved value is certainly
 * a boolean - the ones declared required, plus the optional ones given a
 * boolean fallback above. An optional boolean with no fallback is deliberately
 * excluded: `!undefined` is `true`, which is a coin flip, not a toggle.
 */
type RequiredBooleanPreference = {
  [K in keyof UserPreferences]-?: undefined extends UserPreferences[K]
    ? never
    : boolean extends UserPreferences[K]
      ? K
      : never;
}[keyof UserPreferences];

type DefaultedBooleanPreference = {
  [K in keyof typeof PAGE_DEFAULTS]: (typeof PAGE_DEFAULTS)[K] extends boolean ? K : never;
}[keyof typeof PAGE_DEFAULTS];

export type BooleanPreference = RequiredBooleanPreference | DefaultedBooleanPreference;

function resolve(loaded: UserPreferences): ResolvedPreferences {
  const out: Record<string, unknown> = { ...loaded };
  for (const [key, fallback] of Object.entries(PAGE_DEFAULTS)) {
    if (out[key] === undefined || out[key] === null) out[key] = fallback;
  }
  return out as unknown as ResolvedPreferences;
}

/**
 * The preferences behind Nebula's Privacy, Localization, Notifications and
 * Advanced pages.
 *
 * Standard spreads one `useState` per preference across `SettingsPage` and
 * threads a handler per switch down to each panel. Nebula's pages own
 * themselves instead (as Voice already does), so the part worth sharing is not
 * the state - it is the **side effects**: several preferences are not merely
 * persisted but also pushed to the backend or mirrored into the store, and a
 * page that wrote the preference and skipped its effect would appear to work
 * and change nothing until the next launch. `EFFECTS` is that table, applied by
 * `set` for every caller, so no page has to remember which of its switches is
 * one of those.
 */
type Effect = (value: never, prefs: ResolvedPreferences) => void;

const EFFECTS: {
  [K in keyof ResolvedPreferences]?: (value: ResolvedPreferences[K], prefs: ResolvedPreferences) => void;
} = {
  enableNotifications: (enabled, prefs) => {
    // Streamer mode suppresses notifications wholesale, so it - not this
    // switch - has the last word while it is on.
    void invoke("set_notifications_enabled", { enabled: prefs.streamerMode ? false : enabled }).catch(
      () => undefined,
    );
  },
  streamerMode: (on, prefs) => {
    useAppStore.setState({ streamerMode: on });
    void invoke("set_notifications_enabled", { enabled: on ? false : prefs.enableNotifications }).catch(
      () => undefined,
    );
  },
  // The backend flag is the inverse of the preference.
  enableDualPath: (on) => {
    void invoke("set_disable_dual_path", { disabled: !on }).catch(() => undefined);
  },
  disableLinkPreviews: (off) => useAppStore.setState({ disableLinkPreviews: off }),
  disableOsmMaps: (off) => useAppStore.setState({ disableOsmMaps: off }),
  enableExternalEmbeds: (on) => useAppStore.setState({ enableExternalEmbeds: on }),
  // Starting rich presence binds Discord's IPC slot, so both of these have to
  // reach the backend now rather than at the next launch.
  enableRichPresence: (on, prefs) => {
    void useAppStore.getState().setRichPresenceEnabled(on, prefs.richPresenceArtwork);
  },
  richPresenceArtwork: (artwork, prefs) => {
    if (prefs.enableRichPresence) void useAppStore.getState().setRichPresenceEnabled(true, artwork);
  },
  // The GIF client reads its key from a module-level latch, so persisting the
  // preference alone would not reach the request that uses it until relaunch.
  klipyApiKey: (key) => setKlipyApiKey(key),
  autoUpdateOnStartup: (on) => {
    void invoke("updater_set_auto_install", { enabled: on }).catch(() => undefined);
  },
  persistDms: (on) => {
    // Turning persistence off is also a request to forget what was kept.
    if (!on) void import("@core/dmStorage").then((m) => m.clearAllDmHistory()).catch(() => undefined);
  },
  logLevel: (filter) => {
    void invoke("set_log_level", { filter }).catch(() => undefined);
  },
  logToFile: (enabled) => {
    void invoke("set_log_to_file", { enabled }).catch(() => undefined);
  },
  terminalLogging: (enabled) => {
    void invoke("set_terminal_logging", { enabled }).catch(() => undefined);
  },
  autoZipLogs: (enabled) => {
    void invoke("set_auto_zip_logs", { enabled }).catch(() => undefined);
  },
  // The detector task's lifetime follows the mode, so a change that only
  // reached the preferences file would leave the overlay behaving as it did
  // before until the next launch.
  gameOverlay: (settings) => {
    void applyGameOverlaySettings(settings);
  },
};

export interface PreferenceSettings {
  /** Null until the first load resolves; pages render nothing before then. */
  prefs: ResolvedPreferences | null;
  set: (patch: Partial<UserPreferences>) => void;
  /** Flip one boolean preference, effects included. */
  toggle: (key: BooleanPreference) => void;
}

export function usePreferenceSettings(): PreferenceSettings {
  const [prefs, setPrefs] = useState<ResolvedPreferences | null>(null);
  // `set` must not close over a stale `prefs`, and must not run its writes
  // inside a state updater - React invokes updaters twice under StrictMode,
  // which would fire every backend effect twice. The ref keeps the current
  // value reachable from a callback with no dependencies.
  const latest = useRef<ResolvedPreferences | null>(null);

  useEffect(() => {
    let active = true;
    void getPreferences()
      .then((loaded) => {
        if (!active) return;
        const resolved = resolve(loaded);
        latest.current = resolved;
        setPrefs(resolved);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const set = useCallback((patch: Partial<UserPreferences>) => {
    const current = latest.current;
    if (!current) return;
    const next = { ...current, ...patch } as ResolvedPreferences;
    latest.current = next;
    setPrefs(next);
    void updatePreferences(patch).catch(() => undefined);
    for (const key of Object.keys(patch) as (keyof ResolvedPreferences)[]) {
      const effect = EFFECTS[key] as Effect | undefined;
      // `next` rather than `patch`, so an effect that reads a *second*
      // preference (streamer mode reading notifications) sees the state this
      // write lands in rather than the one it left.
      effect?.(next[key] as never, next);
    }
  }, []);

  const toggle = useCallback(
    (key: BooleanPreference) => {
      const current = latest.current;
      if (current) set({ [key]: !current[key] });
    },
    [set],
  );

  return { prefs, set, toggle };
}
