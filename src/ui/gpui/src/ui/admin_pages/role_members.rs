//! The role editor's Members tab: who is in the role, who is kept out of
//! what it takes from a parent, who it has from there, and whether it
//! takes and passes on members: the web UI's `RoleMembers`.

use gpui::{AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{GroupTitle, MemberPicker, Reachable, TickBox};
use super::roles_page::{Among, RolesPage};
use crate::engine::AclGroup;
use crate::theme::Theme;
use crate::words::t;

/// How many accounts a field suggests at most.
const SUGGESTED: usize = 8;

/// The accounts what is typed in `field` matches, not among `chosen`: by
/// a part of their name, or their number.
fn suggestions(page: &RolesPage, typed: &str, chosen: &[u32]) -> Vec<(u32, SharedString)> {
    let typed = typed.trim().to_lowercase();
    if typed.is_empty() {
        return Vec::new();
    }
    page.accounts
        .iter()
        .filter(|account| !chosen.contains(&account.id))
        .filter(|account| account.name.to_lowercase().contains(&typed) || account.id.to_string() == typed)
        .take(SUGGESTED)
        .map(|account| (account.id, account.name.clone()))
        .collect()
}

/// The tab.
pub(super) fn render(page: &RolesPage, role: &AclGroup, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let Some(form) = page.form.as_ref() else {
        return div().into_any_element();
    };
    let locked = role.from_parent;
    let named = |ids: &[u32]| ids.iter().map(|id| (*id, page.named(*id))).collect::<Vec<_>>();
    let picker = |id: &'static str, among: Among, ids: &[u32], cx: &mut Context<Shell>| {
        let field = match among {
            Among::Members => form.add_member.clone(),
            Among::Excluded => form.add_excluded.clone(),
        };
        let typed = field.read(cx).text().to_owned();
        MemberPicker::new(id, field)
            .chosen(named(ids))
            .suggested(suggestions(page, &typed, ids))
            .locked(locked)
            .empty(match among {
                Among::Members => t!("No explicit members"),
                Among::Excluded => t!("No exclusions"),
            })
            .on_remove(cx.listener(move |shell, id: &u32, _, cx| shell.take_from_role(among, *id, cx)))
            .on_pick(cx.listener(move |shell, id: &u32, _, cx| shell.pick_for_role(among, *id, cx)))
    };
    div()
        .max_w(px(640.0))
        .child(GroupTitle::new(t!("Members")))
        .child(picker("role-members", Among::Members, &role.added, cx))
        .child(
            GroupTitle::new(t!("Excluded members"))
                .hint(t!("Users who should be removed from the inherited member set.")),
        )
        .child(picker("role-excluded", Among::Excluded, &role.removed, cx))
        .when(!role.inherited.is_empty(), |tab| {
            tab.child(GroupTitle::new(t!(
                "Inherited members ({{count}})",
                count = role.inherited.len()
            )))
            .child(div().flex().flex_wrap().gap(px(4.0)).children(role.inherited.iter().map(|id| {
                div()
                    .px(px(9.0))
                    .py(px(3.0))
                    .rounded(theme.skin.radius_pill)
                    .text_size(px(11.0))
                    .bg(theme.c.card2)
                    .text_color(theme.c.muted)
                    .child(page.named(*id))
            })))
        })
        .child(GroupTitle::new(t!("Inheritance")))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(tick("role-inherit", t!("Inherit members from parent channels"), role.inherit, locked, true, theme, cx))
                .child(tick(
                    "role-inheritable",
                    t!("Allow child channels to inherit from this role"),
                    role.inheritable,
                    locked,
                    false,
                    theme,
                    cx,
                )),
        )
        .into_any_element()
}

/// A tick box and what it means; `parents` says which of the two it is.
fn tick(
    id: &'static str,
    says: SharedString,
    on: bool,
    locked: bool,
    parents: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    let row = div()
        .id(id)
        .debug_selector(move || id.to_owned())
        .h(px(32.0))
        .px(px(6.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .rounded(theme.skin.radius_md)
        .text_size(px(12.5))
        .when(locked, |row| row.opacity(0.5))
        .when(!locked, |row| {
            row.cursor_pointer()
                .hover(move |style| style.bg(hover))
                .on_click(cx.listener(move |shell, _, _, cx| shell.role_inherits(parents, !on, cx)))
        })
        .child(TickBox::new(on))
        .child(says);
    Reachable::new(id, row)
}
