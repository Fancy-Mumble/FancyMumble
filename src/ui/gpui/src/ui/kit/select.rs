//! A dropdown: a field that says which of a list is chosen, and opens the
//! list under itself to choose another.
//!
//! The web UI's outlined `select` field as Nebula styles it: the field's
//! fill and a stronger hairline, the choice in the field's text, a caret
//! at the end; the list is a floating sheet of menu rows.

use std::rc::Rc;

use gpui::{
    App, ElementId, Entity, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window,
    anchored, deferred, div, prelude::*, px, relative,
};

use super::control::MenuItem;
use super::dialog::Sheet;
use super::focus::{Hold, Ring, TabStop};
use crate::theme::{ActiveTheme, Mode};

type OnChoose = Rc<dyn Fn(&usize, &mut Window, &mut App) + 'static>;

/// Whether the list is open, kept from one frame to the next.
#[derive(Default)]
struct Open(bool);

/// A dropdown of `choices`, of which the one at `chosen` is in force.
///
/// ```ignore
/// Select::new("input-device", names, chosen).on_choose(cx.listener(...))
/// ```
#[derive(IntoElement)]
pub(crate) struct Select {
    id: &'static str,
    choices: Vec<SharedString>,
    /// A small picture before each choice, where the choices have one.
    pictures: Vec<super::Picture>,
    chosen: usize,
    on_choose: Option<OnChoose>,
}

impl Select {
    /// `id` names it for the tests: the field is `<id>`, each choice in
    /// the open list `<id>-<its place>`.
    pub(crate) fn new(id: &'static str, choices: Vec<SharedString>, chosen: usize) -> Self {
        Self {
            id,
            choices,
            pictures: Vec::new(),
            chosen,
            on_choose: None,
        }
    }

    /// A picture before each choice, in the list and in the field: a
    /// language's flag. Drawn twenty by fifteen.
    pub(crate) fn pictures(mut self, pictures: Vec<super::Picture>) -> Self {
        self.pictures = pictures;
        self
    }

    pub(crate) fn on_choose(
        mut self,
        handler: impl Fn(&usize, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_choose = Some(Rc::new(handler));
        self
    }
}

impl Select {
    /// The open list, under the field, as wide as it.
    fn list(&self, open: &Entity<Open>, width: gpui::Pixels) -> impl IntoElement + use<> {
        let id = self.id;
        let rows = self.choices.iter().enumerate().map(|(at, name)| {
            let (open, handler) = (open.clone(), self.on_choose.clone());
            MenuItem::new((id, at), name.clone())
                .selector(format!("{id}-{at}"))
                .when_some(self.pictures.get(at).map(picture), MenuItem::lead)
                .height(34.0)
                .ticked(at == self.chosen)
                .on_click(move |_, window, cx| {
                    open.update(cx, |open, cx| {
                        open.0 = false;
                        cx.notify();
                    });
                    if let Some(handler) = &handler {
                        handler(&at, window, cx);
                    }
                })
        });
        let closer = open.clone();
        deferred(
            anchored().snap_to_window().child(
                div()
                    .on_mouse_down_out(move |_, _, cx| {
                        closer.update(cx, |open, cx| {
                            open.0 = false;
                            cx.notify();
                        });
                    })
                    .child(
                        Sheet::new(id)
                            .holds(Hold::Arrows)
                            .scrolls()
                            .mt(px(4.0))
                            .w(width)
                            .max_h(px(320.0))
                            .p(px(5.0))
                            .flex()
                            .flex_col()
                            .children(rows),
                    ),
            ),
        )
        .with_priority(1)
    }
}

/// A choice's small picture: twenty by fifteen, its corners the small ones,
/// drawn in its own colours.
fn picture(picture: &super::Picture) -> impl IntoElement + use<> {
    gpui::img(std::sync::Arc::clone(&picture.0))
        .flex_none()
        .w(px(20.0))
        .h(px(15.0))
        .rounded(px(4.0))
}

/// The web UI's caret at the end of a dropdown: a small filled triangle in
/// the ink an inactive control is drawn in.
fn caret(mode: Mode) -> impl IntoElement {
    let ink = if mode == Mode::Light {
        gpui::hsla(0.0, 0.0, 0.0, 0.54)
    } else {
        gpui::hsla(0.0, 0.0, 1.0, 0.56)
    };
    gpui::canvas(
        |_, _, _| (),
        move |bounds, (), window, _| {
            // Drawn in a box of 24 as the web UI's icon is.
            let at = |x: f32, y: f32| {
                bounds.origin
                    + gpui::point(
                        bounds.size.width * (x / 24.0),
                        bounds.size.height * (y / 24.0),
                    )
            };
            let mut path = gpui::PathBuilder::fill();
            path.move_to(at(7.0, 10.0));
            path.line_to(at(12.0, 15.0));
            path.line_to(at(17.0, 10.0));
            path.close();
            if let Ok(path) = path.build() {
                window.paint_path(path, ink);
            }
        },
    )
    .flex_none()
    .size(px(22.3))
}

impl RenderOnce for Select {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let id: ElementId = self.id.into();
        let open = window.use_keyed_state(
            ElementId::Name(format!("{}-open", self.id).into()),
            cx,
            |_, _| Open::default(),
        );
        let is_open = open.read(cx).0;
        let ring = Ring {
            corner: theme.skin.radius_md,
            ink: theme.c.accent,
        };
        let says = self.choices.get(self.chosen).cloned().unwrap_or_default();
        let selector = self.id;
        let toggler = open.clone();
        let field = div()
            .id(id.clone())
            .debug_selector(move || selector.to_owned())
            .relative()
            .w_full()
            .h(px(36.0))
            .pl(px(12.0))
            .pr(px(6.0))
            .flex()
            .items_center()
            .gap(px(8.0))
            .rounded(theme.skin.radius_md)
            .bg(theme.c.input)
            .border_1()
            .border_color(if is_open {
                theme.c.accent_line
            } else {
                theme.c.line2
            })
            .text_size(px(12.5))
            .line_height(relative(1.4375))
            .cursor_pointer()
            .on_click(move |_, _, cx| {
                toggler.update(cx, |open, cx| {
                    open.0 = !open.0;
                    cx.notify();
                });
            })
            .children(self.pictures.get(self.chosen).map(picture))
            .child(div().flex_1().min_w_0().truncate().child(says))
            .child(caret(theme.mode));
        let field = TabStop::new(id, window, cx).wrap(field, ring, window);
        // The list is as wide as the field, measured as it was last laid out.
        let measured = window.use_keyed_state(
            ElementId::Name(format!("{}-width", self.id).into()),
            cx,
            |_, _| px(240.0),
        );
        let width = *measured.read(cx);
        div()
            .relative()
            .w_full()
            .child(field)
            .child(
                gpui::canvas(
                    move |bounds, _, cx| {
                        if *measured.read(cx) != bounds.size.width {
                            measured.update(cx, |width, _| *width = bounds.size.width);
                        }
                    },
                    |_, (), _, _| {},
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
            .when(is_open, |select| {
                select.child(
                    div()
                        .absolute()
                        .left_0()
                        .top_full()
                        .child(self.list(&open, width)),
                )
            })
    }
}
