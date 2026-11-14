//! The pill of actions that stands just off the message the pointer is on:
//! the few things wanted mid-conversation, a click away, where the menu
//! behind a right click has all of them.
//!
//! What it offers is read off that menu, entry by entry, so the two can
//! never disagree about what may be done to a message.

use std::time::Duration;

use gpui::{
    AnyElement, ClickEvent, Context, IntoElement, ParentElement, Pixels, Styled, Window, div,
    prelude::*, px,
};

use super::Shell;
use super::kit::{Divider, keyed_tip};
use super::menu::Item;
use super::widgets::icon;
use crate::theme::Theme;

/// How long the pill outlives the pointer leaving its message: the time it
/// takes to cross the gap between the two.
const GRACE: Duration = Duration::from_millis(220);

/// How tall the pill is, and how far it stands off its message.
const HEIGHT: f32 = 34.0;
const GAP: f32 = 4.0;
/// How tall it is where it stands under every message, as the web UI
/// draws its pinned strip.
const PINNED_HEIGHT: f32 = 30.0;

/// Which message the pointer is on, for the pill.
#[derive(Debug, Default)]
pub(super) struct Hovered {
    /// The message, by its place in the conversation.
    message: Option<usize>,
    /// Whether the pointer is on the pill itself.
    on_pill: bool,
    /// Counts every arrival and departure: a departure that waited out its
    /// grace takes the pill away only if nothing happened meanwhile.
    turn: u64,
}

/// One button of the pill.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Act {
    React,
    Reply,
    Edit,
    Copy,
    Pin,
    More,
    Delete,
}

impl Act {
    /// In the order the pill shows them. `Delete` stands apart, last.
    const ALL: [Self; 7] = [
        Self::React,
        Self::Reply,
        Self::Edit,
        Self::Copy,
        Self::Pin,
        Self::More,
        Self::Delete,
    ];

    /// The menu entry this button stands for, among `items` and the quick
    /// reactions `quick`.
    fn entry<'a>(self, items: &'a [Item], quick: &'a [Item]) -> Option<&'a Item> {
        let named = |names: &[&str]| {
            items
                .iter()
                .find(|item| names.contains(&item.name.as_ref()))
        };
        match self {
            // The last quick entry is the way to every emoji.
            Self::React => quick.last(),
            Self::Reply => named(&["Reply"]),
            Self::Edit => named(&["Edit"]),
            Self::Copy => named(&["Copy text"]),
            Self::Pin => named(&["Pin", "Unpin"]),
            Self::Delete => named(&["Delete"]),
            Self::More => None,
        }
    }

    /// Its icon and what it says when rested on, for the entry it stands for.
    fn face(self, entry: Option<&Item>) -> (&'static str, &'static str) {
        let unpins = entry.is_some_and(|item| item.name.as_ref() == "Unpin");
        match self {
            Self::React => ("smile-plus", "Add reaction"),
            Self::Reply => ("reply", "Reply"),
            Self::Edit => ("pencil", "Edit"),
            Self::Copy => ("copy", "Copy text"),
            Self::Pin if unpins => ("check", "Unpin"),
            Self::Pin => ("pin", "Pin"),
            Self::More => ("ellipsis-vertical", "More"),
            Self::Delete => ("trash-2", "Delete"),
        }
    }
}

impl Shell {
    /// The pointer came onto, or left, the message at `index`.
    pub(super) fn hover_message(&mut self, index: usize, over: bool, cx: &mut Context<Self>) {
        if over {
            self.pointed.pill.turn += 1;
            if self.pointed.pill.message != Some(index) {
                self.pointed.pill.message = Some(index);
                cx.notify();
            }
        } else if self.pointed.pill.message == Some(index) {
            self.leave_later(cx);
        }
    }

    /// The pointer came onto, or left, the pill.
    fn hover_pill(&mut self, over: bool, cx: &mut Context<Self>) {
        self.pointed.pill.on_pill = over;
        self.pointed.pill.turn += 1;
        if !over {
            self.leave_later(cx);
        }
    }

