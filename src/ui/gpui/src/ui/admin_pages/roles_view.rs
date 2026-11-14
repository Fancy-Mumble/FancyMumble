//! The Roles page as it is drawn: the list of roles with the search and
//! the way to make one, or the editor of one, its three tabs under its
//! title.

use gpui::{AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{
    Button, Emphasis, Empty, IconButton, PageTitle, PillStep, Reachable, RolePill, SearchField,
    Segmented, Size, Tone, edged, Edge,
};
use super::roles_page::{RolesPage, Tab};
use crate::engine::AclGroup;
use crate::theme::Theme;
use crate::words::t;

/// How wide the page is at most.
const WIDEST: f32 = 760.0;
/// How tall the list's toolbar is: its search field's height.
const TOOLBAR: f32 = 47.0;

/// The page.
pub(super) fn render(
    page: &RolesPage,
    budget: usize,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let body = if page.editing.is_some() {
        editor(page, budget, theme, cx)
    } else {
        list(page, theme, cx)
    };
    div()
        .id("admin-roles-page")
        .max_w(px(WIDEST))
        .child(body)
        .into_any_element()
}

/// The colour a role is drawn in, where the server gave it one.
pub(super) fn colour_of(group: &AclGroup) -> Option<gpui::Hsla> {
    let written = group.look.color.as_ref()?;
    crate::theme::parse_color(written).map(Into::into)
}

/// The list of roles.
fn list(page: &RolesPage, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let wanted = page.search.read(cx).text().to_owned();
    let roles = page.listed(&wanted);
    let toolbar = div()
        .flex()
        .gap(px(6.0))
        .child(SearchField::new(page.search.clone()).width(200.0))
        .child(
            Button::new("roles-create", t!("+ Create role"))
                .emphasis(Emphasis::Contained)
                .size(Size::Compact)
                .height(TOOLBAR)
                .on_click(cx.listener(|shell, _, window, cx| shell.create_role(window, cx))),
        )
        .when(page.dirty, |toolbar| {
            toolbar.child(
                Button::new("roles-save", t!("Save changes"))
                    .emphasis(Emphasis::Outlined)
                    .size(Size::Compact)
                    .height(TOOLBAR)
                    .on_click(cx.listener(|shell, _, _, cx| shell.save_roles_page(cx))),
            )
        });
    let body = if page.acl.is_none() {
        Empty::new(t!("Loading roles...")).into_any_element()
    } else if roles.is_empty() {
        Empty::new(t!("No roles match your search.")).into_any_element()
    } else {
        div()
            .flex()
            .flex_col()
            .gap(px(5.0))
            .children(roles.into_iter().enumerate().map(|(at, role)| row(at, role, theme, cx)))
            .into_any_element()
    };
    div()
        .child(
            PageTitle::new(t!("Server Roles"))
                .hint(t!("Server-wide roles live on the root channel and are inherited everywhere. Use the Channel ACL tab to add per-channel overrides."))
                .below(20.0)
                .action(toolbar),
        )
        .child(body)
        .into_any_element()
}

/// A role in the list: its pill, how many are in it, and its style.
fn row(at: usize, role: &AclGroup, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let name = role.name.clone();
    let id = SharedString::from(format!("role-row-{at}"));
    let selector = id.clone();
    let hover = theme.c.hover;
    let count = role.added.len() + role.inherited.len();
    let button = div()
        .id(gpui::ElementId::Name(id.clone()))
        .debug_selector(move || selector.to_string())
        .w_full()
        .flex()
        .items_center()
        .gap(px(12.0))
        .px(px(14.0))
        .py(px(11.0))
        .rounded(theme.skin.radius_lg)
        .bg(theme.c.card)
        .map(|row| edged(row, Edge::All, theme.skin.line_width))
        .border_color(theme.c.line)
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .on_click(cx.listener(move |shell, _, window, cx| shell.edit_role(name.clone(), window, cx)))
        .child(RolePill::new(role.name.clone(), colour_of(role)).step(PillStep::Medium))
        .child(
            div()
                .text_size(px(11.5))
                .text_color(theme.c.muted)
                .child(t!("{{count}} member", "{{count}} members", count = count)),
        )
        .children(role.look.style.clone().map(|style| {
            div()
                .text_size(px(11.0))
                .text_color(theme.c.dim)
                .child(t!("preset: {{name}}", name = style))
        }));
    Reachable::new(gpui::ElementId::Name(id), button).corner(theme.skin.radius_lg)
}

/// The editor of the role being edited: its title with what can be done
/// to it, the way back and its tabs, and the tab chosen.
fn editor(page: &RolesPage, budget: usize, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let name = page.editing.clone().unwrap_or_default();
    let role = page.role();
    let deletable = role.is_some_and(|role| !role.from_parent);
    let toolbar = div()
        .flex()
        .gap(px(6.0))
        .when(deletable, |toolbar| {
            toolbar.child(
                Button::new("role-delete", t!("Delete role"))
                    .size(Size::Compact)
                    .height(33.1)
                    .tone(Tone::Muted)
                    .on_click(cx.listener(|shell, _, _, cx| shell.delete_role(cx))),
            )
        })
        .when(page.dirty, |toolbar| {
            toolbar.child(
                Button::new("role-save", t!("Save changes"))
                    .emphasis(Emphasis::Contained)
                    .size(Size::Compact)
                    .height(33.1)
                    .on_click(cx.listener(|shell, _, _, cx| shell.save_roles_page(cx))),
            )
        });
    let taken = Tab::ALL.iter().position(|tab| *tab == page.tab).unwrap_or(0);
    let tabs = div()
        .mb(px(16.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            IconButton::new("role-back", "arrow-left")
                .size(25.0)
                .glyph_size(15.0)
                .on_click(cx.listener(|shell, _, _, cx| shell.leave_role(cx))),
        )
        .child(
            Segmented::new("role-tab", Tab::ALL.map(Tab::name), taken).on_choose(cx.listener(
                |shell, at: &usize, _, cx| {
                    if let Some(tab) = Tab::ALL.get(*at) {
                        shell.role_tab(*tab, cx);
                    }
                },
            )),
        );
    let body = match (page.acl.as_ref(), role) {
        (None, _) => Empty::new(t!("Loading role...")).into_any_element(),
        (Some(_), None) => Empty::new(t!("Role {{name}} not found.", name = name)).into_any_element(),
        (Some(_), Some(role)) => match page.tab {
            Tab::Display => super::role_display::render(page, role, budget, theme, cx),
            Tab::Permissions => super::role_grants::render(page, role, theme, cx),
            Tab::Members => super::role_members::render(page, role, theme, cx),
        },
    };
    div()
        .child(
            PageTitle::new(t!("Role: {{name}}", name = name))
                .below(20.0)
                .action(toolbar),
        )
        .child(tabs)
        .child(body)
        .into_any_element()
}
