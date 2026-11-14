//! Surfaces in the theme's shapes.
//!
//! A theme that cuts a kind of surface (`theme::Cuts`) has it drawn here as
//! the web UI's `chamferedSurface` draws one: the whole shape in the edge's
//! colour, and the same shape laid on the box a line smaller in the fill's,
//! so the edge follows the cut on every side, slanted ones included. Behind
//! it may stand a hard offset plate; under the pointer it takes
//! the hover's colour, inside the shape only. A theme that cuts nothing gets
//! what it always had: a rounded box with a border.
//!
//! The pointer still meets the element's box, not its shape: a lean of ten
//! pixels leaves corners no-one aims at.

use gpui::{
    Bounds, Hsla, IntoElement, ParentElement, Path, PathBuilder, Pixels, Point, Styled, Window,
    canvas, point, px,
};

use crate::theme::{Cut, Kind, Theme};

/// What a shaped surface is painted with.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Finish {
    pub fill: Hsla,
    /// The edge, or `None` for none.
    pub edge: Option<Hsla>,
    /// The fill under the pointer.
    pub hover: Option<Hsla>,
    /// A hard plate behind it, this far down and across, in this colour.
    pub hard: Option<(f32, Hsla)>,
    /// The fill running into this colour at this angle (CSS degrees), as
    /// a `linear-gradient`.
    pub fill_to: Option<(f32, Hsla)>,
}

impl Finish {
    /// `fill` inside `edge`, and nothing else.
    pub(crate) fn new(fill: Hsla, edge: Option<Hsla>) -> Self {
        Self {
            fill,
            edge,
            hover: None,
            hard: None,
            fill_to: None,
        }
    }

    /// The fill running into `to` at `angle` degrees, as CSS writes a
    /// `linear-gradient(<angle>deg, <fill>, <to>)`.
    pub(crate) fn fading_to(mut self, angle: f32, to: Hsla) -> Self {
        self.fill_to = Some((angle, to));
        self
    }

    pub(crate) fn hover(mut self, hover: Hsla) -> Self {
        self.hover = Some(hover);
        self
    }
}

/// `element` drawn as a surface of `kind` in `finish`: in the theme's cut for
/// that kind, or, where it cuts none, rounded by `corner` with a border of
/// the edge. Call before the element's own children are given, so the
/// shape is painted under them.
pub(crate) fn shaped<E: Styled + ParentElement>(
    element: E,
    kind: Kind,
    finish: Finish,
    corner: Pixels,
    theme: &Theme,
) -> E {
    match theme.skin.cuts.of(kind) {
        Some(cut) => cut_into(element, cut, finish, theme.skin.line_width),
        None => {
            let element = element.rounded(corner).bg(finish.fill);
            match finish.edge {
                Some(edge) => element.border_1().border_color(edge),
                None => element,
            }
        }
    }
}

/// `element` with `cut` painted under its children in `finish`, the edge
/// `line` wide.
pub(crate) fn cut_into<E: Styled + ParentElement>(
    mut element: E,
    cut: Cut,
    finish: Finish,
    line: Pixels,
) -> E {
    // The shape is placed against the element: one already placed
    // absolutely is a place for it as it is.
    let place = &mut element.style().position;
    if place.is_none() {
        *place = Some(gpui::Position::Relative);
    }
    element.child(plate(cut, finish, line))
}

