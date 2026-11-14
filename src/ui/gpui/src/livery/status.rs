//! Which livery a server's page draws, and what it says about where that
//! came from: the web client's `liveryStatus.ts`, ported as it is.
//!
//! A livery is fetched, not waited for, from the cheapest source that has
//! it, in this order:
//!
//! 1. the open connection, when this server is one the engine is on;
//! 2. a copy kept from an earlier visit, when the ping's digest vouches for it;
//! 3. a probe: connect, ask, hang up, never authenticate.
//!
//! The digest in the ping has three states, not two: absent is a server that
//! said nothing (plain Mumble, or a ping in the old format), and empty is a
//! Fancy server saying it has no livery. Only the second forgets a kept copy.

use gpui::SharedString;

use crate::words::t;

/// What a server's ping said, once one came back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Pinged {
    /// Nothing answered.
    Down,
    /// It answered; with the digest of its livery, if it gave one.
    Up { digest: Option<SharedString> },
}

/// Where asking the server itself has got to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Probe {
    #[default]
    Idle,
    Running,
    Failed,
}

/// Where the livery on a page came from, or why there is none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Status {
    /// The ping is still out; nothing is known yet.
    Probing,
    /// From the open connection: the server is saying it right now.
    Live,
    /// From a kept copy whose digest the server just confirmed.
    Cached,
    /// The server has a livery this client does not hold; asking for it.
    Fetching,
    /// Asking did not bring it.
    Failed,
    /// The server says it has none.
    Absent,
    /// The server cannot say: plain Mumble, or a ping in the old format.
    Unverified,
    /// The ping did not come back.
    Unreachable,
}

/// How a status is toned: working, wrong, or nothing to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Tone {
    Ok,
    Bad,
    Muted,
}

impl Status {
    /// Every status, for whatever has to say something about each.
    #[cfg(test)]
    pub(crate) const ALL: [Self; 8] = [
        Self::Probing,
        Self::Live,
        Self::Cached,
        Self::Fetching,
        Self::Failed,
        Self::Absent,
        Self::Unverified,
        Self::Unreachable,
    ];

    pub(crate) const fn tone(self) -> Tone {
        match self {
            Self::Live | Self::Cached => Tone::Ok,
            Self::Failed | Self::Unreachable => Tone::Bad,
            Self::Probing | Self::Fetching | Self::Absent | Self::Unverified => Tone::Muted,
        }
    }

    /// Whether something is still on its way: the mark pulses.
    pub(crate) const fn busy(self) -> bool {
        matches!(self, Self::Probing | Self::Fetching)
    }

    /// What the mark says when pointed at: one sentence, in the user's terms.
    pub(crate) fn says(self) -> SharedString {
        match self {
            Self::Probing => t!("Checking this server for branding"),
            Self::Live => t!("Showing this server's branding, live from the connection"),
            Self::Cached => t!("Showing this server's branding, confirmed current"),
            Self::Fetching => t!("Loading this server's branding"),
            Self::Failed => t!("This server has branding, but it could not be loaded"),
            Self::Absent => t!("This server has no branding set"),
            Self::Unverified => t!("This server does not report branding"),
            Self::Unreachable => t!("Could not reach this server to check its branding"),
        }
    }

    /// Its name, for a selector a test finds the mark by.
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Probing => "probing",
            Self::Live => "live",
            Self::Cached => "cached",
            Self::Fetching => "fetching",
            Self::Failed => "failed",
            Self::Absent => "absent",
            Self::Unverified => "unverified",
            Self::Unreachable => "unreachable",
        }
    }
}

/// Which livery the page draws.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Shown {
    /// The open connection's.
    Live,
    /// The kept copy.
    Kept,
    /// None: the server is drawn in its own colours.
    Nothing,
}

/// What the page draws, what it says about it, and what to do next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Resolved {
    pub shown: Shown,
    pub status: Status,
    /// Whether to ask the server for its livery now: only when it says it
    /// has one and nothing to hand matches. Acted on once per digest.
    pub fetch: bool,
    /// Whether to forget the kept copy: only when the server says it has no
    /// livery, so a livery its operator removed does not outlive that.
    pub forget: bool,
}

impl Resolved {
    const fn showing(shown: Shown, status: Status) -> Self {
        Self {
            shown,
            status,
            fetch: false,
            forget: false,
        }
    }
}

