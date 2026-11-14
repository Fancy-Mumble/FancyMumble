//! The Users page as it is drawn: its title with the search and the way to
//! read the list again, the table of accounts, how many are shown, and the
//! dialogs its menu opens.

use std::ops::Range;

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, Window, div, prelude::*,
    px,
};

use super::super::Shell;
use super::super::kit::table::{Cell, Table};
use super::super::kit::{
    Button, Dialog, Emphasis, Empty, PageTitle, Reachable, RolePill, SearchField, Size, TickBox,
    Tone,
};
use super::roles::Managing;
use super::users::{Users, cells, columns, now_ms};
use crate::theme::Theme;
use crate::words::t;

/// How tall the toolbar's field is, and the button beside it with it.
const TOOLBAR: f32 = 47.0;

/// The page.
pub(super) fn render(users: &Users, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let toolbar = div()
        .flex()
        .gap(px(6.0))
        .child(SearchField::new(users.search.clone()).width(220.0))
        .child(refresh(users.loading, cx));
    let body = if users.shown.is_empty() {
        let says = if users.loading {
            t!("Loading...")
        } else if users.accounts.is_empty() {
            t!("No registered users")
        } else {
            t!("No matching users")
        };
        Empty::new(says).into_any_element()
    } else {
        Table::new(
            "users",
            columns(users.sort),
            &users.widths,
            users.shown.len(),
            cx.processor(rows),
        )
        .on_sort(cx.listener(|shell, at: &usize, _, cx| shell.sort_users(*at, cx)))
        .on_chip(
            "users-role",
            cx.listener(|shell, (row, at): &(usize, usize), _, cx| {
                shell.open_role_of_row(*row, *at, cx);
            }),
        )
        .on_menu(
            "users-menu",
            cx.listener(
                |shell, (row, at): &(usize, gpui::Point<gpui::Pixels>), _, cx| {
                    shell.open_account_menu(*row, *at, cx);
                },
            ),
        )
        .into_any_element()
    };
    let total = users.accounts.len();
    div()
        .id("admin-users")
        .flex_1()
        .min_h_0()
        .flex()
        .flex_col()
        .child(
            PageTitle::new(t!("Registered Users"))
                .below(20.0)
                .action(toolbar),
        )
        .child(body)
        .child(
            div()
                .flex_none()
                .mt(px(10.0))
                .text_size(px(11.0))
                .text_color(theme.c.dim)
                .child(t!(
                    "{{filtered}} of {{total}} user",
                    "{{filtered}} of {{total}} users",
                    count = total,
                    filtered = users.shown.len(),
                    total = total
                )),
        )
        .into_any_element()
}

/// The button that reads the list again: saying so while it is read.
fn refresh(loading: bool, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let button = Button::new(
        "users-refresh",
        if loading {
            t!("Loading...")
        } else {
            t!("Refresh")
        },
    )
    .emphasis(Emphasis::Outlined)
    .size(Size::Compact)
    .height(TOOLBAR);
    if loading {
        button
    } else {
        button.on_click(cx.listener(|shell, _, _, cx| shell.refresh_users(cx)))
    }
}

/// The cells of the rows in `range`: the name in a field for the row being
/// renamed.
fn rows(
    shell: &mut Shell,
    range: Range<usize>,
    _: &mut Window,
    cx: &mut Context<Shell>,
) -> Vec<Vec<Cell>> {
    let roles = shell.engine.roles();
    let now = now_ms();
    let Some(users) = shell.users_page() else {
        return Vec::new();
    };
    range
        .filter_map(|row| {
            let account = users.at_row(row)?;
            let mut cells = cells(account, &shell.snapshot, &roles, now);
            if let Some(renaming) = users
                .renaming
                .as_ref()
                .filter(|renaming| renaming.id == account.id)
            {
                cells[0] = Cell::Own(renaming_field(renaming.field.clone(), cx));
            }
            Some(cells)
        })
        .collect()
}

/// The field a name is changed in, with its Save and its Cancel.
fn renaming_field(
    field: gpui::Entity<super::super::text_input::TextInput>,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let theme = crate::theme::ActiveTheme::get(cx);
    div()
        .flex()
        .items_center()
        .gap(px(6.0))
        .child(
            div()
                .w(px(180.0))
                .h(px(30.0))
                .px(px(10.0))
                .flex()
                .items_center()
                .rounded(theme.skin.radius_md)
                .bg(theme.c.input)
                .border_1()
                .border_color(theme.c.line2)
                .text_size(px(12.0))
                .child(field),
        )
        .child(
            Button::new("rename-save", t!("Save"))
                .emphasis(Emphasis::Contained)
                .size(Size::Compact)
                .height(30.0)
                .on_click(cx.listener(|shell, _, _, cx| shell.finish_renaming_account(cx))),
        )
        .child(
            Button::new("rename-cancel", t!("Cancel"))
                .size(Size::Compact)
                .height(30.0)
                .on_click(cx.listener(|shell, _, _, cx| shell.stop_renaming_account(cx))),
        )
        .into_any_element()
}

