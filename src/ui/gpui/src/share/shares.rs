//! Who is sharing on the server on screen, the local user's own share, and
//! what the stage looks at: the state of screen sharing, apart from the
//! peers and pixels that carry it.

use std::time::Instant;

use gpui::SharedString;

use super::announce::Announcer;
use super::stroke::Strokes;
use super::{Fit, Settings, Signal, SignalKind, Source, Standing, Tracks};
use crate::engine::{ChannelId, Session};

/// The local user's own share.
#[derive(Debug, Clone)]
pub(crate) struct Own {
    /// The server it is on.
    pub server: Option<SharedString>,
    /// The channel it was announced in last.
    pub channel: ChannelId,
    pub sources: Vec<Source>,
    pub settings: Settings,
    pub tracks: Tracks,
    pub standing: Standing,
}

/// Whose a share on the stage is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Whose {
    /// Somebody else's.
    Theirs,
    /// The local user's, from here.
    Mine,
    /// The local user's account's, from another device.
    MineElsewhere,
}

/// One share on the stage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Shown {
    pub session: Session,
    pub whose: Whose,
    pub tracks: Tracks,
}

/// What a signal changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Change {
    /// `session` began sharing.
    Began(Session),
    /// `session` shares something else now: watch it again.
    Changed(Session),
    /// `session` stopped.
    Ended(Session),
    Nothing,
}

/// The state of screen sharing.
#[derive(Debug, Default)]
pub(crate) struct Shares {
    /// The server the shares below are on.
    server: Option<SharedString>,
    /// Who announced a share, in the order they did.
    live: Vec<(Session, Tracks)>,
    own: Option<Own>,
    /// The share the stage shows large, when one was picked.
    focus: Option<Session>,
    pub fit: Fit,
    pub strokes: Strokes,
    announcer: Announcer,
}

impl Shares {
    /// The server on screen is now `server`. Says whether it is another one:
    /// everything of the last one's is forgotten, and its shares are to be
    /// stopped watching. One's own share stays on its own server.
    pub(crate) fn on_server(&mut self, server: Option<SharedString>) -> bool {
        if self.server == server {
            return false;
        }
        // The first server known is not another one: what was heard before
        // it was known was heard on it.
        if self.server.is_none() && self.own.is_none() {
            self.server = server;
            return false;
        }
        self.server = server;
        self.live.clear();
        self.focus = None;
        self.strokes.forget_all();
        true
    }

    /// Take a START or STOP.
    pub(crate) fn heard(&mut self, signal: &Signal) -> Change {
        if signal.server.is_some() && self.server.is_some() && signal.server != self.server {
            return Change::Nothing;
        }
        let Some(sender) = signal.sender else {
            return Change::Nothing;
        };
        match signal.kind {
            SignalKind::Start => {
                let tracks = Tracks::announced(&signal.payload);
                match self.live.iter_mut().find(|(session, _)| *session == sender) {
                    Some((_, held)) if *held == tracks => Change::Nothing,
                    Some((_, held)) => {
                        *held = tracks;
                        Change::Changed(sender)
                    }
                    None => {
                        self.live.push((sender, tracks));
                        Change::Began(sender)
                    }
                }
            }
            SignalKind::Stop => self.ended(sender),
            _ => Change::Nothing,
        }
    }

    /// `session` stopped sharing, or left.
    fn ended(&mut self, session: Session) -> Change {
        let before = self.live.len();
        self.live.retain(|(held, _)| *held != session);
        self.strokes.forget_sender(session);
        if self.focus == Some(session) {
            self.focus = None;
        }
        if self.live.len() == before {
            Change::Nothing
        } else {
            Change::Ended(session)
        }
    }

    /// Of those sharing, the ones no longer on the server, now forgotten.
    pub(crate) fn gone(&mut self, here: impl Fn(Session) -> bool) -> Vec<Session> {
        let gone: Vec<Session> = self
            .live
            .iter()
            .map(|(session, _)| *session)
            .filter(|session| !here(*session))
            .collect();
        for session in &gone {
            let _ = self.ended(*session);
        }
        gone
    }

