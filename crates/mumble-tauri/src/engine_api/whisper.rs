//! Whisper and shout targets kept in slots of their own, for a view that
//! is not the web page: what the web client's `whisper_register` and
//! `whisper_start` commands do for its several named targets, each in the
//! slot its place in the list gives it.

use crate::state::WhisperEntry;

use super::EngineHandle;

/// Who a target reaches, as it stands now.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WhisperReach {
    /// The people, by session.
    pub sessions: Vec<u32>,
    /// The channel a shout goes to.
    pub channel: Option<u32>,
    /// Only those of this group, by name.
    pub group: Option<String>,
    /// Also the channels linked to `channel`.
    pub links: bool,
    /// Also the channels under it.
    pub children: bool,
}

impl From<WhisperReach> for WhisperEntry {
    fn from(reach: WhisperReach) -> Self {
        Self {
            sessions: reach.sessions,
            channel_id: reach.channel,
            group: reach.group,
            links: reach.links,
            children: reach.children,
        }
    }
}

impl EngineHandle {
    /// Tell the server ahead of time who the slot `slot` reaches, so that
    /// the first syllable is not lost; `None` empties it.
    ///
    /// # Errors
    ///
    /// When not connected, or `slot` is not one of the server's thirty.
    pub async fn register_whisper_slot(&self, slot: u8, reach: Option<WhisperReach>) -> Result<(), String> {
        let entries = reach.map(|reach| vec![reach.into()]).unwrap_or_default();
        self.state.whisper_register(slot, entries).await.map(|_| ())
    }

    /// The key of the slot `slot` went down: speak to `reach` and to
    /// nobody else. [`EngineHandle::whisper_end`] ends it.
    ///
    /// # Errors
    ///
    /// When not connected, when it reaches nobody, or the microphone cannot
    /// be opened.
    pub async fn start_whisper_slot(&self, slot: u8, reach: WhisperReach) -> Result<(), String> {
        self.state.whisper_start(slot, vec![reach.into()]).await
    }
}
