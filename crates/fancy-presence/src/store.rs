//! The set of activities currently being advertised by local applications.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

use serde::Serialize;

use crate::protocol::Activity;

/// Identifies one client connection for the lifetime of that connection.
///
/// Not stable across reconnects: an application that restarts gets a new id,
/// which is what makes "this entry went away" unambiguous.
pub type ConnectionId = u64;

/// One application's live presence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceEntry {
    /// Connection that reported this activity.
    pub id: ConnectionId,
    /// Discord application id from the handshake, as a decimal string.
    pub application_id: String,
    /// Human-readable application name, once resolved. The IPC protocol never
    /// carries it, so it stays `None` until the embedder looks it up.
    pub application_name: Option<String>,
    /// Process id the application reported, if it reported one.
    pub pid: Option<u32>,
    /// Executable name for [`PresenceEntry::pid`], where the platform can
    /// tell us. Gives the entry a label even with no name resolution.
    pub process_name: Option<String>,
    /// What the application says it is doing.
    pub activity: Activity,
}

impl PresenceEntry {
    /// The best label available for this entry, preferring a resolved
    /// application name and falling back through the process name to the
    /// raw application id.
    #[must_use]
    pub fn display_name(&self) -> &str {
        self.application_name
            .as_deref()
            .or(self.activity.name.as_deref())
            .or(self.process_name.as_deref())
            .unwrap_or(&self.application_id)
    }
}

/// Live presence for every connected application.
///
/// Cheap to read and safe to share: the embedder polls
/// [`PresenceStore::snapshot`] whenever it needs the full picture and
/// otherwise reacts to [`crate::PresenceEvent`]s.
#[derive(Debug, Default)]
pub struct PresenceStore {
    entries: Mutex<HashMap<ConnectionId, PresenceEntry>>,
}

impl PresenceStore {
    /// An empty store.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Record an entry, returning `true` when it actually changed anything.
    ///
    /// Applications re-send identical `SET_ACTIVITY` payloads on a timer, so
    /// filtering no-op updates here keeps the event stream (and any UI
    /// listening to it) quiet.
    pub fn upsert(&self, mut entry: PresenceEntry) -> bool {
        let mut entries = self.lock();
        if let Some(existing) = entries.get(&entry.id) {
            // A name the embedder resolved has to outlive activity updates,
            // which never carry one - otherwise every keepalive would wipe it
            // and re-emit a change.
            if entry.application_name.is_none() {
                entry
                    .application_name
                    .clone_from(&existing.application_name);
            }
            if *existing == entry {
                return false;
            }
        }
        let _ = entries.insert(entry.id, entry);
        true
    }

    /// Drop an entry, returning `true` if one was there.
    pub fn remove(&self, id: ConnectionId) -> bool {
        self.lock().remove(&id).is_some()
    }

    /// Every live entry, ordered oldest connection first so a UI list does
    /// not reshuffle on every update.
    #[must_use]
    pub fn snapshot(&self) -> Vec<PresenceEntry> {
        let mut entries: Vec<PresenceEntry> = self.lock().values().cloned().collect();
        entries.sort_by_key(|entry| entry.id);
        entries
    }

    /// Number of applications currently advertising presence.
    #[must_use]
    pub fn len(&self) -> usize {
        self.lock().len()
    }

    /// Whether no application is advertising presence.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.lock().is_empty()
    }

    /// Attach a resolved application name to an entry.
    ///
    /// Returns `true` if the entry existed and the name is new. Name lookup
    /// is the embedder's job (it needs network access this crate does not
    /// take), so it arrives after the entry itself.
    pub fn set_application_name(&self, id: ConnectionId, name: &str) -> bool {
        let mut entries = self.lock();
        let Some(entry) = entries.get_mut(&id) else {
            return false;
        };
        if entry.application_name.as_deref() == Some(name) {
            return false;
        }
        entry.application_name = Some(name.to_owned());
        true
    }

    /// Take the lock, recovering from poisoning.
    ///
    /// A panic while holding this lock can leave at most one stale entry;
    /// that is not worth propagating a panic to every later caller.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<ConnectionId, PresenceEntry>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: ConnectionId, details: &str) -> PresenceEntry {
        PresenceEntry {
            id,
            application_id: "123".to_owned(),
            application_name: None,
            pid: None,
            process_name: None,
            activity: Activity {
                details: Some(details.to_owned()),
                ..Activity::default()
            },
        }
    }

    #[test]
    fn reports_a_repeated_identical_update_as_no_change() {
        let store = PresenceStore::new();
        assert!(store.upsert(entry(1, "Playing")));
        assert!(!store.upsert(entry(1, "Playing")));
        assert!(store.upsert(entry(1, "Menu")));
    }

    #[test]
    fn orders_the_snapshot_by_connection_age() {
        let store = PresenceStore::new();
        assert!(store.upsert(entry(7, "later")));
        assert!(store.upsert(entry(2, "earlier")));

        let ids: Vec<ConnectionId> = store.snapshot().iter().map(|e| e.id).collect();
        assert_eq!(ids, vec![2, 7]);
    }

    #[test]
    fn removes_only_the_named_connection() {
        let store = PresenceStore::new();
        assert!(store.upsert(entry(1, "a")));
        assert!(store.upsert(entry(2, "b")));

        assert!(store.remove(1));
        assert!(!store.remove(1));
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn names_an_existing_entry_once() {
        let store = PresenceStore::new();
        assert!(store.upsert(entry(1, "a")));

        assert!(store.set_application_name(1, "Some Game"));
        assert!(!store.set_application_name(1, "Some Game"));
        assert!(!store.set_application_name(99, "Absent"));

        assert_eq!(
            store.snapshot()[0].application_name.as_deref(),
            Some("Some Game")
        );
    }

    #[test]
    fn keeps_a_resolved_name_across_activity_updates() {
        let store = PresenceStore::new();
        assert!(store.upsert(entry(1, "a")));
        assert!(store.set_application_name(1, "Some Game"));

        // An ordinary activity update carries no name and must not erase one.
        assert!(store.upsert(entry(1, "b")));
        assert_eq!(
            store.snapshot()[0].application_name.as_deref(),
            Some("Some Game")
        );

        // And a repeat of that same update is still a no-op.
        assert!(!store.upsert(entry(1, "b")));
    }

    #[test]
    fn falls_back_through_the_available_labels() {
        let mut candidate = entry(1, "a");
        assert_eq!(candidate.display_name(), "123");

        candidate.process_name = Some("game.exe".to_owned());
        assert_eq!(candidate.display_name(), "game.exe");

        candidate.activity.name = Some("From Activity".to_owned());
        assert_eq!(candidate.display_name(), "From Activity");

        candidate.application_name = Some("Resolved".to_owned());
        assert_eq!(candidate.display_name(), "Resolved");
    }
}
