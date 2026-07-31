/**
 * Self-service account settings store.
 *
 * Backed by `FancyAccountSettings` (wire ID 154), which the server sends in
 * response to a `query` action and after every successful update, and
 * `FancyAccountAck` (156) which reports per-operation success/failure.
 * Operations go out via the `update_account_settings` command (155).
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { AccountAck, AccountAction, AccountSettings } from "../../types";
import { ACCOUNT_ACTION_IDS } from "../../types";
import { fancyVersionEncode } from "../../utils/version";

/** Minimum server version for the self-service account settings (0.4.1). */
export const ACCOUNT_MIN_FANCY_VERSION = fancyVersionEncode(0, 4, 1);

/**
 * Returns true when the connected server reports a `fancy_version` high
 * enough to handle the account-settings messages (IDs 154-156).  Returns
 * false for legacy (non-Fancy) Mumble servers - which would silently drop
 * the messages - and Fancy servers older than 0.4.1.
 */
export function isAccountSettingsSupported(serverFancyVersion: number | null | undefined): boolean {
  return serverFancyVersion != null && serverFancyVersion >= ACCOUNT_MIN_FANCY_VERSION;
}

interface TotpEnrollment {
  /** Base32 shared secret for manual authenticator entry. */
  secret: string;
  /** otpauth://totp/... provisioning URI. */
  uri: string;
}

interface AccountStoreState {
  /** Latest own-account snapshot from the server, or null if none yet. */
  snapshot: AccountSettings | null;
  /** Action currently in flight (disables the panel's buttons), or null. */
  pending: AccountAction | null;
  /** Error code of the last failed action (localised by the panel). */
  errorCode: string | null;
  /** Numeric action id the last error belongs to. */
  errorAction: number | null;
  /** Numeric action id of the last successful ack (drives "saved" toasts). */
  lastSuccessAction: number | null;
  /** In-progress TOTP enrolment (secret shown once, until verified). */
  totpEnroll: TotpEnrollment | null;

  setSnapshot: (snapshot: AccountSettings | null) => void;
  handleAck: (ack: AccountAck) => void;
  clear: () => void;
  clearFeedback: () => void;
  /** Pull the cached snapshot from the backend (tab mount / HMR). */
  load: () => Promise<void>;
  /** Ask the server for a fresh snapshot. */
  query: () => Promise<void>;
  /** Send one account operation; the result arrives as an `account-ack`. */
  send: (action: AccountAction, value?: string) => Promise<void>;
}

export const useAccountStore = create<AccountStoreState>((set) => ({
  snapshot: null,
  pending: null,
  errorCode: null,
  errorAction: null,
  lastSuccessAction: null,
  totpEnroll: null,

  setSnapshot: (snapshot) => set({ snapshot }),

  handleAck: (ack) => {
    const patch: Partial<AccountStoreState> = { pending: null };
    if (ack.ok) {
      patch.errorCode = null;
      patch.errorAction = null;
      patch.lastSuccessAction = ack.action;
      if (ack.action === ACCOUNT_ACTION_IDS.totp_begin && ack.totp_secret) {
        patch.totpEnroll = { secret: ack.totp_secret, uri: ack.totp_uri ?? "" };
      }
      if (ack.action === ACCOUNT_ACTION_IDS.totp_verify || ack.action === ACCOUNT_ACTION_IDS.totp_disable) {
        patch.totpEnroll = null;
      }
    } else {
      patch.errorCode = ack.error ?? "unknown";
      patch.errorAction = ack.action;
    }
    set(patch);
  },

  clear: () =>
    set({
      snapshot: null,
      pending: null,
      errorCode: null,
      errorAction: null,
      lastSuccessAction: null,
      totpEnroll: null,
    }),

  clearFeedback: () => set({ errorCode: null, errorAction: null, lastSuccessAction: null }),

  load: async () => {
    try {
      const snapshot = await invoke<AccountSettings | null>("get_account_settings");
      if (snapshot) set({ snapshot });
    } catch {
      /* not connected yet - the query() on mount will populate it */
    }
  },

  query: async () => {
    try {
      await invoke("update_account_settings", { action: "query", value: null });
    } catch {
      /* not connected - panel stays in its empty state */
    }
  },

  send: async (action, value) => {
    set({ pending: action, errorCode: null, errorAction: null, lastSuccessAction: null });
    try {
      await invoke("update_account_settings", { action, value: value ?? null });
      // Completion is signalled by the matching `account-ack` event.
    } catch (e) {
      set({ pending: null, errorCode: String(e), errorAction: ACCOUNT_ACTION_IDS[action] });
    }
  },
}));
