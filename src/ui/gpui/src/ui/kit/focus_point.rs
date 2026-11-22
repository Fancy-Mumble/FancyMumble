//! Where a picture's subject is: the whole picture, with a ring on the
//! point that stays in view when a room cuts the picture (the web UI's
//! `FocusPicker`). Pressed or dragged to a point, or moved with the arrow
//! keys. Drawn blurred, darkened and washed as the wall is, so the bars
//! beside it can be judged on it.

use std::rc::Rc;
use std::sync::Arc;

use gpui::{
    App, Bounds, DispatchPhase, ElementId, Hitbox, HitboxBehavior, Hsla, IntoElement, MouseButton,
    MouseDownEvent, MouseMoveEvent, MouseUpEvent, ParentElement, Pixels, RenderOnce, SharedString,
    Styled, Window, canvas, div, prelude::*, px,
};

use super::focus::{Ring, TabStop};
use crate::pictures::{Fit, shown};
use crate::theme::ActiveTheme;

/// The box the picture is letterboxed in.
const FRAME: (f32, f32) = (440.0, 248.0);
/// How large the ring is.
const MARK: f32 = 16.0;
/// How far one press of an arrow key moves the point.
const NUDGE: f32 = 0.02;

/// What a press or a drag says: the point, across and down, from 0 to 1.
type Moved = Rc<dyn Fn((f32, f32), &mut Window, &mut App)>;

/// Whether the point is being dragged, kept from one frame to the next.
#[derive(Default)]
struct Held(bool);

/// The picture with its point.
#[derive(IntoElement)]
pub(crate) struct FocusPicker {
    id: SharedString,
    picture: Arc<gpui::Image>,
    at: (f32, f32),
    blur: u8,
    dim: f32,
    wash: Hsla,
    on_change: Option<Moved>,
}

impl FocusPicker {
    /// `picture` with its point at `at`. `id` also names it for the tests.
    pub(crate) fn new(
        id: impl Into<SharedString>,
        picture: Arc<gpui::Image>,
        at: (f32, f32),
    ) -> Self {
        Self {
            id: id.into(),
            picture,
            at,
            blur: 0,
            dim: 0.0,
            wash: gpui::transparent_black(),
            on_change: None,
        }
    }

    /// Draw it as the wall is drawn: blurred `blur` pixels, darkened by
    /// `dim`, under `wash`. The blurred copy is the wall's own, so showing
    /// it here reads nothing the conversation has not read already.
    pub(crate) fn looks(mut self, blur: u8, dim: f32, wash: Hsla) -> Self {
        self.blur = blur;
        self.dim = dim.clamp(0.0, 1.0);
        self.wash = wash;
        self
    }

    /// Called with the point, at a press, all through a drag, and at each
    /// press of an arrow key.
    pub(crate) fn on_change(
        mut self,
        handler: impl Fn(&(f32, f32), &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_change = Some(Rc::new(move |at, window, cx| handler(&at, window, cx)));
        self
    }
}

/// The picture's place inside the frame: as large as fits whole, centred.
fn letterboxed(shape: Option<(u32, u32)>) -> (f32, f32) {
    let Some((width, height)) = shape.filter(|(width, height)| *width > 0 && *height > 0) else {
        return FRAME;
    };
    #[expect(clippy::cast_precision_loss, reason = "a picture's side")]
    let aspect = width as f32 / height as f32;
    if aspect >= FRAME.0 / FRAME.1 {
        (FRAME.0, FRAME.0 / aspect)
    } else {
        (FRAME.1 * aspect, FRAME.1)
    }
}

/// What takes the presses and drags over the picture, and says where in it
/// they are.
fn grip(held: gpui::Entity<Held>, on_change: Option<Moved>) -> gpui::Canvas<Hitbox> {
    canvas(
        |bounds, window, _| window.insert_hitbox(bounds, HitboxBehavior::Normal),
        move |bounds, hitbox: Hitbox, window, _| {
            let (pressed, changed) = (held.clone(), on_change.clone());
            window.on_mouse_event(move |event: &MouseDownEvent, phase, window, cx| {
                if phase != DispatchPhase::Bubble
                    || event.button != MouseButton::Left
                    || !hitbox.is_hovered(window)
                {
                    return;
                }
                pressed.update(cx, |held, _| held.0 = true);
                if let Some((changed, at)) = changed.as_ref().zip(point_in(bounds, event.position))
                {
                    changed(at, window, cx);
                }
                cx.stop_propagation();
            });
            let (dragged, changed) = (held.clone(), on_change.clone());
            window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
                if phase != DispatchPhase::Bubble || !dragged.read(cx).0 {
                    return;
                }
                if event.pressed_button != Some(MouseButton::Left) {
                    dragged.update(cx, |held, _| held.0 = false);
                    return;
                }
                if let Some((changed, at)) = changed.as_ref().zip(point_in(bounds, event.position))
                {
                    changed(at, window, cx);
                }
            });
            window.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
                if phase == DispatchPhase::Bubble && held.read(cx).0 {
                    held.update(cx, |held, _| held.0 = false);
                }
            });
        },
    )
}

