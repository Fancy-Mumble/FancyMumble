//! Whisper and shout: speaking somewhere other than the channel you are in.
//!
//! Mumble's audio header carries five bits of *target*. Zero is the channel
//! the speaker is in; thirty of the others are slots a client fills ahead of
//! time by sending `VoiceTarget` over TCP - "slot 1 means these two users and
//! that channel" - and afterwards speaks at. Whisper is to users, shout is to a
//! channel; one slot can be both, and the server sends the union.
//!
//! # Registered ahead of the key
//!
//! Each configured target owns a slot - its place in the list, plus one - and
//! the frontend keeps every slot registered as the roster moves
//! ([`AppState::whisper_register`]). A key press then only changes which slot
//! the outbound loop stamps on its packets. Registering on the press loses the
//! opening frames instead: `VoiceTarget` goes over TCP and the voice over UDP,
//! so the first syllable reaches the server before the slot means anything,
//! and the server drops it.
//!
//! The press still carries the target it resolved and registers it where the
//! slot holds something else - someone reconnected a moment ago - so a stale
//! registration costs those first frames rather than whispering to the wrong
//! person.
//!
//! # What the key press does besides retargeting
//!
//! It transmits. A whisper is push-to-talk with a destination, and it works
//! from any activation mode. A press engages the mic where it was not already
//! live, and a release only gives that back where the press took it; in
//! voice-activity mode the release retargets and nothing else.
//!
//! # Refusals
//!
//! The server checks `Whisper` when a slot is registered, not per packet, and
//! answers each refused channel with `PermissionDenied`. Those channels are
//! kept in `AudioPipelineState::whisper_denied` and announced on
//! [`WHISPER_DENIALS_EVENT`]. A registration touching a channel clears it
//! first, so a channel still in the set is one the server refused again.

use std::collections::BTreeSet;
use std::sync::atomic::Ordering;

use tauri::Emitter;
use tracing::{debug, info};

use mumble_protocol::command;

use super::AppState;
use super::types::VoiceState;

/// The highest slot a client may register. 0 is normal speech and 31 the
/// server loopback; neither can be reassigned.
pub(crate) const MAX_WHISPER_SLOT: u8 = 30;

/// Tauri event carrying whether this client is whispering right now.
pub(crate) const WHISPER_STATE_EVENT: &str = "whisper-state";

/// Tauri event carrying the channels the server refuses whispers into.
pub(crate) const WHISPER_DENIALS_EVENT: &str = "whisper-denials";

/// One entry of a whisper target, as the frontend resolved it.
///
/// The shape is upstream's `VoiceTarget.Target`: a list of users, a channel,
/// or both. `links` and `children` widen the channel half only.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WhisperEntry {
    /// Sessions to whisper to.
    #[serde(default)]
    pub sessions: Vec<u32>,
    /// A channel to shout into.
    #[serde(default)]
    pub channel_id: Option<u32>,
    /// Restrict the shout to members of one ACL group.
    #[serde(default)]
    pub group: Option<String>,
    /// Also reach the channels linked to `channel_id`.
    #[serde(default)]
    pub links: bool,
    /// Also reach `channel_id`'s sub-channels, recursively.
    #[serde(default)]
    pub children: bool,
}

impl WhisperEntry {
    /// Whether this entry names anyone at all.
    fn is_empty(&self) -> bool {
        self.sessions.is_empty() && self.channel_id.is_none()
    }
}

impl From<&WhisperEntry> for command::VoiceTargetEntry {
    fn from(entry: &WhisperEntry) -> Self {
        Self {
            sessions: entry.sessions.clone(),
            channel_id: entry.channel_id,
            group: entry.group.clone(),
            links: entry.links,
            children: entry.children,
        }
    }
}

/// The channel one refusal named, and what the server said about it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WhisperRefusal {
    pub channel_id: u32,
    pub reason: Option<String>,
}

/// Payload of [`WHISPER_DENIALS_EVENT`].
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WhisperDenials {
    /// Every channel currently refused.
    pub denied_channels: Vec<u32>,
    /// The refusal that caused this event; `None` when a registration cleared
    /// channels instead.
    pub latest: Option<WhisperRefusal>,
}

/// Whether `slot` is one a client may register.
pub(crate) fn valid_slot(slot: u8) -> bool {
    (1..=MAX_WHISPER_SLOT).contains(&slot)
}

