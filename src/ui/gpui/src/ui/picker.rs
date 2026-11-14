//! The theme picker: every theme of the catalogue, and the light/dark choice.

use gpui::{Context, IntoElement, ParentElement, Styled, div, prelude::*, px};

use super::Shell;
use super::kit::{MenuItem, Sheet};
use super::widgets::{EMPHASIS, icon, label};
use crate::theme::{Catalog, Mode, Theme, ThemeEntry};
use crate::words::t;

pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    Sheet::new("theme-picker")
        .absolute()
        .top(px(48.0))
        .right(px(10.0))
        .w(px(250.0))
        .p(px(8.0))
        .child(body(shell, theme, cx))
}

/// What the picker holds, as a column: the light/dark choice and every
/// theme. The settings page shows the same.
pub(super) fn body(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> gpui::Div {
    let entries = Catalog::get().entries(theme.mode);
    let chosen = if shell.follows_system() {
        ("monitor", t!("Match system"))
    } else if theme.mode == Mode::Light {
        ("sun", t!("Light"))
    } else {
        ("moon", t!("Dark"))
    };
    div()
        .flex()
        .flex_col()
        .gap(px(2.0))
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .px(px(8.0))
                .py(px(6.0))
                .child(div().font_weight(EMPHASIS).child(label(&t!("Theme"), theme)))
                .child(mode_switch(chosen, theme, cx)),
        )
        .children(entries.into_iter().map(|entry| theme_row(entry, theme, cx)))
}

/// The switch in the picker's heading, which says which of dark, light
/// and the system's own is `chosen`, by its icon and its name, and goes to
/// the next.
fn mode_switch(
    (drawn, says): (&'static str, gpui::SharedString),
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    let switch = div()
        .id("mode")
        .debug_selector(|| "mode".to_owned())
        .flex()
        .items_center()
        .gap(px(6.0))
        .px(px(8.0))
        .py(px(4.0))
        .rounded(theme.skin.radius_sm)
        .cursor_pointer()
        .text_size(px(12.0))
        .text_color(theme.c.muted)
        .hover(move |style| style.bg(hover))
        .on_click(cx.listener(|shell, _, window, cx| shell.next_mode(window, cx)))
        .child(icon(drawn, 13.0, theme.c.muted))
        .child(says);
    super::kit::Reachable::new("mode", switch).corner(theme.skin.radius_sm)
}

fn theme_row(
    entry: ThemeEntry,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let current = entry.id == theme.id;
    let mode = theme.mode;
    let id = entry.id.clone();
    MenuItem::new(entry.id.clone(), entry.name)
        .selector(format!("theme-{}", entry.id))
        .height(32.0)
        .selected(current)
        .ticked(current)
        .lead(
            div()
                .flex()
                .rounded(theme.skin.radius_sm)
                .overflow_hidden()
                .border_1()
                .border_color(theme.c.line2)
                .children(
                    entry
                        .swatches
                        .into_iter()
                        .map(|swatch| div().w(px(12.0)).h(px(16.0)).bg(swatch)),
                ),
        )
        .on_click(cx.listener(move |shell, _, _, cx| shell.set_theme(&id, mode, cx)))
}
