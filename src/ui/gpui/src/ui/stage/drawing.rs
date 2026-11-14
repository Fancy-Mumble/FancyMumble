//! Drawing on the share shown large, as the web client's `AnnotationLayer`
//! does: the tools, the pen, and the strokes of everybody in the channel
//! over the picture.

use gpui::{
    AnyElement, Bounds, Context, Hsla, IntoElement, MouseButton, MouseDownEvent, MouseMoveEvent,
    MouseUpEvent, ParentElement, PathBuilder, Pixels, Point, Rgba, Styled, Window, canvas, div,
    point, prelude::*, px, quad,
};

use super::super::Shell;
use super::super::kit::{IconButton, Reachable, Slider, Variant};
use crate::engine::ChannelId;
use crate::share::fit::Rect;
use crate::share::stroke::{self, COLOURS, Drawn, Pen, SEND_EVERY, WIDTH, WIDTHS};
use crate::theme::Theme;
use crate::words::t;

/// The pen and how it is set.
#[derive(Debug)]
pub(crate) struct PenState {
    /// Which of [`COLOURS`] it draws in.
    pub colour: usize,
    /// How wide, in pixels of the picture as it is drawn.
    pub width: u32,
    /// The stroke being drawn, while the button is held.
    pub down: Option<Pen>,
}

impl Default for PenState {
    fn default() -> Self {
        Self {
            colour: 0,
            width: WIDTH,
            down: None,
        }
    }
}

/// An ARGB colour as the theme's kind.
pub(super) fn colour(argb: u32) -> Hsla {
    let byte = |shift: u32| f32::from(u8::try_from((argb >> shift) & 0xFF).unwrap_or(0)) / 255.0;
    Rgba {
        r: byte(16),
        g: byte(8),
        b: byte(0),
        a: byte(24),
    }
    .into()
}

/// The strokes in `channel`, over a picture laid at `laid` in its room.
pub(super) fn strokes(strokes: Vec<Drawn>, laid: Option<Rect>) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, (), window, _| {
            let Some(laid) = laid else {
                return;
            };
            window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
                for drawn in &strokes {
                    paint_stroke(drawn, laid, bounds.origin, window);
                }
            });
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

/// `strokes` over the whole of the room they are given: the picture is the
/// room, as over the shared screen itself.
pub(super) fn strokes_over_all(strokes: Vec<Drawn>) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, (), window, _| {
            let laid = Rect {
                x: 0.0,
                y: 0.0,
                width: f32::from(bounds.size.width),
                height: f32::from(bounds.size.height),
            };
            for drawn in &strokes {
                paint_stroke(drawn, laid, bounds.origin, window);
            }
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

/// One stroke: a line through its points, and a round dot at each so its
/// ends and corners are round, as the web client's are.
fn paint_stroke(drawn: &Drawn, laid: Rect, origin: Point<Pixels>, window: &mut Window) {
    let width = drawn.width_over(laid.height);
    let ink = colour(drawn.colour);
    let at = |fraction: (f32, f32)| {
        let (x, y) = laid.point(fraction);
        point(origin.x + px(x), origin.y + px(y))
    };
    let points: Vec<Point<Pixels>> = drawn.points.iter().map(|each| at(*each)).collect();
    if points.len() > 1 {
        let mut path = PathBuilder::stroke(px(width));
        path.add_polygon(&points, false);
        if let Ok(path) = path.build() {
            window.paint_path(path, ink);
        }
    }
    let radius = px(width / 2.0);
    for centre in points {
        let dot = Bounds::new(
            point(centre.x - radius, centre.y - radius),
            gpui::size(radius * 2.0, radius * 2.0),
        );
        window.paint_quad(quad(dot, radius, ink, px(0.0), ink, gpui::BorderStyle::Solid));
    }
}

/// What takes the pointer over the picture while drawing is on: a press
/// starts a stroke, a drag draws it, letting go ends it.
pub(super) fn pad(cx: &mut Context<Shell>) -> impl IntoElement {
    div()
        .id("draw-pad")
        .debug_selector(|| "draw-pad".to_owned())
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .cursor(gpui::CursorStyle::Crosshair)
        .on_mouse_down(
            MouseButton::Left,
            cx.listener(|shell, event: &MouseDownEvent, _, cx| {
                cx.stop_propagation();
                shell.pen_down(event.position, cx);
            }),
        )
        .on_mouse_move(cx.listener(|shell, event: &MouseMoveEvent, _, cx| {
            if event.pressed_button == Some(MouseButton::Left) {
                shell.pen_to(event.position, cx);
            }
        }))
        .on_mouse_up(
            MouseButton::Left,
            cx.listener(|shell, event: &MouseUpEvent, _, cx| shell.pen_up(event.position, cx)),
        )
}

/// The tools: the colours, the width and the way to clear.
pub(super) fn tools(shell: &Shell, sharer: bool, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let pen = &shell.stage.pen;
    let swatches = COLOURS.iter().enumerate().map(|(at, argb)| {
        let taken = at == pen.colour;
        let ink = colour(*argb);
        Reachable::new(
            ("draw-colour", at),
            div()
                .id(("draw-colour", at))
                .debug_selector(move || format!("draw-colour-{at}"))
                .size(px(15.0))
                .rounded_full()
                .bg(ink)
                .border_2()
                .border_color(if taken { gpui::white() } else { gpui::transparent_black() })
                .cursor_pointer()
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.stage.pen.colour = at;
                    cx.notify();
                })),
        )
        .corner(px(8.0))
    });
    let (least, most) = (*WIDTHS.start(), *WIDTHS.end());
    let along = (pen.width - least) as f32 / (most - least) as f32;
    let clear_tip = if sharer {
        t!("Clear everyone's drawings")
    } else {
        t!("Clear my drawings")
    };
    div()
        .id("draw-tools")
        .debug_selector(|| "draw-tools".to_owned())
        .absolute()
        .left(px(9.0))
        .bottom(px(48.0))
        .flex()
        .items_center()
        .gap(px(6.0))
        .px(px(8.0))
        .py(px(5.0))
        .rounded(theme.skin.radius_md)
        .bg(gpui::hsla(0.6, 0.33, 0.07, 0.75))
        .occlude()
        .children(swatches)
        .child(
            div().w(px(60.0)).child(Slider::new("draw-width", along).on_change(cx.listener(
                move |shell, at: &f32, _, cx| {
                    let span = (most - least) as f32;
                    #[expect(
                        clippy::cast_possible_truncation,
                        clippy::cast_sign_loss,
                        reason = "a width from 2 to 16"
                    )]
                    let width = least + (at * span).round() as u32;
                    shell.stage.pen.width = width;
                    cx.notify();
                },
            ))),
        )
        .child(
            IconButton::new("draw-clear", "trash-2")
                .size(26.0)
                .glyph_size(12.0)
                .variant(Variant::Ghost)
                .tip(clear_tip)
                .on_click(cx.listener(move |shell, _, _, cx| shell.clear_drawings(sharer, cx))),
        )
        .into_any_element()
}

