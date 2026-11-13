//! Unread message tracking: per-channel and per-DM counts.

use std::collections::HashMap;

use crate::state::AppState;
use crate::state::core_event::CoreEvent;
use crate::state::types::{DmUnreadPayload, UnreadPayload};

impl AppState {
    /// Tell the engine whether the user is looking at the application.
    ///
    /// A message that arrives while they are not counts as unread and raises
    /// a notification even in the conversation that is open.
    pub fn set_app_focused(&self, focused: bool) {
        if let Ok(mut state) = self.inner.snapshot().lock() {
            state.prefs.app_focused = focused;
        }
    }

    pub fn unread_counts(&self) -> HashMap<u32, u32> {
        self.inner
            .snapshot()
            .lock()
            .map(|s| s.msgs.channel_unread.clone())
            .unwrap_or_default()
    }

    pub fn mark_read(&self, channel_id: u32) {
        if let Ok(mut state) = self.inner.snapshot().lock() {
            let _ = state.msgs.channel_unread.remove(&channel_id);
            crate::state::read_sync::share(
                &state,
                crate::state::read_sync::Read::Channel(channel_id),
            );
        }
        self.emit_unreads();
    }

    pub(in crate::state) fn emit_unreads(&self) {
        let unreads = self.unread_counts();
        self.tell_view(CoreEvent::UnreadChanged(UnreadPayload { unreads }));
    }

    pub fn dm_unread_counts(&self) -> HashMap<u32, u32> {
        self.inner
            .snapshot()
            .lock()
            .map(|s| s.msgs.dm_unread.clone())
            .unwrap_or_default()
    }

    pub fn mark_dm_read(&self, session: u32) {
        if let Ok(mut state) = self.inner.snapshot().lock() {
            let _ = state.msgs.dm_unread.remove(&session);
            crate::state::read_sync::share(&state, crate::state::read_sync::Read::Direct(session));
        }
        self.emit_dm_unreads();
    }

    pub(in crate::state) fn emit_dm_unreads(&self) {
        let unreads = self.dm_unread_counts();
        self.tell_view(CoreEvent::DmUnreadChanged(DmUnreadPayload { unreads }));
    }
}
