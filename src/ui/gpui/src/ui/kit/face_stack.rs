//! The people in a room as a row of small faces, each over the one before
//! it, and how many more there are past the first few: the web UI's
//! `StackedOccupants`, what its "modern" channel viewer puts on a
//! channel's row.

use std::sync::Arc;

use gpui::{
    App, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div, prelude::*, px,
};

use super::Avatar;
use crate::theme::ActiveTheme;

/// How many faces are shown before the rest are counted.
const MOST: usize = 5;
/// How large a face is, and how far each one sits over the one before.
const FACE: f32 = 18.0;
const OVERLAP: f32 = 6.0;

/// One face of the stack: whose, their picture, whether they are talking.
pub(crate) struct Face {
    pub name: SharedString,
    pub picture: Option<Arc<gpui::Image>>,
    pub talking: bool,
}

/// The faces of a room.
#[derive(IntoElement)]
pub(crate) struct FaceStack {
    id: SharedString,
    faces: Vec<Face>,
}

impl FaceStack {
    /// `faces`, in the room's order. `id` names it for the tests.
    pub(crate) fn new(id: impl Into<SharedString>, faces: Vec<Face>) -> Self {
        Self {
            id: id.into(),
            faces,
        }
    }
}

impl RenderOnce for FaceStack {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let more = self.faces.len().saturating_sub(MOST);
        let selector = self.id;
        div()
            .debug_selector(move || selector.to_string())
            .flex_none()
            .ml(px(4.0))
            .flex()
            .items_center()
            .children(
                self.faces
                    .into_iter()
                    .take(MOST)
                    .enumerate()
                    .map(|(at, face)| {
                        div()
                            .id(SharedString::from(format!("face-{}", face.name)))
                            .flex()
                            .when(at > 0, |face| face.ml(px(-OVERLAP)))
                            .tooltip(super::keyed_tip(face.name.clone(), None::<&str>))
                            .child(
                                Avatar::new(&face.name)
                                    .picture(face.picture.as_ref())
                                    .talking(face.talking)
                                    .size(FACE),
                            )
                    }),
            )
            .when(more > 0, |stack| {
                stack.child(
                    div()
                        .ml(px(4.0))
                        .text_size(px(9.5))
                        .font_weight(gpui::FontWeight::SEMIBOLD)
                        .text_color(theme.c.dim)
                        .child(format!("+{more}")),
                )
            })
    }
}
