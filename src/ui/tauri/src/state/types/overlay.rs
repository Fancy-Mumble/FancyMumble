//! What the game overlay window shows.
//!
//! One flat snapshot rather than the half-dozen queries the main window makes,
//! because the overlay is a separate webview with no store behind it: it asks
//! once when it opens and then follows the same `user-talking` /
//! `voice-state-changed` / `new-message` events every other window gets.

use serde::Serialize;

/// One person in the channel, as the overlay draws them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayOccupant {
    /// Session id, which is also what `user-talking` reports.
    pub session: u32,
    /// Display name.
    pub name: String,
    /// Avatar marker, so the overlay can fetch the picture on demand exactly
    /// as the main window does.
    pub texture_size: Option<u32>,
    /// Muted themselves.
    pub self_mute: bool,
    /// Deafened themselves.
    pub self_deaf: bool,
    /// Muted by an administrator.
    pub mute: bool,
}

/// The most recent thing said in the channel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayMessage {
    /// Who sent it.
    pub sender: String,
    /// The body with markup removed - the overlay renders plain text only, so
    /// nothing a peer sends can style or script the window.
    pub text: String,
    /// Unix epoch milliseconds, when the sender's client provided one.
    pub timestamp: Option<u64>,
}

/// Everything the overlay needs to draw itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySnapshot {
    /// Whether a server is connected at all.
    pub connected: bool,
    /// The channel the local user is in.
    pub channel_name: Option<String>,
    /// Everyone in it, including the local user.
    pub occupants: Vec<OverlayOccupant>,
    /// The local user's session id.
    pub own_session: Option<u32>,
    /// Who is talking right now.
    pub talking_sessions: Vec<u32>,
    /// The local user's microphone state, as `voice-state-changed` reports it.
    pub voice_state: VoiceStateLabel,
    /// The local user has deafened themselves.
    pub self_deaf: bool,
    /// The last message in the channel, when there is one.
    pub last_message: Option<OverlayMessage>,
}

/// Serialised spelling of the local microphone state.
///
/// Mirrors the `VoiceState` the client already emits, kept separate so the
/// overlay's payload does not depend on the audio module's internals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VoiceStateLabel {
    /// Not transmitting.
    Inactive,
    /// Transmitting.
    Active,
    /// Microphone muted.
    Muted,
}
