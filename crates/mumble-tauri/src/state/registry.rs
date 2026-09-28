//! Session registry: tracks every active server connection's
//! [`SharedState`] keyed by [`ServerId`], plus which one is currently
//! active.
//!
//! This is the central piece of the multi-server architecture.  Each
//! connected server gets its own `Arc<Mutex<SharedState>>`; the
//! registry maps `ServerId -> Arc<Mutex<SharedState>>` and remembers
//! which session is "active" (the one that commands without an explicit
//! `serverId` operate on).
//!
//! Phase B.1: the registry is in place but only ever holds at most one
//! entry; behaviour is identical to the single-connection world.  Phase
//! B.2 makes `connect` additive and `set_active_server` perform a real
//! switch between concurrent sessions.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;

use super::SharedState;
use super::sessions::{ServerId, SessionMeta};

/// Result of a cross-server user lookup by certificate hash.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserHashMatch {
    pub server_id: ServerId,
    pub user_session: u32,
    pub user_name: String,
    /// The registered account the match belongs to, when they have one.  The
    /// caller needs it to tell whether the certificate it searched for is still
    /// worn by the person it saved.
    pub user_id: Option<u32>,
}

/// Who to look for, in [`Registry::find_user_by_hash`].
///
/// The hash on its own addresses a *certificate*; the other two fields are what
/// narrow that to a person - the account the caller saved, and the session it
/// saved them on.
#[derive(Clone, Copy, Debug)]
pub(crate) struct HashLookup<'a> {
    /// The TLS certificate hash (hex SHA-1) to search for.
    pub user_hash: &'a str,
    /// The registered account the caller expects, when it knows one.
    pub user_id: Option<u32>,
    /// The session the caller's record was captured on, when it is open.
    pub origin: Option<ServerId>,
}

/// Inner mutable state of [`Registry`].
#[derive(Default)]
struct RegistryInner {
    active: Option<ServerId>,
    sessions: HashMap<ServerId, Arc<Mutex<SharedState>>>,
}

/// Concurrency-safe wrapper around the per-session map.
#[derive(Default, Clone)]
pub(crate) struct Registry {
    inner: Arc<Mutex<RegistryInner>>,
}

impl Registry {
    /// Return the active session's id, if any.
    pub(crate) fn active_id(&self) -> Option<ServerId> {
        self.inner.lock().ok().and_then(|g| g.active)
    }

    /// Look up a specific session's [`SharedState`] handle by id.
    pub(crate) fn session(&self, id: ServerId) -> Option<Arc<Mutex<SharedState>>> {
        self.inner.lock().ok()?.sessions.get(&id).cloned()
    }

