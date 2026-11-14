//! A heading lit for a moment, where the settings search sent the reader:
//! washed in the accent with the wash spread round it, as the web UI
//! flashes one; and where it was drawn, for the page to be scrolled to it.

use gpui::{
    App, Bounds, BoxShadow, Div, Global, ParentElement, Pixels, Styled, canvas, div, point, px,
};

use crate::theme::ActiveTheme;

/// Where the heading lit last was drawn, until the page has been scrolled
/// to it.
#[derive(Default)]
pub(crate) struct LitAt(pub Option<Bounds<Pixels>>);

impl Global for LitAt {}

/// `heading`, lit if `on`.
pub(crate) fn lit(heading: Div, on: bool, cx: &App) -> Div {
    if !on {
        return heading;
    }
    let theme = ActiveTheme::get(cx);
    let wash = theme.c.accent_soft;
    heading
        .relative()
        .bg(wash)
        .rounded(px(2.0))
        .shadow(vec![BoxShadow {
            color: wash,
            offset: point(px(0.0), px(0.0)),
            blur_radius: px(0.0),
            spread_radius: px(6.0),
        }])
        .child(
            div().absolute().top_0().left_0().size_full().child(
                canvas(
                    |bounds, _, cx| cx.set_global(LitAt(Some(bounds))),
                    |_, (), _, _| {},
                )
                .size_full(),
            ),
        )
}

/// Where the heading lit last was drawn, taken: the page is scrolled to it
/// once.
pub(crate) fn take_lit(cx: &mut App) -> Option<Bounds<Pixels>> {
    if !cx.has_global::<LitAt>() {
        return None;
    }
    cx.global_mut::<LitAt>().0.take()
}
