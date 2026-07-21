/** Self-service account settings (own registration) and the events that
 *  deliver them. Backed by `FancyAccountSettings` (wire ID 154) /
 *  `FancyAccountAck` (156); operations are sent via the
 *  `update_account_settings` command (155 `FancyAccountSettingsUpdate`). */

/** Snapshot of the own registered account's server-side settings. */
export interface AccountSettings {
  /** True while the session belongs to a registered (non-SuperUser) account. */
  registered: boolean;
  /** Registered user ID of the account. */
  user_id?: number | null;
  /** Registered user name (DB casing). */
  name?: string | null;
  /** Contact email stored for the account. */
  email?: string | null;
  /** Whether password authentication is enabled. While set, a password is
   *  REQUIRED to log in - a certificate alone no longer works. */
  has_password: boolean;
  /** Whether a TOTP second factor is enrolled. */
  totp_enabled: boolean;
  /** Hex SHA-1 hash of the certificate bound to the account, if any. */
  cert_hash?: string | null;
  /** Whether this session's certificate matches `cert_hash` (precondition
   *  for switching back to certificate-only login). */
  cert_matches_session: boolean;
}

/** Actions understood by `update_account_settings` (snake_case names of
 *  `FancyAccountSettingsUpdate.Action`). */
export type AccountAction =
  | "query"
  | "set_password"
  | "clear_password"
  | "rename"
  | "set_email"
  | "unregister"
  | "totp_begin"
  | "totp_verify"
  | "totp_disable";

/** Numeric `FancyAccountSettingsUpdate.Action` values echoed in acks. */
export const ACCOUNT_ACTION_IDS: Record<AccountAction, number> = {
  query: 0,
  set_password: 1,
  clear_password: 2,
  rename: 3,
  set_email: 4,
  unregister: 5,
  totp_begin: 6,
  totp_verify: 7,
  totp_disable: 8,
};

/** Result of one account operation (`FancyAccountAck`). */
export interface AccountAck {
  /** Numeric `FancyAccountSettingsUpdate.Action` this ack belongs to. */
  action: number;
  ok: boolean;
  /** Machine-readable error code when `ok` is false (localised by the UI). */
  error?: string | null;
  /** TOTP enrolment: base32 shared secret for manual authenticator entry. */
  totp_secret?: string | null;
  /** TOTP enrolment: otpauth://totp/... provisioning URI. */
  totp_uri?: string | null;
}

/** Event payload emitted when a `FancyAccountSettings` snapshot arrives. */
export interface AccountSettingsEvent {
  settings: AccountSettings;
}
