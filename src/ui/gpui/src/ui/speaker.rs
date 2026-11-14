//! What somebody's voice flags say of them, as marks beside their name.
//!
//! Who set a flag is the point of showing it: a mute the server put on
//! somebody was done to them and is not theirs to lift, a mute of their own
//! is a choice. They are drawn in different inks so that they cannot be read
//! as the same state, and each says which it is to a pointer that rests on
//! it.

use gpui::{Div, Hsla, IntoElement, ParentElement, Stateful, Styled, div, prelude::*, px};

use super::kit::{icon, keyed_tip};
use crate::engine::User;
use crate::theme::Theme;

/// How somebody stands, for the marks: each flag by who set it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "each is a mark of its own, and any may be there with any other"
)]
pub(super) struct Standing {
    pub priority: bool,
    pub server_muted: bool,
    pub server_deafened: bool,
    /// Muted by themselves, and not also by the server: where both hold,
    /// the one they cannot lift is the one worth showing.
    pub self_muted: bool,
    pub self_deafened: bool,
}

impl Standing {
    pub(super) const fn of(user: &User) -> Self {
        Self {
            priority: user.priority,
            server_muted: user.server_muted,
            server_deafened: user.server_deafened,
            self_muted: user.muted && !user.server_muted,
            self_deafened: user.deafened && !user.server_deafened,
        }
    }

    /// The marks it is drawn with, in order: what they say, their icon, and
    /// whether the server set them.
    fn marks(self) -> impl Iterator<Item = (&'static str, &'static str, bool)> {
        [
            (self.server_muted, "Server muted", "mic-off", true),
            (
                self.server_deafened,
                "Server deafened",
                "headphone-off",
                true,
            ),
            (self.self_muted, "Self muted", "mic-off", false),
            (self.self_deafened, "Self deafened", "headphone-off", false),
        ]
        .into_iter()
        .filter(|(held, ..)| *held)
        .map(|(_, says, glyph, by_server)| (says, glyph, by_server))
    }
}

/// One mark: an icon that says what it is to a pointer resting on it.
fn mark(user: &User, says: &'static str, glyph: &'static str, ink: Hsla) -> Stateful<Div> {
    div()
        .id((says, user.session as usize))
        .debug_selector(move || says.to_owned())
        .flex_none()
        .tooltip(keyed_tip(says, None::<&str>))
        .child(icon(glyph, 11.0, ink))
}

/// The bolt after the name of somebody who is heard over everybody else.
/// It is about the person, so it goes with the name and not with the marks
/// of their microphone.
pub(super) fn priority_mark(user: &User, theme: &Theme) -> Option<impl IntoElement + use<>> {
    Standing::of(user)
        .priority
        .then(|| mark(user, "Priority speaker", "zap", theme.c.warn))
}

/// The mute and deafen marks of `user`, or nothing at all for somebody
/// plain: a row of empty places would make everybody look like they had a
/// state worth reading.
pub(super) fn voice_marks(user: &User, theme: &Theme) -> Option<impl IntoElement + use<>> {
    let marks: Vec<_> = Standing::of(user)
        .marks()
        .map(|(says, glyph, by_server)| {
            let ink = if by_server { theme.c.bad } else { theme.c.dim };
            mark(user, says, glyph, ink)
        })
        .collect();
    (!marks.is_empty()).then(|| {
        div()
            .flex_none()
            .flex()
            .items_center()
            .gap(px(4.0))
            .children(marks)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user() -> User {
        User {
            session: 3,
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
            hash: None,
        }
    }

    fn said(user: &User) -> Vec<&'static str> {
        Standing::of(user).marks().map(|(says, ..)| says).collect()
    }

    #[test]
    fn somebody_plain_has_no_marks() {
        assert!(said(&user()).is_empty());
    }

    #[test]
    fn a_mute_is_marked_by_who_set_it_and_the_servers_wins() {
        let mut rin = user();
        rin.muted = true;
        assert_eq!(said(&rin), ["Self muted"]);
        // The server's as well: one mark, the one they cannot lift.
        rin.server_muted = true;
        assert_eq!(said(&rin), ["Server muted"]);
        rin.deafened = true;
        assert_eq!(said(&rin), ["Server muted", "Self deafened"]);
        rin.server_deafened = true;
        assert_eq!(said(&rin), ["Server muted", "Server deafened"]);
    }
}
