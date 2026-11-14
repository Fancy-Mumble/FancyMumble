//! A column of a bounded height that scrolls, fading into its ground at an
//! edge with more beyond it: the web card's bio (`Bio` in `ProfileCard.tsx`).
//!
//! The web fades the words themselves with a mask, because a card there can
//! be painted with anything. A card here stands on one colour, so the fade
//! is that colour laid over the edge, in the web's eased steps. Nothing is
//! faded while everything fits.

use gpui::{
    AnyElement, App, Div, ElementId, Hsla, IntoElement, ParentElement, RenderOnce, ScrollHandle,
    SharedString, Styled, Window, div, linear_color_stop, linear_gradient, prelude::*, px,
};

/// How deep a fade is, and its shape: how much of the ground has been laid
/// at even steps down it.
const DEPTH: f32 = 72.0;
const RAMP: [f32; 7] = [0.0, 0.04, 0.14, 0.34, 0.6, 0.85, 1.0];

/// A bounded column that scrolls and fades.
#[derive(IntoElement)]
pub(crate) struct Faded {
    id: ElementId,
    selector: SharedString,
    scroll: ScrollHandle,
    most: f32,
    ground: Hsla,
    column: Div,
}

impl Faded {
    /// A column named `selector`, scrolled by `scroll` (kept by whoever
    /// draws it, so it stays where it was scrolled to), at most `most` tall,
    /// fading into `ground`.
    pub(crate) fn new(selector: &str, scroll: &ScrollHandle, most: f32, ground: Hsla) -> Self {
        Self {
            id: ElementId::Name(SharedString::from(selector.to_owned())),
            selector: selector.to_owned().into(),
            scroll: scroll.clone(),
            most,
            ground,
            column: div().flex().flex_col(),
        }
    }
}

impl ParentElement for Faded {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.column.extend(elements);
    }
}

impl Styled for Faded {
    fn style(&mut self) -> &mut gpui::StyleRefinement {
        self.column.style()
    }
}

impl RenderOnce for Faded {
    fn render(self, window: &mut Window, _: &mut App) -> impl IntoElement {
        // Where it stands is known once it has been laid out: until then,
        // one more frame.
        if self.scroll.bounds().size.height <= px(0.0) {
            window.request_animation_frame();
        }
        let down = -self.scroll.offset().y;
        let more_below = down < self.scroll.max_offset().y - px(1.0);
        let more_above = down > px(1.0);
        let selector = self.selector.clone();
        div()
            .relative()
            .w_full()
            .child(
                div()
                    .id(self.id)
                    .debug_selector(move || selector.to_string())
                    .w_full()
                    .max_h(px(self.most))
                    .overflow_y_scroll()
                    .track_scroll(&self.scroll)
                    .child(self.column),
            )
            .when(more_below, |area| {
                area.child(fade(self.ground, &self.selector, false))
            })
            .when(more_above, |area| {
                area.child(fade(self.ground, &self.selector, true))
            })
    }
}

/// The ground laid over one edge in steps: fully at the edge, not at all a
/// fade's depth in.
fn fade(ground: Hsla, selector: &SharedString, top: bool) -> impl IntoElement {
    let step = DEPTH / (RAMP.len() - 1) as f32;
    let name = format!("{selector}-fade-{}", if top { "top" } else { "bottom" });
    let steps = RAMP.windows(2).map(move |pair| {
        let (inner, outer) = (pair[0], pair[1]);
        let (from, to) = if top { (outer, inner) } else { (inner, outer) };
        div().h(px(step)).flex_none().bg(linear_gradient(
            180.0,
            linear_color_stop(
                Hsla {
                    a: ground.a * from,
                    ..ground
                },
                0.0,
            ),
            linear_color_stop(
                Hsla {
                    a: ground.a * to,
                    ..ground
                },
                1.0,
            ),
        ))
    });
    let steps: Vec<_> = if top {
        steps.rev().collect()
    } else {
        steps.collect()
    };
    div()
        .debug_selector(move || name.clone())
        .absolute()
        .left_0()
        .right_0()
        .h(px(DEPTH))
        .map(|edge| if top { edge.top_0() } else { edge.bottom_0() })
        .flex()
        .flex_col()
        .children(steps)
}
