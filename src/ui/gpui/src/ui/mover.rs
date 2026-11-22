//! Choosing a channel to move somebody into: the tree, narrowed by what is
//! typed, in a dialog over the window. For one person, or for everybody
//! who is in a channel.

use gpui::Focusable as _;
use gpui::{
    Context, Entity, IntoElement, ParentElement, SharedString, Styled, Window, div, prelude::*, px,
};

use super::Shell;
use super::kit::{Dialog, MenuItem};
use super::text_input::TextInput;
use super::toasts::Kind;
use super::widgets::icon;
use crate::engine::{Action, ChannelId, Session};
use crate::theme::Theme;

/// Who is to be moved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Moved {
    /// One person.
    User(Session),
    /// Everybody in a channel.
    Everyone(ChannelId),
}

/// The dialog while it is open: who is moved, and what narrows the tree.
pub(super) struct Mover {
    moved: Moved,
    search: Entity<TextInput>,
}

impl Shell {
    /// Ask where `moved` is to go.
    pub(super) fn ask_where_to_move(
        &mut self,
        moved: Moved,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let search = cx.new(|cx| TextInput::new("Search channels", cx));
        window.focus(&search.focus_handle(cx), cx);
        // What is typed narrows the list, which is drawn from it.
        cx.observe(&search, |_, _, cx| cx.notify()).detach();
        self.panels.mover = Some(Mover { moved, search });
        cx.notify();
    }

    /// The channel they are in now: where there is no point moving them to.
    fn moved_from(&self, moved: Moved) -> Option<ChannelId> {
        match moved {
            Moved::User(session) => self
                .snapshot
                .users
                .iter()
                .find(|user| user.session == session)
                .map(|user| user.channel),
            Moved::Everyone(from) => Some(from),
        }
    }

    /// What the dialog is headed: whose move it is.
    fn moved_name(&self, moved: Moved) -> SharedString {
        match moved {
            Moved::User(session) => self
                .snapshot
                .users
                .iter()
                .find(|user| user.session == session)
                .map_or_else(|| "them".into(), |user| user.name.clone()),
            Moved::Everyone(from) => self
                .snapshot
                .channels
                .iter()
                .find(|channel| channel.id == from)
                .map_or_else(
                    || "everyone".into(),
                    |channel| format!("everyone in #{}", channel.name).into(),
                ),
        }
    }

    /// The channel `to` was chosen: move them, and say so.
    fn move_to(&mut self, to: ChannelId, cx: &mut Context<Self>) {
        let Some(mover) = self.panels.mover.take() else {
            return;
        };
        let who = self.moved_name(mover.moved);
        let room = self
            .snapshot
            .channels
            .iter()
            .find(|channel| channel.id == to)
            .map(|channel| channel.name.clone())
            .unwrap_or_default();
        self.engine.act(match mover.moved {
            Moved::User(session) => Action::MoveUser {
                session,
                channel: to,
            },
            Moved::Everyone(from) => Action::MoveEveryone { from, to },
        });
        self.toast(format!("Moved {who} to #{room}"), Kind::Done, cx);
        cx.notify();
    }

    /// The channels somebody could be moved to, in the tree's order, as
    /// `(id, name, depth)`: every one but where they are, narrowed by what
    /// is typed. A search flattens the tree: what matched is listed, not
    /// what it is inside.
    fn destinations(&self, mover: &Mover, cx: &gpui::App) -> Vec<(ChannelId, SharedString, usize)> {
        let wanted = mover.search.read(cx).text().trim().to_lowercase();
        let from = self.moved_from(mover.moved);
        let channels = &self.snapshot.channels;
        super::sidebar::tree_order(channels)
            .into_iter()
            .map(|(at, depth)| (&channels[at], depth))
            .filter(|(channel, _)| Some(channel.id) != from)
            .filter(|(channel, _)| {
                wanted.is_empty() || channel.name.to_lowercase().contains(&wanted)
            })
            .map(|(channel, depth)| {
                let depth = if wanted.is_empty() { depth } else { 0 };
                (channel.id, channel.name.clone(), depth)
            })
            .collect()
    }
}

/// The dialog, while somebody is being moved.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<impl IntoElement + use<>> {
    let mover = shell.panels.mover.as_ref()?;
    let title = format!("Move {} to…", shell.moved_name(mover.moved));
    let rooms = shell.destinations(mover, cx);
    let list = crate::ui::kit::ScrollArea::div("mover-list", div()
        .id("mover-list")
        .max_h(px(320.0))
        .overflow_y_scroll()
        .flex()
        .flex_col()
        .gap(px(1.0))
        .children(rooms.into_iter().map(|(id, name, depth)| {
            #[expect(clippy::cast_precision_loss, reason = "a tree is a few channels deep")]
            let indent = px(14.0 * depth as f32);
            div().pl(indent).child(
                // Each its own: rows that share a name share what is known of
                // a press on them.
                MenuItem::new(("mover-room", id as usize), name)
                    .selector(format!("move-to-{id}"))
                    .height(32.0)
                    .lead(icon("hash", 13.0, theme.c.dim))
                    .on_click(cx.listener(move |shell, _, _, cx| shell.move_to(id, cx))),
            )
        })));
    Some(
        Dialog::new("mover")
            .title(title)
            .w(px(400.0))
            .p(px(20.0))
            .gap(px(10.0))
            .on_dismiss(cx.listener(|shell, _, _, cx| {
                shell.panels.mover = None;
                cx.notify();
            }))
            .child(
                div()
                    .h(px(38.0))
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .px(px(12.0))
                    .rounded(theme.skin.radius_md)
                    .bg(theme.c.input)
                    .border_1()
                    .border_color(theme.c.line2)
                    .text_size(px(13.0))
                    .child(icon("search", 12.0, theme.c.dim))
                    .child(mover.search.clone()),
            )
            .child(list),
    )
}
