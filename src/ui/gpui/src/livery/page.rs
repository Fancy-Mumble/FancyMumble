//! What a server's page knows of its livery while it is on screen: the
//! copy kept from an earlier visit, and where asking the server has got to.
//! The web client's `ConnectScreen` keeps the same three things in its state.

use std::sync::Arc;

use gpui::SharedString;

use super::{Kept, Livery, Pinged, Probe, Resolved, Shown, resolve};

/// The livery of the server whose page is showing.
#[derive(Debug, Default)]
pub(crate) struct Landing {
    /// The address the page is for, `host:port`.
    key: Option<String>,
    /// The copy kept from an earlier visit, once it has been read.
    kept: Option<Kept>,
    /// Whether that copy is still being read: nothing is asked of the server
    /// meanwhile, since the copy may be the one its ping vouches for.
    reading: bool,
    /// Where asking the server got to, and for which digest: an answer about
    /// one digest says nothing about another.
    probe: Option<(SharedString, Probe)>,
    /// The digest already asked about: asked once, however often the page
    /// is drawn.
    asked: Option<SharedString>,
}

impl Landing {
    /// The page is for `key` now. Whether that is a change, after which
    /// what was known is forgotten and the kept copy wants reading.
    pub(crate) fn look_at(&mut self, key: &str) -> bool {
        if self.key.as_deref() == Some(key) {
            return false;
        }
        *self = Self {
            key: Some(key.to_owned()),
            ..Self::default()
        };
        true
    }

    /// The copy kept for the page is being read.
    pub(crate) fn reading_kept(&mut self) {
        self.reading = true;
    }

    /// The copy kept for `key` has been read, if there was one.
    pub(crate) fn kept_read(&mut self, key: &str, kept: Option<Kept>) {
        // Read for a page that has been left: not this one's.
        if self.key.as_deref() != Some(key) {
            return;
        }
        self.reading = false;
        if self.kept.is_none() {
            self.kept = kept;
        }
    }

    /// What to draw, given the open connection's livery and the ping.
    pub(crate) fn resolve(&self, live: bool, ping: Option<&Pinged>) -> Resolved {
        let digest = match ping {
            Some(Pinged::Up {
                digest: Some(digest),
            }) => Some(digest),
            _ => None,
        };
        let probe = self
            .probe
            .as_ref()
            .filter(|(asked, _)| Some(asked) == digest)
            .map_or(Probe::Idle, |(_, probe)| *probe);
        let resolved = resolve(
            live,
            self.kept.as_ref().map(|kept| kept.digest.as_ref()),
            ping,
            probe,
        );
        Resolved {
            fetch: resolved.fetch && !self.reading,
            ..resolved
        }
    }

    /// The livery `resolved` says to draw.
    pub(crate) fn shown(
        &self,
        resolved: Resolved,
        live: Option<Arc<Livery>>,
    ) -> Option<Arc<Livery>> {
        match resolved.shown {
            Shown::Live => live,
            Shown::Kept => self.kept.as_ref().map(|kept| Arc::clone(&kept.livery)),
            Shown::Nothing => None,
        }
    }

    /// Whether to ask the server about `digest` now: once per digest.
    pub(crate) fn ask(&mut self, digest: &SharedString) -> bool {
        if self.asked.as_ref() == Some(digest) {
            return false;
        }
        self.asked = Some(digest.clone());
        self.probe = Some((digest.clone(), Probe::Running));
        true
    }

    /// The server at `key` answered: with its livery, or not at all. The
    /// livery to keep on disk, when there is one to keep.
    pub(crate) fn answered(
        &mut self,
        key: &str,
        livery: Option<Arc<Livery>>,
    ) -> Option<Arc<Livery>> {
        // Superseded: another page is showing, or nothing was asked.
        let digest = self
            .asked
            .clone()
            .filter(|_| self.key.as_deref() == Some(key))?;
        match livery.filter(|livery| !livery.digest.is_empty()) {
            Some(livery) => {
                self.kept = Some(Kept {
                    digest: livery.digest.clone(),
                    livery: Arc::clone(&livery),
                });
                self.probe = Some((digest, Probe::Idle));
                Some(livery)
            }
            None => {
                self.probe = Some((digest, Probe::Failed));
                None
            }
        }
    }