/// The channels a registration needs `Whisper` in: the channel a shout names,
/// and the channel each whispered user is standing in - the permission is on
/// the recipient's room, not the speaker's.
fn channels_touched(
    entries: &[WhisperEntry],
    channel_of: impl Fn(u32) -> Option<u32>,
) -> BTreeSet<u32> {
    entries
        .iter()
        .flat_map(|entry| {
            entry
                .channel_id
                .into_iter()
                .chain(entry.sessions.iter().filter_map(|session| channel_of(*session)))
        })
        .collect()
}

impl AppState {
    /// Make `slot` hold `entries` on the server.
    ///
    /// Returns whether a `VoiceTarget` went out: `false` when the slot already
    /// holds exactly this, which is what nearly every roster-driven call finds.
    /// An empty `entries` clears the slot, so a target whose people all left
    /// stops reaching whoever inherits their session ids.
    pub async fn whisper_register(
        &self,
        slot: u8,
        entries: Vec<WhisperEntry>,
    ) -> Result<bool, String> {
        if !valid_slot(slot) {
            return Err(format!("whisper slot {slot} is outside 1..={MAX_WHISPER_SLOT}"));
        }
        let entries: Vec<WhisperEntry> = entries.into_iter().filter(|e| !e.is_empty()).collect();

        let (handle, cleared) = {
            let __session = self.inner.snapshot();
            let mut state = __session.lock().map_err(|e| e.to_string())?;
            let held = state.audio.whisper_slots.get(&slot).map_or(&[][..], Vec::as_slice);
            if held == entries.as_slice() {
                return Ok(false);
            }
            let handle = state.conn.client_handle.clone().ok_or("not connected")?;

            // Cleared before the message goes out, never after: the refusal is
            // handled on the event loop, and one landing between the send and a
            // later clear would be wiped the moment it arrived.
            let touched = channels_touched(&entries, |session| {
                state.users.get(&session).map(|user| user.channel_id)
            });
            let before = state.audio.whisper_denied.len();
            state.audio.whisper_denied.retain(|channel| !touched.contains(channel));
            let cleared = (state.audio.whisper_denied.len() != before)
                .then(|| state.audio.whisper_denied.iter().copied().collect::<Vec<_>>());

            if entries.is_empty() {
                let _ = state.audio.whisper_slots.remove(&slot);
            } else {
                let _ = state.audio.whisper_slots.insert(slot, entries.clone());
            }
            (handle, cleared)
        };

        let targets = entries.iter().map(command::VoiceTargetEntry::from).collect();
        let sent = handle
            .send(command::SetVoiceTarget {
                id: u32::from(slot),
                targets,
            })
            .await;
        if let Err(e) = sent {
            // The cache must not claim a registration the server never got, or
            // every later call would skip it as already done.
            let __session = self.inner.snapshot();
            if let Ok(mut state) = __session.lock() {
                let _ = state.audio.whisper_slots.remove(&slot);
            }
            return Err(format!("Failed to register whisper slot {slot}: {e}"));
        }

        if let Some(denied_channels) = cleared {
            self.emit_whisper_denials(WhisperDenials {
                denied_channels,
                latest: None,
            });
        }
        debug!("whisper: registered slot {slot} ({} entries)", entries.len());
        Ok(true)
    }

    /// Start whispering at `slot` (whisper key down).
    ///
    /// `entries` is the target as the frontend resolved it at the press; it is
    /// registered only where the slot holds something else. Refuses a target
    /// that reaches nobody rather than letting the speech fall back into the
    /// channel - the whole reason to press the key is that the channel is the
    /// wrong audience.
    pub async fn whisper_start(&self, slot: u8, entries: Vec<WhisperEntry>) -> Result<(), String> {
        let entries: Vec<WhisperEntry> = entries.into_iter().filter(|e| !e.is_empty()).collect();
        if entries.is_empty() {
            return Err("whisper target reaches nobody".into());
        }
        let _ = self.whisper_register(slot, entries).await?;

        let (voice_state, target) = {
            let __session = self.inner.snapshot();
            let state = __session.lock().map_err(|e| e.to_string())?;
            (state.audio.voice_state, state.audio.voice_target.clone())
        };

        // Set before the mic starts, so the first encoded frame is already
        // addressed. The other way round the opening syllable goes to the
        // channel, which on a whisper is the syllable that gives it away.
        target.store(slot, Ordering::Relaxed);

        if voice_state != VoiceState::Active {
            self.push_to_talk_start().await?;
            let __session = self.inner.snapshot();
            let mut state = __session.lock().map_err(|e| e.to_string())?;
            state.audio.whisper_held_ptt = true;
        }

        info!("whisper: started at slot {slot}");
        self.emit_whisper_state(true);
        Ok(())
    }

