//! The Groups tab: the channel's groups, each a card with its name,
//! whether it takes and passes on members, and who is added to it or
//! kept out. The web UI's `AclGroups` and `GroupCard`; the Users tab is
//! here too, who the rules let in (`AccessUsers`).

use gpui::{
    AnyElement, Context, ElementId, IntoElement, ParentElement, SharedString, Styled, div,
    prelude::*, px,
};

use super::super::Shell;
use super::super::kit::{
    Button, Card, Emphasis, Empty, IconButton, Reachable, Size, TextBox, TickBox, icon,
};
use super::acl_model::Access;
use super::acl_page::{AclPage, Among};
use crate::engine::{Acl, AclGroup, User};
use crate::theme::Theme;
use crate::words::t;

/// The tab.
pub(super) fn render(page: &AclPage, acl: &Acl, users: &[User], theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let head = div()
        .mb(px(10.0))
        .flex()
        .items_center()
        .justify_between()
        .child(div().text_size(px(12.5)).font_weight(gpui::FontWeight::SEMIBOLD).child(t!("Groups")))
        .child(
            Button::new("acl-add-group", t!("+ Add Group"))
                .emphasis(Emphasis::Outlined)
                .size(Size::Compact)
                .on_click(cx.listener(|shell, _, _, cx| shell.add_acl_group(cx))),
        );
    let body = if acl.groups.is_empty() {
        Empty::new(t!("No groups defined")).into_any_element()
    } else {
        div()
            .flex()
            .flex_col()
            .gap(px(6.0))
            .children(acl.groups.iter().enumerate().map(|(at, group)| card(page, at, group, users, theme, cx)))
            .into_any_element()
    };
    div().child(head).child(body).into_any_element()
}

/// Who `ids` are, as chips, each with a way out where it can be taken out.
fn chips(
    page: &AclPage,
    at: usize,
    among: Option<Among>,
    ids: &[u32],
    heading: SharedString,
    users: &[User],
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let theme = crate::theme::ActiveTheme::get(cx);
    let chips = ids.iter().map(|id| {
        let id = *id;
        div()
            .flex()
            .items_center()
            .gap(px(3.0))
            .px(px(8.0))
            .py(px(3.0))
            .rounded(theme.skin.radius_pill)
            .text_size(px(11.0))
            .bg(theme.c.card2)
            .child(page.named(id, users))
            .when_some(among, |chip, among| {
                let name = SharedString::from(format!("acl-group-{at}-drop-{id}"));
                let selector = name.clone();
                let drop = div()
                    .id(ElementId::Name(name.clone()))
                    .debug_selector(move || selector.to_string())
                    .cursor_pointer()
                    .opacity(0.6)
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        shell.change_acl_group(
                            at,
                            |group| match among {
                                Among::Added => group.added.retain(|added| *added != id),
                                Among::Removed => group.removed.retain(|removed| *removed != id),
                            },
                            cx,
                        );
                    }))
                    .child(icon("x", 10.0, theme.c.text));
                chip.child(Reachable::new(ElementId::Name(name), drop))
            })
    });
    div()
        .mt(px(10.0))
        .child(
            div()
                .text_size(px(11.0))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .text_color(theme.c.muted)
                .child(heading),
        )
        .child(div().mt(px(5.0)).flex().flex_wrap().gap(px(4.0)).children(chips.collect::<Vec<_>>()))
}

/// The field and button that add somebody to a group's list.
fn entry(at: usize, among: Among, field: gpui::Entity<super::super::text_input::TextInput>, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let (id, says) = match among {
        Among::Added => ("acl-group-add", t!("Add")),
        Among::Removed => ("acl-group-exclude", t!("Exclude")),
    };
    div()
        .mt(px(7.0))
        .flex()
        .gap(px(6.0))
        .child(div().flex_1().child(TextBox::new(field).named(format!("{id}-{at}"))))
        .child(
            Button::new(id, says)
                .selector(format!("{id}-button-{at}"))
                .emphasis(Emphasis::Outlined)
                .size(Size::Compact)
                .height(36.0)
                .on_click(cx.listener(move |shell, _, _, cx| shell.add_to_acl_group(at, among, cx))),
        )
}

/// A tick box and its words: whether a group takes or passes on members.
fn tick(id: SharedString, says: SharedString, on: bool, locked: bool, at: usize, inherit: bool, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let selector = id.clone();
    let row = div()
        .id(ElementId::Name(id.clone()))
        .debug_selector(move || selector.to_string())
        .flex()
        .items_center()
        .gap(px(6.0))
        .text_size(px(11.5))
        .when(locked, |row| row.opacity(0.5))
        .when(!locked, |row| {
            row.cursor_pointer().on_click(cx.listener(move |shell, _, _, cx| {
                shell.change_acl_group(
                    at,
                    |group| {
                        if inherit {
                            group.inherit = !on;
                        } else {
                            group.inheritable = !on;
                        }
                    },
                    cx,
                );
            }))
        })
        .child(TickBox::new(on))
        .child(says);
    Reachable::new(ElementId::Name(id), row)
}

