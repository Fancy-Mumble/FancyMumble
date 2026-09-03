//! Content offloading: encrypt message bodies to temp files and restore
//! them on demand, keeping memory usage bounded for large chat histories.

use std::collections::HashMap;

use tauri::Manager;

use super::offload::OffloadStore;
use super::types::ChatMessage;
use super::{AppState, SharedState};

impl AppState {
    pub fn init_offload_store(&self) -> Result<(), String> {
        let base_dir = self.offload_base_dir()?;
        OffloadStore::cleanup_stale(&base_dir);
        let store = OffloadStore::new(base_dir)?;
        if let Ok(mut state) = self.inner.snapshot().lock() {
            state.offload_store = Some(store);
        }
        Ok(())
    }

    pub(super) fn offload_base_dir(&self) -> Result<std::path::PathBuf, String> {
        if let Some(app) = self.app_handle() {
            if let Ok(cache) = app.path().cache_dir() {
                return Ok(cache);
            }
        }
        Ok(std::env::temp_dir())
    }

    pub fn offload_message(
        &self,
        message_id: String,
        scope: String,
        scope_id: String,
    ) -> Result<(), String> {
        let __session = self.inner.snapshot();
        let mut state = __session.lock().map_err(|e| e.to_string())?;

        let body = find_message_body(&state, &scope, &scope_id, &message_id)?;

        if body.starts_with("<!-- OFFLOADED:") {
            return Ok(());
        }

        let content_len = body.len();

        let store = state
            .offload_store
            .as_mut()
            .ok_or("Offload store not initialised")?;
        store.store(&message_id, &body)?;

        set_message_body(
            &mut state,
            &scope,
            &scope_id,
            &message_id,
            offload_placeholder(&message_id, content_len),
        );

        Ok(())
    }

    pub fn load_offloaded_message(
        &self,
        message_id: String,
        scope: String,
        scope_id: String,
    ) -> Result<String, String> {
        let __session = self.inner.snapshot();
        let mut state = __session.lock().map_err(|e| e.to_string())?;

        let store = state
            .offload_store
            .as_mut()
            .ok_or("Offload store not initialised")?;
        let body = store.load(&message_id)?;
        store.remove(&message_id);

        set_message_body(&mut state, &scope, &scope_id, &message_id, body.clone());

        Ok(body)
    }

    pub fn load_offloaded_messages_batch(
        &self,
        message_ids: Vec<String>,
        scope: String,
        scope_id: String,
    ) -> Result<HashMap<String, String>, String> {
        let __session = self.inner.snapshot();
        let mut state = __session.lock().map_err(|e| e.to_string())?;

        let store = state
            .offload_store
            .as_mut()
            .ok_or("Offload store not initialised")?;

        let key_refs: Vec<&str> = message_ids.iter().map(String::as_str).collect();
        let results = store.load_many(&key_refs);

        let mut restored = HashMap::new();
        for (key, result) in &results {
            if let Ok(body) = result {
                store.remove(key);
                let _ = restored.insert(key.clone(), body.clone());
            }
        }

        for (key, body) in &restored {
            set_message_body(&mut state, &scope, &scope_id, key, body.clone());
        }

        Ok(restored)
    }

    pub fn clear_offloaded(&self) {
        if let Ok(mut state) = self.inner.snapshot().lock() {
            if let Some(store) = state.offload_store.as_mut() {
                store.clear();
            }
        }
    }

    pub fn shutdown_offload_store(&self) {
        if let Ok(mut state) = self.inner.snapshot().lock() {
            if let Some(store) = state.offload_store.as_mut() {
                store.cleanup_dir();
            }
        }
    }
}

// -- Host-side sweep ----------------------------------------------------

/// Bodies shorter than this are never worth a file, whatever they hold.
///
/// The same rule the frontend applies (`isHeavyContent`), so a body the host
/// puts away is one the rows already know how to draw a placeholder for.
const HEAVY_THRESHOLD: usize = 4096;

/// Whether a body carries inline media worth putting away: over the
/// threshold and embedding a data-URL picture or clip.
pub(super) fn is_heavy_body(body: &str) -> bool {
    body.len() > HEAVY_THRESHOLD
        && (body.contains("src=\"data:image/") || body.contains("src=\"data:video/"))
}

/// The marker a put-away body leaves behind, carrying its size so a row can
/// hold the right amount of room open for it.
pub(super) fn offload_placeholder(message_id: &str, content_len: usize) -> String {
    format!("<!-- OFFLOADED:{message_id}:{content_len} -->")
}