/// Where in `picture` the point `at` on screen is, from 0 to 1 each way.
fn point_in(picture: Bounds<Pixels>, at: gpui::Point<Pixels>) -> Option<(f32, f32)> {
    if picture.size.width <= px(0.0) || picture.size.height <= px(0.0) {
        return None;
    }
    Some((
        ((at.x - picture.left()) / picture.size.width).clamp(0.0, 1.0),
        ((at.y - picture.top()) / picture.size.height).clamp(0.0, 1.0),
    ))
}

/// Where the point stands after the key `key`, if the key moves it.
fn nudged((x, y): (f32, f32), key: &str) -> Option<(f32, f32)> {
    let (x, y) = match key {
        "left" => (x - NUDGE, y),
        "right" => (x + NUDGE, y),
        "up" => (x, y - NUDGE),
        "down" => (x, y + NUDGE),
        _ => return None,
    };
    Some((x.clamp(0.0, 1.0), y.clamp(0.0, 1.0)))
}

impl RenderOnce for FocusPicker {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let id: ElementId = self.id.clone().into();
        let held = window.use_keyed_state(id.clone(), cx, |_, _| Held::default());
        let (width, height) = letterboxed(crate::picture::dimensions(self.picture.bytes()));
        let (at, on_change) = (self.at, self.on_change);
        let keyed = on_change.clone();
        let stop = on_change
            .is_some()
            .then(|| TabStop::new(id.clone(), window, cx));
        let selector = self.id;
        let accent = theme.c.accent;
        let mut dim = gpui::black();
        dim.a = self.dim;
        let layer = || div().absolute().top_0().left_0().size_full();
        let mark = div()
            .absolute()
            .left(px(at.0 * width - MARK / 2.0))
            .top(px(at.1 * height - MARK / 2.0))
            .size(px(MARK))
            .rounded_full()
            .border_2()
            .border_color(accent)
            // Its own contrast over a picture of any colour.
            .shadow(vec![gpui::BoxShadow {
                color: gpui::hsla(0.0, 0.0, 0.0, 0.65),
                offset: gpui::point(px(0.0), px(0.0)),
                blur_radius: px(0.0),
                spread_radius: px(1.0),
                inset: false,
            }]);
        let grip = grip(held, on_change)
            .absolute()
            .top_0()
            .left_0()
            .size_full();
        let picture = div()
            .id(id)
            .debug_selector(move || selector.to_string())
            .relative()
            .w(px(width))
            .h(px(height))
            .cursor_crosshair()
            .child(
                // Clipped on its own, so a blurred edge stays inside the
                // picture while the ring may still sit on its border.
                layer()
                    .overflow_hidden()
                    .child(
                        gpui::img(shown(&self.picture, Fit::Wall(self.blur)))
                            .size_full()
                            .object_fit(gpui::ObjectFit::Fill),
                    )
                    .child(layer().bg(dim))
                    .child(layer().bg(self.wash)),
            )
            .child(mark)
            .child(grip)
            .when_some(keyed, |picture, changed| {
                picture.on_key_down(move |event, window, cx| {
                    if let Some(to) = nudged(at, &event.keystroke.key) {
                        cx.stop_propagation();
                        changed(to, window, cx);
                    }
                })
            });
        let ring = Ring {
            corner: px(0.0),
            ink: accent,
        };
        let picture = match stop {
            Some(stop) => stop.wrap(picture, ring, window),
            None => picture,
        };
        div()
            .w(px(FRAME.0))
            .h(px(FRAME.1))
            .flex()
            .items_center()
            .justify_center()
            .overflow_hidden()
            .rounded(theme.skin.radius_md)
            .bg(theme.c.card2)
            .border_1()
            .border_color(theme.c.line)
            .child(picture)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_picture_is_letterboxed_and_a_press_is_read_as_a_share_of_it() {
        assert_eq!(letterboxed(Some((2000, 1000))), (FRAME.0, FRAME.0 / 2.0));
        assert_eq!(letterboxed(Some((100, 200))), (FRAME.1 / 2.0, FRAME.1));
        assert_eq!(letterboxed(None), FRAME);
        let picture = Bounds::new(
            gpui::point(px(10.0), px(20.0)),
            gpui::size(px(200.0), px(100.0)),
        );
        assert_eq!(
            point_in(picture, gpui::point(px(110.0), px(45.0))),
            Some((0.5, 0.25))
        );
        assert_eq!(
            point_in(picture, gpui::point(px(0.0), px(500.0))),
            Some((0.0, 1.0))
        );
    }

    #[test]
    fn the_arrows_nudge_the_point_and_stop_at_the_edges() {
        let near = |got: Option<(f32, f32)>, want: (f32, f32)| {
            got.is_some_and(|got| (got.0 - want.0).abs() < 1e-4 && (got.1 - want.1).abs() < 1e-4)
        };
        assert!(near(nudged((0.5, 0.5), "right"), (0.52, 0.5)));
        assert!(near(nudged((0.5, 0.5), "up"), (0.5, 0.48)));
        assert!(near(nudged((0.0, 1.0), "left"), (0.0, 1.0)));
        assert!(near(nudged((0.0, 1.0), "down"), (0.0, 1.0)));
        assert_eq!(nudged((0.5, 0.5), "a"), None);
    }
}
