//! The Channels / ACL page as it is drawn: the tree of channels with its
//! search, the chosen channel's rules under their tabs, and what narrows
//! the tree.

use gpui::{
    AnyElement, Context, ElementId, IntoElement, ParentElement, SharedString, Styled, div,
    prelude::*, px,
};

use super::super::Shell;
use super::super::kit::{
    Button, Card, Edge, Emphasis, PageTitle, Placeholder, Reachable, SearchField, Segmented, Size,
    TickBox, edged, icon,
};
use super::acl_model::{Filters, Tree};
use super::acl_page::{AclPage, AclTab};
use crate::engine::Acl;
use crate::theme::Theme;
use crate::words::t;

/// How wide the tree's column is, and the filters'.
const TREE: f32 = 260.0;
const FILTERS: f32 = 230.0;
/// How large the web UI's tick box is, its padding counted: what a row
/// that has one stands as tall as.
const CHECK: f32 = 36.6;

/// The page.
pub(super) fn render(shell: &Shell, page: &AclPage, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    // As tall as the pane, each column scrolling in itself: the web UI
    // bounds them at about two thirds of the window, which is the pane.
    div()
        .id("admin-acl-page")
        .flex_1()
        .min_h_0()
        .flex()
        .flex_col()
        .child(PageTitle::new(t!("Channels / ACL")).below(20.0))
        .child(
            div()
                .flex_1()
                .min_h_0()
                .flex()
                .items_start()
                .gap(px(12.0))
                .child(tree(shell, page, theme, cx))
                .child(
                    div()
                        .id("acl-detail")
                        .flex_1()
                        .min_w_0()
                        .max_h_full()
                        .overflow_y_scroll()
                        .child(detail(shell, page, theme, cx)),
                )
                .child(filters(page.filters, theme, cx)),
        )
        .into_any_element()
}

/// A tick box as large as the web UI's, its box drawn as the kit draws one.
fn check(on: bool) -> impl IntoElement {
    div()
        .flex_none()
        .size(px(CHECK))
        .flex()
        .items_center()
        .justify_center()
        .child(TickBox::new(on))
}

/// The search, and the tree under it.
fn tree(shell: &Shell, page: &AclPage, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let search = page.search.read(cx).text().to_owned();
    let lines = Tree {
        channels: &shell.snapshot.channels,
        users: &shell.snapshot.users,
        selected: page.selected,
        expanded: &page.expanded,
        filters: page.filters,
        own_rules: &page.own_rules,
        search: &search,
    }
    .lines();
    let hover = theme.c.hover;
    let rows = lines.into_iter().map(|line| {
        let channel = line.id;
        let chosen = page.selected == Some(channel);
        let id = SharedString::from(format!("acl-channel-{channel}"));
        let selector = id.clone();
        let toggle = SharedString::from(format!("acl-branch-{channel}"));
        let toggled = toggle.clone();
        let row = div()
            .id(ElementId::Name(id.clone()))
            .debug_selector(move || selector.to_string())
            .w_full()
            .pl(px(8.0 + 14.0 * line.depth as f32))
            .pr(px(9.0))
            .py(px(6.0))
            .flex()
            .items_center()
            .gap(px(5.0))
            .rounded(theme.skin.radius_md)
            .text_size(px(12.0))
            .cursor_pointer()
            .map(|row| {
                if chosen {
                    row.bg(theme.c.accent_soft).text_color(theme.c.text)
                } else {
                    row.text_color(theme.c.muted).hover(move |style| style.bg(hover))
                }
            })
            .on_click(cx.listener(move |shell, _, _, cx| shell.choose_acl_channel(channel, cx)))
            .on_mouse_down(gpui::MouseButton::Right, cx.listener(move |shell, event: &gpui::MouseDownEvent, _, cx| {
                shell.open_acl_channel_menu(channel, event.position, cx);
            }))
            .map(|row| {
                if line.branches {
                    // Opening a branch is not choosing its channel.
                    row.child(
                        div()
                            .id(ElementId::Name(toggle.clone()))
                            .debug_selector(move || toggled.to_string())
                            .flex_none()
                            .on_click(cx.listener(move |shell, _, _, cx| {
                                cx.stop_propagation();
                                shell.toggle_acl_branch(channel, cx);
                            }))
                            .child(icon(if line.open { "chevron-down" } else { "chevron-right" }, 11.0, theme.c.muted)),
                    )
                } else {
                    row.child(div().flex_none().w(px(11.0)))
                }
            })
            .when(line.private, |row| row.child(icon("lock", 10.0, theme.c.muted)))
            .child(div().flex_1().min_w_0().truncate().child(line.name.clone()))
            .when(line.private, |row| {
                row.child(div().flex_none().text_size(px(9.5)).text_color(theme.c.dim).child(t!("private")))
            });
        Reachable::new(ElementId::Name(id), row)
    });
    div()
        .flex_none()
        .w(px(TREE))
        .max_h_full()
        .flex()
        .flex_col()
        .child(SearchField::new(page.search.clone()))
        .child(
            div()
                .id("acl-tree")
                .mt(px(10.0))
                .p(px(6.0))
                .flex_shrink()
                .min_h_0()
                .overflow_y_scroll()
                .rounded(theme.skin.radius_lg)
                .bg(theme.c.card)
                .map(|tree| edged(tree, Edge::All, theme.skin.line_width))
                .border_color(theme.c.line)
                .children(rows.collect::<Vec<_>>()),
        )
}

