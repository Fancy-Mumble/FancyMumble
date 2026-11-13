//! The theme picker: every theme of the catalogue, and the light/dark choice.

use gpui::{Context, IntoElement, ParentElement, Styled, div, prelude::*, px};

use super::Shell;
use super::kit::{MenuItem, Sheet};
use super::widgets::{EMPHASIS, icon, label};
use crate::theme::{Catalog, Mode, Theme, ThemeEntry};

pub(super) fn render(theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let entries = Catalog::get().entries(theme.mode);
    let light = theme.mode == Mode::Light;
    Sheet::new("theme-picker")
        .absolute()
        .top(px(48.0))
        .right(px(10.0))
        .w(px(250.0))
        .flex()
        .flex_col()
        .gap(px(2.0))
        .p(px(8.0))
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
