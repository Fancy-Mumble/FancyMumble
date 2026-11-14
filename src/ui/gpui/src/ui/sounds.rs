//! Hearing what happens: telling from one look at the server to the next
//! what changed, and playing what the user chose for it. Where that is
//! chosen is the Notifications page of the settings.

use std::collections::BTreeSet;

use gpui::SharedString;

use super::Shell;
use crate::engine::{ChannelId, Connection, Conversation, Session, Snapshot, Voice};
use crate::sounds::Event;

/// What was last seen of the server, for telling what changed since.
#[derive(Debug, Default)]
pub(super) struct Watch {
    /// Whose look it was: on which server, as whom. A look as somebody
    /// else, or elsewhere, is not compared with it.
    as_whom: Option<(Option<SharedString>, Session)>,
    /// How many others were on the server.
    others: usize,
    /// The channel the user was in, and who else was.
    room: Option<(ChannelId, BTreeSet<Session>)>,
    muted: bool,
}

impl Watch {
    /// What happened between the last look and `snapshot`, in the order it
    /// is worth hearing. Arriving somewhere is not a crowd arriving: the
    /// first look at a server, or as a new user, only notes what is there.
    pub(super) fn changed(&mut self, snapshot: &Snapshot) -> Vec<Event> {
        let own = snapshot
            .own_session
            .filter(|_| snapshot.connection == Connection::Connected);
        let Some(own) = own else {
            *self = Self::default();
            return Vec::new();
        };
        let server = snapshot
            .sessions
            .iter()
            .find(|session| session.active)
            .map(|session| session.id.clone());
        let others = snapshot
            .users
            .iter()
            .filter(|user| user.session != own)
            .count();
        let room = snapshot.current_channel.map(|channel| {
            let with = snapshot
                .users
                .iter()
                .filter(|user| user.channel == channel && user.session != own)
                .map(|user| user.session)
                .collect::<BTreeSet<_>>();
            (channel, with)
        });
        let muted = snapshot.voice == Voice::Muted;
        let as_whom = Some((server, own));
        let mut heard = Vec::new();
        if self.as_whom == as_whom {
            // Only against the same channel: going somewhere else oneself
            // is not everybody there coming in.
            let (came, went) = match (&self.room, &room) {
                (Some((was, before)), Some((is, now))) if was == is => (
                    now.difference(before).next().is_some(),
                    before.difference(now).next().is_some(),
                ),
                _ => (false, false),
            };
            // Somebody who arrives into this channel is heard once, as
            // coming in; and the same for leaving.
            match others.cmp(&self.others) {
                std::cmp::Ordering::Greater if !came => heard.push(Event::Arrived),
                std::cmp::Ordering::Less if !went => heard.push(Event::Left),
                _ => {}
            }
            heard.extend(came.then_some(Event::Joined));
            heard.extend(went.then_some(Event::Parted));
            heard.extend((muted && !self.muted).then_some(Event::Muted));
        }
        *self = Self {
            as_whom,
            others,
            room,
            muted,
        };
        heard
    }
}

impl Shell {
    /// Play what the user chose for `event`, if anything.
    pub(super) fn hear(&self, event: Event) {
        if let Some((sound, volume)) = self.panels.settings.sounds.heard(event) {
            crate::sounds::play(sound, volume);
        }
    }

    /// The server was looked at again: hear what changed on it.
    pub(super) fn hear_changes(&mut self) {
        for event in self.watch.changed(&self.snapshot) {
            self.hear(event);
        }
    }

    /// Something was said in `conversation`: hear it, unless the user said
    /// it. A message that names the user is heard as that and nothing else.
    pub(super) fn hear_message(&self, conversation: Conversation) {
        if !self.panels.settings.sounds.on {
            return;
        }
        let Some(said) = self.engine.window(conversation, 1).messages.pop() else {
            return;
        };
        if said.own {
            return;
        }
        let names_me = super::mention::Mentions::read(&said.html).names(self.snapshot.own_session);
        self.hear(match conversation {
            _ if names_me => Event::Mention,
            Conversation::Direct(_) => Event::Direct,
            Conversation::Channel(_) => Event::Message,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::demo::DemoEngine;
    use crate::engine::Engine as _;

    #[test]
    fn arriving_somewhere_is_not_heard_and_what_happens_after_is() {
        let engine = DemoEngine::new();
        let mut watch = Watch::default();
        let mut seen = engine.snapshot();
        assert!(watch.changed(&seen).is_empty(), "the first look");
        assert!(watch.changed(&seen).is_empty(), "nothing changed");

        // Somebody in the user's channel goes to another: out of it, and
        // still on the server.
        let own = seen.own_session.expect("connected");
        let room = seen.current_channel.expect("somewhere");
        let elsewhere = seen
            .channels
            .iter()
            .map(|channel| channel.id)
            .find(|id| *id != room)
            .expect("another channel");
        let other = seen
            .users
            .iter()
            .position(|user| user.session != own && user.channel == room)
            .expect("somebody here");
        seen.users[other].channel = elsewhere;
        assert_eq!(watch.changed(&seen), [Event::Parted]);
        seen.users[other].channel = room;
        assert_eq!(watch.changed(&seen), [Event::Joined]);

        // Gone from the server out of this channel: heard once.
        let gone = seen.users.remove(other);
        assert_eq!(watch.changed(&seen), [Event::Parted]);
        // Arriving elsewhere on the server is somebody arriving.
        let mut back = gone;
        back.channel = elsewhere;
        seen.users.push(back);
        assert_eq!(watch.changed(&seen), [Event::Arrived]);
        let _ = seen.users.pop();
        assert_eq!(watch.changed(&seen), [Event::Left]);
    }

    #[test]
    fn going_elsewhere_oneself_and_being_muted() {
        let engine = DemoEngine::new();
        let mut watch = Watch::default();
        let mut seen = engine.snapshot();
        let _ = watch.changed(&seen);
        // The user moves: who is in the new channel did not come in.
        let room = seen.current_channel.expect("somewhere");
        let elsewhere = seen
            .channels
            .iter()
            .map(|channel| channel.id)
            .find(|id| *id != room)
            .expect("another channel");
        seen.current_channel = Some(elsewhere);
        assert!(watch.changed(&seen).is_empty());
        seen.voice = Voice::Muted;
        assert_eq!(watch.changed(&seen), [Event::Muted]);
        assert!(watch.changed(&seen).is_empty(), "once");
        // Away from the server and back: a first look again.
        seen.connection = Connection::Disconnected;
        assert!(watch.changed(&seen).is_empty());
        seen.connection = Connection::Connected;
        seen.users.clear();
        assert!(watch.changed(&seen).is_empty());
    }
}