impl Shell {
    /// The channel drawn in: the one the user is in.
    fn drawn_in(&self) -> Option<ChannelId> {
        self.snapshot
            .current_channel
            .filter(|channel| self.stage.drawing.contains(channel))
    }

    /// Where `at`, in the window, is on the picture shown large.
    fn on_picture(&self, at: Point<Pixels>, clamped: bool) -> Option<((f32, f32), f32)> {
        let screen = self.large_track()?.screen.borrow();
        let (laid, room) = (screen.laid?, screen.room?);
        let inside = (f32::from(at.x - room.origin.x), f32::from(at.y - room.origin.y));
        let fraction = if clamped {
            Some(laid.clamped(inside))
        } else {
            laid.fraction(inside)
        }?;
        Some((fraction, laid.height))
    }

    /// The pen went down at `at`: a stroke begins, if that is on the
    /// picture. Its points go out every [`SEND_EVERY`] while it is drawn.
    pub(super) fn pen_down(&mut self, at: Point<Pixels>, cx: &mut Context<Self>) {
        let Some(channel) = self.drawn_in() else {
            return;
        };
        let Some((fraction, height)) = self.on_picture(at, false) else {
            return;
        };
        let pen = &mut self.stage.pen;
        pen.down = Some(Pen::down(channel, COLOURS[pen.colour], pen.width, height, fraction));
        cx.spawn(async move |shell, cx| {
            loop {
                cx.background_executor().timer(SEND_EVERY).await;
                let going = shell.update(cx, |shell, _| shell.send_pen()).unwrap_or(false);
                if !going {
                    break;
                }
            }
        })
        .detach();
        cx.notify();
    }

    /// Send what the pen drew since the last packet; says whether it is
    /// still down.
    fn send_pen(&mut self) -> bool {
        let Some(own) = self.snapshot.own_session else {
            return false;
        };
        let Some(pen) = self.stage.pen.down.as_mut() else {
            return false;
        };
        if let Some(packet) = pen.packet(own) {
            self.stage.media().stroke(packet);
        }
        true
    }

    pub(super) fn pen_to(&mut self, at: Point<Pixels>, cx: &mut Context<Self>) {
        if self.stage.pen.down.is_none() {
            return;
        }
        let Some((fraction, _)) = self.on_picture(at, true) else {
            return;
        };
        // Drawn here at once (`Pen::drawn`); it goes out with the next packet.
        if let Some(pen) = self.stage.pen.down.as_mut() {
            pen.to(fraction);
        }
        cx.notify();
    }

    pub(super) fn pen_up(&mut self, at: Point<Pixels>, cx: &mut Context<Self>) {
        let (Some(mut pen), Some(own)) = (self.stage.pen.down.take(), self.snapshot.own_session) else {
            return;
        };
        if let Some((fraction, _)) = self.on_picture(at, true) {
            pen.to(fraction);
        }
        // Kept here whole; the rest of it goes out as the stroke's end.
        self.stage.shares.strokes.take(pen.whole(own), false, std::time::Instant::now());
        self.stage.media().stroke(pen.up(own));
        cx.notify();
    }

    /// Clear one's own drawings in the channel, or everybody's for the
    /// sharer.
    fn clear_drawings(&mut self, everybody: bool, cx: &mut Context<Self>) {
        let (Some(own), Some(channel)) = (self.snapshot.own_session, self.snapshot.current_channel) else {
            return;
        };
        let packet = stroke::clearing(own, channel, everybody);
        self.stage.shares.strokes.take(packet.clone(), everybody, std::time::Instant::now());
        self.stage.media().stroke(packet);
        cx.notify();
    }

    /// Turn drawing on or off in the channel the user is in.
    pub(super) fn toggle_drawing(&mut self, cx: &mut Context<Self>) {
        if let Some(channel) = self.snapshot.current_channel
            && !self.stage.drawing.remove(&channel)
        {
            let _ = self.stage.drawing.insert(channel);
        }
        self.stage.pen.down = None;
        cx.notify();
    }
}
