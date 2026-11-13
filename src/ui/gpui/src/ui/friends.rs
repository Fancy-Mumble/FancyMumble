//! Friends: the people the user keeps, whatever server they were met on.
//!
//! A friend is a certificate's hash, which is who somebody is on every
//! server, with the name they had and the server they were on when they
//! were added. The list is the view's own and is remembered with its
//! settings; whether a friend is here is read from who is on the server
//! showing.

use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::Shell;
use super::kit::{Avatar, Button, Dialog, IconButton, Tone};
use super::widgets::EMPHASIS;
use crate::engine::{Conversation, Session};
use crate::store::Friend;
use crate::theme::Theme;

/// The friends, and whether their list is showing.
#[derive(Default)]
pub(super) struct Friends {
    pub open: bool,
    pub kept: Vec<Friend>,
}

impl Shell {
    /// Whether whoever has this certificate is kept as a friend.
    pub(super) fn is_friend(&self, hash: &str) -> bool {
        self.panels
            .friends
            .kept
            .iter()
            .any(|friend| friend.hash == hash)
    }

    /// Keep whoever is on `session` as a friend, or stop keeping them.
    pub(super) fn set_friend(&mut self, session: Session, keep: bool, cx: &mut Context<Self>) {
        let Some((hash, name)) = self
            .snapshot
            .users
            .iter()
            .find(|user| user.session == session)
            .and_then(|user| Some((user.hash.clone()?, user.name.clone())))
        else {
            return;
        };
        self.forget_friend(&hash);
        if keep {
            let server = self
                .snapshot
                .sessions
                .iter()
                .find(|session| session.active)
                .map(|session| session.name.to_string())
                .unwrap_or_default();
            self.panels.friends.kept.push(Friend {
                hash: hash.to_string(),
                name: name.to_string(),
                server,
            });
        }
        self.remember_settings(cx);
        cx.notify();
    }

    fn forget_friend(&mut self, hash: &str) {
        self.panels
            .friends
            .kept
            .retain(|friend| friend.hash != hash);
    }

    /// The session a friend is on, on the server showing, if they are.
    fn friend_here(&self, friend: &Friend) -> Option<Session> {
        self.snapshot
            .users
            .iter()
            .find(|user| {
                user.hash
                    .as_ref()
                    .is_some_and(|hash| hash.as_ref() == friend.hash)
            })
            .map(|user| user.session)
    }
}

/// The list, over a veil.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement {
    let kept = &shell.panels.friends.kept;
    let body = if kept.is_empty() {
        div()
            .debug_selector(|| "friends-none".to_owned())
            .text_color(theme.c.muted)
            .child("Nobody yet. Add somebody from their menu, on a server you are both on.")
            .into_any_element()
    } else {
        div()
            .flex()
            .flex_col()
            .gap(px(4.0))
            .children(
                kept.iter()
                    .enumerate()
                    .map(|(at, friend)| row(shell, at, friend, theme, cx)),
            )
            .into_any_element()
    };
    Dialog::new("friends")
        .title("Friends")
        .w(px(440.0))
        .max_h(px(520.0))
        .scrolls()
        .gap(px(14.0))
        .p(px(22.0))
        .child(body)
        .child(
            div()
                .flex()
                .justify_end()
                .child(Button::new("friends-close", "Close").on_click(cx.listener(
                    |shell, _, _, cx| {
                        shell.panels.friends.open = false;
                        cx.notify();
                    },
                ))),
        )
}

/// One friend: who, whether they are here, and the way to stop keeping
/// them. A click on one who is here opens the conversation with them.
fn row(
    shell: &Shell,
    at: usize,
    friend: &Friend,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let here = shell.friend_here(friend);
    let live = here.and_then(|session| shell.snapshot.users.iter().find(|u| u.session == session));
    let name: SharedString =
        live.map_or_else(|| friend.name.clone().into(), |user| user.name.clone());
    let about = if here.is_some() {
        "here now".to_owned()
    } else if friend.server.is_empty() {
        "not here".to_owned()
    } else {
        format!("not here · met on {}", friend.server)
    };
    let hash = friend.hash.clone();
    let hover = theme.c.hover;
    div()
        .id(("friend", at))
        .debug_selector(move || format!("friend-{at}"))
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(10.0))
        .py(px(8.0))
        .rounded(theme.skin.radius_md)
        .when_some(here, |row, session| {
            row.cursor_pointer()
                .hover(move |style| style.bg(hover))
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.panels.friends.open = false;
                    shell.open_conversation(Conversation::Direct(session), cx);
                }))
        })
        .child(
            Avatar::new(&name)
                .picture(live.and_then(|user| user.avatar.as_ref()))
                .size(34.0)
                .status(Some(if here.is_some() {
                    theme.c.ok
                } else {
                    theme.c.dim
                })),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(div().truncate().font_weight(EMPHASIS).child(name))
                .child(
                    div()
                        .truncate()
                        .text_size(px(11.5))
                        .text_color(theme.c.muted)
                        .child(about),
                ),
        )
        .child(
            IconButton::at("friend-remove", at, "x")
                .tone(Tone::Dim)
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.forget_friend(&hash);
                    shell.remember_settings(cx);
                    cx.notify();
                    // Not also a click on the row.
                    cx.stop_propagation();
                })),
        )
}