    /// Take the pill away once the pointer has had time to reach it, if it
    /// went nowhere the pill belongs to.
    fn leave_later(&mut self, cx: &mut Context<Self>) {
        self.pointed.pill.turn += 1;
        let turn = self.pointed.pill.turn;
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(GRACE).await;
            let _ = shell.update(cx, |shell, cx| {
                if shell.pointed.pill.turn == turn && !shell.pointed.pill.on_pill {
                    shell.pointed.pill.message = None;
                    cx.notify();
                }
            });
        })
        .detach();
    }

    /// The message the pill is up for.
    #[cfg(test)]
    pub(super) fn hovered_message(&self) -> Option<usize> {
        self.pointed.pill.message
    }

    /// Do what the pill's button `act` says to message `index`.
    fn act_on_message(
        &mut self,
        index: usize,
        act: Act,
        event: &ClickEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if act == Act::More {
            self.open_message_menu(event.position(), index, cx);
            return;
        }
        let Some((items, quick)) = self.message_entries(index) else {
            return;
        };
        if let Some(entry) = act.entry(&items, &quick) {
            self.run(entry.command.clone(), window, cx);
        }
    }

    /// The pill for the message at `index`, if the pointer is on it: hung
    /// from the leading or the trailing edge of the row, `inset` from it,
    /// its foot just off the message, which begins `gap` under the row's
    /// top edge.
    pub(super) fn action_pill(
        &self,
        index: usize,
        (trailing, inset, gap): (bool, Pixels, Pixels),
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let busy = self.chrome.picked.is_some() || self.menu.is_some();
        // Where every message shows its actions, none hangs over one.
        let pinned = self.panels.settings.look.always_show_message_actions;
        if self.pointed.pill.message != Some(index) || busy || pinned {
            return None;
        }
        let pill = self.pill(index, theme, cx)?.h(px(HEIGHT)).shadow(theme.c.shadow.cast());
        // The gap under the pill is part of what the pointer may cross
        // without the pill going: it is the pill's to watch.
        let hung = div()
            .id("message-actions-reach")
            .absolute()
            .top(gap - px(GAP + HEIGHT))
            .pb(px(GAP))
            .on_hover(cx.listener(|shell, over: &bool, _, cx| shell.hover_pill(*over, cx)))
            .child(pill);
        Some(
            if trailing {
                hung.right(inset)
            } else {
                hung.left(inset)
            }
            .into_any_element(),
        )
    }

    /// The actions of the message at `index` standing under it, where every
    /// message shows them: at its trailing edge for a message drawn there.
    pub(super) fn pinned_actions(
        &self,
        index: usize,
        trailing: bool,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if self.chrome.picked.is_some() {
            return None;
        }
        let pill = self.pill(index, theme, cx)?.h(px(PINNED_HEIGHT));
        Some(
            div()
                .debug_selector(move || format!("pinned-actions-{index}"))
                .mt(px(5.0))
                .flex()
                .when(trailing, Styled::justify_end)
                .child(pill)
                .into_any_element(),
        )
    }

    /// The pill's buttons for the message at `index`, on the floating
    /// surface: as many as the menu offers for it.
    fn pill(
        &self,
        index: usize,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> Option<gpui::Stateful<gpui::Div>> {
        let (items, quick) = self.message_entries(index)?;
        // Deleting is a click away only on what is one's own; anybody
        // else's is deleted from the menu, where it is not hit by mistake.
        let own = self.messages.get(index).is_some_and(|message| message.own);
        let button = |act: Act| {
            let entry = act.entry(&items, &quick);
            let offered = match act {
                Act::More => true,
                Act::Delete => own && entry.is_some(),
                _ => entry.is_some(),
            };
            offered.then(|| {
                let (glyph, says) = act.face(entry);
                let danger = act == Act::Delete;
                let (ink, lit) = if danger {
                    (theme.c.bad, theme.c.bad)
                } else {
                    (theme.c.muted, theme.c.text)
                };
                div()
                    .id(says)
                    .debug_selector(move || format!("pill-{says}"))
                    .cursor_pointer()
                    .text_color(ink)
                    .hover(move |style| style.text_color(lit))
                    .tooltip(keyed_tip(says, None::<&str>))
                    .on_click(cx.listener(move |shell, event, window, cx| {
                        shell.act_on_message(index, act, event, window, cx);
                    }))
                    .child(icon(glyph, 15.0, ink))
            })
        };
        let (last, rest) = Act::ALL.split_last()?;
        let delete = button(*last);
        let pill = div()
            .id("message-actions")
            .debug_selector(|| "message-actions".to_owned())
            .px(px(12.0))
            .flex()
            .items_center()
            .gap(px(14.0))
            .rounded(theme.skin.radius_lg)
            .bg(theme.c.bg0)
            .border_1()
            .border_color(theme.c.line2)
            .occlude()
            .children(rest.iter().filter_map(|act| button(*act)))
            // The only divider, and only before the destructive end.
            .when_some(delete, |pill, delete| {
                pill.child(Divider::upright(14.0)).child(delete)
            });
        Some(pill)
    }
}
