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

/**
 * How long to wait for the matching `account-ack` / `account-settings` event
 * before giving up on it.
 *
 * `invoke("update_account_settings")` only confirms the request reached the
 * connection's send queue, not that the server did anything with it - a
 * canon gap (no wire translation for the action), a server that predates
 * self-service accounts, or a crashed handler on the other end all leave it
 * queued forever with nothing to report. Without this the panel is
 * indistinguishable from one that is still working.
 */
const ACCOUNT_REPLY_TIMEOUT_MS = 8000;

/** Ack/settings-wait timers, keyed by nothing but "the one currently running" -
 *  a fresh `send`/`query` always supersedes whatever it was waiting on. */
let sendTimeoutId: ReturnType<typeof setTimeout> | null = null;
let queryTimeoutId: ReturnType<typeof setTimeout> | null = null;

function clearSendTimeout(): void {
  if (sendTimeoutId !== null) {
    clearTimeout(sendTimeoutId);
    sendTimeoutId = null;
  }
}

function clearQueryTimeout(): void {
  if (queryTimeoutId !== null) {
    clearTimeout(queryTimeoutId);
    queryTimeoutId = null;
  }
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
  /**
   * Set when a `query()` got no `account-settings` reply within
   * [`ACCOUNT_REPLY_TIMEOUT_MS`]. Lets the panel show "the server did not
   * answer" instead of "Loading…" forever. Cleared by a snapshot arriving or
   * a fresh `query()`.
   */
  queryError: string | null;

  setSnapshot: (snapshot: AccountSettings | null) => void;
  handleAck: (ack: AccountAck) => void;
  clear: () => void;
  clearFeedback: () => void;
  /** Pull the cached snapshot from the backend (tab mount / HMR). */
  load: () => Promise<void>;
  /** Ask the server for a fresh snapshot. */
  query: () => Promise<void>;
  /**
   * Send one account operation; the result arrives as an `account-ack`.
   *
   * `currentPassword` is the account's *existing* password, re-typed by the
   * user. The server refuses every action that changes anything without it,
   * except on an account that has none - there the certificate is the proof.
   */
  send: (action: AccountAction, value?: string, currentPassword?: string) => Promise<void>;
}

export const useAccountStore = create<AccountStoreState>((set) => ({
  snapshot: null,
  pending: null,
  errorCode: null,
  errorAction: null,
  lastSuccessAction: null,
  totpEnroll: null,
  queryError: null,

  setSnapshot: (snapshot) => {
    clearQueryTimeout();
    set({ snapshot, queryError: null });
  },

  handleAck: (ack) => {
    clearSendTimeout();
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

  clear: () => {
    clearSendTimeout();
    clearQueryTimeout();
    set({
      snapshot: null,
      pending: null,
      errorCode: null,
      errorAction: null,
      lastSuccessAction: null,
      totpEnroll: null,
      queryError: null,
    });
  },

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
    clearQueryTimeout();
    set({ queryError: null });
    try {
      await invoke("update_account_settings", {
        action: "query",
        value: null,
        currentPassword: null,
      });
      // The command resolving only means the query reached the connection;
      // the reply is a separate `account-settings` event (via setSnapshot,
      // which cancels this timer). If it never comes, say so instead of
      // leaving the panel on "Loading…" forever.
      queryTimeoutId = setTimeout(() => {
        queryTimeoutId = null;
        set((s) => (s.snapshot === null ? { queryError: "timeout" } : {}));
      }, ACCOUNT_REPLY_TIMEOUT_MS);
    } catch {
      /* not connected - panel stays in its empty state */
    }
  },

  send: async (action, value, currentPassword) => {
    clearSendTimeout();
    set({ pending: action, errorCode: null, errorAction: null, lastSuccessAction: null });
    try {
      await invoke("update_account_settings", {
        action,
        value: value ?? null,
        currentPassword: currentPassword ?? null,
      });
      // Completion is signalled by the matching `account-ack` event (via
      // handleAck, which cancels this timer). If the server drops the
      // request or never answers, don't leave the panel's buttons disabled
      // forever - time out and let the user retry or report it.
      const errorAction = ACCOUNT_ACTION_IDS[action];
      sendTimeoutId = setTimeout(() => {
        sendTimeoutId = null;
        set((s) => (s.pending === action ? { pending: null, errorCode: "timeout", errorAction } : {}));
      }, ACCOUNT_REPLY_TIMEOUT_MS);
    } catch (e) {
      set({ pending: null, errorCode: String(e), errorAction: ACCOUNT_ACTION_IDS[action] });
    }
  },
}));
