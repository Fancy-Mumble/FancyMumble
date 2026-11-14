//! The feed shown large: its picture, what is drawn on it, its caption,
//! its controls (fit, sound, copy, drawing, menu, whole window, stop), and
//! the statistics. A feed in its own window is said to be there, with the
//! way to bring it back.

use std::sync::Arc;

use gpui::{
    AnyElement, Context, IntoElement, KeyDownEvent, MouseButton, MouseDownEvent, MouseMoveEvent,
    ParentElement, ScrollWheelEvent, Styled, Window, div, hsla, prelude::*, px,
};

use super::super::Shell;
use super::super::kit::{Button, IconButton, Reachable, Segmented, Slider, Variant};
use super::view::{Feed, WELL, kind_of, name_of};
use super::{Track, Watched, drawing, screen, stats};
use crate::share::Fit;
use crate::share::shares::Whose;
use crate::theme::Theme;
use crate::words::t;

/// The frames a second a large feed is wanted at.
const LARGE_RATE: u32 = 30;

/// The feed in focus, large, with everything over it.
pub(super) fn large(shell: &Shell, feed: &Feed, theme: &Theme, window: &Window, cx: &mut Context<Shell>) -> AnyElement {
    let session = feed.session();
    let camera = feed.camera;
    let Some(watched) = shell.stage.feeds.get(&session) else {
        return div().flex_1().into_any_element();
    };
    let track = watched.track(camera).unwrap_or_else(|| watched.main());
    let popped = shell.stage.popped_feed() == Some((session, camera));
    let well = div()
        .id("stage-large")
        .debug_selector(|| "stage-large".to_owned())
        .flex_1()
        .min_w_0()
        .h_full()
        .relative()
        .rounded(theme.skin.radius_md)
        .bg(WELL)
        .overflow_hidden()
        .on_mouse_down(
            MouseButton::Right,
            cx.listener(move |shell, event: &MouseDownEvent, _, cx| {
                shell.open_stage_menu(session, camera, event.position, cx);
            }),
        );
    if popped {
        return well.child(popped_words(cx)).into_any_element();
    }
    let well = picture(shell, feed, watched, track, well, theme, cx)
        .child(caption(shell, feed, track, theme))
        .child(controls(shell, feed, theme, window, cx))
        .when(shell.stage.stats_open, |well| {
            let frames = track.slot.counts();
            let viewport = track.wanted.size();
            let rows = stats::rows(shell.stage.stats.get(&session), frames, viewport, shell.stage.uplink.as_ref());
            well.child(stats::render(rows, theme, cx))
        });
    Reachable::new("stage-large", well)
        .corner(theme.skin.radius_md)
        .into_any_element()
}

