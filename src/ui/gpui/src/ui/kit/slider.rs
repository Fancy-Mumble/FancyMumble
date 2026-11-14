//! A bar to drag: how much of something, from none of it to all of it.
//!
//! The bar does not hold its value. It is told where it stands each time it
//! is drawn and says where it was dragged to; whoever owns the value keeps
//! it, so a volume changed from somewhere else moves the bar too.

use std::rc::Rc;

use gpui::{
    App, Bounds, DispatchPhase, ElementId, Hitbox, HitboxBehavior, Hsla, IntoElement, MouseButton,
    MouseDownEvent, MouseMoveEvent, MouseUpEvent, Pixels, RenderOnce, SharedString, Window, canvas,
    div, fill, point, prelude::*, px, size,
};

use super::focus::{Ring, TabStop};
use crate::theme::ActiveTheme;

/// What a drag says: where the bar now stands, from 0 to 1.
type Dragged = Rc<dyn Fn(f32, &mut Window, &mut App)>;

/// How thick the bar is, and how wide the knob on it.
const BAR: f32 = 4.0;
const KNOB: f32 = 12.0;
/// How tall the control is: room to take hold of it, as the web UI's
/// slider leaves ten pixels above and below its bar.
const HEIGHT: f32 = 24.0;
/// How far one press of an arrow key moves the bar.
const STEP: f32 = 0.05;

/// Whether the bar is being dragged, kept from one frame to the next.
#[derive(Default)]
struct Held(bool);

/// A bar with a knob, dragged or clicked to a place along it.
///
/// ```ignore
/// Slider::new("volume", volume / 2.0)
///     .on_change(cx.listener(|shell, at: &f32, _, cx| shell.set_volume(*at * 2.0, cx)))
/// ```
#[derive(IntoElement)]
pub(crate) struct Slider {
    id: SharedString,
    at: f32,
    on_change: Option<Dragged>,
}

impl Slider {
    /// A bar standing at `at`, from 0 to 1. `id` also names it for the tests.
    pub(crate) fn new(id: impl Into<SharedString>, at: f32) -> Self {
        Self {
            id: id.into(),
            at: at.clamp(0.0, 1.0),
            on_change: None,
        }
    }

    /// Called with where the bar stands, at a press and all through a drag.
    pub(crate) fn on_change(
        mut self,
        handler: impl Fn(&f32, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_change = Some(Rc::new(move |at, window, cx| handler(&at, window, cx)));
        self
    }
}

/// Where along `bar` the point `x` is, from 0 to 1: the knob's middle
/// travels from one end of the bar to the other, as the web UI's does.
fn along(bar: Bounds<Pixels>, x: Pixels) -> f32 {
    if bar.size.width <= px(0.0) {
        return 0.0;
    }
    ((x - bar.left()) / bar.size.width).clamp(0.0, 1.0)
}

impl RenderOnce for Slider {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let (filled, empty, knob) = (theme.c.accent, theme.c.card2, theme.c.on_accent);
        let id: ElementId = self.id.clone().into();
        let held = window.use_keyed_state(id.clone(), cx, |_, _| Held::default());
        let (at, on_change) = (self.at, self.on_change);
        let stop = on_change
            .is_some()
            .then(|| TabStop::new(id.clone(), window, cx));
        let ring = Ring {
            corner: theme.skin.radius_sm,
            ink: theme.c.accent,
        };
        let selector = self.id;
        let bar = div()
            .id(id)
            .debug_selector(move || selector.to_string())
            .flex_1()
            .min_w(px(40.0))
            .h(px(HEIGHT))
            .cursor_pointer()
            .when_some(on_change.clone(), |bar, changed| {
                bar.on_key_down(move |event, window, cx| {
                    if let Some(to) = keyed(at, &event.keystroke.key) {
                        cx.stop_propagation();
                        changed(to, window, cx);
                    }
                })
            })
            .child(
                canvas(
                    |bounds, window, _| window.insert_hitbox(bounds, HitboxBehavior::Normal),
                    move |bounds, hitbox: Hitbox, window, _| {
                        paint_bar(bounds, at, (filled, empty, knob), window);

                        let (pressed, changed) = (held.clone(), on_change.clone());
                        window.on_mouse_event(move |event: &MouseDownEvent, phase, window, cx| {
                            let on_it = phase == DispatchPhase::Bubble
                                && event.button == MouseButton::Left
                                && hitbox.is_hovered(window);
                            if !on_it {
                                return;
                            }
                            pressed.update(cx, |held, _| held.0 = true);
                            if let Some(changed) = &changed {
                                changed(along(bounds, event.position.x), window, cx);
                            }
                            cx.stop_propagation();
                        });
                        let (dragged, changed) = (held.clone(), on_change);
                        window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
                            if phase != DispatchPhase::Bubble || !dragged.read(cx).0 {
                                return;
                            }
                            // Let go somewhere the release was not seen.
                            if event.pressed_button != Some(MouseButton::Left) {
                                dragged.update(cx, |held, _| held.0 = false);
                                return;
                            }
                            if let Some(changed) = &changed {
                                changed(along(bounds, event.position.x), window, cx);
                            }
                        });
                        window.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
                            if phase == DispatchPhase::Bubble && held.read(cx).0 {
                                held.update(cx, |held, _| held.0 = false);
                            }
                        });
                    },
                )
                .size_full(),
            );
        match stop {
            Some(stop) => stop.wrap(bar, ring, window),
            None => bar,
        }
    }
}

