//! Two tools that tile one leaning plate, as the web composer's clip and
//! its chevron do on a theme that plates the composer: each cut on the
//! plate's own silhouette, the second pulled back onto the first's leaning
//! edge, so the two interlock along a slanted seam.
//!
//! A pointer belongs to exactly one of them: the one whose cut it is inside,
//! as a browser's `clip-path` decides. GPUI gives the pointer to every box
//! under it, and the two boxes overlap by the lean, so this decides itself:
//! which tool is lit, which tip is said, and which a press works. Each tool
//! is still a stop of the keyboard's of its own, ringed in its cut.

use std::cell::Cell;
use std::rc::Rc;

use gpui::{
    App, Bounds, ClickEvent, ElementId, IntoElement, ParentElement, Pixels, Point, RenderOnce,
    SharedString, Styled, Window, canvas, div, point, prelude::*, px,
};

use super::focus::{Ring, TabStop};
use super::icon;
use super::{Finish, cut_into};
use crate::theme::{ActiveTheme, Cut};

type OnClick = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// One of the two tools.
pub(crate) struct Tool {
    id: &'static str,
    glyph: &'static str,
    glyph_size: f32,
    width: f32,
    tip: SharedString,
    faded: bool,
    on_click: OnClick,
}

impl Tool {
    /// A tool `width` wide showing `glyph`, saying `tip`, doing `on_click`.
    pub(crate) fn new(
        id: &'static str,
        glyph: &'static str,
        width: f32,
        tip: impl Into<SharedString>,
        on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        Self {
            id,
            glyph,
            glyph_size: 16.0,
            width,
            tip: tip.into(),
            faded: false,
            on_click: Rc::new(on_click),
        }
    }

    pub(crate) fn glyph_size(mut self, size: f32) -> Self {
        self.glyph_size = size;
        self
    }

    /// Drawn faded: it works, but less is behind it here.
    pub(crate) fn faded(mut self, faded: bool) -> Self {
        self.faded = faded;
        self
    }
}

/// Which tool the pointer is over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Side {
    First,
    Second,
}

/// The pair, on a plate of `cut` that is `height` high.
#[derive(IntoElement)]
pub(crate) struct PlatePair {
    id: &'static str,
    cut: Cut,
    height: f32,
    first: Tool,
    second: Tool,
}

impl PlatePair {
    pub(crate) fn new(id: &'static str, cut: Cut, height: f32, first: Tool, second: Tool) -> Self {
        Self {
            id,
            cut,
            height,
            first,
            second,
        }
    }
}

/// How far `cut` leans across a box `height` high: where its top edge
/// starts, against where its bottom edge starts.
fn lean(cut: Cut, height: f32) -> f32 {
    let corners = cut.points(Bounds::new(
        point(px(0.0), px(0.0)),
        gpui::size(px(100.0), px(height)),
    ));
    let top = corners
        .iter()
        .filter(|corner| f32::from(corner.y) < height / 2.0)
        .map(|corner| f32::from(corner.x))
        .fold(f32::INFINITY, f32::min);
    let bottom = corners
        .iter()
        .filter(|corner| f32::from(corner.y) >= height / 2.0)
        .map(|corner| f32::from(corner.x))
        .fold(f32::INFINITY, f32::min);
    (top - bottom).abs()
}

/// Which of two tools `widths` wide, the second pulled back by `lean` onto
/// the first, both cut by `cut` and standing at `origin`, holds `at`.
pub(crate) fn side_at(
    cut: Cut,
    (origin, height): (Point<Pixels>, f32),
    widths: (f32, f32),
    at: Point<Pixels>,
) -> Option<Side> {
    let lean = lean(cut, height);
    let first = Bounds::new(origin, gpui::size(px(widths.0), px(height)));
    let second = Bounds::new(
        origin + point(px(widths.0 - lean), px(0.0)),
        gpui::size(px(widths.1), px(height)),
    );
    if cut.contains(first, at) {
        Some(Side::First)
    } else if cut.contains(second, at) {
        Some(Side::Second)
    } else {
        None
    }
}