/// The dialog open over the page, if one is.
pub(super) fn dialogs(
    shell: &Shell,
    users: &Users,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<AnyElement> {
    if let Some(managing) = users.managing.as_ref() {
        let roles = shell.engine.roles();
        return Some(roles_dialog(managing, users, &roles, theme, cx));
    }
    let id = users.unregistering?;
    let name = users.account(id).map(|account| account.name.clone())?;
    Some(
        Dialog::new("unregister")
            .w(px(444.0))
            .gap(px(14.0))
            .p(px(22.0))
            .title(t!("Unregister user"))
            .child(
                div()
                    .text_size(px(12.5))
                    .child(t!("Unregister \"{{name}}\"? This permanently deletes all of their data on this server - registration, comment, avatar and role/ACL memberships. This cannot be undone.", name = name)),
            )
            .child(actions(
                Button::new("unregister-cancel", t!("Cancel"))
                    .on_click(cx.listener(|shell, _, _, cx| {
                        if let Some(users) = shell.users_page_mut() {
                            users.unregistering = None;
                        }
                        cx.notify();
                    })),
                Button::new("unregister-confirm", t!("Unregister"))
                    .emphasis(Emphasis::Contained)
                    .tone(Tone::Danger)
                    .on_click(cx.listener(|shell, _, _, cx| shell.confirm_unregister(cx))),
            ))
            .into_any_element(),
    )
}

/// A dialog's two buttons, at its end.
fn actions(cancel: Button, confirm: Button) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .justify_end()
        .gap(px(8.0))
        .child(cancel)
        .child(confirm)
}

/// The dialog choosing which roles an account holds.
fn roles_dialog(
    managing: &Managing,
    users: &Users,
    roles: &[crate::engine::Role],
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let lines = managing.lines(users.roots.as_ref());
    let body = if !managing.loaded() {
        quiet(t!("Loading roles..."), theme).into_any_element()
    } else if lines.is_empty() {
        quiet(t!("No roles defined on this server."), theme).into_any_element()
    } else {
        div()
            .flex()
            .flex_col()
            .gap(px(2.0))
            .children(lines.into_iter().map(|line| {
                let colour = roles
                    .iter()
                    .find(|role| role.name == line.name)
                    .and_then(|role| role.color);
                role_line(line, colour, theme, cx)
            }))
            .into_any_element()
    };
    let save = Button::new("roles-save", t!("Save")).emphasis(Emphasis::Contained);
    let save = if managing.dirty() {
        save.on_click(cx.listener(|shell, _, _, cx| shell.save_roles(cx)))
    } else {
        save
    };
    Dialog::new("roles")
        .w(px(444.0))
        .gap(px(14.0))
        .p(px(22.0))
        .title(t!("Manage roles for {{name}}", name = managing.name))
        .child(body)
        .child(actions(
            Button::new("roles-cancel", t!("Cancel"))
                .on_click(cx.listener(|shell, _, _, cx| shell.close_roles(cx))),
            save,
        ))
        .into_any_element()
}

/// Words in the muted ink, where a list would be.
fn quiet(words: SharedString, theme: &Theme) -> gpui::Div {
    div()
        .text_size(px(12.0))
        .text_color(theme.c.muted)
        .child(words)
}

/// One role in the dialog: its tick box, its pill, and whether it is held
/// only by way of a parent channel.
fn role_line(
    line: super::roles::Line,
    colour: Option<gpui::Hsla>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let id = SharedString::from(format!("role-{}", line.name));
    let fixed = line.inherited_only && !line.ticked;
    let role = line.name.clone();
    let selector = id.clone();
    let hover = theme.c.hover;
    let row = div()
        .id(gpui::ElementId::Name(id.clone()))
        .debug_selector(move || selector.to_string())
        .h(px(32.0))
        .px(px(6.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .rounded(theme.skin.radius_md)
        .when(fixed, |row| row.opacity(0.5))
        .when(!fixed, |row| {
            row.cursor_pointer()
                .hover(move |style| style.bg(hover))
                .on_click(cx.listener(move |shell, _, _, cx| shell.toggle_role(&role, cx)))
        })
        .child(TickBox::new(line.ticked))
        .child(RolePill::new(line.name, colour))
        .when(line.inherited_only, |row| {
            row.child(
                div()
                    .text_size(px(11.0))
                    .text_color(theme.c.dim)
                    .child(t!("(inherited)")),
            )
        });
    Reachable::new(gpui::ElementId::Name(id), row)
}
