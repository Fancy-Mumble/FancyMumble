//! When somebody's card comes up by itself: while the pointer rests on
//! them, without a click.
//!
//! It is the card a click keeps (`card.rs`), shown where the pointer cannot
//! reach it: fetched when the pointer has rested, and let go of when it
//! leaves.

use std::time::Duration;

use gpui::{Context, Pixels, Point, Window};

use super::Shell;
use crate::engine::{Session, Subject};

/// How long the pointer rests on somebody before their card comes up:
/// passing over a list of names is not asking about each of them.
pub(super) const REST: Duration = Duration::from_millis(350);

impl Shell {
    /// The pointer came onto `session`'s row, or left it.
    pub(super) fn hover_user(
        &mut self,
        session: Session,
        over: bool,
        window: &Window,
        cx: &mut Context<Self>,
    ) {
        if !over {
            if self.pointed.user == Some(session) {
                self.pointed.user = None;
            }
            let floats_here = self
                .info
                .as_ref()
                .is_some_and(|info| info.hover.is_some() && info.subject == Subject::User(session));
            if floats_here {
                self.info = None;
                cx.notify();
            }
            return;
        }
        self.pointed.user = Some(session);
        let at = window.mouse_position();
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(REST).await;
            let _ = shell.update(cx, |shell, cx| shell.float_card(session, at, cx));
        })
        .detach();
    }

    /// The pointer has rested: bring up `session`'s card beside it, unless
    /// it has moved on meanwhile or something else is up already.
    fn float_card(&mut self, session: Session, at: Point<Pixels>, cx: &mut Context<Self>) {
        let busy = self.info.is_some() || self.menu.is_some() || self.prompt.is_some();
        if self.pointed.user != Some(session) || busy {
            return;
        }
        self.show_about(Subject::User(session), cx);
        if let Some(info) = self.info.as_mut() {
            info.hover = Some(at);
        }
    }
}
