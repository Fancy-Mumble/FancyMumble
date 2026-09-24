//! What was read on one of the account's devices is read on all of them.
//!
//! Each time a channel or a conversation is opened or left, the device writes
//! a read marker to the account's records - `read/ch/<channel>` or
//! `read/dm/<session>`, the time it was read. Leaving counts as well as
//! opening: whatever arrived while the channel was open was read then, and
//! the other devices counted it as unread.
//!
//! Starling pushes a record one session writes to the account's other
//! sessions (an unasked `Record`, empty `request_id`), and on receiving a
//! marker a device clears that badge. A registered account only; a guest has
//! no records, and its writes are simply refused.
//!
//! Writes are debounced per key: switching back and forth through five
//! channels is five markers, not fifty, and each goes out once the switching
//! has settled.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

use mumble_protocol::command;

use super::SharedState;

/// How long a marker waits for the switching to settle before it is written.
const SETTLE: Duration = Duration::from_millis(1500);

/// Keys waiting to be written, so a second switch within the window does not
/// schedule a second write.
static PENDING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// What was read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Read {
    Channel(u32),
    Direct(u32),
}

impl Read {
    fn key(self) -> String {
        match self {
            Self::Channel(id) => format!("read/ch/{id}"),
            Self::Direct(session) => format!("read/dm/{session}"),
        }
    }

    /// The marker a record key names, if it is one.
    pub(crate) fn from_key(key: &str) -> Option<Self> {
        let rest = key.strip_prefix("read/")?;
        if let Some(id) = rest.strip_prefix("ch/") {
            return id.parse().ok().map(Self::Channel);
        }
        rest.strip_prefix("dm/")?.parse().ok().map(Self::Direct)
    }
}

/// Tell the account's other devices `read` was read here.
///
/// Called with the session's state locked, so it only takes what it needs
/// and schedules the write; nothing here waits.
pub(crate) fn share(state: &SharedState, read: Read) {
    let registered = state
        .conn
        .own_session
        .and_then(|own| state.users.get(&own))
        .is_some_and(|user| user.user_id.is_some());
    let Some(handle) = state.conn.client_handle.clone().filter(|_| registered) else {
        return;
    };
    let key = read.key();
    {
        let Ok(mut pending) = PENDING.lock() else {
            return;
        };
        if !pending.get_or_insert_with(HashSet::new).insert(key.clone()) {
            return;
        }
    }
    drop(tokio::spawn(async move {
        tokio::time::sleep(SETTLE).await;
        if let Ok(mut pending) = PENDING.lock()
            && let Some(keys) = pending.as_mut()
        {
            let _ = keys.remove(&key);
        }
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or_default();
        // Nobody waits for the answer: the marker is advice to the other
        // devices, and a lost one costs a badge, not a message.
        if let Err(e) = handle
            .send(command::SendFancyRecordPut {
                request_id: uuid::Uuid::new_v4().to_string(),
                key,
                value: now_ms.to_string().into_bytes(),
                remove: false,
            })
            .await
        {
            tracing::debug!("could not share a read marker: {e}");
        }
    }));
}

/// Apply a marker another device wrote: clear that badge here.
///
/// Returns which kind of badge changed, so the caller can tell the frontend.
pub(crate) fn apply(state: &mut SharedState, read: Read) -> Option<Read> {
    let cleared = match read {
        Read::Channel(id) => state.msgs.channel_unread.remove(&id),
        Read::Direct(session) => state.msgs.dm_unread.remove(&session),
    };
    cleared.map(|_| read)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_marker_key_reads_back_as_what_was_read() {
        for read in [Read::Channel(4), Read::Direct(17)] {
            assert_eq!(Read::from_key(&read.key()), Some(read));
        }
        assert_eq!(Read::from_key("prefs/v1"), None);
        assert_eq!(Read::from_key("read/ch/not-a-number"), None);
        assert_eq!(Read::from_key("read/xx/4"), None);
    }

    #[test]
    fn a_marker_from_another_device_clears_the_badge_here() {
        let mut state = SharedState::default();
        let _ = state.msgs.channel_unread.insert(4, 3);
        let _ = state.msgs.dm_unread.insert(17, 1);
        assert_eq!(apply(&mut state, Read::Channel(4)), Some(Read::Channel(4)));
        assert_eq!(apply(&mut state, Read::Direct(17)), Some(Read::Direct(17)));
        assert!(state.msgs.channel_unread.is_empty());
        assert!(state.msgs.dm_unread.is_empty());
        // Nothing to clear is nothing to report.
        assert_eq!(apply(&mut state, Read::Channel(4)), None);
    }
}
