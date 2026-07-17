//! Self-service account settings types cached from `FancyAccountSettings` /
//! `FancyAccountAck` and surfaced to the "Account" settings panel.

use serde::Serialize;

/// Snapshot of the own registered account's server-side settings.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct AccountSettings {
    /// True while the session belongs to a registered (non-SuperUser)
    /// account. False after a successful self-unregister.
    pub registered: bool,
    /// Registered user ID of the account.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<u32>,
    /// Registered user name (DB casing).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Contact email stored for the account.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Whether password authentication is enabled. While set, a password is
    /// required to log in - a certificate alone no longer works.
    #[serde(default)]
    pub has_password: bool,
    /// Whether a TOTP second factor is enrolled.
    #[serde(default)]
    pub totp_enabled: bool,
    /// Hex SHA-1 hash of the certificate bound to the account, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert_hash: Option<String>,
    /// Whether the current session's certificate matches `cert_hash`
    /// (precondition for switching back to certificate-only login).
    #[serde(default)]
    pub cert_matches_session: bool,
}

/// Result of one account operation (`FancyAccountAck`).
#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct AccountAck {
    /// Echo of the `FancyAccountSettingsUpdate.Action` this ack belongs to.
    pub action: u32,
    pub ok: bool,
    /// Machine-readable error code when `ok` is false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// TOTP enrolment: base32 shared secret for manual authenticator entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totp_secret: Option<String>,
    /// TOTP enrolment: `otpauth://totp/...` provisioning URI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totp_uri: Option<String>,
}
