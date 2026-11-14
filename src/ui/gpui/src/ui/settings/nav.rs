//! The column of the settings: the way back, the search over the pages,
//! and an entry for each page under the heading the web UI gives them.
//!
//! The web UI's `SidebarShell` with a back link and a search, filled with
//! `SettingsNav`.

use gpui::{
    Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px, relative,
};

use super::super::Shell;
use super::super::kit::{LINE, Reachable};
use super::super::widgets::{EMPHASIS, icon};
use super::{Page, search};
use crate::theme::Theme;
use crate::words::t;

/// The column.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let open = shell.panels.settings.page;
    div()
        .flex_none()
        .w(theme.skin.column_width)
        .h_full()
        .flex()
        .flex_col()
        .bg(theme.c.panel)
        .border_r_1()
        .border_color(theme.c.line)
        .line_height(relative(LINE))
        .child(back(theme, cx))
        .child(
            div()
                .flex_none()
                // Where the theme plates the column, the room the channel
                // column's search has there too.
                .map(|around| {
                    if theme.skin.marks.column_plate {
                        around.px(px(18.0)).pt(px(16.0)).pb(px(10.0))
                    } else {
                        around.px(px(12.0)).pt(px(12.0)).pb(px(6.0))
                    }
                })
                .child(search_box(shell, theme))
                .children(search::results(shell, theme, cx)),
        )
        .child(
            div()
                .id("settings-pages")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .pb(px(10.0))
                .child(heading(&t!("SETTINGS"), 10.0, theme))
                .child(
                    div()
                        .px(px(10.0))
                        .flex()
                        .flex_col()
                        .gap(px(1.0))
                        .children(Page::ALL.map(|page| entry(page, page == open, theme, cx))),
                )
                .children(administration(shell, theme, cx)),
        )
}

/// A heading of the column, the web UI's `SectionLabel`: in the theme's
/// voice for headings, with its dashed rule out to the edge where the theme
/// draws one; elsewhere an overline, its capitals spaced a tenth apart.
fn heading(label: &str, above: f32, theme: &Theme) -> impl IntoElement + use<> {
    let rule = super::super::kit::heading_rule(theme);
    let words = if rule.is_some() {
        super::super::kit::voiced(label, super::super::kit::Role::Heading, 10.5, theme)
    } else {
        super::super::kit::spaced(&label.to_uppercase(), 1.05).into_any_element()
    };
    div()
        .flex()
        .items_center()
        .gap(px(10.0))
        .child(
            div()
                .flex_none()
                .px(px(16.0))
                .pt(px(above))
                .pb(px(6.0))
                .text_size(px(10.5))
                .line_height(px(14.7))
                .font_weight(EMPHASIS)
                .text_color(theme.c.dim)
                .child(words),
        )
        .children(rule)
}

