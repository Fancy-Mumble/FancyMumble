//! The rows of the member list, as the web client's `MemberPanel` draws
//! them: a heading with its role's pill, or somebody, with their face, their
//! name in their role's colour, and at the end either how they are in voice
//! (under the channel on screen) or where they are (everywhere else).

use std::sync::Arc;

use gpui::{
    AnyElement, Context, Hsla, IntoElement, ParentElement, SharedString, Styled, div, prelude::*,
    px,
};

use super::roster::{Group, Roles};
use super::{Panel, ROW};
use crate::engine::{Registered, User};
use crate::theme::Theme;
use crate::ui::Shell;
use crate::ui::kit::{Avatar, Badge, IconButton, Reachable, RolePill, Tone, icon, keyed_tip};
use crate::words::t;

/// How tall the line of a heading is: a pill's, or the words alone.
const PILL: f32 = 17.0;
const WORDS: f32 = 14.0;

/// A heading: the mark or pill of what it heads, and its name and count
/// in small capitals. The `first` of the list has no group above it to
/// keep apart from.
pub(super) fn heading(
    group: Group,
    count: usize,
    first: bool,
    roles: &Roles,
    theme: &Theme,
) -> AnyElement {
    let (lead, words, ink) = match group {
        Group::Channel => (
            icon("mic", 11.0, theme.c.accent).into_any_element(),
            t!("This channel — {{count}}", count = count),
            theme.c.accent,
        ),
        Group::Role(at) => {
            let role = roles.list.get(at);
            let name = role.map(|role| role.name.clone()).unwrap_or_default();
            let color = role.and_then(|role| role.color);
            (
                RolePill::new(name.clone(), color).into_any_element(),
                t!("{{role}} — {{count}}", role = name, count = count),
                theme.c.dim,
            )
        }
        Group::Members => (
            RolePill::new(t!("Members"), None).into_any_element(),
            t!("Members — {{count}}", count = count),
            theme.c.dim,
        ),
        Group::Guests => (
            RolePill::new(t!("Guests"), None).into_any_element(),
            t!("Guests — {{count}}", count = count),
            theme.c.dim,
        ),
    };
    // The web's section ends 6px below its last row; its heading stands
    // 8px down from there, and 4px above its first.
    let line = if group == Group::Channel { WORDS } else { PILL };
    div()
        .debug_selector(move || format!("members-heading-{}", count_selector(group)))
        .pt(px(if first { 8.0 } else { 14.0 }))
        .pb(px(4.0))
        .child(
            div()
                .h(px(line))
                .w_full()
                .min_w_0()
                .overflow_hidden()
                .flex()
                .items_center()
                .gap(px(6.0))
                .px(px(8.0))
                .child(lead)
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_size(px(10.0))
                        .line_height(px(14.0))
                        .font_weight(gpui::FontWeight::BOLD)
                        .text_color(ink)
                        .child(SharedString::from(words.to_uppercase())),
                ),
        )
        .into_any_element()
}

/// What a test calls the heading of `group`.
fn count_selector(group: Group) -> String {
    match group {
        Group::Channel => "channel".to_owned(),
        Group::Role(at) => format!("role-{at}"),
        Group::Members => "members".to_owned(),
        Group::Guests => "guests".to_owned(),
    }
}

/// The line that says the registered people are on their way.
pub(super) fn loading(theme: &Theme) -> AnyElement {
    div()
        .debug_selector(|| "members-loading".to_owned())
        .h(px(29.0))
        .flex()
        .items_center()
        .px(px(8.0))
        .text_size(px(11.0))
        .text_color(theme.c.dim)
        .child(t!("Loading offline members…"))
        .into_any_element()
}

/// What every member row is: a face, a name and what follows it.
fn frame(face: Avatar, name: SharedString, color: Option<Hsla>, theme: &Theme) -> gpui::Div {
    div()
        .w_full()
        .h(px(ROW))
        .flex()
        .items_center()
        .gap(px(9.0))
        .px(px(8.0))
        .rounded(theme.skin.radius_md)
        .text_size(px(12.5))
        .min_w_0()
        .child(face.size(24.0))
        .child(
            div()
                .min_w_0()
                .truncate()
                .text_color(color.unwrap_or(theme.c.text))
                .child(name),
        )
}

