/**
 * The game overlay's frontend side: pushing the user's settings down to the
 * detector, and the one question it is allowed to ask.
 *
 * The overlay itself lives entirely in Rust - it decides what is a game, when
 * to show the window and where to put it. The frontend owns only the settings,
 * because those are preferences and preferences live in `preferences.json`.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TauriEvent } from "@core/constants/tauriEvents";
import { getPreferences, updatePreferences } from "@core/preferencesStorage";
import type { GameOverlayMode, GameOverlayRule, GameOverlaySettings } from "@core/types/preferences";

/** What the detector concluded about the foreground window. */
export type GameOverlayVerdict = "game" | "probably" | "notGame" | "cannotShow";

/** Why the overlay is not on screen. */
export type GameOverlayHiddenReason =
  | "visible"
  | "modeOff"
  | "pageNotReady"
  | "noGame"
  | "exclusiveFullscreen"
  | "waitingForActivity"
  | "manuallyHidden";

/** What the shell reported about the foreground application. */
export type GameOverlayShell = "normal" | "busy" | "exclusiveFullscreen" | "presenting" | "unknown";

/** One thing the classifier noticed, and what it was worth. */
export interface GameOverlayReason {
  code: string;
  weight: number;
  detail?: string;
}

/** The payload of `game-overlay-state`. */
export interface GameOverlayState {
  /** Whether the window is on screen, as the window itself reports it. */
  visible: boolean;
  /** Whether the overlay window exists at all. */
  windowCreated: boolean;
  /** Why it could not be created, when that is what happened. */
  windowError?: string;
  /** Why it is not on screen. */
  hiddenReason: GameOverlayHiddenReason;
  /** The mode currently in force, as the backend has it. */
  mode: GameOverlayMode;
  /** What the overlay page says it is drawing, once it has said. */
  pageStatus?: {
    connected: boolean;
    occupants: number;
    hasMessage: boolean;
    failed: boolean;
  };
  /** Where the window actually is, in physical pixels. */
  placement?: { x: number; y: number; w: number; h: number };
  verdict: GameOverlayVerdict | null;
  score: number;
  exePath: string | null;
  exeStem: string | null;
  windowClass: string | null;
  title: string | null;
  shell: GameOverlayShell | null;
  reasons: GameOverlayReason[];
}

/** The payload of `game-overlay-ask`. */
export interface GameOverlayAsk {
  exePath: string;
  name: string;
  score: number;
}

/**
 * Subscribe to a Tauri event, tolerating the absence of a Tauri shell.
 *
 * Outside the app - a browser dev session, a component test - the IPC bridge
 * is simply not there and `listen` throws synchronously. Neither of the hooks
 * below is load-bearing enough to take a surface down with it, so both degrade
 * to "no events ever arrive", which is the truth in that environment.
 */
function safeListen<T>(event: string, handler: (payload: T) => void): () => void {
  try {
    const pending = listen<T>(event, ({ payload }) => handler(payload));
    void pending.catch(() => undefined);
    return () => void pending.then((off) => off()).catch(() => undefined);
  } catch {
    return () => undefined;
  }
}

/** The settings shape the Rust side accepts. */
const toBackendSettings = (settings: GameOverlaySettings) => ({
  mode: settings.mode,
  corner: settings.corner,
  hideFromCapture: settings.hideFromCapture,
  rules: settings.rules,
});

/**
 * Hand the detector the current settings, starting or stopping it as needed.
 *
 * Safe to call on every change: the Rust side owns the watcher's lifetime and
 * treats a repeated configure as an update.
 */
export async function applyGameOverlaySettings(settings: GameOverlaySettings): Promise<void> {
  try {
    await invoke("game_overlay_configure", { settings: toBackendSettings(settings) });
  } catch (e) {
    // A desktop-only feature on a platform without it is not an error worth
    // showing anyone; anything else is worth a line in the log.
    console.warn("game overlay: configure failed", e);
  }
}

/** Push whatever is in the stored preferences. Called once at startup. */
export async function applyStoredGameOverlaySettings(): Promise<void> {
  const prefs = await getPreferences();
  if (!prefs.gameOverlay) return;
  await applyGameOverlaySettings(prefs.gameOverlay);
}

/** Record what the user decided about one executable, and tell the detector. */
export async function setGameOverlayRule(exePath: string, rule: GameOverlayRule | null): Promise<void> {
  const prefs = await getPreferences();
  const current = prefs.gameOverlay;
  if (!current) return;
  const rules = { ...current.rules };
  if (rule) rules[exePath] = rule;
  else delete rules[exePath];
  const asked = current.asked.includes(exePath) ? current.asked : [...current.asked, exePath];
  await updatePreferences({ gameOverlay: { ...current, rules, asked } });
  await invoke("game_overlay_set_rule", { exePath, rule }).catch(() => {});
}

/**
 * The detector's running commentary, for the settings page's diagnostics.
 *
 * Asks once for the current state, because the Rust side only emits on change
 * and a panel opened mid-session would otherwise show nothing.
 */
export function useGameOverlayState(): GameOverlayState | null {
  const [state, setState] = useState<GameOverlayState | null>(null);

  useEffect(() => {
    let live = true;
    invoke<GameOverlayState | null>("game_overlay_diagnostics")
      .then((current) => {
        if (live && current) setState(current);
      })
      .catch(() => undefined);
    const stop = safeListen<GameOverlayState>(TauriEvent.GameOverlayState, setState);
    return () => {
      live = false;
      stop();
    };
  }, []);

  return state;
}

/**
 * The one-time "is this a game?" question.
 *
 * Only fires for something that looks like a game but did not clear the
 * automatic bar, and only once per executable - the answer becomes a rule, and
 * an executable already in `asked` never comes back.
 */
export function useGameOverlayAsk(): {
  pending: GameOverlayAsk | null;
  answer: (rule: GameOverlayRule | null) => void;
} {
  const [pending, setPending] = useState<GameOverlayAsk | null>(null);

  useEffect(
    () =>
      safeListen<GameOverlayAsk>(TauriEvent.GameOverlayAsk, (payload) => {
        void getPreferences()
          .then((prefs) => {
            const overlay = prefs.gameOverlay;
            // Off, already decided, or already asked: say nothing.
            if (!overlay || overlay.mode === "off") return;
            if (overlay.rules[payload.exePath] || overlay.asked.includes(payload.exePath)) return;
            setPending(payload);
          })
          .catch(() => undefined);
      }),
    [],
  );

  const answer = useCallback(
    (rule: GameOverlayRule | null) => {
      const asked = pending;
      setPending(null);
      if (!asked) return;
      // "Not now" still records that we asked, so the prompt is a one-time
      // interruption rather than one per launch.
      void setGameOverlayRule(asked.exePath, rule);
    },
    [pending],
  );

  return { pending, answer };
}