    /// Whether `session` is sharing, as far as this client knows.
    pub(crate) fn is_live(&self, session: Session, own: Option<Session>) -> bool {
        (self.own.is_some() && own == Some(session))
            || self.live.iter().any(|(held, _)| *held == session)
    }

    /// What the stage shows of `channel`: one's own share first, then the
    /// others' in the order they began, of those `in_channel` says are
    /// there.
    pub(crate) fn shown(&self, own: Option<Session>, in_channel: impl Fn(Session) -> bool) -> Vec<Shown> {
        let mut shown = Vec::new();
        if let (Some(mine), Some(session)) = (&self.own, own) {
            shown.push(Shown {
                session,
                whose: Whose::Mine,
                tracks: mine.tracks.clone(),
            });
        }
        for (session, tracks) in &self.live {
            let whose = match own {
                Some(own) if own == *session && self.own.is_some() => continue,
                Some(own) if own == *session => Whose::MineElsewhere,
                _ => Whose::Theirs,
            };
            if in_channel(*session) {
                shown.push(Shown {
                    session: *session,
                    whose,
                    tracks: tracks.clone(),
                });
            }
        }
        shown
    }

    /// The share the stage shows large: the one picked, else the first.
    pub(crate) fn focused<'a>(&self, shown: &'a [Shown]) -> Option<&'a Shown> {
        shown
            .iter()
            .find(|each| Some(each.session) == self.focus)
            .or_else(|| shown.first())
    }

    /// Show `session`'s share large.
    pub(crate) fn focus(&mut self, session: Session) {
        self.focus = Some(session);
    }

    /// Whether the local user's account shares from another device: then no
    /// share is started here.
    pub(crate) fn shared_elsewhere(&self, own: Option<Session>) -> bool {
        self.own.is_none() && own.is_some_and(|own| self.live.iter().any(|(held, _)| *held == own))
    }

    pub(crate) fn own(&self) -> Option<&Own> {
        self.own.as_ref()
    }

    pub(crate) fn own_mut(&mut self) -> Option<&mut Own> {
        self.own.as_mut()
    }

    /// The local user began sharing, as `own` says, to `members` of its
    /// channel; it is shown large.
    pub(crate) fn begin_own(&mut self, own: Own, session: Session, members: impl IntoIterator<Item = Session>) {
        self.announcer.announced(own.channel, members, Instant::now());
        self.own = Some(own);
        self.focus = Some(session);
    }

    /// The local user's share ended; what was drawn on it goes with it.
    pub(crate) fn end_own(&mut self) -> Option<Own> {
        let own = self.own.take()?;
        self.strokes.forget_channel(own.channel);
        Some(own)
    }

    /// Whether to announce one's own share again, its sharer being in
    /// `channel` with `members`.
    pub(crate) fn announce_due(
        &mut self,
        channel: ChannelId,
        members: impl IntoIterator<Item = Session>,
        now: Instant,
    ) -> bool {
        if self.own.is_none() {
            return false;
        }
        let due = self.announcer.due(channel, members, now);
        if due && let Some(own) = self.own.as_mut() {
            own.channel = channel;
        }
        due
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::share::tracks::Content;

    fn said(sender: Session, kind: SignalKind, payload: &str) -> Signal {
        Signal {
            server: Some("s1".into()),
            sender: Some(sender),
            kind,
            payload: payload.to_owned(),
        }
    }

    fn own(channel: ChannelId) -> Own {
        Own {
            server: Some("s1".into()),
            channel,
            sources: Vec::new(),
            settings: Settings::default(),
            tracks: Tracks::of([Content::Screen]),
            standing: Standing::Connecting,
        }
    }

    fn on(server: &str) -> Shares {
        let mut shares = Shares::default();
        assert!(!shares.on_server(Some(server.to_owned().into())), "the first is no change");
        shares
    }

    #[test]
    fn several_people_share_at_once_in_the_order_they_began() {
        let mut shares = on("s1");
        assert_eq!(shares.heard(&said(3, SignalKind::Start, "")), Change::Began(3));
        assert_eq!(shares.heard(&said(2, SignalKind::Start, "")), Change::Began(2));
        assert_eq!(shares.heard(&said(3, SignalKind::Start, "")), Change::Nothing, "said again");
        let camera = Tracks::of([Content::Screen, Content::Camera]).payload();
        assert_eq!(shares.heard(&said(3, SignalKind::Start, &camera)), Change::Changed(3));
        let shown = shares.shown(Some(1), |_| true);
        assert_eq!(shown.iter().map(|each| each.session).collect::<Vec<_>>(), [3, 2]);
        assert_eq!(shares.focused(&shown).map(|each| each.session), Some(3));
        shares.focus(2);
        assert_eq!(shares.focused(&shown).map(|each| each.session), Some(2));
        assert_eq!(shares.heard(&said(2, SignalKind::Stop, "")), Change::Ended(2));
        let shown = shares.shown(Some(1), |_| true);
        assert_eq!(shares.focused(&shown).map(|each| each.session), Some(3), "back to the first");
        assert_eq!(shares.heard(&said(2, SignalKind::Stop, "")), Change::Nothing);
    }

    #[test]
    fn the_stage_shows_ones_own_first_and_only_those_in_the_channel() {
        let mut shares = on("s1");
        let _ = shares.heard(&said(3, SignalKind::Start, ""));
        let _ = shares.heard(&said(4, SignalKind::Start, ""));
        shares.begin_own(own(1), 1, [1, 3]);
        let shown = shares.shown(Some(1), |session| session != 4);
        assert_eq!(
            shown.iter().map(|each| (each.session, each.whose)).collect::<Vec<_>>(),
            [(1, Whose::Mine), (3, Whose::Theirs)]
        );
        assert_eq!(shares.focused(&shown).map(|each| each.session), Some(1), "one's own, large");
        assert!(shares.is_live(1, Some(1)));
    }

    #[test]
    fn a_share_of_ones_own_account_from_another_device_is_shown_as_ones_own() {
        // On Starling the sibling device's START names this device itself.
        let mut shares = on("s1");
        let _ = shares.heard(&said(1, SignalKind::Start, ""));
        assert!(shares.shared_elsewhere(Some(1)));
        let shown = shares.shown(Some(1), |_| true);
        assert_eq!(shown.len(), 1);
        assert_eq!(shown[0].whose, Whose::MineElsewhere);
        assert!(shares.is_live(1, Some(1)));
        // Its STOP, when that device stops or leaves, ends it here.
        assert_eq!(shares.heard(&said(1, SignalKind::Stop, "")), Change::Ended(1));
        assert!(!shares.shared_elsewhere(Some(1)));
    }

    #[test]
    fn what_another_server_says_and_who_left_are_dropped() {
        let mut shares = on("s1");
        let mut elsewhere = said(5, SignalKind::Start, "");
        elsewhere.server = Some("s2".into());
        assert_eq!(shares.heard(&elsewhere), Change::Nothing);
        let _ = shares.heard(&said(5, SignalKind::Start, ""));
        let _ = shares.heard(&said(6, SignalKind::Start, ""));
        assert_eq!(shares.gone(|session| session == 6), [5]);
        assert!(!shares.is_live(5, None));
        assert!(shares.on_server(Some("s2".into())), "another server");
        assert!(!shares.is_live(6, None), "forgotten with it");
        assert!(!shares.on_server(Some("s2".into())));
    }

    #[test]
    fn ones_own_share_is_announced_again_where_its_sharer_goes() {
        let mut shares = on("s1");
        let start = Instant::now();
        assert!(!shares.announce_due(1, [1], start), "nothing shared");
        shares.begin_own(own(1), 1, [1, 2]);
        assert!(!shares.announce_due(1, [1, 2], start));
        assert!(shares.announce_due(2, [1], start), "moved");
        assert_eq!(shares.own().map(|own| own.channel), Some(2));
        assert!(shares.end_own().is_some());
        assert!(!shares.announce_due(3, [1], start));
    }
}