/// The shape alone, filling its parent: put it first among the children of
/// a relative parent.
pub(crate) fn plate(cut: Cut, finish: Finish, line: Pixels) -> impl IntoElement + use<> {
    canvas(
        move |bounds, window, _| {
            // Asked only of a surface that changes under the pointer; it
            // takes no press from the element it stands in.
            finish
                .hover
                .map(|_| window.insert_hitbox(bounds, gpui::HitboxBehavior::Normal))
        },
        move |bounds, hitbox, window, _| {
            let hovered = hitbox.is_some_and(|hitbox| hitbox.is_hovered(window));
            paint_plate(cut, finish, line, hovered, bounds, window);
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

fn paint_plate(
    cut: Cut,
    finish: Finish,
    line: Pixels,
    hovered: bool,
    bounds: Bounds<Pixels>,
    window: &mut Window,
) {
    if let Some((offset, color)) = finish.hard {
        let shifted = Bounds::new(bounds.origin + point(px(offset), px(offset)), bounds.size);
        fill(&cut.points(shifted), color, window);
    }
    let inside = match finish.edge {
        Some(edge) if line > px(0.0) => {
            fill(&cut.points(bounds), edge, window);
            cut.points(inset(bounds, line))
        }
        _ => cut.points(bounds),
    };
    match finish.fill_to {
        Some((angle, to)) => {
            if let Some(path) = polygon(&inside) {
                window.paint_path(
                    path,
                    gpui::linear_gradient(
                        angle,
                        gpui::linear_color_stop(finish.fill, 0.0),
                        gpui::linear_color_stop(to, 1.0),
                    ),
                );
            }
        }
        None => fill(&inside, finish.fill, window),
    }
    if let Some(hover) = finish.hover.filter(|_| hovered) {
        fill(&inside, hover, window);
    }
}

/// `bounds` a `by` smaller on every side.
pub(crate) fn inset(bounds: Bounds<Pixels>, by: Pixels) -> Bounds<Pixels> {
    Bounds::new(
        bounds.origin + point(by, by),
        gpui::size(
            (bounds.size.width - by * 2.0).max(px(0.0)),
            (bounds.size.height - by * 2.0).max(px(0.0)),
        ),
    )
}

/// The closed polygon through `corners`, filled.
///
/// Every shape a theme cuts is convex, and a convex one is a fan of
/// triangles from its first corner: laid down directly, without the
/// tessellator a path of any shape needs, which cost most of a frame
/// drawn in such a theme.
pub(crate) fn polygon(corners: &[Point<Pixels>]) -> Option<Path<Pixels>> {
    if let [first, rest @ ..] = corners
        && rest.len() >= 2
        && convex(corners)
    {
        let mut path = Path::new(*first);
        for corner in rest {
            path.line_to(*corner);
        }
        return Some(path);
    }
    let mut path = PathBuilder::fill();
    path.add_polygon(corners, true);
    path.build().ok()
}

/// Whether the polygon through `corners` turns the same way at every
/// corner: convex, whichever way round it runs. Corners on a straight
/// line turn neither way and do not count against it.
fn convex(corners: &[Point<Pixels>]) -> bool {
    let count = corners.len();
    let mut turning = 0.0_f32;
    for at in 0..count {
        let (a, b, c) = (
            corners[at],
            corners[(at + 1) % count],
            corners[(at + 2) % count],
        );
        let cross = f32::from(b.x - a.x) * f32::from(c.y - b.y)
            - f32::from(b.y - a.y) * f32::from(c.x - b.x);
        if cross.abs() <= f32::EPSILON {
            continue;
        }
        if turning != 0.0 && cross.signum() != turning {
            return false;
        }
        turning = cross.signum();
    }
    turning != 0.0
}

/// The closed polygon through `corners`, outlined `width` wide.
pub(crate) fn outline(corners: &[Point<Pixels>], width: Pixels) -> Option<Path<Pixels>> {
    let mut path = PathBuilder::stroke(width);
    path.add_polygon(corners, true);
    path.build().ok()
}

fn fill(corners: &[Point<Pixels>], color: Hsla, window: &mut Window) {
    if color.a <= 0.0 {
        return;
    }
    if let Some(path) = polygon(corners) {
        window.paint_path(path, color);
    }
}

/// The focus ring of a control cut to `cut`: its outline, `width` wide,
/// laid just inside the control's box.
pub(crate) fn ring(cut: Cut, ink: Hsla, width: Pixels) -> impl IntoElement + use<> {
    canvas(
        |_, _, _| (),
        move |bounds, (), window, _| {
            let half = width / 2.0;
            if let Some(path) = outline(&cut.points(inset(bounds, half)), width) {
                window.paint_path(path, ink);
            }
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::size;

    #[test]
    fn a_box_inset_by_a_line_keeps_its_middle() {
        let outer = Bounds::new(point(px(10.0), px(20.0)), size(px(100.0), px(40.0)));
        let inner = inset(outer, px(2.0));
        assert_eq!(inner.origin, point(px(12.0), px(22.0)));
        assert_eq!(inner.size, size(px(96.0), px(36.0)));
        assert_eq!(inner.center(), outer.center());
        // Never inside out.
        assert_eq!(inset(outer, px(50.0)).size.height, px(0.0));
    }

    #[test]
    fn a_convex_shape_is_told_from_one_that_is_not() {
        let at = |x: f32, y: f32| point(px(x), px(y));
        let leaning = [at(10.0, 0.0), at(100.0, 0.0), at(90.0, 30.0), at(0.0, 30.0)];
        assert!(convex(&leaning));
        let mut backwards = leaning;
        backwards.reverse();
        assert!(convex(&backwards), "either way round");
        let notched = [
            at(0.0, 0.0),
            at(50.0, 20.0),
            at(100.0, 0.0),
            at(100.0, 30.0),
            at(0.0, 30.0),
        ];
        assert!(!convex(&notched));
        let flat = [at(0.0, 0.0), at(50.0, 0.0), at(100.0, 0.0)];
        assert!(!convex(&flat), "no area");
    }

    #[test]
    fn a_cut_makes_a_path_to_fill_and_one_to_outline() {
        let cut: Cut = "polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)"
            .parse()
            .expect("a polygon");
        let corners = cut.points(Bounds::new(
            point(px(0.0), px(0.0)),
            size(px(80.0), px(30.0)),
        ));
        assert!(polygon(&corners).is_some());
        assert!(outline(&corners, px(2.0)).is_some());
    }
}
