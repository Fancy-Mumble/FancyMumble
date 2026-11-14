//! The meter's track: what is heard filling it, the peak held over it, and
//! the gate's markers on it with their handles above. Drawn in one canvas;
//! a press on it takes the nearest marker that can be moved and drags it.

use std::rc::Rc;

use gpui::{
    App, Bounds, Corners, DispatchPhase, Hitbox, HitboxBehavior, Hsla, IntoElement, MouseButton,
    MouseDownEvent, MouseMoveEvent, MouseUpEvent, Pixels, RenderOnce, Window, canvas, div, fill,
    linear_color_stop, linear_gradient, point, prelude::*, px, size,
};

use super::scale::along;
use super::{HANDLE_HIGH, HANDLE_WIDE, Marker, Moved, TRACK_HIGH};
use crate::theme::ActiveTheme;

/// Which marker is being dragged, kept from one frame to the next.
#[derive(Default)]
struct Dragging(Option<usize>);

/// The inks the track is painted in.
#[derive(Clone, Copy)]
struct Inks {
    ground: Hsla,
    ok: Hsla,
    warn: Hsla,
    bad: Hsla,
    peak: Hsla,
    open: Hsla,
    close: Hsla,
}

/// The track.
#[derive(IntoElement)]
pub(super) struct Track {
    pub id: gpui::ElementId,
    /// Where what is heard reaches, and the held peak, 0 to 1 along it.
    pub level: f32,
    pub peak: f32,
    pub talking: bool,
    pub markers: Vec<Marker>,
    pub on_move: Option<Moved>,
}

/// Paint the fill up to `end`: green, then towards amber from half way,
/// then towards red from three quarters, as the web UI's gradient runs
/// along the fill itself.
fn paint_fill(track: Bounds<Pixels>, end: f32, inks: Inks, window: &mut Window) {
    let width = track.size.width * end;
    if width <= px(0.0) {
        return;
    }
    let part = |from: f32, to: f32| {
        Bounds::new(
            point(track.left() + width * from, track.top()),
            size(width * (to - from), track.size.height),
        )
    };
    let radius = TRACK_HIGH / 2.0;
    let left = Corners {
        top_left: px(radius),
        bottom_left: px(radius),
        ..Corners::default()
    };
    let right = Corners {
        top_right: px(radius),
        bottom_right: px(radius),
        ..Corners::default()
    };
    window.paint_quad(fill(part(0.0, 0.5), inks.ok).corner_radii(left));
    let rising = |from, to| {
        linear_gradient(
            90.0,
            linear_color_stop(from, 0.0),
            linear_color_stop(to, 1.0),
        )
    };
    window.paint_quad(fill(part(0.5, 0.75), rising(inks.ok, inks.warn)));
    window.paint_quad(fill(part(0.75, 1.0), rising(inks.warn, inks.bad)).corner_radii(right));
}

/// Paint a marker's line through the track and, where it can be moved,
/// its handle above: a wedge pointing down onto the line.
fn paint_marker(track: Bounds<Pixels>, marker: &Marker, ink: Hsla, window: &mut Window) {
    let x = track.left() + track.size.width * along(marker.value);
    window.paint_quad(
        fill(
            Bounds::new(
                point(x - px(1.0), track.top() - px(4.0)),
                size(px(2.0), track.size.height + px(8.0)),
            ),
            ink,
        )
        .corner_radii(px(1.0)),
    );
    if !marker.movable {
        return;
    }
    let top = track.top() - px(HANDLE_HIGH);
    let at = |dx: f32, dy: f32| point(x + px(dx), top + px(dy));
    let half = HANDLE_WIDE / 2.0;
    let mut wedge = gpui::PathBuilder::fill();
    wedge.move_to(at(-half * 0.9, 0.0));
    wedge.line_to(at(half * 0.9, 0.0));
    wedge.line_to(at(1.0, HANDLE_HIGH * 0.68));
    wedge.line_to(at(1.0, HANDLE_HIGH));
    wedge.line_to(at(-1.0, HANDLE_HIGH));
    wedge.line_to(at(-1.0, HANDLE_HIGH * 0.68));
    wedge.close();
    if let Ok(wedge) = wedge.build() {
        window.paint_path(wedge, ink);
    }
}

