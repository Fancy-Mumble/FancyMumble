/**
 * Onboarding flow store + helpers.
 *
 * Backed by `FancyOnboardingConfig` (wire ID 136) broadcast by the server
 * after ServerSync, plus the user's `FancyOnboardingResponse` (wire ID 138).
 * A current server pushes the response alongside the config; older ones only
 * answer an explicit query, which is why the store asks for it rather than
 * reading "no response yet" as "never answered".  Components consume this
 * store directly; the main app store wires the Tauri event listeners.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { fancyVersionEncode } from "../../utils/version";

import type { OnboardingConfig, OnboardingResponse, OnboardingSelection } from "../../types";

/** Local-storage key for "user dismissed the onboarding modal this session". */
const DISMISSED_PREFIX = "onboarding-dismissed:";

/**
 * How long to wait for the server to deliver the user's stored response
 * before treating "nothing delivered" as "nothing stored".
 *
 * Only reached against servers that do not push the response after
 * ServerSync, or when the query is dropped by the server's message rate
 * limiter; the normal path cancels this the moment the delivery lands.
 */
const RESPONSE_DELIVERY_TIMEOUT_MS = 5_000;

/** Minimum server version for the onboarding workflow (0.3.1). */
export const ONBOARDING_MIN_FANCY_VERSION = fancyVersionEncode(0, 3, 1);

/** Pending stored-response query, so we ask at most once at a time. */
let responseQueryTimer: ReturnType<typeof setTimeout> | null = null;

function cancelResponseQuery(): void {
  if (responseQueryTimer !== null) {
    clearTimeout(responseQueryTimer);
    responseQueryTimer = null;
  }
}

/**
 * Ask the server for this user's stored response.  `onGiveUp` runs when no
 * delivery arrives in time so that a silent server cannot leave a genuinely
 * new user without the flow.
 */
function queryStoredResponse(onGiveUp: () => void): void {
  if (responseQueryTimer !== null) return;
  responseQueryTimer = setTimeout(() => {
    responseQueryTimer = null;
    onGiveUp();
  }, RESPONSE_DELIVERY_TIMEOUT_MS);
  invoke("request_onboarding_response").catch(() => {
    // Not connected, or the server does not implement the query: nothing
    // will ever be delivered, so decide now instead of after the wait.
    cancelResponseQuery();
    onGiveUp();
  });
}

/** True when the user dismissed the modal for `serverId` this session. */
function isDismissed(serverId: string | null): boolean {
  if (!serverId) return false;
  try {
    return sessionStorage.getItem(DISMISSED_PREFIX + serverId) === "1";
  } catch {
    // sessionStorage may be unavailable in some embedded contexts.
    return false;
  }
}

/**
 * Returns true when the connected server reports a `fancy_version` high
 * enough to support the onboarding workflow.  Returns false for legacy
 * (non-Fancy) servers and Fancy servers older than 0.3.1.
 */
export function isOnboardingSupported(serverFancyVersion: number | null | undefined): boolean {
  return serverFancyVersion != null && serverFancyVersion >= ONBOARDING_MIN_FANCY_VERSION;
}

interface OnboardingStoreState {
  /** Latest config broadcast by the server, or null if none / disabled. */
  config: OnboardingConfig | null;
  /** User's stored response, if available. */
  response: OnboardingResponse | null;
  /**
   * True once the server has told us whether this user has a stored
   * response.  Until then `response === null` only means "not fetched
   * yet", which is not the same as "never answered" - treating the two
   * alike is what re-asked onboarded users on every single connect.
   */
  responseKnown: boolean;
  /** Server the current config/response belong to; keys the dismissal. */
  serverId: string | null;
  /** True when the modal should be visible. */
  modalOpen: boolean;
  /** True while save/submit is in flight. */
  busy: boolean;
  /** Last error message from a save/submit. */
  error: string | null;

  setConfig: (config: OnboardingConfig | null) => void;
  /** Record the server's authoritative answer state (null = none stored). */
  setResponse: (response: OnboardingResponse | null) => void;
  setModalOpen: (open: boolean) => void;
  setServerId: (serverId: string | null) => void;
  clear: () => void;

  /** Pulls config + response from the backend and decides whether to auto-open the modal.
   *  Skips entirely on servers below `ONBOARDING_MIN_FANCY_VERSION`. */
  hydrate: (serverId: string | null, serverFancyVersion: number | null | undefined) => Promise<void>;

  /**
   * Open the modal iff the server says this user still owes an answer.
   * While the answer state is unknown it asks the server and defers the
   * decision to the delivery instead of guessing "not answered".
   */
  evaluateAutoOpen: () => void;

  /** Submit the user's selections (also stores them locally). */
  submit: (selections: OnboardingSelection[], revision: number) => Promise<void>;

  /** Admin path: persist a new config with the server. */
  saveConfig: (config: OnboardingConfig) => Promise<void>;
}

export const useOnboardingStore = create<OnboardingStoreState>((set, get) => ({
  config: null,
  response: null,
  responseKnown: false,
  serverId: null,
  modalOpen: false,
  busy: false,
  error: null,

  setConfig: (config) => set({ config }),
  setResponse: (response) => {
    // A delivery is the server's answer: it settles the question even when
    // it carries no response at all ("you have never answered").
    cancelResponseQuery();
    set({ response, responseKnown: true });
    get().evaluateAutoOpen();
  },
  setModalOpen: (modalOpen) => set({ modalOpen }),
  setServerId: (serverId) => set({ serverId }),
  clear: () => {
    cancelResponseQuery();
    set({
      config: null,
      response: null,
      responseKnown: false,
      serverId: null,
      modalOpen: false,
      busy: false,
      error: null,
    });
  },

  hydrate: async (serverId, serverFancyVersion) => {
    if (!isOnboardingSupported(serverFancyVersion)) {
      // Server is too old (or not a Fancy server). Clear any cached
      // state from a previous connection so the gate is observed
      // consistently.
      cancelResponseQuery();
      set({ config: null, response: null, responseKnown: false, serverId, modalOpen: false });
      return;
    }
    set({ serverId });
    try {
      const [config, response] = await Promise.all([
        invoke<OnboardingConfig | null>("get_onboarding_config"),
        invoke<OnboardingResponse | null>("get_onboarding_response"),
      ]);
      // A response in the backend snapshot was delivered on this
      // connection, so it is as authoritative as the event itself. Its
      // absence is not: the backend cannot tell "none stored" from "never
      // asked", which is what `responseKnown` exists to distinguish.
      set((prev) => ({
        config: config ?? null,
        response: response ?? null,
        responseKnown: prev.responseKnown || response != null,
      }));
      get().evaluateAutoOpen();
    } catch (e) {
      set({ config: null, response: null });
      console.debug("[onboarding] hydrate skipped:", e);
    }
  },

  evaluateAutoOpen: () => {
    const { config, response, responseKnown, serverId, modalOpen } = get();
    if (modalOpen || !config?.enabled) return;
    if (!responseKnown) {
      queryStoredResponse(() => {
        // Nothing was delivered in time; fall back to prompting rather
        // than leaving a new user with no onboarding at all.
        set({ responseKnown: true });
        get().evaluateAutoOpen();
      });
      return;
    }
    if (response && response.config_revision >= config.revision) return;
    if (isDismissed(serverId)) return;
    set({ modalOpen: true });
  },

  submit: async (selections, revision) => {
    set({ busy: true, error: null });
    try {
      const response: OnboardingResponse = {
        config_revision: revision,
        selections,
      };
      await invoke("submit_onboarding_response", { response });
      set({ response, responseKnown: true, modalOpen: false, busy: false });
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
