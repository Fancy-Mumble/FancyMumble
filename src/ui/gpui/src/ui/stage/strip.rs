//! The other feeds, in a strip down the side of the stage: each at the
//! size of its tile and five frames a second, a camera beside its screen.
//! A click shows one large; the one large, or one in its own window, is
//! named here and not drawn twice.

use gpui::{
    AnyElement, Context, MouseButton, MouseDownEvent, ParentElement, Styled, div, hsla, prelude::*, px,
};

use super::super::Shell;
use super::large::feed_video;
use super::view::{Feed, WELL, kind_of, name_of};
use crate::theme::Theme;
use crate::words::t;

/// How wide the strip is.
const RAIL: f32 = 116.0;
/// How tall each tile in it is.
const TILE: f32 = 68.0;
/// The frames a second a tile is wanted at.
const SMALL_RATE: u32 = 5;

/// The strip.
pub(super) fn strip(
    shell: &Shell,
    feeds: &[Feed],
    focused: Option<&Feed>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let tiles: Vec<AnyElement> = feeds
        .iter()
        .enumerate()
        .map(|(at, feed)| tile(shell, feed, at, focused == Some(feed), theme, cx))
        .collect();
    crate::ui::kit::ScrollArea::div("stage-strip", div()
        .id("stage-strip")
        .debug_selector(|| "stage-strip".to_owned())
        .w(px(RAIL))
        .flex_none()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .overflow_y_scroll()
        .children(tiles))
        .into_any_element()
}

/// One feed in the strip.
fn tile(shell: &Shell, feed: &Feed, at: usize, large: bool, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let (session, camera) = (feed.session(), feed.camera);
    let popped = shell.stage.popped_feed() == Some((session, camera));
    let badge = match (popped, kind_of(shell, feed)) {
        (true, _) => t!("OUT"),
        (false, "camera") => "CAM".into(),
        (false, "window") => "WIN".into(),
        _ => "SCR".into(),
    };
    let fit = shell.stage.shares.fit;
    let track = shell
        .stage
        .feeds
        .get(&session)
        .and_then(|watched| watched.track(camera));
    div()
        .id(("stage-tile", at))
        .debug_selector(move || format!("stage-tile-{at}"))
        .flex_none()
        .w_full()
        .h(px(TILE))
        .relative()
        .rounded(theme.skin.radius_md)
        .bg(WELL)
        .overflow_hidden()
        .border_1()
        .border_color(if large { theme.c.accent } else { theme.c.line2 })
        .cursor_pointer()
        // The large one is drawn there, and one in its own window there:
        // here it is only named.
        .when(!large && !popped, |tile| {
            tile.children(track.map(|track| feed_video(track, fit, (0.0, 0.0), SMALL_RATE)))
        })
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.show_large(session, camera);
            cx.notify();
        }))
        .on_mouse_down(
            MouseButton::Right,
            cx.listener(move |shell, event: &MouseDownEvent, _, cx| {
                shell.open_stage_menu(session, camera, event.position, cx);
            }),
        )
        .child(
            div()
                .absolute()
                .bottom(px(4.0))
                .left(px(4.0))
                .px(px(5.0))
                .rounded(theme.skin.radius_sm)
                .bg(hsla(0.61, 0.38, 0.05, 0.75))
                .text_size(px(9.0))
                .text_color(gpui::white())
                .child(name_of(shell, &feed.each)),
        )
        .child(
            div()
                .absolute()
                .top(px(4.0))
                .right(px(4.0))
                .text_size(px(8.5))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .text_color(if camera { theme.c.ok } else { hsla(0.6, 0.12, 0.73, 1.0) })
                .child(badge),
        )
        .into_any_element()
}
