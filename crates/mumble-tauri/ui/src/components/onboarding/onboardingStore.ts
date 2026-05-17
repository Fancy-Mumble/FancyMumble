/**
 * Onboarding flow store + helpers.
 *
 * Backed by `FancyOnboardingConfig` (wire ID 136) broadcast by the server
 * after ServerSync, plus the user's `FancyOnboardingResponse` (wire ID 138)
 * delivered on demand.  Components consume this store directly; the main
 * app store wires the Tauri event listeners that drive it.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

import type {
  OnboardingConfig,
  OnboardingResponse,
  OnboardingSelection,
} from "../../types";

/** Local-storage key for "user dismissed the onboarding modal this session". */
const DISMISSED_PREFIX = "onboarding-dismissed:";

/**
 * Minimum server `fancy_version` required for the onboarding workflow.
 *
 * Mirrors `fancy_message_support!`'s registration of the onboarding
 * message types at `(0, 3, 1)`.  Encoded the same way as the server's
 * `fancy_version_encode`: `(major << 48) | (minor << 32) | (patch << 16)`.
 * For 0.3.1 that's `3 * 2^32 + 1 * 2^16 = 12_884_967_424` — using bit
 * math here keeps the constant readable.
 */
export const ONBOARDING_MIN_FANCY_VERSION =
  3 * 2 ** 32 + 1 * 2 ** 16;

/**
 * Returns true when the connected server reports a `fancy_version` high
 * enough to support the onboarding workflow.  Returns false for legacy
 * (non-Fancy) servers and Fancy servers older than 0.3.1.
 */
export function isOnboardingSupported(
  serverFancyVersion: number | null | undefined,
): boolean {
  return (
    serverFancyVersion != null &&
    serverFancyVersion >= ONBOARDING_MIN_FANCY_VERSION
  );
}

interface OnboardingStoreState {
  /** Latest config broadcast by the server, or null if none / disabled. */
  config: OnboardingConfig | null;
  /** User's stored response, if available. */
  response: OnboardingResponse | null;
  /** True when the modal should be visible. */
  modalOpen: boolean;
  /** True while save/submit is in flight. */
  busy: boolean;
  /** Last error message from a save/submit. */
  error: string | null;

  setConfig: (config: OnboardingConfig | null) => void;
  setResponse: (response: OnboardingResponse | null) => void;
  setModalOpen: (open: boolean) => void;
  clear: () => void;

  /** Pulls config + response from the backend and decides whether to auto-open the modal.
   *  Skips entirely on servers below `ONBOARDING_MIN_FANCY_VERSION`. */
  hydrate: (
    serverId: string | null,
    serverFancyVersion: number | null | undefined,
  ) => Promise<void>;

  /** Submit the user's selections (also stores them locally). */
  submit: (
    selections: OnboardingSelection[],
    revision: number,
  ) => Promise<void>;

  /** Admin path: persist a new config with the server. */
  saveConfig: (config: OnboardingConfig) => Promise<void>;
}

export const useOnboardingStore = create<OnboardingStoreState>((set, get) => ({
  config: null,
  response: null,
  modalOpen: false,
  busy: false,
  error: null,

  setConfig: (config) => set({ config }),
  setResponse: (response) => set({ response }),
  setModalOpen: (modalOpen) => set({ modalOpen }),
  clear: () =>
    set({
      config: null,
      response: null,
      modalOpen: false,
      busy: false,
      error: null,
    }),

  hydrate: async (serverId, serverFancyVersion) => {
    if (!isOnboardingSupported(serverFancyVersion)) {
      // Server is too old (or not a Fancy server). Clear any cached
      // state from a previous connection so the gate is observed
      // consistently.
      set({ config: null, response: null, modalOpen: false });
      return;
    }
    try {
      const [config, response] = await Promise.all([
        invoke<OnboardingConfig | null>("get_onboarding_config"),
        invoke<OnboardingResponse | null>("get_onboarding_response"),
      ]);
      set({ config: config ?? null, response: response ?? null });

      if (config?.enabled) {
        const needsAnswer = !response || response.config_revision < config.revision;
        const dismissed = serverId
          ? sessionStorage.getItem(DISMISSED_PREFIX + serverId) === "1"
          : false;
        if (needsAnswer && !dismissed) {
          set({ modalOpen: true });
        }
      }
    } catch (e) {
      set({ config: null, response: null });
      // eslint-disable-next-line no-console
      console.debug("[onboarding] hydrate skipped:", e);
    }
  },

  submit: async (selections, revision) => {
    set({ busy: true, error: null });
    try {
      const response: OnboardingResponse = {
        config_revision: revision,
        selections,
      };
      await invoke("submit_onboarding_response", { response });
      set({ response, modalOpen: false, busy: false });
    } catch (e) {
      set({ busy: false, error: String(e) });
      throw e;
    }
  },

  saveConfig: async (config) => {
    set({ busy: true, error: null });
    try {
      await invoke("save_onboarding_config", { config });
      // The server will broadcast back the stamped config; until then,
      // surface the local view so the admin sees it instantly.
      set({ config, busy: false });
    } catch (e) {
      set({ busy: false, error: String(e) });
      throw e;
    }
    // Update unused local var to satisfy noUnusedParameters rule from the IDE.
    void get;
  },
}));

/** Mark the modal dismissed for this server in the current session. */
export function dismissOnboardingForServer(serverId: string | null): void {
  if (!serverId) return;
  try {
    sessionStorage.setItem(DISMISSED_PREFIX + serverId, "1");
  } catch {
    // sessionStorage may be unavailable in some embedded contexts.
  }
}

/** Compute the channels a user should see based on their answers and the config. */
export function computeVisibleChannels(
  config: OnboardingConfig | null,
  response: OnboardingResponse | null,
): Set<number> {
  const out = new Set<number>();
  if (!config) return out;
  for (const id of config.default_channel_ids) out.add(id);
  if (!response) return out;

  const answersByQ = new Map<string, Set<string>>();
  for (const sel of response.selections) {
    answersByQ.set(sel.question_id, new Set(sel.answer_ids));
  }
  for (const q of config.questions) {
    const picked = answersByQ.get(q.id);
    if (!picked) continue;
    for (const a of q.answers) {
      if (picked.has(a.id)) {
        for (const id of a.channel_ids) out.add(id);
      }
    }
  }
  return out;
}

/** Compute the role labels a user should display based on their answers. */
export function computeRoleLabels(
  config: OnboardingConfig | null,
  response: OnboardingResponse | null,
): string[] {
  const out = new Set<string>();
  if (!config || !response) return [];
  const answersByQ = new Map<string, Set<string>>();
  for (const sel of response.selections) {
    answersByQ.set(sel.question_id, new Set(sel.answer_ids));
  }
  for (const q of config.questions) {
    const picked = answersByQ.get(q.id);
    if (!picked) continue;
    for (const a of q.answers) {
      if (picked.has(a.id)) {
        for (const g of a.group_names) out.add(g);
      }
    }
  }
  return [...out];
}