/// What the server lets the user look after, as the web UI lists it under
/// its own heading: each opens the panel this client has for it, over the
/// page.
fn administration(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<impl IntoElement + use<>> {
    let entries = admin_entries(shell);
    if entries.is_empty() {
        return None;
    }
    Some(
        div()
            .child(heading(&t!("SERVER ADMIN"), 16.0, theme))
            .child(
                div()
                    .px(px(10.0))
                    .flex()
                    .flex_col()
                    .gap(px(1.0))
                    .children(entries.into_iter().map(|admin| admin.entry(theme, cx))),
            ),
    )
}

/// What the server lets the user look after, in the column's order.
fn admin_entries(shell: &Shell) -> Vec<Admin> {
    use crate::engine::Listing;
    use crate::rights::Right;
    let root = shell.root_rights();
    let channel = shell
        .snapshot
        .current_channel
        .and_then(|id| {
            shell
                .snapshot
                .channels
                .iter()
                .find(|channel| channel.id == id)
        })
        .filter(|channel| channel.rights.may(Right::WRITE))
        .map(|channel| channel.id);
    let mut entries = Vec::new();
    if root.has(Right::REGISTER) {
        entries.push(Admin::Listing(
            "admin-users",
            t!("Users"),
            Listing::Registered,
        ));
    }
    if root.has(Right::BAN) {
        entries.push(Admin::Listing("admin-bans", t!("Ban List"), Listing::Bans));
    }
    if let Some(channel) = channel {
        entries.push(Admin::Channel(t!("Channels / ACL"), channel));
    }
    entries
}

impl Shell {
    /// Whether the server lets the user look after anything.
    pub(in crate::ui) fn may_administer(&self) -> bool {
        !admin_entries(self).is_empty()
    }

    /// Open the settings on what the column's administration lists first,
    /// as the web UI's "Server admin" opens them on its first page.
    pub(in crate::ui) fn administer(&mut self, cx: &mut Context<Self>) {
        let Some(first) = admin_entries(self).into_iter().next() else {
            return;
        };
        self.open_settings(cx);
        first.open(self, cx);
    }
}

/// An entry of the administration.
enum Admin {
    /// One of the server's lists.
    Listing(&'static str, SharedString, crate::engine::Listing),
    /// The permissions of the channel the user is in.
    Channel(SharedString, crate::engine::ChannelId),
}

impl Admin {
    /// Open the panel this client has for it.
    fn open(&self, shell: &mut Shell, cx: &mut Context<Shell>) {
        match self {
            Self::Listing(_, _, listing) => shell.open_admin(*listing, cx),
            Self::Channel(_, channel) => shell.open_acl(*channel, cx),
        }
    }

    fn entry(self, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
        let (id, name) = match &self {
            Self::Listing(id, name, _) => (*id, name.clone()),
            Self::Channel(name, _) => ("admin-acl", name.clone()),
        };
        let button =
            row(id.into(), name, false, theme).on_click(cx.listener(move |shell, _, _, cx| {
                self.open(shell, cx);
            }));
        Reachable::new(id, button)
    }
}

/// The way back to where the settings were opened from.
fn back(theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let (muted, text) = (theme.c.muted, theme.c.text);
    let link = div()
        .id("settings-close")
        .debug_selector(|| "settings-close".to_owned())
        .flex_none()
        .px(px(16.0))
        .pt(px(14.0))
        .pb(px(4.0))
        .text_size(px(12.0))
        .text_color(muted)
        .cursor_pointer()
        .hover(move |style| style.text_color(text))
        .on_click(cx.listener(|shell, _, _, cx| shell.close_settings(cx)))
        .child(SharedString::from(format!("‹ {}", t!("Back"))));
    Reachable::new("settings-close", link)
}

/// The field the pages are searched from.
fn search_box(shell: &Shell, theme: &Theme) -> impl IntoElement + use<> {
    use crate::theme::Kind;
    let finish = super::super::kit::Finish::new(theme.c.input, Some(theme.c.line2));
    // 45 pixels inside its edge: a plate the theme cuts draws its edge
    // within that, a box around it.
    let cut = theme.skin.cuts.of(Kind::Plate).is_some();
    div()
        .h(px(if cut { 45.0 } else { 47.0 }))
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(14.0))
        .map(|field| {
            super::super::kit::shaped(field, Kind::Plate, finish, theme.skin.radius_lg, theme)
        })
        .text_size(px(12.5))
        .child(icon("search", 12.0, theme.c.dim).mt(px(-1.0)))
        .children(
            shell
                .panels
                .settings
                .search
                .as_ref()
                .map(|search| search.field.clone()),
        )
}

/// The entry of `page` in the column, washed in the accent while it is the
/// page on show.
fn entry(
    page: Page,
    open: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let id = SharedString::from(format!("settings-{}", page.id()));
    let button = row(id.clone(), page.name(), open, theme)
        .on_click(cx.listener(move |shell, _, _, cx| shell.turn_to(page, cx)));
    Reachable::new(id, button)
}

/// An entry of the column, washed in the accent while `open`.
fn row(
    id: SharedString,
    name: SharedString,
    open: bool,
    theme: &Theme,
) -> gpui::Stateful<gpui::Div> {
    let hover = theme.c.hover;
    let selector = id.clone();
    div()
        .id(id)
        .debug_selector(move || selector.to_string())
        .px(px(12.0))
        .py(px(8.0))
        .rounded(theme.skin.radius_md)
        // The theme's own weight of line: two pixels in a drawn skin.
        .map(|row| edged(row, theme.skin.line_width))
        .text_size(px(12.5))
        .cursor_pointer()
        .map(|button| {
            if open {
                button
                    .bg(theme.c.accent_soft)
                    .border_color(theme.c.accent_line)
                    .font_weight(EMPHASIS)
                    .text_color(theme.c.text)
            } else {
                button
                    .border_color(gpui::transparent_black())
                    .text_color(theme.c.muted)
                    .hover(move |style| style.bg(hover))
            }
        })
        .child(name)
}

/// `row` with an edge `width` wide on every side.
fn edged(mut row: gpui::Stateful<gpui::Div>, width: gpui::Pixels) -> gpui::Stateful<gpui::Div> {
    let width = gpui::AbsoluteLength::Pixels(width);
    let edges = &mut row.style().border_widths;
    edges.top = Some(width);
    edges.right = Some(width);
    edges.bottom = Some(width);
    edges.left = Some(width);
    row
}
