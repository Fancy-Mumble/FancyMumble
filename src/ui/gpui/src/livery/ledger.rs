//! What an engine knows of liveries without being asked twice: what each
//! address's last ping said of its livery, and the livery of each server it
//! is on. Small: a digest per saved server, and one livery per open
//! connection, let go of with the connection.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use super::{Livery, Pinged};

/// Each session's livery, with the address it is of.
type Live = HashMap<String, (String, Arc<Livery>)>;

#[derive(Debug, Default)]
pub(crate) struct Ledger {
    /// By address, `host:port`.
    pinged: Mutex<HashMap<String, Pinged>>,
    /// By session id.
    live: Mutex<Live>,
}

impl Ledger {
    /// The ping of `key` came back saying `pinged`.
    pub(crate) fn heard(&self, key: String, pinged: Pinged) {
        let _ = self
            .pinged
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(key, pinged);
    }

    /// What the last ping of `key` said, once one came back.
    pub(crate) fn pinged(&self, key: &str) -> Option<Pinged> {
        self.pinged
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(key)
            .cloned()
    }

    /// The liveries of the sessions open now, each with its address: what
    /// was held for a session that has gone goes with it.
    pub(crate) fn hold(&self, sessions: Vec<(String, String, Option<Livery>)>) {
        let mut live = self.live.lock().unwrap_or_else(PoisonError::into_inner);
        let held = std::mem::take(&mut *live);
        for (id, key, livery) in sessions {
            let Some(livery) = livery else { continue };
            // The same livery keeps the same pictures, and so stays drawn.
            let livery = match held.get(&id) {
                Some((_, was)) if **was == livery => Arc::clone(was),
                _ => Arc::new(livery),
            };
            let _ = live.insert(id, (key, livery));
        }
    }

    /// The livery of the server at `key`, while a session is open there.
    pub(crate) fn live(&self, key: &str) -> Option<Arc<Livery>> {
        self.live
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .values()
            .find(|(at, _)| at == key)
            .map(|(_, livery)| Arc::clone(livery))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn livery(digest: &str) -> Livery {
        Livery {
            digest: digest.to_owned().into(),
            ..Livery::default()
        }
    }

    #[test]
    fn a_livery_is_held_while_its_session_is_open() {
        let ledger = Ledger::default();
        ledger.hold(vec![
            ("1".to_owned(), "a:1".to_owned(), Some(livery("aaaa"))),
            ("2".to_owned(), "b:1".to_owned(), None),
        ]);
        let first = ledger.live("a:1").expect("held");
        assert!(ledger.live("b:1").is_none(), "said nothing yet");
        ledger.hold(vec![(
            "1".to_owned(),
            "a:1".to_owned(),
            Some(livery("aaaa")),
        )]);
        assert!(
            Arc::ptr_eq(&first, &ledger.live("a:1").expect("held")),
            "the same livery is the same"
        );
        ledger.hold(Vec::new());
        assert!(ledger.live("a:1").is_none(), "gone with its session");
    }

    #[test]
    fn a_ping_is_remembered_by_address() {
        let ledger = Ledger::default();
        assert!(ledger.pinged("a:1").is_none());
        ledger.heard("a:1".to_owned(), Pinged::Down);
        assert_eq!(ledger.pinged("a:1"), Some(Pinged::Down));
    }
}