    /// The server says it has no livery: what was kept goes.
    pub(crate) fn forget(&mut self) {
        self.kept = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::livery::Status;

    fn up(digest: &str) -> Pinged {
        Pinged::Up {
            digest: Some(digest.to_owned().into()),
        }
    }

    fn livery(digest: &str) -> Arc<Livery> {
        Arc::new(Livery {
            digest: digest.to_owned().into(),
            ..Livery::default()
        })
    }

    #[test]
    fn a_server_is_asked_once_and_its_answer_is_drawn() {
        let mut page = Landing::default();
        assert!(page.look_at("a:1"));
        assert!(!page.look_at("a:1"), "the same page");
        let resolved = page.resolve(false, Some(&up("aaaa")));
        assert!(resolved.fetch);
        let digest: SharedString = "aaaa".into();
        assert!(page.ask(&digest));
        assert!(!page.ask(&digest), "asked already");
        assert_eq!(
            page.resolve(false, Some(&up("aaaa"))).status,
            Status::Fetching
        );
        assert!(!page.resolve(false, Some(&up("aaaa"))).fetch);
        let kept = page.answered("a:1", Some(livery("aaaa")));
        assert!(kept.is_some(), "kept for the next visit");
        let resolved = page.resolve(false, Some(&up("aaaa")));
        assert_eq!(resolved.status, Status::Cached);
        assert_eq!(page.shown(resolved, None), Some(livery("aaaa")));
    }

    #[test]
    fn an_answer_for_a_page_that_was_left_is_not_taken() {
        let mut page = Landing::default();
        let _ = page.look_at("a:1");
        let _ = page.ask(&"aaaa".into());
        let _ = page.look_at("b:1");
        assert!(page.answered("a:1", Some(livery("aaaa"))).is_none());
        assert_eq!(
            page.resolve(false, Some(&up("aaaa"))).status,
            Status::Fetching
        );
        page.kept_read(
            "a:1",
            Some(Kept {
                digest: "aaaa".into(),
                livery: livery("aaaa"),
            }),
        );
        assert_eq!(
            page.resolve(false, None).shown,
            Shown::Nothing,
            "read for another page"
        );
    }

    #[test]
    fn nothing_is_asked_while_the_kept_copy_is_read() {
        let mut page = Landing::default();
        let _ = page.look_at("a:1");
        page.reading_kept();
        assert!(
            !page.resolve(false, Some(&up("aaaa"))).fetch,
            "it may be the one"
        );
        page.kept_read(
            "a:1",
            Some(Kept {
                digest: "aaaa".into(),
                livery: livery("aaaa"),
            }),
        );
        let resolved = page.resolve(false, Some(&up("aaaa")));
        assert_eq!(resolved.status, Status::Cached);
        assert!(!resolved.fetch, "it was");
        assert!(
            page.resolve(false, Some(&up("bbbb"))).fetch,
            "a newer one is asked for"
        );
    }

    #[test]
    fn no_answer_is_a_failure_until_the_digest_changes() {
        let mut page = Landing::default();
        let _ = page.look_at("a:1");
        let _ = page.ask(&"aaaa".into());
        assert!(page.answered("a:1", None).is_none());
        assert_eq!(
            page.resolve(false, Some(&up("aaaa"))).status,
            Status::Failed
        );
        let changed = page.resolve(false, Some(&up("bbbb")));
        assert_eq!(changed.status, Status::Fetching);
        assert!(changed.fetch, "a new livery is worth asking for");
    }
}
