//! A row of bars, one a moment of a sound: a voice message's shape, played
//! up to a point, and a take's level as it is recorded.
//!
//! The web UI's `.wave` and `.live` (`VoiceMessage.module.css`): bars two
//! to four pixels wide with two between them, never lower than a few
//! pixels so silence still shows where the sound is.

use std::rc::Rc;

use gpui::{
    App, Bounds, DispatchPhase, ElementId, Hitbox, HitboxBehavior, Hsla, IntoElement, MouseButton,
    MouseDownEvent, Pixels, RenderOnce, Styled, Window, canvas, div, fill, point, prelude::*, px,
    size,
};

use super::focus::{Ring, TabStop};
use crate::theme::ActiveTheme;

/// Where a press on the bars says to go, from 0 to 1 along them.
type Pressed = Rc<dyn Fn(f32, &mut Window, &mut App)>;
/// A key pressed while the bars have the keyboard; `true` where it was
/// used.
type Keyed = Rc<dyn Fn(&str, &mut Window, &mut App) -> bool>;

/// The space between two bars, and how wide one may be.
const GAP: f32 = 2.0;
const NARROWEST: f32 = 2.0;
const WIDEST: f32 = 4.0;

/// Which end the bars keep to when they do not fill the row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Keep {
    /// The start: a voice message, read from its beginning.
    #[default]
    Start,
    /// The end: a take, its newest moment always at the same place.
    End,
}

/// Bars of `heights` (0 to 1 each), those before `played` (0 to 1) in the
/// accent, the rest faint.
///
/// ```ignore
/// Waveform::new("wave-3", bars, 0.4).lowest(0.12).on_press(...).on_key(...)
/// ```
#[derive(IntoElement)]
pub(crate) struct Waveform {
    id: ElementId,
    selector: String,
    heights: Vec<f32>,
    played: f32,
    lowest: f32,
    tall: f32,
    keep: Keep,
    on_press: Option<Pressed>,
    on_key: Option<Keyed>,
}

impl Waveform {
    /// `id` names it to the tests too.
    pub(crate) fn new(id: impl Into<String>, heights: Vec<f32>, played: f32) -> Self {
        let selector = id.into();
        Self {
            id: ElementId::Name(selector.clone().into()),
            selector,
            heights,
            played: played.clamp(0.0, 1.0),
            lowest: 0.1,
            tall: 28.0,
            keep: Keep::Start,
            on_press: None,
            on_key: None,
        }
    }

    /// The lowest a bar is drawn, as a part of the row's height.
    pub(crate) fn lowest(mut self, lowest: f32) -> Self {
        self.lowest = lowest;
        self
    }

    /// How tall the row is, in pixels.
    pub(crate) fn tall(mut self, tall: f32) -> Self {
        self.tall = tall;
        self
    }

    pub(crate) fn keep(mut self, keep: Keep) -> Self {
        self.keep = keep;
        self
    }

    /// Called with where along the bars a press landed: they become a
    /// place for the keyboard too.
    pub(crate) fn on_press(
        mut self,
        handler: impl Fn(f32, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_press = Some(Rc::new(handler));
        self
    }

    /// Called with each key pressed while the bars have the keyboard.
    pub(crate) fn on_key(
        mut self,
        handler: impl Fn(&str, &mut Window, &mut App) -> bool + 'static,
    ) -> Self {
        self.on_key = Some(Rc::new(handler));
        self
    }
}

/// How wide each bar is, and where the first starts, for `count` bars in
/// `row`.
fn laid_out(row: Bounds<Pixels>, count: usize, keep: Keep) -> (Pixels, Pixels) {
    let count = count.max(1) as f32;
    let room = row.size.width / px(1.0);
    let width = ((room - GAP * (count - 1.0)) / count).clamp(NARROWEST, WIDEST);
    let used = width * count + GAP * (count - 1.0);
    let start = match keep {
        Keep::Start => row.left(),
        Keep::End => row.right() - px(used.min(room)),
    };
    (px(width), start)
}

/// Paint the bars into `row`.
fn paint(row: Bounds<Pixels>, bars: &Waveform, (lit, faint): (Hsla, Hsla), window: &mut Window) {
    let (width, start) = laid_out(row, bars.heights.len(), bars.keep);
    let middle = row.center().y;
    let count = bars.heights.len().max(1);
    for (at, height) in bars.heights.iter().enumerate() {
        let (at_f, count_f) = (at as f32, count as f32);
        let left = start + (width + px(GAP)) * at_f;
        if left + width > row.right() + px(0.5) {
            break;
        }
        let high = row.size.height * height.clamp(bars.lowest, 1.0);
        let bar = Bounds::new(point(left, middle - high / 2.0), size(width, high));
        let ink = if (at_f + 0.5) / count_f <= bars.played {
            lit
        } else {
            faint
        };
        window.paint_quad(fill(bar, ink).corner_radii(width / 2.0));
    }
}

impl RenderOnce for Waveform {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let inks = (theme.c.accent, theme.c.text.opacity(0.38));
        let stop = self
            .on_press
            .is_some()
            .then(|| TabStop::new(self.id.clone(), window, cx));
        let ring = Ring {
            corner: px(4.0),
            ink: theme.c.accent,
        };
        let selector = self.selector.clone();
        let (pressed, keyed) = (self.on_press.clone(), self.on_key.clone());
        let row = div()
            .id(self.id.clone())
            .debug_selector(move || selector.clone())
            .flex_1()
            .min_w(px(24.0))
            .h(px(self.tall))
            .rounded(px(4.0))
            .when(pressed.is_some(), Styled::cursor_pointer)
            .when_some(keyed, |row, keyed| {
                row.on_key_down(move |event, window, cx| {
                    if keyed(&event.keystroke.key, window, cx) {
                        cx.stop_propagation();
                    }
                })
            })
            .child(
                canvas(
                    |bounds, window, _| window.insert_hitbox(bounds, HitboxBehavior::Normal),
                    move |bounds, hitbox: Hitbox, window, _| {
                        paint(bounds, &self, inks, window);
                        let Some(pressed) = pressed else {
                            return;
                        };
                        window.on_mouse_event(move |event: &MouseDownEvent, phase, window, cx| {
                            let on_it = phase == DispatchPhase::Bubble
                                && event.button == MouseButton::Left
                                && hitbox.is_hovered(window);
                            if !on_it || bounds.size.width <= px(0.0) {
                                return;
                            }
                            let along = (event.position.x - bounds.left()) / bounds.size.width;
                            pressed(along.clamp(0.0, 1.0), window, cx);
                            cx.stop_propagation();
                        });
                    },
                )
                .size_full(),
            );
        match stop {
            Some(stop) => stop.wrap(row, ring, window),
            None => row,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bars_are_two_to_four_pixels_and_keep_to_their_end() {
        let row = Bounds::new(point(px(10.0), px(0.0)), size(px(300.0), px(28.0)));
        // Few bars in a wide row: four pixels each, from its start.
        assert_eq!(laid_out(row, 10, Keep::Start), (px(4.0), px(10.0)));
        // From its end: 10 bars and 9 gaps are 58 pixels.
        assert_eq!(laid_out(row, 10, Keep::End), (px(4.0), px(310.0 - 58.0)));
        // Many bars in a narrow row: never under two pixels.
        assert_eq!(laid_out(row, 200, Keep::Start).0, px(2.0));
    }
}