/// Put away every heavy body in `messages` except the newest `keep_newest`.
///
/// The viewport-driven path only ever sees the conversation on screen; a
/// channel the reader has left, or has never opened, keeps every pasted
/// screenshot in this process for as long as the session lasts. This is the
/// other half: nothing in those threads is being looked at, so their heavy
/// bodies go to the encrypted store now, and come back the moment a row asks
/// for them - the same restore path a scrolled-away row uses.
///
/// Returns how many bodies were put away. A body with no id stays, because
/// nothing could ask for it again.
pub(super) fn offload_idle_bodies(
    messages: &mut [ChatMessage],
    store: &mut OffloadStore,
    keep_newest: usize,
) -> usize {
    let end = messages.len().saturating_sub(keep_newest);
    let mut put_away = 0;
    for msg in &mut messages[..end] {
        let Some(id) = msg.message_id.as_deref() else {
            continue;
        };
        if !is_heavy_body(&msg.body) {
            continue;
        }
        if store.store(id, &msg.body).is_err() {
            continue;
        }
        let len = msg.body.len();
        msg.body = offload_placeholder(id, len);
        put_away += 1;
    }
    put_away
}

/// Put away the body that just arrived in `channel_id`, if that channel is
/// not the one on screen and the body is heavy.
///
/// Deliberately only the newest message: this runs on the protocol thread
/// with the state lock held, so the work has to be bounded by what just
/// arrived rather than by how long the conversation is. Everything older was
/// already dealt with on its own arrival, or by the sweep on leaving.
pub(super) fn offload_newest_if_idle(state: &mut SharedState, channel_id: u32) {
    if state.selected_channel == Some(channel_id) {
        return;
    }
    let Some(store) = state.offload_store.as_mut() else {
        return;
    };
    let Some(bucket) = state.msgs.by_channel.get_mut(&channel_id) else {
        return;
    };
    let from = bucket.len().saturating_sub(1);
    let _ = offload_idle_bodies(&mut bucket[from..], store, 0);
}

/// Put away the heavy bodies of every channel except `except`, the one on
/// screen. The frontend's window decides for that one; here nothing decides,
/// because nothing in the others is mounted.
pub(super) fn offload_idle_channels(state: &mut SharedState, except: Option<u32>) -> usize {
    let Some(store) = state.offload_store.as_mut() else {
        return 0;
    };
    let mut put_away = 0;
    for (channel_id, messages) in &mut state.msgs.by_channel {
        if Some(*channel_id) == except {
            continue;
        }
        put_away += offload_idle_bodies(messages, store, 0);
    }
    if put_away > 0 {
        tracing::debug!("offload: put away {put_away} heavy bodies from idle channels");
    }
    put_away
}

// -- Helpers ----------------------------------------------------------

pub(super) fn find_message_body(
    state: &SharedState,
    scope: &str,
    scope_id: &str,
    message_id: &str,
) -> Result<String, String> {
    let messages = match scope {
        "channel" => {
            let ch_id: u32 = scope_id.parse().map_err(|_| "Invalid channel ID")?;
            state.msgs.by_channel.get(&ch_id)
        }
        "dm" => {
            let session: u32 = scope_id.parse().map_err(|_| "Invalid DM session")?;
            state.msgs.by_dm.get(&session)
        }
        _ => return Err(format!("Unknown scope: {scope}")),
    };
    let messages = messages.ok_or("No messages found for scope")?;
    let msg = messages
        .iter()
        .find(|m| m.message_id.as_deref() == Some(message_id))
        .ok_or("Message not found")?;
    Ok(msg.body.clone())
}

pub(super) fn set_message_body(
    state: &mut SharedState,
    scope: &str,
    scope_id: &str,
    message_id: &str,
    body: String,
) {
    let messages = match scope {
        "channel" => {
            let ch_id: u32 = scope_id.parse().unwrap_or(0);
            state.msgs.by_channel.get_mut(&ch_id)
        }
        "dm" => {
            let session: u32 = scope_id.parse().unwrap_or(0);
            state.msgs.by_dm.get_mut(&session)
        }
        _ => None,
    };
    if let Some(messages) = messages {
        if let Some(msg) = messages
            .iter_mut()
            .find(|m| m.message_id.as_deref() == Some(message_id))
        {
            msg.body = body;
        }
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "panic-on-failure is acceptable in test code"
)]
mod tests {
    use super::*;

    fn message(id: &str, body: &str) -> ChatMessage {
        ChatMessage {
            sender_session: Some(1),
            sender_name: "user".into(),
            sender_hash: None,
            body: body.into(),
            channel_id: 0,
            is_own: false,
            dm_session: None,
            message_id: Some(id.into()),
            timestamp: Some(1),
            is_legacy: false,
            send_failed: false,
            edited_at: None,
            pinned: false,
            pinned_by: None,
            pinned_at: None,
            plugin_name: None,
            plugin_components: None,
        }
    }

