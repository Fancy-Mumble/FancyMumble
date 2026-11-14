//! When a share is announced again.
//!
//! The server tells a START to those in the channel when it is said, and to
//! nobody who comes later. So, as the web client does, the sharer says it
//! again whenever somebody new is in its channel; and when the sharer moves,
//! the share goes with them and is announced where they arrived. It is also
//! said again every so often: a START the server's rate limit dropped is
//! said again, and so is one a sibling device of the sharer's own account
//! never heard (that device is the sharer itself to the sharer, so it never
//! arrives as somebody new).

use std::collections::HashSet;
use std::time::{Duration, Instant};

use crate::engine::{ChannelId, Session};

/// How often a share is announced again with nobody new to tell.
pub(crate) const AGAIN: Duration = Duration::from_secs(20);

/// What was announced, where, to whom and when.
#[derive(Debug, Default)]
pub(crate) struct Announcer {
    channel: Option<ChannelId>,
    told: HashSet<Session>,
    last: Option<Instant>,
}

impl Announcer {
    /// The share was just announced in `channel` to `members`.
    pub(crate) fn announced(
        &mut self,
        channel: ChannelId,
        members: impl IntoIterator<Item = Session>,
        now: Instant,
    ) {
        self.channel = Some(channel);
        self.told = members.into_iter().collect();
        self.last = Some(now);
    }

    /// Whether to announce it again, the sharer being in `channel` with
    /// `members`: somebody is new there, the sharer moved, or it was said
    /// long enough ago. Says so once; the caller then announces.
    pub(crate) fn due(
        &mut self,
        channel: ChannelId,
        members: impl IntoIterator<Item = Session>,
        now: Instant,
    ) -> bool {
        let members: HashSet<Session> = members.into_iter().collect();
        let moved = self.channel != Some(channel);
        let joined = members.iter().any(|member| !self.told.contains(member));
        let stale = self.last.is_none_or(|last| now.duration_since(last) >= AGAIN);
        self.channel = Some(channel);
        self.told = members;
        if moved || joined || stale {
            self.last = Some(now);
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_share_is_announced_again_to_somebody_new_and_not_for_somebody_leaving() {
        let start = Instant::now();
        let mut announcer = Announcer::default();
        announcer.announced(1, [1, 2], start);
        assert!(!announcer.due(1, [1, 2], start), "nothing new");
        assert!(!announcer.due(1, [1], start), "somebody left");
        assert!(announcer.due(1, [1, 2], start), "and came back");
        assert!(!announcer.due(1, [1, 2], start), "said once");
        assert!(announcer.due(1, [1, 2, 3], start), "somebody new");
    }

    #[test]
    fn a_sharer_who_moves_announces_where_they_arrive() {
        let start = Instant::now();
        let mut announcer = Announcer::default();
        announcer.announced(1, [1, 2], start);
        assert!(announcer.due(2, [1], start), "the share goes with them");
        assert!(!announcer.due(2, [1], start));
    }

    #[test]
    fn a_share_is_announced_again_every_so_often() {
        let start = Instant::now();
        let mut announcer = Announcer::default();
        announcer.announced(1, [1, 2], start);
        assert!(!announcer.due(1, [1, 2], start + AGAIN / 2));
        assert!(announcer.due(1, [1, 2], start + AGAIN));
        assert!(!announcer.due(1, [1, 2], start + AGAIN + Duration::from_secs(1)));
    }
}