/// One group's card.
fn card(page: &AclPage, at: usize, group: &AclGroup, users: &[User], theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let locked = group.from_parent;
    let Some(fields) = page.groups.get(at) else {
        return div().into_any_element();
    };
    let name_row = div()
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(div().flex_1().child(TextBox::new(fields.name.clone()).named(format!("acl-group-name-{at}"))))
        .map(|row| {
            if locked {
                row.child(div().text_size(px(10.5)).text_color(theme.c.dim).child(t!("Inherit")))
            } else {
                row.child(
                    IconButton::at("acl-group-remove", at, "x")
                        .size(24.0)
                        .glyph_size(12.0)
                        .on_click(cx.listener(move |shell, _, _, cx| shell.remove_acl_group(at, cx))),
                )
            }
        });
    // Its own place among the ids: each card has an Add and an Exclude.
    let card = Card::new()
        .child(name_row)
        .child(
            div()
                .mt(px(8.0))
                .flex()
                .flex_wrap()
                .gap(px(16.0))
                .child(tick(format!("acl-group-inherit-{at}").into(), t!("Inherit"), group.inherit, locked, at, true, cx))
                .child(tick(
                    format!("acl-group-inheritable-{at}").into(),
                    t!("Inheritable"),
                    group.inheritable,
                    locked,
                    at,
                    false,
                    cx,
                )),
        )
        .when(!group.inherited.is_empty(), |card| {
            card.child(chips(page, at, None, &group.inherited, t!("Inherited members"), users, cx))
        })
        .child(chips(page, at, (!locked).then_some(Among::Added), &group.added, t!("Members to add"), users, cx))
        .when(!locked, |card| card.child(entry(at, Among::Added, fields.add.clone(), cx)))
        .child(chips(page, at, (!locked).then_some(Among::Removed), &group.removed, t!("Members to remove"), users, cx))
        .when(!locked, |card| card.child(entry(at, Among::Removed, fields.exclude.clone(), cx)));
    div().id(("acl-group", at)).child(card).into_any_element()
}

/// The Users tab: who the channel's rules let in, by rule, by group, and
/// in general.
pub(super) fn access(page: &AclPage, acl: &Acl, users: &[User], theme: &Theme) -> AnyElement {
    let access = Access::of(acl);
    let online = |id: u32| users.iter().any(|user| user.account == Some(id));
    let person = |id: u32, hinted: bool| {
        let on = online(id);
        div()
            .py(px(3.0))
            .flex()
            .items_center()
            .gap(px(8.0))
            .child(div().size(px(8.0)).rounded_full().bg(if on { theme.c.ok } else { theme.c.dim }))
            .child(div().text_size(px(12.0)).child(page.named(id, users)))
            .when(hinted && on, |row| {
                row.child(div().text_size(px(10.5)).text_color(theme.c.dim).child(t!("online")))
            })
    };
    let mut granted = access.granted.clone();
    granted.sort_by_key(|id| page.named(*id, users).to_lowercase());
    div()
        .when(access.everybody, |tab| {
            tab.child(
                div()
                    .debug_selector(|| "acl-access-everybody".to_owned())
                    .child(Card::new().text_size(px(12.5)).child(t!("All users have access to this channel."))),
            )
        })
        .when(!access.everybody && access.registered, |tab| {
            tab.child(Card::new().text_size(px(12.5)).child(t!("All registered users have access to this channel.")))
        })
        .when(!granted.is_empty(), |tab| {
            tab.child(
                div()
                    .mt(px(12.0))
                    .child(div().mb(px(5.0)).text_size(px(12.0)).font_weight(gpui::FontWeight::SEMIBOLD).child(t!("Users with access")))
                    .children(granted.iter().map(|id| person(*id, true))),
            )
        })
        .children(access.groups.iter().map(|(group, members)| {
            div()
                .mt(px(12.0))
                .child(
                    div()
                        .mb(px(5.0))
                        .text_size(px(12.0))
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .child(t!("Members of @{{group}}", group = group)),
                )
                .map(|block| {
                    if members.is_empty() {
                        block.child(div().text_size(px(11.5)).text_color(theme.c.dim).child(SharedString::new_static("—")))
                    } else {
                        block.children(members.iter().map(|id| person(*id, false)))
                    }
                })
        }))
        .when(access.nobody(), |tab| {
            tab.child(Empty::new(t!("No specific users are granted access; access is inherited from parent ACLs.")))
        })
        .into_any_element()
}
