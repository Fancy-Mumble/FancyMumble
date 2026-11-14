//! The signalling of a share, as the server carries it (`WebRtcSignal`), and
//! the routing of the answers the server's SFU sends back to the peers that
//! wait for them.
//!
//! Every answer arrives with the same shape of envelope, so which peer one is
//! for is read from it as the web client reads it (`try_intercept_answer` in
//! the engine's `commands/screenshare.rs`): the answer to a broadcaster's
//! offer is all `recvonly` with as many sections as the offer had; an answer
//! to a viewer has `sendonly` sections and names the watched session as its
//! sender. An answer that comes before its peer is registered (the SFU
//! answers within milliseconds, often before the peer that offered has been
//! put anywhere) is held a moment for it, instead of being lost to the
//! offer's next retry a second and a half later.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::engine::Session;

/// What a `WebRtcSignal` is (`signal_type` on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum SignalKind {
    /// A share begins, or is announced again: to the sender's channel.
    Start,
    /// A share ends: to the sender's channel.
    Stop,
    /// A peer's offer, to the SFU.
    Offer,
    /// The SFU's answer.
    Answer,
    /// An ICE candidate: never sent here (the SFU is ICE-lite).
    Candidate,
}

impl SignalKind {
    /// The kind `signal_type` says, if it says one.
    pub(crate) fn of(signal_type: i32) -> Option<Self> {
        Some(match signal_type {
            0 => Self::Start,
            1 => Self::Stop,
            2 => Self::Offer,
            3 => Self::Answer,
            4 => Self::Candidate,
            _ => return None,
        })
    }

    /// Its `signal_type` on the wire.
    pub(crate) fn wire(self) -> i32 {
        match self {
            Self::Start => 0,
            Self::Stop => 1,
            Self::Offer => 2,
            Self::Answer => 3,
            Self::Candidate => 4,
        }
    }
}

/// A signal that arrived.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Signal {
    /// The server it came from, as the engine names its sessions.
    pub server: Option<gpui::SharedString>,
    /// Who sent it, as this client knows them.
    pub sender: Option<Session>,
    pub kind: SignalKind,
    pub payload: String,
}

/// A peer that waits for the SFU's answer to its offer.
pub(crate) trait Answerable: Send + Sync {
    /// Whether its offer is still unanswered.
    fn awaiting(&self) -> bool;
    /// Take the answer.
    fn accept(&self, sdp: String);
}

/// Which peer an answer is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum For {
    /// The broadcaster whose offer had this many sections.
    Broadcaster(usize),
    /// The viewer of this session's share.
    Viewer(Session),
}

impl For {
    /// Who `payload`, sent as from `sender`, can be the answer for: either,
    /// or both while the broadcaster's section count is not known.
    fn could_be(&self, sender: Option<Session>, payload: &str) -> bool {
        let sections = payload.matches("\nm=").count();
        match *self {
            Self::Broadcaster(offered) => {
                sections == offered
                    && payload.contains("a=recvonly")
                    && !payload.contains("a=sendonly")
            }
            Self::Viewer(watched) => sender == Some(watched) && payload.contains("a=sendonly"),
        }
    }
}

/// How long an answer nobody claimed is held for a peer registered late.
const HELD_FOR: Duration = Duration::from_secs(3);

/// Where answers go: the peers waiting for one, and the answers that came
/// before their peer.
#[derive(Default)]
pub(crate) struct Answers {
    waiting: Mutex<Waiting>,
}

#[derive(Default)]
struct Waiting {
    peers: Vec<(For, Arc<dyn Answerable>)>,
    early: Vec<(Option<Session>, String, Instant)>,
}

impl std::fmt::Debug for Answers {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Answers").finish_non_exhaustive()
    }
}

impl Answers {
    /// Take `payload`, an answer sent as from `sender`, for the peer it is
    /// for. Runs on the engine's receive thread, so it never waits: when the
    /// registry is busy the answer is left to the offer's retry. Says
    /// whether it was taken (or held for a peer to come).
    pub(crate) fn claim(&self, sender: Option<Session>, payload: &str) -> bool {
        let Ok(mut waiting) = self.waiting.try_lock() else {
            return false;
        };
        let now = Instant::now();
        waiting.early.retain(|(_, _, at)| now.duration_since(*at) < HELD_FOR);
        let found = waiting
            .peers
            .iter()
            .find(|(of, peer)| peer.awaiting() && of.could_be(sender, payload));
        if let Some((_, peer)) = found {
            peer.accept(payload.to_owned());
            return true;
        }
        // Not one of ours yet: an answer to a viewer names a sender, one to a
        // broadcaster is all receiving. Anything else is somebody else's.
        if payload.contains("a=sendonly") || payload.contains("a=recvonly") {
            waiting.early.push((sender, payload.to_owned(), now));
            return true;
        }
        false
    }

    /// Wait for the answer to the broadcaster's offer of `sections`.
    pub(crate) fn broadcaster(&self, sections: usize, peer: Arc<dyn Answerable>) {
        self.register(For::Broadcaster(sections), peer);
    }

    /// Wait for the answer to the offer of the viewer of `session`.
    pub(crate) fn viewer(&self, session: Session, peer: Arc<dyn Answerable>) {
        self.register(For::Viewer(session), peer);
    }

