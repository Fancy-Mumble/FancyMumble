//! How loud each person is played here: set per person, and remembered
//! for those who can be known again.
//!
//! A session's number is new at every connection, so what is kept is kept
//! by certificate: the same person is as loud tomorrow, and on another
//! server, as they were set today.

use std::collections::{BTreeMap, HashMap};

use crate::engine::{Action, Engine, Session, User};

/// The loudness everybody starts at: as they are sent.
const AS_SENT: f32 = 1.0;

/// The loudness set for each person.
#[derive(Debug, Default)]
pub(super) struct Loudness {
    /// For those here, by session.
    here: HashMap<Session, f32>,
    /// For those with a certificate, by its hash: what is written out.
    kept: BTreeMap<String, f32>,
}

impl Loudness {
    /// Starting from what was `kept` the last time.
    pub(super) fn remembering(kept: BTreeMap<String, f32>) -> Self {
        Self {
            here: HashMap::new(),
            kept,
        }
    }

    /// How loud `session` is played, if that was ever set.
    pub(super) fn get(&self, session: &Session) -> Option<&f32> {
        self.here.get(session)
    }

    /// What there is to write out.
    pub(super) fn kept(&self) -> &BTreeMap<String, f32> {
        &self.kept
    }

    /// Play `user` at `volume` from now on. Says whether there is something
    /// new to write out. Somebody played as they are sent is not kept: that
    /// is what everybody is.
    pub(super) fn set(&mut self, user: Option<&User>, session: Session, volume: f32) -> bool {
        let _ = self.here.insert(session, volume);
        let Some(hash) = user.and_then(|user| user.hash.as_ref()) else {
            return false;
        };
        if (volume - AS_SENT).abs() < f32::EPSILON {
            self.kept.remove(hash.as_ref()).is_some()
        } else {
            self.kept.insert(hash.to_string(), volume) != Some(volume)
        }
    }

    /// Whoever of `users` has arrived since the last look and has a
    /// loudness kept is played at it; whoever has left is forgotten by
    /// session.
    pub(super) fn meet(&mut self, users: &[User], engine: &dyn Engine) {
        self.here
            .retain(|session, _| users.iter().any(|user| user.session == *session));
        for user in users {
            let kept = user
                .hash
                .as_ref()
                .and_then(|hash| self.kept.get(hash.as_ref()));
            if let Some(volume) = kept.copied()
                && !self.here.contains_key(&user.session)
            {
                let _ = self.here.insert(user.session, volume);
                engine.act(Action::SetUserVolume {
                    session: user.session,
                    volume,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::demo::DemoEngine;

    fn user(session: Session, hash: Option<&str>) -> User {
        User {
            session,
            name: "Rin".into(),
            channel: 1,
            muted: false,
            deafened: false,
            server_muted: false,
            server_deafened: false,
            avatar: None,
            unread: 0,
            priority: false,
            account: None,
            hash: hash.map(|hash| hash.to_owned().into()),
        }
    }

    #[test]
    fn somebody_is_as_loud_tomorrow_as_they_were_set_today() {
        let mut loudness = Loudness::default();
        let rin = user(3, Some("abc"));
        assert!(loudness.set(Some(&rin), 3, 0.5), "something to write out");
        assert!(!loudness.set(Some(&rin), 3, 0.5), "nothing new");
        // Somebody without a certificate cannot be known again.
        assert!(!loudness.set(Some(&user(4, None)), 4, 0.2));
        assert_eq!(loudness.kept().len(), 1);

        // Another day: the same person under another number.
        let engine = DemoEngine::new();
        let mut later = Loudness::remembering(loudness.kept().clone());
        let people = [user(9, Some("abc")), user(10, Some("other"))];
        later.meet(&people, &engine);
        assert_eq!(later.get(&9), Some(&0.5));
        assert_eq!(later.get(&10), None);
        assert_eq!(
            engine.actions(),
            [Action::SetUserVolume {
                session: 9,
                volume: 0.5
            }]
        );
        // Met once: not told to the engine at every look.
        later.meet(&people, &engine);
        assert_eq!(engine.actions().len(), 1);
        // Gone, and the number is somebody else's next time.
        later.meet(&people[1..], &engine);
        assert_eq!(later.get(&9), None);
        // As they are sent is what everybody is: not kept.
        assert!(later.set(Some(&people[0]), 9, 1.0));
        assert!(later.kept().is_empty());
    }
}
