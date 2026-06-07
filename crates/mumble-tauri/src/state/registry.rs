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

use super::sessions::{ServerId, SessionMeta};
use super::SharedState;

/// Result of a cross-server user lookup by certificate hash.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserHashMatch {
    pub server_id: ServerId,
    pub user_session: u32,
    pub user_name: String,
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

    /// Search every connected session for a user whose certificate hash
    /// matches `user_hash`.  Returns the first match (server id + mumble
    /// session + display name).
    pub(crate) fn find_user_by_hash(&self, user_hash: &str) -> Option<UserHashMatch> {
        let guard = self.inner.lock().ok()?;
        for (id, shared) in &guard.sessions {
            let Ok(s) = shared.lock() else { continue };
            if s.conn.status != super::types::ConnectionStatus::Connected {
                continue;
            }
            if let Some(found) = s
                .users
                .values()
                .find(|u| u.hash.as_deref() == Some(user_hash))
            {
                return Some(UserHashMatch {
                    server_id: *id,
                    user_session: found.session,
                    user_name: found.name.clone(),
                });
            }
        }
        None
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