/// A bar with what it sets and where it stands written over it.
///
/// ```ignore
/// SliderRow::new("Blur", "12", Slider::new("wall-blur", 0.3).on_change(...))
/// ```
#[derive(IntoElement)]
pub(crate) struct SliderRow {
    label: SharedString,
    value: SharedString,
    bar: Slider,
}

impl SliderRow {
    pub(crate) fn new(
        label: impl Into<SharedString>,
        value: impl Into<SharedString>,
        bar: Slider,
    ) -> Self {
        Self {
            label: label.into(),
            value: value.into(),
            bar,
        }
    }
}

impl RenderOnce for SliderRow {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        // The web UI's bar is set inline and leaves the room of a line's
        // descent under it.
        div()
            .flex_1()
            .min_w_0()
            .pb(px(5.2))
            .child(super::ValueHeader::new(self.label, self.value))
            .child(div().flex().child(self.bar))
    }
}

/// The bar standing at `at` in `bounds`: its rail, the part of it filled up
/// to the knob, and the knob with the small shadow that lifts it off a
/// light bar. `inks` are the filled part's, the rail's and the knob's.
fn paint_bar(bounds: Bounds<Pixels>, at: f32, inks: (Hsla, Hsla, Hsla), window: &mut Window) {
    let (filled, empty, knob) = inks;
    let middle = bounds.center().y;
    let knob_middle = bounds.left() + bounds.size.width * at;
    let bar = |from: Pixels, to: Pixels| {
        Bounds::new(
            point(from, middle - px(BAR / 2.0)),
            size(to - from, px(BAR)),
        )
    };
    window.paint_quad(fill(bar(bounds.left(), bounds.right()), empty).corner_radii(px(BAR / 2.0)));
    window.paint_quad(fill(bar(bounds.left(), knob_middle), filled).corner_radii(px(BAR / 2.0)));
    let knob_at = Bounds::new(
        point(knob_middle - px(KNOB / 2.0), middle - px(KNOB / 2.0)),
        size(px(KNOB), px(KNOB)),
    );
    window.paint_shadows(
        knob_at,
        gpui::Corners::all(px(KNOB / 2.0)),
        &[gpui::BoxShadow {
            color: gpui::hsla(0.0, 0.0, 0.0, 0.35),
            offset: point(px(0.0), px(1.0)),
            blur_radius: px(1.5),
            spread_radius: px(0.0),
        }],
    );
    window.paint_quad(fill(knob_at, knob).corner_radii(px(KNOB / 2.0)));
}

/// Where a bar standing at `at` stands after the key `key`, if the key
/// moves it: the arrows a step along, Home and End to its ends.
fn keyed(at: f32, key: &str) -> Option<f32> {
    let to = match key {
        "left" => at - STEP,
        "right" => at + STEP,
        "home" => 0.0,
        "end" => 1.0,
        _ => return None,
    };
    Some(to.clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_place_on_the_bar_is_where_the_knobs_middle_would_be() {
        let bar = Bounds::new(point(px(100.0), px(0.0)), size(px(200.0), px(24.0)));
        // The knob's middle travels from one end of the bar to the other.
        assert_eq!(along(bar, px(100.0)), 0.0);
        assert_eq!(along(bar, px(300.0)), 1.0);
        assert!((along(bar, px(200.0)) - 0.5).abs() < 0.001);
        // Past either end is the end.
        assert_eq!(along(bar, px(0.0)), 0.0);
        assert_eq!(along(bar, px(900.0)), 1.0);
        // A bar with no length stands at nothing.
        let stub = Bounds::new(point(px(0.0), px(0.0)), size(px(0.0), px(24.0)));
        assert_eq!(along(stub, px(4.0)), 0.0);
    }

    #[test]
    fn the_arrows_move_the_bar_a_step_and_home_and_end_to_its_ends() {
        let near = |got: Option<f32>, want: f32| got.is_some_and(|got| (got - want).abs() < 0.001);
        assert!(near(keyed(0.5, "right"), 0.55));
        assert!(near(keyed(0.5, "left"), 0.45));
        assert!(near(keyed(0.98, "right"), 1.0), "not past the end");
        assert!(near(keyed(0.02, "left"), 0.0), "nor past the start");
        assert!(near(keyed(0.5, "home"), 0.0));
        assert!(near(keyed(0.5, "end"), 1.0));
        assert_eq!(keyed(0.5, "a"), None);
    }
}
