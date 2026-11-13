//! The band across the top of the window: the brand, and the window's own
//! controls, since the window draws its own frame.

use gpui::{
    Context, Hsla, IntoElement, MouseButton, ParentElement, Styled, Window, div, prelude::*, px,
};

use super::Shell;
use super::frame;
use super::widgets::{EMPHASIS, icon, label, opaque};
use crate::theme::Theme;

/// The band's height, as the web UI draws it.
const HEIGHT: f32 = 44.0;

pub(super) fn render(
    theme: &Theme,
    window: &Window,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    div()
        .id("band")
        .flex_none()
        .h(px(HEIGHT))
        .flex()
        .items_center()
        .justify_between()
        .pl(px(14.0))
        .pr(px(8.0))
        .bg(theme.c.bar)
        .text_color(theme.c.bar_text)
        // The band is the window's handle: drag to move, double-click to zoom.
        .on_mouse_down(MouseButton::Left, |event, window, _| {
            if event.click_count == 2 {
                window.zoom_window();
            } else {
                window.start_window_move();
            }
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(10.0))
                .child(brand_mark(theme))
                .child(
                    div()
                        .font_weight(EMPHASIS)
                        .child(label("Fancy Mumble", theme)),
                ),
        )
        .child(controls(theme.c.bar_dim, theme, window, cx))
}

/// The window's controls on their own, for a theme that draws no band: they
/// float over the window's top trailing corner instead.
pub(super) fn corner_controls(
    theme: &Theme,
    window: &Window,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    div()
        .absolute()
        .top(px(4.0))
        .right(px(6.0))
        .occlude()
        .rounded(theme.skin.radius_md)
        .bg(opaque(theme.c.header, theme.c.bg0))
        .child(controls(theme.c.muted, theme, window, cx))
}

/// The theme picker's button, then - where the window draws its own frame -
/// minimise, maximise and close. A window the system frames already has
/// those three, and a second set would be a second way to be wrong.
fn controls(
    ink: Hsla,
    theme: &Theme,
    window: &Window,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    div()
        .flex()
        .items_center()
        .gap(px(2.0))
        .child(
            control("themes", "palette", ink, theme)
                .on_click(cx.listener(|shell, _, _, cx| shell.toggle_picker(cx))),
        )
        .when(frame::is_client_decorated(window), |controls| {
            controls
                .child(
                    control("minimise", "minus", ink, theme)
                        .on_click(|_, window, _| window.minimize_window()),
                )
                .child(
                    control("maximise", "square", ink, theme)
                        .on_click(|_, window, _| window.zoom_window()),
                )
                .child(control("close", "x", ink, theme).on_click(|_, _, cx| cx.quit()))
        })
}

/// The round brand mark at the band's leading edge.
fn brand_mark(theme: &Theme) -> impl IntoElement + use<> {
    div()
        .flex_none()
        .size(px(22.0))
        .rounded_full()
        .bg(theme.c.accent)
        .flex()
        .items_center()
        .justify_center()
        // The monogram is wider than it is tall: 1391 by 844.
        .child(
            gpui::svg()
                .path("icons/brand.svg")
                .w(px(15.0))
                .h(px(9.1))
                .text_color(theme.c.on_accent),
        )
}

/// One of the band's buttons.
fn control(
    id: &'static str,
    glyph: &'static str,
    color: Hsla,
    theme: &Theme,
) -> gpui::Stateful<gpui::Div> {
    let hover = theme.c.hover;
    div()
        .id(id)
        .debug_selector(|| id.to_owned())
        .size(px(28.0))
        .rounded(theme.skin.radius_sm)
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        // A press on a control is not a drag of the window.
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .child(icon(glyph, 15.0, color))
}
