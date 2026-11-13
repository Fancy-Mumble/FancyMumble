//! The band across the top of the window: the brand, where you are, and
//! the window's own controls, since the window draws its own frame.

use gpui::{
    IntoElement, MouseButton, ParentElement, SharedString, Styled, Window, div, prelude::*, px,
};

use super::Shell;
use super::frame;
use super::kit::{IconButton, Tone};
use super::widgets::{EMPHASIS, label, opaque};
use crate::theme::Theme;

/// The band's height, its hairline included, as the web UI draws it.
const HEIGHT: f32 = 44.0;

pub(super) fn render(shell: &Shell, theme: &Theme, window: &Window) -> impl IntoElement + use<> {
    // The server on screen, named in the middle of the band.
    let place = shell
        .snapshot
        .sessions
        .iter()
        .find(|session| session.active && !shell.shows_connect_screen())
        .map(|session| session.name.clone());
    div()
        .id("band")
        .flex_none()
        .h(px(HEIGHT))
        .relative()
        .flex()
        .items_center()
        .justify_between()
        .px(px(14.0))
        .bg(theme.c.bar)
        .border_b_1()
        .border_color(theme.c.line)
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
                        .text_size(px(13.0))
                        .font_weight(EMPHASIS)
                        .child(label("Fancy Mumble", theme)),
                ),
        )
        .when_some(place, |band, place| band.child(centred(&place, theme)))
        .child(controls(Tone::Bar, window))
}

/// `name` in the middle of the band, whatever stands at its two ends.
fn centred(name: &SharedString, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .debug_selector(|| "band-place".to_owned())
                .text_size(px(12.5))
                .font_weight(EMPHASIS)
                .child(label(name, theme)),
        )
}

/// The window's controls on their own, for a theme that draws no band: they
/// float over the window's top trailing corner instead.
pub(super) fn corner_controls(theme: &Theme, window: &Window) -> impl IntoElement + use<> {
    div()
        .absolute()
        .top(px(4.0))
        .right(px(6.0))
        .occlude()
        .p(px(4.0))
        .rounded(theme.skin.radius_md)
        .bg(opaque(theme.c.header, theme.c.bg0))
        .child(controls(Tone::Muted, window))
}

/// Minimise, maximise and close, where the window draws its own frame. A
/// window the system frames already has those three, and a second set would
/// be a second way to be wrong.
fn controls(tone: Tone, window: &Window) -> impl IntoElement + use<> {
    let control = |id, glyph, side: f32| {
        IconButton::new(id, glyph)
            .size(side)
            .glyph_size(side - 10.0)
            .tone(tone)
    };
    div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .when(frame::is_client_decorated(window), |controls| {
            controls
                .child(
                    control("minimise", "minus", 23.0)
                        .on_click(|_, window, _| window.minimize_window()),
                )
                .child(
                    control("maximise", "square", 21.0)
                        .on_click(|_, window, _| window.zoom_window()),
                )
                .child(control("close", "x", 23.0).on_click(|_, _, cx| cx.quit()))
        })
}

/// The round brand mark at the band's leading edge.
fn brand_mark(theme: &Theme) -> impl IntoElement + use<> {
    div()
        .flex_none()
        .size(px(22.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.accent)
        .flex()
        .items_center()
        .justify_center()
        // The monogram is wider than it is tall: 1391 by 844.
        .child(
            gpui::svg()
                .path("icons/brand.svg")
                .w(px(15.8))
                .h(px(9.6))
                .text_color(theme.c.on_accent),
        )
}
