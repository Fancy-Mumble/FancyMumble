//! The window's own frame, for when the window draws it: the eight strips
//! along its edges that resize it.
//!
//! Where the system decorates the window these are not drawn at all; the
//! system's frame already does the job.

use gpui::{
    CursorStyle, Decorations, Div, IntoElement, MouseButton, ParentElement, ResizeEdge, Styled,
    Window, div, prelude::*, px,
};

/// How far in from the window's edge a press still resizes it.
const GRIP: f32 = 5.0;
/// How far along each edge a corner reaches.
const CORNER: f32 = 14.0;

/// Whether the window draws its own frame and controls.
///
/// `FANCY_GPUI_FRAME=client` says yes whatever the compositor answered, so
/// the controls can be looked at under one that insists on framing windows
/// itself.
pub(super) fn is_client_decorated(window: &Window) -> bool {
    static FORCED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FORCED.get_or_init(|| std::env::var("FANCY_GPUI_FRAME").as_deref() == Ok("client"))
        || matches!(window.window_decorations(), Decorations::Client { .. })
}

/// The resize strips, or nothing where there is nothing to resize: a window
/// the system frames, or one that is maximised.
pub(super) fn resize_grips(window: &Window) -> Option<impl IntoElement + use<>> {
    if !is_client_decorated(window) || window.is_maximized() {
        return None;
    }
    let edge = |place: fn(Div) -> Div, edge: ResizeEdge| grip(place(div().absolute()), edge);
    Some(
        div()
            .absolute()
            .size_full()
            .top_0()
            .left_0()
            // Edges first, corners after: where they overlap, the corner wins.
            .child(edge(
                |strip| strip.top_0().left_0().right_0().h(px(GRIP)),
                ResizeEdge::Top,
            ))
            .child(edge(
                |strip| strip.bottom_0().left_0().right_0().h(px(GRIP)),
                ResizeEdge::Bottom,
            ))
            .child(edge(
                |strip| strip.left_0().top_0().bottom_0().w(px(GRIP)),
                ResizeEdge::Left,
            ))
            .child(edge(
                |strip| strip.right_0().top_0().bottom_0().w(px(GRIP)),
                ResizeEdge::Right,
            ))
            .child(edge(
                |corner| corner.top_0().left_0().size(px(CORNER)),
                ResizeEdge::TopLeft,
            ))
            .child(edge(
                |corner| corner.top_0().right_0().size(px(CORNER)),
                ResizeEdge::TopRight,
            ))
            .child(edge(
                |corner| corner.bottom_0().left_0().size(px(CORNER)),
                ResizeEdge::BottomLeft,
            ))
            .child(edge(
                |corner| corner.bottom_0().right_0().size(px(CORNER)),
                ResizeEdge::BottomRight,
            )),
    )
}

/// One strip: the cursor that says what it does, and the press that does it.
fn grip(strip: Div, edge: ResizeEdge) -> impl IntoElement + use<> {
    strip
        .cursor(cursor_for(edge))
        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
            window.start_window_resize(edge);
            // Not also a drag of the window, where the strip lies over the band.
            cx.stop_propagation();
        })
}

/// The cursor shown over the strip that resizes from `edge`.
fn cursor_for(edge: ResizeEdge) -> CursorStyle {
    match edge {
        ResizeEdge::Top | ResizeEdge::Bottom => CursorStyle::ResizeUpDown,
        ResizeEdge::Left | ResizeEdge::Right => CursorStyle::ResizeLeftRight,
        ResizeEdge::TopLeft | ResizeEdge::BottomRight => CursorStyle::ResizeUpLeftDownRight,
        ResizeEdge::TopRight | ResizeEdge::BottomLeft => CursorStyle::ResizeUpRightDownLeft,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opposite_edges_share_a_cursor_and_corners_run_diagonally() {
        assert_eq!(cursor_for(ResizeEdge::Top), cursor_for(ResizeEdge::Bottom));
        assert_eq!(cursor_for(ResizeEdge::Left), cursor_for(ResizeEdge::Right));
        assert_eq!(
            cursor_for(ResizeEdge::TopLeft),
            cursor_for(ResizeEdge::BottomRight)
        );
        assert_ne!(
            cursor_for(ResizeEdge::TopLeft),
            cursor_for(ResizeEdge::TopRight)
        );
        assert_ne!(cursor_for(ResizeEdge::Top), cursor_for(ResizeEdge::Left));
    }
}
