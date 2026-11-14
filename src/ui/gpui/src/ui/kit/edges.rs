//! Styles GPUI's builders give only in fixed steps, given any amount: an
//! edge the theme's own weight of line (two pixels in a drawn skin), a
//! rounding of two corners, a share of what is left over in a row.

use gpui::{AbsoluteLength, Pixels, Styled};

/// Where an edge is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Edge {
    Top,
    Bottom,
    All,
}

/// `element` with an edge `width` wide where `edge` says.
pub(crate) fn edged<E: Styled>(mut element: E, edge: Edge, width: Pixels) -> E {
    let width = Some(AbsoluteLength::Pixels(width));
    let edges = &mut element.style().border_widths;
    match edge {
        Edge::Top => edges.top = width,
        Edge::Bottom => edges.bottom = width,
        Edge::All => {
            edges.top = width;
            edges.right = width;
            edges.bottom = width;
            edges.left = width;
        }
    }
    element
}

/// `element` rounded `radius` at its two top corners only.
pub(crate) fn top_rounded<E: Styled>(mut element: E, radius: Pixels) -> E {
    let radius = Some(AbsoluteLength::Pixels(radius));
    let corners = &mut element.style().corner_radii;
    corners.top_left = radius;
    corners.top_right = radius;
    element
}

/// `element` taking `share` of what is left over in its row or column.
pub(crate) fn grown<E: Styled>(mut element: E, share: f32) -> E {
    element.style().flex_grow = Some(share);
    element
}