/// The web client's `resolveLivery`.
///
/// `live` is whether the open connection has a livery; `kept`, the digest
/// of the copy kept from an earlier visit; `ping`, what the ping said, if
/// it is back; `probe`, where asking the server got to for this digest.
pub(crate) fn resolve(
    live: bool,
    kept: Option<&str>,
    ping: Option<&Pinged>,
    probe: Probe,
) -> Resolved {
    // The open connection outranks everything: it is the server speaking now.
    if live {
        return Resolved::showing(Shown::Live, Status::Live);
    }
    let stored = if kept.is_some() {
        Shown::Kept
    } else {
        Shown::Nothing
    };
    // Nothing checked yet: the kept copy, rather than a flash of none and
    // then the livery a moment later. The ping corrects it.
    let Some(ping) = ping else {
        return Resolved::showing(stored, Status::Probing);
    };
    let Pinged::Up { digest } = ping else {
        return Resolved::showing(stored, Status::Unreachable);
    };
    // A server that cannot speak to it: silence is no retraction.
    let Some(digest) = digest else {
        return Resolved::showing(stored, Status::Unverified);
    };
    // An explicit "none": the one case that forgets.
    if digest.is_empty() {
        return Resolved {
            forget: kept.is_some(),
            ..Resolved::showing(Shown::Nothing, Status::Absent)
        };
    }
    if kept == Some(digest.as_ref()) {
        return Resolved::showing(Shown::Kept, Status::Cached);
    }
    // The server has a livery this client does not hold, or holds an older
    // one: provably the wrong picture, so it is not drawn meanwhile.
    if probe == Probe::Failed {
        return Resolved::showing(Shown::Nothing, Status::Failed);
    }
    Resolved {
        fetch: probe == Probe::Idle,
        ..Resolved::showing(Shown::Nothing, Status::Fetching)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn up(digest: Option<&str>) -> Pinged {
        Pinged::Up {
            digest: digest.map(|digest| digest.to_owned().into()),
        }
    }

    #[test]
    fn prefers_the_open_connection_over_anything_remembered() {
        let resolved = resolve(true, Some("bbbb"), Some(&up(Some("bbbb"))), Probe::Idle);
        assert_eq!(resolved.status, Status::Live);
        assert_eq!(resolved.shown, Shown::Live);
    }

    #[test]
    fn paints_the_remembered_document_while_the_probe_is_still_out() {
        // Flashing unbranded and then branded a moment later is worse than
        // showing the last known answer and correcting it.
        let resolved = resolve(false, Some("aaaa"), None, Probe::Idle);
        assert_eq!(resolved.status, Status::Probing);
        assert_eq!(resolved.shown, Shown::Kept);
    }

    #[test]
    fn draws_a_remembered_document_the_servers_digest_confirms() {
        let resolved = resolve(false, Some("aaaa"), Some(&up(Some("aaaa"))), Probe::Idle);
        assert_eq!(resolved.status, Status::Cached);
        assert_eq!(resolved.shown, Shown::Kept);
    }

    #[test]
    fn withholds_a_remembered_document_the_server_has_moved_on_from_and_refetches() {
        let resolved = resolve(false, Some("aaaa"), Some(&up(Some("zzzz"))), Probe::Idle);
        assert_eq!(resolved.status, Status::Fetching);
        // Provably the wrong picture, so it is not drawn while the right one
        // is on its way.
        assert_eq!(resolved.shown, Shown::Nothing);
        assert!(resolved.fetch);
        assert!(!resolved.forget);
    }

    #[test]
    fn fetches_branding_this_client_has_never_held_rather_than_waiting_for_a_join() {
        let resolved = resolve(false, None, Some(&up(Some("aaaa"))), Probe::Idle);
        assert_eq!(resolved.status, Status::Fetching);
        assert!(resolved.fetch);
    }

    #[test]
    fn does_not_ask_twice_while_an_answer_is_already_on_its_way() {
        let resolved = resolve(false, None, Some(&up(Some("aaaa"))), Probe::Running);
        assert_eq!(resolved.status, Status::Fetching);
        assert!(!resolved.fetch);
    }

    #[test]
    fn reports_a_fetch_that_did_not_come_back() {
        let resolved = resolve(false, None, Some(&up(Some("aaaa"))), Probe::Failed);
        assert_eq!(resolved.status, Status::Failed);
        assert!(!resolved.fetch);
    }

    #[test]
    fn asks_nothing_of_a_server_that_says_it_has_none() {
        let resolved = resolve(false, None, Some(&up(Some(""))), Probe::Idle);
        assert!(!resolved.fetch);
    }

    #[test]
    fn asks_nothing_of_a_server_that_cannot_answer_the_question() {
        // A probe against plain Mumble would sit until it timed out: the
        // server ignores the message type rather than refusing it.
        let resolved = resolve(false, None, Some(&up(None)), Probe::Idle);
        assert!(!resolved.fetch);
    }

    #[test]
    fn clears_the_cache_when_a_server_says_it_has_no_branding() {
        let resolved = resolve(false, Some("aaaa"), Some(&up(Some(""))), Probe::Idle);
        assert_eq!(resolved.status, Status::Absent);
        assert_eq!(resolved.shown, Shown::Nothing);
        assert!(resolved.forget);
    }

    #[test]
    fn does_not_clear_anything_for_a_server_that_cannot_answer() {
        let resolved = resolve(false, Some("aaaa"), Some(&up(None)), Probe::Idle);
        assert_eq!(resolved.status, Status::Unverified);
        assert_eq!(resolved.shown, Shown::Kept);
        assert!(!resolved.forget);
    }

    #[test]
    fn reports_an_unreachable_server_without_forgetting_what_it_last_said() {
        let resolved = resolve(false, Some("aaaa"), Some(&Pinged::Down), Probe::Idle);
        assert_eq!(resolved.status, Status::Unreachable);
        assert!(!resolved.forget);
    }

    #[test]
    fn has_a_tone_and_a_sentence_for_every_state_it_can_report() {
        for status in Status::ALL {
            let _ = status.tone();
            assert!(!status.says().is_empty(), "{status:?}");
            assert!(!status.name().is_empty());
        }
        assert!(Status::Probing.busy() && Status::Fetching.busy());
        assert!(!Status::Cached.busy());
    }
}
