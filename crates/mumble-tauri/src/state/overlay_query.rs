//! The one read the game overlay window makes.
//!
//! Kept apart from `query.rs` because it is a single composite read for one
//! surface rather than another general accessor: the overlay is a separate
//! webview with no store behind it, so it asks once when it opens and then
//! follows the same events every other window gets.

use super::types::{OverlayMessage, OverlayOccupant, OverlaySnapshot, VoiceState, VoiceStateLabel};
use super::AppState;

/// How long a message stays "the last message" as far as the overlay's
/// activity policy is concerned. Longer than the fade in the page itself, so
/// the window does not vanish the instant the text starts fading.
pub(crate) const MESSAGE_FRESHNESS_MS: u64 = 12_000;

/// How long after the microphone last transmitted the local user still counts
/// as active. Comfortably longer than the overlay's poll interval, so no
/// utterance can fall between two ticks and go unnoticed.
const LOCAL_TALKING_GRACE_MS: u64 = 1_500;

impl AppState {
    /// Everything the overlay window draws, in one lock.
    pub(crate) fn overlay_snapshot(&self) -> OverlaySnapshot {
        let handle = self.inner.snapshot();
        let Ok(state) = handle.lock() else {
            return empty_snapshot();
        };

        let own_session = state.conn.own_session;
        let channel_id = own_session
            .and_then(|session| state.users.get(&session))
            .map(|user| user.channel_id)
            .or(state.current_channel);

        let Some(channel_id) = channel_id else {
            return OverlaySnapshot {
                connected: matches!(state.conn.status, super::ConnectionStatus::Connected),
                ..empty_snapshot()
            };
        };

        let mut occupants: Vec<OverlayOccupant> = state
            .users
            .values()
            .filter(|user| user.channel_id == channel_id)
            .map(|user| OverlayOccupant {
                session: user.session,
                name: user.name.clone(),
                texture_size: user.texture_marker,
                self_mute: user.self_mute,
                self_deaf: user.self_deaf,
                mute: user.mute,
            })
            .collect();
        // Stable order, own user first: the overlay is a glance, and a list
        // that reshuffles as people talk is unreadable at a glance.
        occupants.sort_by(|a, b| {
            let own = |s: u32| own_session != Some(s);
            own(a.session)
                .cmp(&own(b.session))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        let last_message = state
            .msgs
            .by_channel
            .get(&channel_id)
            .and_then(|messages| messages.last())
            .map(|message| OverlayMessage {
                sender: message.sender_name.clone(),
                // Plain text only: nothing a peer sends can style or script
                // the overlay window.
                text: fancy_utils::html::strip_html_tags(&message.body),
                timestamp: message.timestamp,
            });

        OverlaySnapshot {
            connected: matches!(state.conn.status, super::ConnectionStatus::Connected),
            channel_name: state.channels.get(&channel_id).map(|c| c.name.clone()),
            occupants,
            own_session,
            talking_sessions: {
                let mut talking: Vec<u32> = state.audio.talking_sessions.iter().copied().collect();
                // Same omission as above: the set is remote speakers only, and
                // a roster that never rings your own avatar looks broken.
                if self
                    .local_talking
                    .load(std::sync::atomic::Ordering::Relaxed)
                {
                    if let Some(own) = own_session {
                        talking.push(own);
                    }
                }
                talking
            },
            voice_state: match state.audio.voice_state {
                VoiceState::Inactive => VoiceStateLabel::Inactive,
                VoiceState::Active => VoiceStateLabel::Active,
                VoiceState::Muted => VoiceStateLabel::Muted,
            },
            self_deaf: own_session
                .and_then(|session| state.users.get(&session))
                .is_some_and(|user| user.self_deaf),
            last_message,
        }
    }

    /// Is there voice or chat activity worth showing the overlay for?
    ///
    /// Drives the "while active" mode: someone is talking, or a message
    /// arrived in the last few seconds.
    pub(crate) fn overlay_has_activity(&self, now_ms: u64) -> bool {
        let handle = self.inner.snapshot();
        let Ok(state) = handle.lock() else {
            return false;
        };
        // The local user first: `talking_sessions` never contains them, so a
        // channel where only you are speaking looks silent from in here. Asked
        // as "how long ago", because an utterance shorter than the caller's
        // poll interval is invisible to a question asked in the present tense.
        if self
            .local_talking
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            return true;
        }
        let spoke_at = self
            .local_talking_at
            .load(std::sync::atomic::Ordering::Relaxed);
        if spoke_at != 0 && now_ms.saturating_sub(spoke_at) < LOCAL_TALKING_GRACE_MS {
            return true;
        }
        if !state.audio.talking_sessions.is_empty() {
            return true;
        }
        let channel_id = state
            .conn
            .own_session
            .and_then(|session| state.users.get(&session))
            .map(|user| user.channel_id)
            .or(state.current_channel);
        let Some(channel_id) = channel_id else {
            return false;
        };
        state
            .msgs
            .by_channel
            .get(&channel_id)
            .and_then(|messages| messages.last())
            .and_then(|message| message.timestamp)
            .is_some_and(|sent| now_ms.saturating_sub(sent) < MESSAGE_FRESHNESS_MS)
    }
}

fn empty_snapshot() -> OverlaySnapshot {
    OverlaySnapshot {
        connected: false,
        channel_name: None,
        occupants: Vec::new(),
        own_session: None,
        talking_sessions: Vec::new(),
        voice_state: VoiceStateLabel::Inactive,
        self_deaf: false,
        last_message: None,
    }
}

#[cfg(test)]
#[allow(
    clippy::expect_used,
    reason = "test code: panicking on failure is the intended behaviour"
)]
mod tests {
    use super::super::AppState;
    use std::sync::atomic::Ordering;

    /// The regression this file exists to prevent: `talking_sessions` holds
    /// only remote speakers, so a channel where the local user is the one
    /// talking used to read as silent and the overlay never appeared.
    #[test]
    fn the_local_user_talking_counts_as_activity() {
        let state = AppState::new();
        assert!(!state.overlay_has_activity(0));

        state.local_talking.store(true, Ordering::Relaxed);
        assert!(
            state.overlay_has_activity(0),
            "talking into the microphone is activity even with nobody else speaking"
        );

        state.local_talking.store(false, Ordering::Relaxed);
        assert!(!state.overlay_has_activity(0));
    }

    #[test]
    fn a_disconnected_client_reports_nothing_to_draw() {
        let state = AppState::new();
        let snapshot = state.overlay_snapshot();
        assert!(!snapshot.connected);
        assert!(snapshot.occupants.is_empty());
        assert!(snapshot.last_message.is_none());
    }
}