/// The chosen channel's rules, or what the detail says while there are
/// none to show.
fn detail(shell: &Shell, page: &AclPage, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    if page.loading || (page.selected.is_some() && page.acl.is_none()) {
        return Placeholder::new(t!("Loading ACL...")).into_any_element();
    }
    let Some(acl) = page.acl.as_ref() else {
        return Placeholder::new(t!("Select a channel to edit its ACL")).into_any_element();
    };
    let name = shell
        .snapshot
        .channels
        .iter()
        .find(|channel| channel.id == acl.channel)
        .map(|channel| channel.name.clone())
        .unwrap_or_default();
    let head = div()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(16.0))
        .child(div().text_size(px(15.0)).font_weight(gpui::FontWeight::SEMIBOLD).child(name))
        .when(page.dirty, |head| {
            head.child(
                Button::new("acl-save", t!("Save Changes"))
                    .emphasis(Emphasis::Contained)
                    .size(Size::Compact)
                    .on_click(cx.listener(|shell, _, _, cx| shell.save_acl_page(cx))),
            )
        });
    let inherit = div()
        .id("acl-inherit")
        .debug_selector(|| "acl-inherit".to_owned())
        .mt(px(10.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .text_size(px(12.5))
        .cursor_pointer()
        .on_click(cx.listener(|shell, _, _, cx| shell.acl_inherit(cx)))
        .child(check(acl.inherit))
        .child(t!("Inherit ACLs from parent channel"));
    let body = match page.tab {
        AclTab::Rules => super::acl_rules::render(page, acl, theme, cx),
        AclTab::Groups => super::acl_groups::render(page, acl, &shell.snapshot.users, theme, cx),
        AclTab::Users => super::acl_groups::access(page, acl, &shell.snapshot.users, theme),
    };
    div()
        .child(head)
        .child(Reachable::new("acl-inherit", inherit))
        .child(div().mt(px(12.0)).mb(px(14.0)).child(tabs(page, acl, cx)))
        .child(body)
        .into_any_element()
}

/// The tabs, each with how many it holds.
fn tabs(page: &AclPage, acl: &Acl, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let users = super::acl_model::Access::of(acl).granted.len();
    let names = [
        t!("ACL Rules ({{count}})", count = acl.rules.len()),
        t!("Groups ({{count}})", count = acl.groups.len()),
        t!("Users ({{count}})", count = users),
    ];
    let taken = AclTab::ALL.iter().position(|tab| *tab == page.tab).unwrap_or(0);
    Segmented::new("acl-tab", names, taken).on_choose(cx.listener(|shell, at: &usize, _, cx| {
        if let Some(tab) = AclTab::ALL.get(*at) {
            shell.acl_tab(*tab, cx);
        }
    }))
}

/// What narrows the tree.
fn filters(filters: Filters, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let row = |id: &'static str, says: SharedString, on: bool, flip: fn(&mut Filters), cx: &mut Context<Shell>| {
        let button = div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .py(px(3.0))
            .flex()
            .items_center()
            .gap(px(8.0))
            .cursor_pointer()
            .on_click(cx.listener(move |shell, _, _, cx| shell.set_acl_filters(flip, cx)))
            .child(div().flex_1().min_w_0().text_size(px(11.5)).child(says))
            .child(check(on));
        Reachable::new(id, button)
    };
    div()
        .flex_none()
        .w(px(FILTERS))
        .child(
            div()
                .mb(px(8.0))
                .text_size(px(12.0))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .child(t!("Filters")),
        )
        .child(
            Card::new()
                .text_color(theme.c.text)
                .child(row("acl-hide-dm", t!("Hide DM channels"), filters.friend_chats, |f| f.friend_chats = !f.friend_chats, cx))
                .child(row("acl-hide-empty", t!("Hide empty channels"), filters.empty, |f| f.empty = !f.empty, cx))
                .child(row("acl-private-only", t!("Private channels only"), filters.private_only, |f| f.private_only = !f.private_only, cx))
                .child(row("acl-top-level", t!("Top-level channels only"), filters.top_level, |f| f.top_level = !f.top_level, cx))
                .child(row("acl-own-rules", t!("Custom ACL only"), filters.own_rules_only, |f| f.own_rules_only = !f.own_rules_only, cx)),
        )
}