/// The movable marker nearest to `x` along `track`, as a place among
/// `markers`.
fn nearest(markers: &[Marker], track: Bounds<Pixels>, x: Pixels) -> Option<usize> {
    let at = (x - track.left()) / track.size.width;
    markers
        .iter()
        .enumerate()
        .filter(|(_, marker)| marker.movable)
        .min_by(|(_, a), (_, b)| {
            (along(a.value) - at)
                .abs()
                .total_cmp(&(along(b.value) - at).abs())
        })
        .map(|(place, _)| place)
}

impl RenderOnce for Track {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let inks = Inks {
            ground: theme.c.text.opacity(0.08),
            ok: theme.c.ok,
            warn: theme.c.warn,
            bad: theme.c.bad,
            peak: gpui::white().opacity(0.7),
            open: theme.c.accent,
            close: theme.c.warn,
        };
        let dragging = window.use_keyed_state(self.id.clone(), cx, |_, _| Dragging::default());
        let Self {
            level,
            peak,
            talking,
            markers,
            on_move,
            ..
        } = self;
        let markers = Rc::new(markers);
        div().w_full().h(px(HANDLE_HIGH + TRACK_HIGH)).child(
            canvas(
                |bounds, window, _| window.insert_hitbox(bounds, HitboxBehavior::Normal),
                move |bounds, hitbox: Hitbox, window, _| {
                    let track = Bounds::new(
                        point(bounds.left(), bounds.top() + px(HANDLE_HIGH)),
                        size(bounds.size.width, px(TRACK_HIGH)),
                    );
                    let round = px(TRACK_HIGH / 2.0);
                    if talking {
                        let ring = Bounds::new(
                            point(track.left() - px(2.0), track.top() - px(2.0)),
                            size(track.size.width + px(4.0), track.size.height + px(4.0)),
                        );
                        window.paint_quad(fill(ring, inks.ok).corner_radii(round + px(2.0)));
                    }
                    window.paint_quad(fill(track, inks.ground).corner_radii(round));
                    paint_fill(track, level, inks, window);
                    let peak_at = track.left() + track.size.width * peak;
                    window.paint_quad(fill(
                        Bounds::new(
                            point(peak_at - px(1.0), track.top()),
                            size(px(2.0), track.size.height),
                        ),
                        inks.peak,
                    ));
                    for marker in markers.iter() {
                        let ink = if marker.opens { inks.open } else { inks.close };
                        paint_marker(track, marker, ink, window);
                    }
                    let Some(on_move) = on_move else {
                        return;
                    };
                    let along_x =
                        move |x: Pixels| ((x - track.left()) / track.size.width).clamp(0.0, 1.0);
                    let (held, moved, picked) =
                        (dragging.clone(), on_move.clone(), Rc::clone(&markers));
                    window.on_mouse_event(move |event: &MouseDownEvent, phase, window, cx| {
                        if phase != DispatchPhase::Bubble
                            || event.button != MouseButton::Left
                            || !hitbox.is_hovered(window)
                        {
                            return;
                        }
                        let Some(place) = nearest(&picked, track, event.position.x) else {
                            return;
                        };
                        held.update(cx, |held, _| held.0 = Some(place));
                        moved(place, along_x(event.position.x), window, cx);
                        cx.stop_propagation();
                    });
                    let (held, moved) = (dragging.clone(), on_move);
                    window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
                        let Some(place) = held.read(cx).0 else {
                            return;
                        };
                        if phase != DispatchPhase::Bubble {
                            return;
                        }
                        if event.pressed_button != Some(MouseButton::Left) {
                            held.update(cx, |held, _| held.0 = None);
                            return;
                        }
                        moved(place, along_x(event.position.x), window, cx);
                    });
                    window.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
                        if phase == DispatchPhase::Bubble && dragging.read(cx).0.is_some() {
                            dragging.update(cx, |held, _| held.0 = None);
                        }
                    });
                },
            )
            .size_full(),
        )
    }
}