    fn register(&self, of: For, peer: Arc<dyn Answerable>) {
        let mut waiting = self.waiting.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let now = Instant::now();
        waiting.early.retain(|(_, _, at)| now.duration_since(*at) < HELD_FOR);
        let early = waiting
            .early
            .iter()
            .position(|(sender, payload, _)| of.could_be(*sender, payload));
        if let Some(at) = early {
            let (_, payload, _) = waiting.early.remove(at);
            if peer.awaiting() {
                peer.accept(payload);
            }
        }
        waiting.peers.retain(|(held, _)| *held != of);
        waiting.peers.push((of, peer));
    }

    /// Stop waiting for the broadcaster's answer.
    pub(crate) fn forget_broadcaster(&self) {
        self.forget(|of| matches!(of, For::Broadcaster(_)));
    }

    /// Stop waiting for the answer of the viewer of `session`.
    pub(crate) fn forget_viewer(&self, session: Session) {
        self.forget(|of| *of == For::Viewer(session));
    }

    fn forget(&self, which: impl Fn(&For) -> bool) {
        let mut waiting = self.waiting.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        waiting.peers.retain(|(of, _)| !which(of));
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use super::*;

    /// A peer that records the answer it took.
    #[derive(Default)]
    struct Peer {
        answered: Mutex<Option<String>>,
        done: AtomicBool,
    }

    impl Answerable for Peer {
        fn awaiting(&self) -> bool {
            !self.done.load(Ordering::SeqCst)
        }

        fn accept(&self, sdp: String) {
            self.done.store(true, Ordering::SeqCst);
            *self.answered.lock().expect("held") = Some(sdp);
        }
    }

    impl Peer {
        fn took(&self) -> Option<String> {
            self.answered.lock().expect("held").clone()
        }
    }

    const TO_BROADCASTER: &str = "v=0\r\nm=video 9\r\na=recvonly\r\n";
    const TO_VIEWER: &str = "v=0\r\nm=video 9\r\na=sendonly\r\nm=video 9\r\na=sendonly\r\nm=audio 9\r\na=sendonly\r\n";

    #[test]
    fn signal_kinds_are_the_wire_numbers() {
        for kind in [
            SignalKind::Start,
            SignalKind::Stop,
            SignalKind::Offer,
            SignalKind::Answer,
            SignalKind::Candidate,
        ] {
            assert_eq!(SignalKind::of(kind.wire()), Some(kind));
        }
        assert_eq!(SignalKind::Start.wire(), 0);
        assert_eq!(SignalKind::Answer.wire(), 3);
        assert_eq!(SignalKind::of(9), None);
    }

    #[test]
    fn each_answer_goes_to_the_peer_it_is_for() {
        let answers = Answers::default();
        let (broadcaster, preview, watched) =
            (Arc::new(Peer::default()), Arc::new(Peer::default()), Arc::new(Peer::default()));
        answers.broadcaster(1, broadcaster.clone());
        answers.viewer(7, preview.clone());
        answers.viewer(9, watched.clone());
        assert!(answers.claim(Some(9), TO_VIEWER));
        assert_eq!(watched.took().as_deref(), Some(TO_VIEWER));
        assert!(answers.claim(Some(7), TO_BROADCASTER), "same sender, the broadcaster's shape");
        assert_eq!(broadcaster.took().as_deref(), Some(TO_BROADCASTER));
        assert!(preview.took().is_none());
        assert!(answers.claim(Some(7), TO_VIEWER));
        assert_eq!(preview.took().as_deref(), Some(TO_VIEWER));
    }

    #[test]
    fn an_answer_before_its_peer_is_held_for_it_and_a_repeat_goes_nowhere() {
        let answers = Answers::default();
        assert!(answers.claim(Some(4), TO_VIEWER), "held");
        let late = Arc::new(Peer::default());
        answers.viewer(4, late.clone());
        assert_eq!(late.took().as_deref(), Some(TO_VIEWER), "given once registered");
        // The retry's answer finds the peer answered: held, then dropped.
        assert!(answers.claim(Some(4), TO_VIEWER));
        let other = Arc::new(Peer::default());
        answers.viewer(5, other.clone());
        assert!(other.took().is_none(), "not another session's");
    }

    #[test]
    fn an_answer_for_nobody_here_is_left_alone() {
        let answers = Answers::default();
        assert!(!answers.claim(Some(2), "v=0\r\n"), "no sections: not an SFU answer");
        let viewer = Arc::new(Peer::default());
        answers.viewer(2, viewer.clone());
        answers.forget_viewer(2);
        assert!(answers.claim(Some(2), TO_VIEWER), "held for a viewer to come");
        assert!(viewer.took().is_none(), "the forgotten one takes nothing");
    }

    #[test]
    fn a_broadcaster_takes_only_an_answer_with_as_many_sections_as_it_offered() {
        let answers = Answers::default();
        let broadcaster = Arc::new(Peer::default());
        answers.broadcaster(3, broadcaster.clone());
        assert!(answers.claim(Some(1), TO_BROADCASTER));
        assert!(broadcaster.took().is_none(), "one section, three offered");
    }
}