    /// Every session's [`SharedState`] handle, in no particular order.
    ///
    /// For teardown work that has to touch each connection rather than
    /// just the active one - flushing per-session state to disk on exit,
    /// say, which otherwise loses whatever the background tabs held.
    pub(crate) fn all_sessions(&self) -> Vec<Arc<Mutex<SharedState>>> {
        self.inner
            .lock()
            .map(|g| g.sessions.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Insert a new session and mark it as active.  Returns the id.
    pub(crate) fn register_active(
        &self,
        id: ServerId,
        shared: Arc<Mutex<SharedState>>,
    ) -> Option<Arc<Mutex<SharedState>>> {
        let mut guard = self.inner.lock().ok()?;
        let displaced = guard.sessions.insert(id, shared);
        guard.active = Some(id);
        displaced
    }

    /// Set which session is active.  Returns `Err` if `id` is unknown.
    pub(crate) fn set_active(&self, id: ServerId) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        if !guard.sessions.contains_key(&id) {
            return Err(format!("unknown server id: {id}"));
        }
        guard.active = Some(id);
        Ok(())
    }

    /// Remove a session.  If it was the active one, picks an arbitrary
    /// remaining session as the new active (or `None` if empty).
    pub(crate) fn remove(&self, id: ServerId) -> Option<Arc<Mutex<SharedState>>> {
        let mut guard = self.inner.lock().ok()?;
        let removed = guard.sessions.remove(&id);
        if guard.active == Some(id) {
            guard.active = guard.sessions.keys().copied().next();
        }
        removed
    }

    /// Reuse a single *disconnected* session targeting `(host, port,
    /// username)` for a reconnect: returns its id and shared state so the
    /// caller can re-bind the **same** tab instead of allocating a fresh
    /// [`ServerId`].  Without this, every automatic reconnect attempt
    /// would create a new session and spam the tab strip with one entry
    /// per retry.
    ///
    /// Any *additional* disconnected duplicates for the same target are
    /// dropped so the strip never accumulates stale tabs.  Sessions whose
    /// status is `Connecting` or `Connected` are never reused or removed:
    /// the user may legitimately have several attempts in flight, and we
    /// must never silently kill a live session.
    pub(crate) fn take_reusable_for(
        &self,
        host: &str,
        port: u16,
        username: &str,
    ) -> Option<(ServerId, Arc<Mutex<SharedState>>)> {
        let mut guard = self.inner.lock().ok()?;
        let mut matches: Vec<ServerId> = guard
            .sessions
            .iter()
            .filter_map(|(id, shared)| {
                let s = shared.lock().ok()?;
                let matches = s.server.host == host
                    && s.server.port == port
                    && s.conn.own_name == username
                    && s.conn.status == super::types::ConnectionStatus::Disconnected;
                matches.then_some(*id)
            })
            .collect();
        let reuse = matches.pop();
        // Drop any extra stale duplicates targeting the same server.
        for id in matches {
            let _ = guard.sessions.remove(&id);
            if guard.active == Some(id) {
                guard.active = None;
            }
        }
        let reuse_id = reuse?;
        let shared = guard.sessions.get(&reuse_id).cloned()?;
        Some((reuse_id, shared))
    }

    /// After a session fails to connect, prefer to keep the user on a
    /// still-live session: if any session *other* than `failed_id`
    /// exists, make one active (preferring a `Connected` one) and return
    /// `true`.  When `failed_id` is the only session, leave it active -
    /// so its tab can show the reconnect overlay while auto-reconnect
    /// retries - and return `false`.
    pub(crate) fn activate_fallback(&self, failed_id: ServerId) -> bool {
        let Ok(mut guard) = self.inner.lock() else {
            return false;
        };
        let mut fallback: Option<ServerId> = None;
        for (id, shared) in &guard.sessions {
            if *id == failed_id {
                continue;
            }
            let connected = shared
                .lock()
                .map(|s| s.conn.status == super::types::ConnectionStatus::Connected)
                .unwrap_or(false);
            if connected {
                fallback = Some(*id);
                break;
            }
            if fallback.is_none() {
                fallback = Some(*id);
            }
        }
        match fallback {
            Some(id) => {
                guard.active = Some(id);
                true
            }
            None => false,
        }
    }

    /// Find the person a saved record refers to, among the users on every
    /// connected session.
    ///
    /// A certificate hash is *not* a person: one certificate can log in under
    /// several accounts (a second identity, a test login), so searching by hash
    /// alone happily answers with whoever happens to hold that certificate now.
    /// When the caller knows which registered account it saved
    /// ([`HashLookup::user_id`]) and which session it saved it on
    /// ([`HashLookup::origin`]), that account is what identifies the person on
    /// that server, and a *different* account wearing the same certificate is
    /// refused rather than returned.
    ///
    /// Registered ids only mean anything on the server that issued them, so the
    /// check applies to sessions pointed at the friend's own `host:port` (both
    /// of them, when the client holds two connections to it) and nowhere else.
    /// Any other open server is still searched by certificate alone - that is
    /// what finds a friend who is somewhere else today - but only after the
    /// friend's own server has failed to answer.
    pub(crate) fn find_user_by_hash(&self, lookup: HashLookup<'_>) -> Option<UserHashMatch> {
        let guard = self.inner.lock().ok()?;
        let origin_target = lookup
            .origin
            .and_then(|id| guard.sessions.get(&id))
            .and_then(|shared| {
                let s = shared.lock().ok()?;
                Some((s.server.host.clone(), s.server.port))
            });

        // The friend's own session first, then the rest in a stable order: the
        // session map is a `HashMap`, so without this the answer to "which of
        // my connections is this friend on" changes from call to call.
        let mut order: Vec<_> = guard.sessions.iter().collect();
        order.sort_by_key(|(id, _)| (Some(**id) != lookup.origin, id.to_string()));

        // A match on a server that is not the friend's own is the weaker
        // answer, so it is kept only until the friend's own server has been
        // searched.
        let mut elsewhere: Option<UserHashMatch> = None;
        for (id, shared) in order {
            let Ok(s) = shared.lock() else { continue };
            if s.conn.status != super::types::ConnectionStatus::Connected {
                continue;
            }
            let same_server = origin_target
                .as_ref()
                .is_some_and(|(host, port)| *host == s.server.host && *port == s.server.port);
            // On the friend's own server their account decides; anywhere else
            // an id would be a different server's, so only the hash is asked.
            let want = if same_server { lookup.user_id } else { None };
            let Some(found) = wearer_of(&s, lookup.user_hash, want) else {
                continue;
            };
            let matched = UserHashMatch {
                server_id: *id,
                user_session: found.session,
                user_name: found.name.clone(),
                user_id: found.user_id,
            };
            // Their own server has spoken, or there was never an account to
            // check against - either way this is the answer.
            if same_server || lookup.user_id.is_none() {
                return Some(matched);
            }
            let _ = elsewhere.get_or_insert(matched);
        }
        elsewhere
    }

    /// Look up a user on a specific connected session by display name.
    /// Fallback for anonymous users that have no certificate hash and
    /// therefore can only be addressed within a single server.
    pub(crate) fn find_user_in_server(
        &self,
        server_id: ServerId,
        user_name: &str,
    ) -> Option<UserHashMatch> {
        let guard = self.inner.lock().ok()?;
        let shared = guard.sessions.get(&server_id)?;
        let s = shared.lock().ok()?;
        if s.conn.status != super::types::ConnectionStatus::Connected {
            return None;
        }
        let found = s.users.values().find(|u| u.name == user_name)?;
        Some(UserHashMatch {
            server_id,
            user_session: found.session,
            user_name: found.name.clone(),
            user_id: found.user_id,
        })
    }

    /// Snapshot the metadata of every known session, suitable for the
    /// `list_servers` command.  Reads the per-session `SharedState` to
    /// derive the live status, host, port, username, etc.
    pub(crate) fn list_meta(&self) -> Vec<SessionMeta> {
        let Ok(guard) = self.inner.lock() else {
            return Vec::new();
        };
        guard
            .sessions
            .iter()
            .filter_map(|(id, shared)| {
                let s = shared.lock().ok()?;
                Some(SessionMeta {
                    id: *id,
                    label: format_label(&s.conn.own_name, &s.server.host, s.server.port),
                    host: s.server.host.clone(),
                    port: s.server.port,
                    username: s.conn.own_name.clone(),
                    cert_label: s.cert_label.clone(),
                    status: s.conn.status,
                })
            })
            .collect()
    }
}

/// The user on this session's roster wearing `hash` - narrowed to the account
/// `want` when the caller knows which of the certificate's accounts it means.
fn wearer_of<'a>(
    state: &'a SharedState,
    hash: &str,
    want: Option<u32>,
) -> Option<&'a super::UserEntry> {
    state
        .users
        .values()
        .find(|u| u.hash.as_deref() == Some(hash) && want.is_none_or(|id| u.user_id == Some(id)))
}

