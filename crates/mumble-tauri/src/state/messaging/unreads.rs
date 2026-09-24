//! Unread message tracking: per-channel and per-DM counts.

use std::collections::HashMap;

use tauri::Emitter;

use crate::state::AppState;
use crate::state::types::{DmUnreadPayload, UnreadPayload};

impl AppState {
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
        if let Some(handle) = self.app_handle() {
            let unreads = self.unread_counts();
            let _ = handle.emit("unread-changed", UnreadPayload { unreads });
        }
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
        if let Some(handle) = self.app_handle() {
            let unreads = self.dm_unread_counts();
            let _ = handle.emit("dm-unread-changed", DmUnreadPayload { unreads });
        }
    }
}
