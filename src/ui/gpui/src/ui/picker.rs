//! The theme picker: every theme of the catalogue, and the light/dark choice.

use gpui::{Context, IntoElement, ParentElement, Styled, div, prelude::*, px};

use super::Shell;
use super::widgets::{EMPHASIS, icon, label, opaque};
use crate::theme::{ActiveTheme, Catalog, Mode, Theme, ThemeEntry};

pub(super) fn render(theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let entries = Catalog::get().entries(theme.mode);
    let light = theme.mode == Mode::Light;
    div()
        .id("theme-picker")
        .absolute()
        .top(px(48.0))
        .right(px(10.0))
        .w(px(250.0))
        .occlude()
        .flex()
        .flex_col()
        .gap(px(2.0))
        .p(px(8.0))
        .rounded(theme.skin.radius_lg)
        .bg(opaque(theme.c.card, theme.c.bg0))
        .border_1()
        .border_color(theme.c.line2)
        .shadow_lg()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .px(px(8.0))
                .py(px(6.0))
                .child(div().font_weight(EMPHASIS).child(label("Theme", theme)))
                .child(mode_switch(light, theme, cx)),
        )
        .children(entries.into_iter().map(|entry| theme_row(entry, theme, cx)))
}

/// The light/dark switch in the picker's heading.
fn mode_switch(light: bool, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    div()
        .id("mode")
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
        .on_click(cx.listener(|shell, _, _, cx| shell.toggle_mode(cx)))
        .child(icon(
            if light { "sun" } else { "moon" },
            13.0,
            theme.c.muted,
        ))
        .child(if light { "Light" } else { "Dark" })
}

fn theme_row(
    entry: ThemeEntry,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let current = entry.id == theme.id;
    let hover = theme.c.hover;
    let mode = theme.mode;
    let id = entry.id.clone();
    div()
        .id(entry.id.clone())
        .h(px(32.0))
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(8.0))
        .rounded(theme.skin.radius_md)
        .cursor_pointer()
        .when(current, |row| row.bg(theme.c.accent_soft))
        .when(!current, |row| row.hover(move |style| style.bg(hover)))
        .on_click(cx.listener(move |_, _, _, cx| ActiveTheme::set(&id, mode, cx)))
        .child(
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
        .child(div().flex_1().child(entry.name))
        .when(current, |row| {
            row.child(icon("check", 13.0, theme.c.accent_text))
        })
}