/// Somebody registered who is not on: dimmed, and nothing to click.
pub(super) fn away(
    account: &Registered,
    face: Option<&Arc<gpui::Image>>,
    roles: &Roles,
    theme: &Theme,
) -> AnyElement {
    let id = account.id;
    let face = Avatar::new(&account.name)
        .picture(face)
        .status(Some(theme.c.dim));
    frame(face, account.name.clone(), roles.color_of(Some(id)), theme)
        .debug_selector(move || format!("member-away-{id}"))
        .opacity(0.6)
        .into_any_element()
}

impl Shell {
    /// Somebody who is on. A click keeps their card, a rest of the pointer
    /// brings it up, a right click opens what can be done with them.
    pub(super) fn member_on(
        &self,
        user: &User,
        here: bool,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let session = user.session;
        let own = self.snapshot.own_session == Some(session);
        let id: SharedString = if here {
            format!("member-here-{session}")
        } else {
            format!("member-{session}")
        }
        .into();
        let face = Avatar::new(&user.name)
            .picture(user.avatar.as_ref())
            .talking(here && self.talking.contains(&session))
            .status((!here).then_some(theme.c.ok));
        let hover = theme.c.hover;
        let selector = id.clone();
        let row = frame(
            face,
            user.name.clone(),
            self.panels.members.roles.color_of(user.account),
            theme,
        )
        .id(id.clone())
        .debug_selector(move || selector.to_string())
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .on_hover(cx.listener(move |shell, over: &bool, window, cx| {
            shell.hover_user(session, *over, window, cx);
        }))
        .on_mouse_down(
            gpui::MouseButton::Right,
            cx.listener(move |shell, event: &gpui::MouseDownEvent, _, cx| {
                shell.open_user_menu(session, event.position, cx);
            }),
        )
        .on_click(cx.listener(move |shell, event: &gpui::ClickEvent, _, cx| {
            shell.pin_card(session, Some(event.position()), cx);
        }))
        .when(own, |row| {
            row.child(
                div()
                    .flex_none()
                    .text_size(px(9.5))
                    .text_color(theme.c.dim)
                    .child(t!("you")),
            )
        })
        .when(here, |row| {
            row.children(crate::ui::speaker::priority_mark(user, theme))
        })
        .when(!own && user.unread > 0, |row| {
            row.child(Badge::new(user.unread))
        })
        // What follows stands at the far end: taffy drops the row's gaps
        // where an automatic margin does that.
        .child(div().flex_1())
        .child(if here {
            self.voice_end(user, theme, cx)
        } else {
            self.where_end(user, theme)
        });
        Reachable::new(id, row)
            .corner(theme.skin.radius_md)
            .into_any_element()
    }

    /// The end of a row under the channel on screen: how they are in voice,
    /// and the way to everything about them.
    fn voice_end(&self, user: &User, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let session = user.session;
        let name = user.name.clone();
        div()
            .flex_none()
            .flex()
            .items_center()
            .gap(px(6.0))
            .children(crate::ui::speaker::voice_marks(user, theme))
            .children(self.live_badge(session))
            .child(
                IconButton::at("member-info", session as usize, "info")
                    .size(17.0)
                    .glyph_size(13.0)
                    .tone(Tone::Dim)
                    .tip(t!("Information about {{name}}", name = name))
                    .on_click(cx.listener(move |shell, _, _, cx| shell.inform(session, cx))),
            )
            .into_any_element()
    }

    /// The end of a row anywhere else: the channel they are in.
    fn where_end(&self, user: &User, theme: &Theme) -> AnyElement {
        let channel = self
            .snapshot
            .channels
            .iter()
            .find(|channel| channel.id == user.channel)
            .map(|channel| channel.name.clone());
        let Some(channel) = channel else {
            return div().into_any_element();
        };
        div()
            .id(("member-where", user.session as usize))
            .min_w_0()
            .max_w(px(Panel::WHERE_WIDTH))
            .truncate()
            .text_size(px(11.0))
            .text_color(theme.c.dim)
            .tooltip(keyed_tip(
                t!("In {{channel}}", channel = channel),
                None::<&str>,
            ))
            .child(SharedString::from(format!("#{channel}")))
            .into_any_element()
    }

    /// Open the sheet of everything about `session`, as the menu's "User
    /// information" does.
    fn inform(&mut self, session: crate::engine::Session, cx: &mut Context<Self>) {
        self.show_about(crate::engine::Subject::User(session), cx);
        if let Some(info) = self.info.as_mut() {
            info.sheet = true;
        }
    }
}