    /// Stop whispering (whisper key up).
    ///
    /// Gives the mic back before clearing the target where the press took it,
    /// so no frame of the whisper's tail is addressed to the channel.
    pub async fn whisper_end(&self) -> Result<(), String> {
        let (target, held_ptt) = {
            let __session = self.inner.snapshot();
            let mut state = __session.lock().map_err(|e| e.to_string())?;
            let held = std::mem::take(&mut state.audio.whisper_held_ptt);
            (state.audio.voice_target.clone(), held)
        };

        if held_ptt {
            self.push_to_talk_end().await?;
        }
        target.store(0, Ordering::Relaxed);

        info!("whisper: ended");
        self.emit_whisper_state(false);
        Ok(())
    }

    /// Whether this client is whispering right now.
    pub fn whisper_active(&self) -> bool {
        let __session = self.inner.snapshot();
        __session
            .lock()
            .is_ok_and(|state| state.audio.voice_target.load(Ordering::Relaxed) != 0)
    }

    /// The channels the server currently refuses whispers into.
    pub fn whisper_denials(&self) -> Vec<u32> {
        let __session = self.inner.snapshot();
        __session
            .lock()
            .map(|state| state.audio.whisper_denied.iter().copied().collect())
            .unwrap_or_default()
    }

    /// Tell every window whether the whisper is on. The key is global, so the
    /// press often lands while the window that draws the indicator is not the
    /// focused one.
    fn emit_whisper_state(&self, active: bool) {
        if let Some(app) = self.app_handle() {
            let _ = app.emit(WHISPER_STATE_EVENT, active);
        }
    }

    fn emit_whisper_denials(&self, payload: WhisperDenials) {
        if let Some(app) = self.app_handle() {
            let _ = app.emit(WHISPER_DENIALS_EVENT, payload);
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    #[test]
    fn entry_reads_the_frontend_shape() {
        let entry: WhisperEntry = serde_json::from_str(
            r#"{"sessions":[3],"channelId":7,"group":"admin","links":true,"children":false}"#,
        )
        .unwrap();
        assert_eq!(entry.sessions, vec![3]);
        assert_eq!(entry.channel_id, Some(7));
        assert_eq!(entry.group.as_deref(), Some("admin"));
        assert!(entry.links && !entry.children);
    }

    #[test]
    fn an_entry_naming_nobody_is_empty() {
        let entry: WhisperEntry = serde_json::from_str("{}").unwrap();
        assert!(entry.is_empty());
        let shout = WhisperEntry {
            channel_id: Some(0),
            ..entry.clone()
        };
        assert!(!shout.is_empty());
    }

    #[test]
    fn entry_converts_to_the_voice_target_command() {
        let entry = WhisperEntry {
            sessions: vec![1, 2],
            channel_id: Some(5),
            group: None,
            links: false,
            children: true,
        };
        let converted = command::VoiceTargetEntry::from(&entry);
        assert_eq!(converted.sessions, vec![1, 2]);
        assert_eq!(converted.channel_id, Some(5));
        assert!(converted.children && !converted.links);
    }

    #[test]
    fn slots_outside_the_range_are_refused() {
        assert!(!valid_slot(0), "0 is normal speech");
        assert!(valid_slot(1));
        assert!(valid_slot(MAX_WHISPER_SLOT));
        assert!(!valid_slot(31), "31 is the server loopback");
    }

    #[test]
    fn a_registration_touches_the_shout_channel_and_each_whispered_users_channel() {
        let entries = [WhisperEntry {
            sessions: vec![10, 11, 99],
            channel_id: Some(4),
            group: None,
            links: false,
            children: false,
        }];
        let touched = channels_touched(&entries, |session| match session {
            10 => Some(2),
            11 => Some(4),
            _ => None,
        });
        assert_eq!(touched.into_iter().collect::<Vec<_>>(), vec![2, 4]);
    }
}