    fn picture() -> String {
        format!("look <img src=\"data:image/png;base64,{}\">", "A".repeat(5000))
    }

    fn store() -> (tempfile::TempDir, OffloadStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = OffloadStore::new(dir.path().to_path_buf()).unwrap();
        (dir, store)
    }

    #[test]
    fn heavy_means_long_and_carrying_inline_media() {
        assert!(is_heavy_body(&picture()));
        // Long, but plain text: not worth a file.
        assert!(!is_heavy_body(&"a".repeat(10_000)));
        // Inline media, but tiny: not worth a file either.
        assert!(!is_heavy_body("<img src=\"data:image/png;base64,AAAA\">"));
    }

    #[test]
    fn puts_away_heavy_bodies_and_leaves_a_marker_that_carries_the_size() {
        let (_dir, mut store) = store();
        let heavy = picture();
        let mut messages = vec![message("a", "hello"), message("b", &heavy)];

        assert_eq!(offload_idle_bodies(&mut messages, &mut store, 0), 1);
        assert_eq!(messages[0].body, "hello");
        assert_eq!(messages[1].body, offload_placeholder("b", heavy.len()));
        // The bytes are in the store, and come back as they were.
        assert_eq!(store.load("b").unwrap(), heavy);
    }

    #[test]
    fn keeps_the_newest_bodies_where_the_reader_is() {
        let (_dir, mut store) = store();
        let heavy = picture();
        let mut messages = vec![message("old", &heavy), message("new", &heavy)];

        assert_eq!(offload_idle_bodies(&mut messages, &mut store, 1), 1);
        assert!(messages[0].body.starts_with("<!-- OFFLOADED:old:"));
        assert_eq!(messages[1].body, heavy);
    }

    #[test]
    fn a_body_nothing_could_ask_back_for_stays() {
        let (_dir, mut store) = store();
        let mut anonymous = message("x", &picture());
        anonymous.message_id = None;
        let mut messages = vec![anonymous];

        assert_eq!(offload_idle_bodies(&mut messages, &mut store, 0), 0);
        assert!(messages[0].body.starts_with("look <img"));
    }

    #[test]
    fn the_newest_arrival_goes_away_only_while_the_channel_is_off_screen() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = SharedState {
            offload_store: Some(OffloadStore::new(dir.path().to_path_buf()).unwrap()),
            ..SharedState::default()
        };
        let heavy = picture();
        let _ = state
            .msgs
            .by_channel
            .insert(4, vec![message("old", &heavy), message("new", &heavy)]);

        // On screen: the frontend's window decides, so nothing happens here.
        state.selected_channel = Some(4);
        offload_newest_if_idle(&mut state, 4);
        assert_eq!(state.msgs.by_channel[&4][1].body, heavy);

        // Off screen: the arrival goes, and only the arrival - the one before
        // it was dealt with when *it* arrived.
        state.selected_channel = Some(9);
        offload_newest_if_idle(&mut state, 4);
        assert!(state.msgs.by_channel[&4][1].body.starts_with("<!-- OFFLOADED:new:"));
        assert_eq!(state.msgs.by_channel[&4][0].body, heavy);
    }

    #[test]
    fn leaving_a_channel_sweeps_it_but_never_the_one_arrived_at() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = SharedState {
            offload_store: Some(OffloadStore::new(dir.path().to_path_buf()).unwrap()),
            ..SharedState::default()
        };
        let heavy = picture();
        let _ = state.msgs.by_channel.insert(1, vec![message("left", &heavy)]);
        let _ = state.msgs.by_channel.insert(2, vec![message("opened", &heavy)]);

        assert_eq!(offload_idle_channels(&mut state, Some(2)), 1);
        assert!(state.msgs.by_channel[&1][0].body.starts_with("<!-- OFFLOADED:left:"));
        assert_eq!(state.msgs.by_channel[&2][0].body, heavy);
    }

    #[test]
    fn a_second_sweep_finds_nothing_left_to_do() {
        let (_dir, mut store) = store();
        let mut messages = vec![message("a", &picture())];
        assert_eq!(offload_idle_bodies(&mut messages, &mut store, 0), 1);
        // The marker is short and carries no media, so it is not heavy.
        assert_eq!(offload_idle_bodies(&mut messages, &mut store, 0), 0);
        assert_eq!(store.offloaded_count(), 1);
    }
}