/// The picture of the large feed, what is drawn on it, and the ways to
/// draw on it or move round it.
fn picture(
    shell: &Shell,
    feed: &Feed,
    watched: &Watched,
    track: &Track,
    well: gpui::Stateful<gpui::Div>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> gpui::Stateful<gpui::Div> {
    let fit = shell.stage.shares.fit;
    let channel = shell.snapshot.current_channel;
    let drawing = channel.is_some_and(|channel| shell.stage.drawing.contains(&channel));
    let mut strokes: Vec<_> = channel
        .map(|channel| shell.stage.shares.strokes.of(channel).cloned().collect())
        .unwrap_or_default();
    strokes.extend(shell.stage.pen.down.as_ref().map(crate::share::stroke::Pen::drawn));
    let (laid, waiting) = {
        let screen = track.screen.borrow();
        (screen.laid, !screen.has_picture())
    };
    let sharer = feed.each.whose == Whose::Mine;
    well.child(feed_video(track, fit, shell.stage.pan.offset(), LARGE_RATE))
        .when(!strokes.is_empty(), |well| well.child(drawing::strokes(strokes, laid)))
        .when(waiting, |well| well.child(waiting_words(watched)))
        .when(drawing, |well| well.child(drawing::pad(cx)))
        .when(!drawing, |well| panning(well, cx))
        .when(drawing, |well| well.child(drawing::tools(shell, sharer, theme, cx)))
}

/// The pointer, the wheel and the arrow keys moving round a feed shown
/// pixel for pixel.
fn panning(well: gpui::Stateful<gpui::Div>, cx: &mut Context<Shell>) -> gpui::Stateful<gpui::Div> {
    well.on_mouse_down(
        MouseButton::Left,
        cx.listener(|shell, event: &MouseDownEvent, _, _| shell.pan_held(event.position)),
    )
    .on_mouse_move(cx.listener(|shell, event: &MouseMoveEvent, _, cx| {
        if event.pressed_button == Some(MouseButton::Left) {
            shell.pan_dragged(event.position, cx);
        }
    }))
    .on_mouse_up(MouseButton::Left, cx.listener(|shell, _, _, _| shell.pan_let_go()))
    .on_scroll_wheel(cx.listener(|shell, event: &ScrollWheelEvent, _, cx| shell.pan_wheel(event, cx)))
    .on_key_down(cx.listener(|shell, event: &KeyDownEvent, _, cx| {
        if shell.pan_key(event, cx) {
            cx.stop_propagation();
        }
    }))
}

/// One track's video, wanted at `rate` frames a second, moved `pan` where
/// it is shown pixel for pixel.
pub(super) fn feed_video(track: &Track, fit: Fit, pan: (f32, f32), rate: u32) -> impl IntoElement {
    div().absolute().top_0().left_0().size_full().child(screen::video(
        std::rc::Rc::clone(&track.screen),
        track.slot.clone(),
        Arc::clone(&track.wanted),
        fit,
        pan,
        rate,
    ))
}

/// What is said over a feed with nothing to show yet.
fn waiting_words(watched: &Watched) -> impl IntoElement {
    let says = if matches!(watched.standing, crate::share::Standing::Failed(_)) {
        t!("Stream unavailable")
    } else {
        t!("Connecting…")
    };
    div()
        .debug_selector(|| "stage-waiting".to_owned())
        .absolute()
        .size_full()
        .flex()
        .items_center()
        .justify_center()
        .text_size(px(11.5))
        .text_color(hsla(0.6, 0.06, 0.63, 1.0))
        .child(says)
}

/// What the stage says of a feed shown in its own window.
fn popped_words(cx: &mut Context<Shell>) -> impl IntoElement {
    div()
        .debug_selector(|| "stage-popped".to_owned())
        .absolute()
        .size_full()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .items_center()
        .justify_center()
        .text_size(px(12.0))
        .text_color(hsla(0.6, 0.06, 0.73, 1.0))
        .child(t!("Shown in its own window"))
        .child(
            Button::new("stage-bring-back", t!("Bring it back"))
                .start_icon("minimize")
                .on_click(cx.listener(|shell, _, _, cx| shell.bring_back(cx))),
        )
}

/// The caption over the top of the feed: live, whose and what, its size,
/// and how far away and how fast it is.
fn caption(shell: &Shell, feed: &Feed, track: &Track, theme: &Theme) -> impl IntoElement {
    let sampled = shell.stage.stats.get(&feed.session());
    let sent = track.screen.borrow().sent();
    let mut right: Vec<String> = Vec::new();
    if let Some(ms) = sampled.and_then(|s| s.now.rtt_ms) {
        right.push(t!("{{ms}} ms", ms = format!("{ms:.0}")).to_string());
    }
    if let Some(fps) = sampled.and_then(|s| s.fps) {
        right.push(t!("{{fps}} fps", fps = format!("{fps:.0}")).to_string());
    }
    div()
        .debug_selector(|| "stage-caption".to_owned())
        .absolute()
        .top(px(8.0))
        .left(px(9.0))
        .right(px(9.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .text_size(px(11.0))
        .text_color(hsla(0.62, 0.3, 0.93, 1.0))
        .child(live_pill(theme))
        .child(format!("{} · {}", name_of(shell, &feed.each), kind_of(shell, feed)))
        .children(sent.map(|(w, h)| {
            div()
                .text_size(px(10.0))
                .text_color(hsla(0.6, 0.12, 0.73, 1.0))
                .child(format!("{w}×{h}"))
        }))
        .child(div().flex_1())
        .child(right.join(" · "))
}

/// The red LIVE at the head of the caption.
fn live_pill(theme: &Theme) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .px(px(6.0))
        .h(px(17.0))
        .rounded(theme.skin.radius_sm)
        .bg(hsla(0.0, 0.63, 0.6, 0.22))
        .border_1()
        .border_color(hsla(0.0, 0.63, 0.6, 0.4))
        .text_size(px(9.5))
        .text_color(hsla(0.0, 0.73, 0.82, 1.0))
        .child(div().size(px(5.0)).rounded_full().bg(hsla(0.0, 0.66, 0.65, 1.0)))
        .child(t!("LIVE"))
}

/// A glass button over the picture.
fn glass(button: IconButton) -> IconButton {
    button.size(26.0).glyph_size(12.0).variant(Variant::Filled)
}

/// The controls over the foot of the feed.
fn controls(shell: &Shell, feed: &Feed, theme: &Theme, _window: &Window, cx: &mut Context<Shell>) -> impl IntoElement {
    let (session, camera) = (feed.session(), feed.camera);
    let fit = Fit::ALL.iter().position(|fit| *fit == shell.stage.shares.fit).unwrap_or(0);
    let drawing = shell
        .snapshot
        .current_channel
        .is_some_and(|channel| shell.stage.drawing.contains(&channel));
    let expanded = shell.stage.expanded;
    let heard = feed.each.whose != Whose::Mine && shell.stage.loudness.has_sound(session);
    div()
        .absolute()
        .bottom(px(8.0))
        .left(px(9.0))
        .right(px(9.0))
        .flex()
        .items_center()
        .gap(px(6.0))
        // Kept whole however narrow the stage: the room goes from the gap.
        .child(div().flex_none().child(
            Segmented::new("stage-fit", Fit::ALL.map(Fit::name), fit).on_choose(cx.listener(
                |shell, at: &usize, _, cx| {
                    shell.lay_large(Fit::ALL[*at]);
                    cx.notify();
                },
            )),
        ))
        .when(heard, |row| row.child(sound(shell, session, cx)))
        .child(div().flex_1())
        .child(glass(IconButton::new("stage-copy", "camera"))
            .tip(t!("Copy a screenshot of this feed"))
            .on_click(cx.listener(|shell, _, _, cx| shell.copy_frame(cx))))
        .child(glass(IconButton::new("stage-draw", "pencil"))
            .variant(if drawing { Variant::Solid } else { Variant::Filled })
            .tip(if drawing { t!("Stop drawing") } else { t!("Draw on screen") })
            .on_click(cx.listener(|shell, _, _, cx| shell.toggle_drawing(cx))))
        .child(glass(IconButton::new("stage-more", "ellipsis-vertical"))
            .tip(t!("Stream options"))
            .on_click(cx.listener(move |shell, event: &gpui::ClickEvent, _, cx| {
                shell.open_stage_menu(session, camera, event.position(), cx);
            })))
        .child(glass(IconButton::new("stage-whole", if expanded { "minimize" } else { "maximize" }))
            .tip(if expanded { t!("Exit fullscreen") } else { t!("Fullscreen") })
            .on_click(cx.listener(|shell, _, window, cx| shell.toggle_whole_window(window, cx))))
        .when(feed.each.whose == Whose::Mine, |row| {
            row.child(
                Button::new("stage-stop", t!("Stop"))
                    .tone(super::super::kit::Tone::Danger)
                    .on_click(cx.listener(|shell, _, _, cx| shell.stop_share(cx))),
            )
        })
        .text_color(theme.c.text)
}

/// The share's sound: mute, and how loud, as the web client's viewer has
/// them.
fn sound(shell: &Shell, session: crate::engine::Session, cx: &mut Context<Shell>) -> impl IntoElement {
    let (volume, muted) = shell.stage.loudness.of(session);
    div()
        .flex_none()
        .flex()
        .items_center()
        .gap(px(4.0))
        .child(
            glass(IconButton::new("stage-mute", if muted { "volume-x" } else { "volume-2" }))
                .tip(if muted { t!("Unmute") } else { t!("Mute") })
                .on_click(cx.listener(move |shell, _, _, cx| shell.toggle_share_mute(session, cx))),
        )
        .child(div().w(px(70.0)).child(
            Slider::new("stage-volume", if muted { 0.0 } else { volume }).on_change(cx.listener(
                move |shell, at: &f32, _, cx| shell.set_share_volume(session, *at, cx),
            )),
        ))
}

impl Shell {
    /// Mute `session`'s share's sound, or unmute it.
    pub(super) fn toggle_share_mute(&mut self, session: crate::engine::Session, cx: &mut Context<Self>) {
        let gain = self.stage.loudness.toggle_mute(session);
        self.stage.hearing().set_volume(session, gain);
        cx.notify();
    }

    /// Play `session`'s share's sound at `volume`, 0 to 1.
    pub(in crate::ui) fn set_share_volume(&mut self, session: crate::engine::Session, volume: f32, cx: &mut Context<Self>) {
        let gain = self.stage.loudness.set_volume(session, volume);
        self.stage.hearing().set_volume(session, gain);
        cx.notify();
    }
}