fn format_label(username: &str, host: &str, port: u16) -> String {
    if username.is_empty() {
        format!("{host}:{port}")
    } else {
        format!("{username}@{host}:{port}")
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "unwrap/expect is acceptable in test code"
)]
mod tests {
    use super::*;

    fn make_shared(host: &str, port: u16, user: &str) -> Arc<Mutex<SharedState>> {
        let mut s = SharedState::default();
        s.server.host = host.into();
        s.server.port = port;
        s.conn.own_name = user.into();
        Arc::new(Mutex::new(s))
    }

    #[test]
    fn register_and_resolve_active() {
        let reg = Registry::default();
        let id = ServerId::new();
        let shared = make_shared("h", 1, "u");
        let _ = reg.register_active(id, shared);
        assert_eq!(reg.active_id(), Some(id));
    }

    #[test]
    fn remove_picks_next_active() {
        let reg = Registry::default();
        let a = ServerId::new();
        let b = ServerId::new();
        let _ = reg.register_active(a, make_shared("a", 1, "u1"));
        let _ = reg.register_active(b, make_shared("b", 2, "u2"));
        assert_eq!(reg.active_id(), Some(b));
        let _ = reg.remove(b);
        assert_eq!(reg.active_id(), Some(a));
        let _ = reg.remove(a);
        assert!(reg.active_id().is_none());
    }