impl RenderOnce for PlatePair {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let (cut, height) = (self.cut, self.height);
        let widths = (self.first.width, self.second.width);
        let lean = lean(cut, height);
        let hovered = window.use_keyed_state(ElementId::from(self.id), cx, |_, _| None::<Side>);
        let origin = Rc::new(Cell::new(point(px(0.0), px(0.0))));
        let lit = *hovered.read(cx);
        let hover_fill = theme.c.hover;
        let ring = Ring {
            corner: px(0.0),
            ink: theme.c.accent,
        };
        let tool = |tool: &Tool, side: Side, left: f32, window: &mut Window, cx: &mut App| {
            let on_click = Rc::clone(&tool.on_click);
            let control = div()
                .id(tool.id)
                .debug_selector({
                    let id = tool.id;
                    move || id.to_owned()
                })
                .absolute()
                .top_0()
                .left(px(left))
                .w(px(tool.width))
                .h(px(height))
                .flex()
                .items_center()
                .justify_center()
                // A press is the pair's to give; Enter and Space are this
                // tool's own.
                .on_click(move |event, window, cx| {
                    if matches!(event, ClickEvent::Keyboard(_)) {
                        on_click(event, window, cx);
                    }
                });
            let control = if lit == Some(side) {
                let id = tool.id;
                cut_into(control, cut, Finish::new(hover_fill, None), px(0.0)).child(
                    div()
                        .debug_selector(move || format!("{id}-lit"))
                        .absolute()
                        .size_full(),
                )
            } else {
                control
            };
            let ink = if tool.faded {
                theme.c.dim
            } else {
                theme.c.muted
            };
            let control = control.child(icon(tool.glyph, tool.glyph_size, ink));
            TabStop::new(tool.id, window, cx).wrap_cut(control, ring, Some(cut), window)
        };
        let first = tool(&self.first, Side::First, 0.0, window, cx);
        let second = tool(&self.second, Side::Second, widths.0 - lean, window, cx);
        let (first_click, second_click) = (
            Rc::clone(&self.first.on_click),
            Rc::clone(&self.second.on_click),
        );
        let (first_tip, second_tip) = (self.first.tip.clone(), self.second.tip.clone());
        let tips = hovered.clone();
        let (moved, clicked) = (Rc::clone(&origin), Rc::clone(&origin));
        let (moving, left_by) = (hovered.clone(), hovered.clone());
        div()
            .id(self.id)
            .debug_selector({
                let id = self.id;
                move || id.to_owned()
            })
            .relative()
            .flex_none()
            .w(px(widths.0 + widths.1 - lean))
            .h(px(height))
            .cursor_pointer()
            .child({
                let origin = Rc::clone(&origin);
                canvas(
                    move |bounds, _, _| origin.set(bounds.origin),
                    |_, (), _, _| {},
                )
                .absolute()
                .size_full()
            })
            .child(first)
            .child(second)
            .on_mouse_move(move |event, _, cx| {
                let side = side_at(cut, (moved.get(), height), widths, event.position);
                moving.update(cx, |hovered, cx| {
                    if *hovered != side {
                        *hovered = side;
                        cx.notify();
                    }
                });
            })
            .on_hover(move |inside, _, cx| {
                if !inside {
                    left_by.update(cx, |hovered, cx| {
                        *hovered = None;
                        cx.notify();
                    });
                }
            })
            .on_click(move |event, window, cx| {
                let ClickEvent::Mouse(mouse) = event else {
                    return;
                };
                match side_at(cut, (clicked.get(), height), widths, mouse.up.position) {
                    Some(Side::First) => first_click(event, window, cx),
                    Some(Side::Second) => second_click(event, window, cx),
                    None => {}
                }
            })
            .tooltip(move |window, cx| {
                let says = match *tips.read(cx) {
                    Some(Side::Second) => second_tip.clone(),
                    _ => first_tip.clone(),
                };
                super::tooltip::keyed_tip(says, None::<&str>)(window, cx)
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Nimbus's control, leaning ten pixels.
    fn plate() -> Cut {
        "polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)"
            .parse()
            .expect("a polygon")
    }

    fn at(x: f32, y: f32) -> Point<Pixels> {
        point(px(x), px(y))
    }

    #[test]
    fn every_point_of_the_plate_belongs_to_one_tool_and_the_seam_leans() {
        let place = (at(0.0, 0.0), 54.0);
        let widths = (40.0, 34.0);
        assert_eq!(
            side_at(plate(), place, widths, at(20.0, 27.0)),
            Some(Side::First)
        );
        assert_eq!(
            side_at(plate(), place, widths, at(52.0, 27.0)),
            Some(Side::Second)
        );
        // The seam leans with the plate: near the top the first reaches
        // further right than near the bottom.
        assert_eq!(
            side_at(plate(), place, widths, at(36.0, 2.0)),
            Some(Side::First)
        );
        assert_eq!(
            side_at(plate(), place, widths, at(36.0, 52.0)),
            Some(Side::Second)
        );
        // Across the seam at each height, one and then the other, never both.
        for y in [1.0, 13.0, 27.0, 41.0, 53.0] {
            let mut seen = Vec::new();
            for x in 0..64 {
                if let Some(side) = side_at(plate(), place, widths, at(x as f32 + 0.5, y)) {
                    if seen.last() != Some(&side) {
                        seen.push(side);
                    }
                }
            }
            assert_eq!(seen, [Side::First, Side::Second], "at {y}");
        }
    }
}