    #[test]
    fn list_meta_synthesises_label() {
        let reg = Registry::default();
        let id = ServerId::new();
        let _ = reg.register_active(id, make_shared("mumble.example", 64738, "alice"));
        let metas = reg.list_meta();
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].label, "alice@mumble.example:64738");
    }

    #[test]
    fn take_reusable_reuses_one_and_drops_duplicate_disconnected() {
        use super::super::types::ConnectionStatus;

        let reg = Registry::default();
        // Two stale disconnected sessions targeting the same server: one
        // must be reused, the other dropped.
        let stale_a = ServerId::new();
        let stale_b = ServerId::new();
        // A live connecting session to the same target - must NOT be touched.
        let live = ServerId::new();
        // A disconnected session targeting a *different* server - must NOT be touched.
        let other = ServerId::new();

        let stale_a_shared = make_shared("h", 1, "u");
        let stale_b_shared = make_shared("h", 1, "u");
        let live_shared = make_shared("h", 1, "u");
        live_shared.lock().unwrap().conn.status = ConnectionStatus::Connecting;
        let other_shared = make_shared("other", 1, "u");

        let _ = reg.register_active(stale_a, stale_a_shared);
        let _ = reg.register_active(stale_b, stale_b_shared);
        let _ = reg.register_active(live, live_shared);
        let _ = reg.register_active(other, other_shared);

        let (reused_id, _shared) = reg
            .take_reusable_for("h", 1, "u")
            .expect("a disconnected match must be reusable");
        assert!(reused_id == stale_a || reused_id == stale_b);

        let remaining: Vec<_> = reg.list_meta().into_iter().map(|m| m.id).collect();
        // The reused session stays; the duplicate stale one is dropped;
        // the live + other-target sessions are untouched.
        assert!(remaining.contains(&reused_id));
        assert!(remaining.contains(&live));
        assert!(remaining.contains(&other));
        assert_eq!(remaining.len(), 3);
    }

    #[test]
    fn take_reusable_returns_none_without_disconnected_match() {
        use super::super::types::ConnectionStatus;

        let reg = Registry::default();
        let live = ServerId::new();
        let live_shared = make_shared("h", 1, "u");
        live_shared.lock().unwrap().conn.status = ConnectionStatus::Connected;
        let _ = reg.register_active(live, live_shared);

        // No *disconnected* session for this target: nothing to reuse, and
        // the connected one must be left intact.
        assert!(reg.take_reusable_for("h", 1, "u").is_none());
        assert_eq!(reg.list_meta().len(), 1);
    }

    /// Put `user` on `shared`'s roster.  `hash` is the certificate they
    /// connected with, `user_id` their registered account (if any).
    fn add_user(
        shared: &Arc<Mutex<SharedState>>,
        session: u32,
        name: &str,
        hash: &str,
        user_id: Option<u32>,
    ) {
        use crate::state::types::UserEntry;

        let mut entry = UserEntry::new(session);
        entry.name = name.into();
        entry.hash = Some(hash.into());
        entry.user_id = user_id;

        let mut s = shared.lock().unwrap();
        s.conn.status = super::super::types::ConnectionStatus::Connected;
        let _ = s.users.insert(session, entry);
    }

    #[test]
    fn hash_lookup_refuses_another_account_on_the_same_certificate() {
        // One certificate, two accounts on the friend's own server: the saved
        // account is the friend, the other one is a stranger.
        let reg = Registry::default();
        let origin = ServerId::new();
        let shared = make_shared("magical.rocks", 64738, "me");
        add_user(&shared, 7, "TestUser", "cert-a", Some(2));
        let _ = reg.register_active(origin, shared);

        assert!(
            reg.find_user_by_hash(HashLookup {
                user_hash: "cert-a",
                user_id: Some(5),
                origin: Some(origin),
            })
            .is_none()
        );

        let found = reg
            .find_user_by_hash(HashLookup {
                user_hash: "cert-a",
                user_id: Some(2),
                origin: Some(origin),
            })
            .expect("the saved account is on this server");
        assert_eq!(found.user_session, 7);
        assert_eq!(found.user_id, Some(2));
    }

    #[test]
    fn hash_lookup_checks_every_connection_to_the_friends_server() {
        // Two connections to the same server (two identities of our own): the
        // impostor must not be answered just because the friend was saved on
        // the *other* one of them.
        let reg = Registry::default();
        let origin = ServerId::new();
        let second = ServerId::new();
        let origin_shared = make_shared("magical.rocks", 64738, "zewi");
        let second_shared = make_shared("magical.rocks", 64738, "sebi");
        add_user(&second_shared, 9, "TestUser", "cert-a", Some(2));
        let _ = reg.register_active(origin, origin_shared);
        let _ = reg.register_active(second, second_shared);

        assert!(
            reg.find_user_by_hash(HashLookup {
                user_hash: "cert-a",
                user_id: Some(5),
                origin: Some(origin),
            })
            .is_none()
        );
    }

    #[test]
    fn hash_lookup_still_finds_a_friend_on_another_server() {
        // Registered ids are per-server, so elsewhere the certificate is all
        // there is to go on - and it is enough to say "they are online here".
        let reg = Registry::default();
        let origin = ServerId::new();
        let other = ServerId::new();
        let origin_shared = make_shared("magical.rocks", 64738, "me");
        let other_shared = make_shared("elsewhere", 64738, "me");
        add_user(&other_shared, 3, "Sebi", "cert-a", Some(11));
        let _ = reg.register_active(origin, origin_shared);
        let _ = reg.register_active(other, other_shared);

        let found = reg
            .find_user_by_hash(HashLookup {
                user_hash: "cert-a",
                user_id: Some(5),
                origin: Some(origin),
            })
            .expect("a friend on another open server is still found");
        assert_eq!(found.server_id, other);
        assert_eq!(found.user_session, 3);
    }

    #[test]
    fn hash_lookup_without_a_saved_account_matches_the_certificate() {
        // An anonymous friend, or a record saved before ids were kept: the
        // hash is all there is, and it still resolves.
        let reg = Registry::default();
        let id = ServerId::new();
        let shared = make_shared("magical.rocks", 64738, "me");
        add_user(&shared, 4, "Jonas", "cert-b", None);
        let _ = reg.register_active(id, shared);

        let found = reg
            .find_user_by_hash(HashLookup {
                user_hash: "cert-b",
                user_id: None,
                origin: None,
            })
            .expect("hash-only lookups keep working");
        assert_eq!(found.user_name, "Jonas");
        assert_eq!(found.user_id, None);
    }

    #[test]
    fn activate_fallback_prefers_connected_or_keeps_sole_session() {
        use super::super::types::ConnectionStatus;

        let reg = Registry::default();
        let failed = ServerId::new();
        let _ = reg.register_active(failed, make_shared("h", 1, "u"));

        // Sole session: fallback leaves it active and reports no switch.
        assert!(!reg.activate_fallback(failed));
        assert_eq!(reg.active_id(), Some(failed));

        // Add a live connected session: fallback switches active to it.
        let alive = ServerId::new();
        let alive_shared = make_shared("a", 2, "u2");
        alive_shared.lock().unwrap().conn.status = ConnectionStatus::Connected;
        let _ = reg.register_active(alive, alive_shared);
        // register_active made `alive` active; simulate the failed one
        // being active again before its connect attempt fails.
        reg.set_active(failed).unwrap();
        assert!(reg.activate_fallback(failed));
        assert_eq!(reg.active_id(), Some(alive));
    }
}
