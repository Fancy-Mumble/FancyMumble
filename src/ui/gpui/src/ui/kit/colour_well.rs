//! A colour to choose: a small well filled with the colour chosen, which
//! opens a sheet of colours under itself.
//!
//! The web UI's `ColourWell` is the browser's own colour input, which opens
//! the system's picker; GPUI has none, so the well offers a palette.

use std::rc::Rc;

use gpui::{
    App, ElementId, Entity, Hsla, IntoElement, ParentElement, RenderOnce, SharedString, Styled,
    Window, anchored, deferred, div, prelude::*, px,
};

use super::dialog::Sheet;
use super::focus::{Hold, Reachable, Ring, TabStop};
use crate::theme::ActiveTheme;

type OnPick = Rc<dyn Fn(&Hsla, &mut Window, &mut App) + 'static>;

/// The colours offered, as CSS writes them: a run of hues in two
/// strengths, and greys.
pub(crate) const PALETTE: [&str; 18] = [
    "#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#6366f1", "#8e4ec6",
    "#d6409f", "#7d2a2f", "#7a3e14", "#6b5a12", "#1f5130", "#0f4c5c", "#2a3350", "#3a2a64",
    "#ffffff", "#101828",
];

/// Whether the sheet is open, kept from one frame to the next.
#[derive(Default)]
struct Open(bool);

/// A well showing `colour`, or none chosen.
#[derive(IntoElement)]
pub(crate) struct ColourWell {
    id: &'static str,
    colour: Option<Hsla>,
    on_pick: Option<OnPick>,
}

impl ColourWell {
    /// `id` names it for the tests: the well is `<id>`, each colour of the
    /// open sheet `<id>-<its place in PALETTE>`.
    pub(crate) fn new(id: &'static str, colour: Option<Hsla>) -> Self {
        Self {
            id,
            colour,
            on_pick: None,
        }
    }

    pub(crate) fn on_pick(
        mut self,
        handler: impl Fn(&Hsla, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_pick = Some(Rc::new(handler));
        self
    }
}

/// `colour` as CSS writes it, `#rrggbb`.
pub(crate) fn hex(colour: Hsla) -> String {
    let rgba = gpui::Rgba::from(colour);
    let byte = |channel: f32| {
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a channel from 0 to 1, made a byte"
        )]
        let byte = (channel.clamp(0.0, 1.0) * 255.0).round() as u8;
        byte
    };
    format!("#{:02x}{:02x}{:02x}", byte(rgba.r), byte(rgba.g), byte(rgba.b))
}

impl ColourWell {
    /// The sheet of colours, under the well.
    fn sheet(&self, open: &Entity<Open>, line: Hsla) -> impl IntoElement + use<> {
        let id = self.id;
        let swatches = PALETTE.iter().enumerate().map(|(at, css)| {
            let colour = crate::theme::color(css);
            let (open, handler) = (open.clone(), self.on_pick.clone());
            let swatch = div()
                .id((id, at))
                .debug_selector(move || format!("{id}-{at}"))
                .size(px(22.0))
                .rounded_full()
                .bg(colour)
                .border_1()
                .border_color(line)
                .cursor_pointer()
                .on_click(move |_, window, cx| {
                    open.update(cx, |open, cx| {
                        open.0 = false;
                        cx.notify();
                    });
                    if let Some(handler) = &handler {
                        handler(&colour, window, cx);
                    }
                });
            Reachable::new((id, at), swatch).corner(px(11.0))
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
                            .mt(px(4.0))
                            .w(px(9.0 * 28.0 + 12.0))
                            .p(px(8.0))
                            .flex()
                            .flex_wrap()
                            .gap(px(6.0))
                            .children(swatches),
                    ),
            ),
        )
        .with_priority(1)
    }
}

impl RenderOnce for ColourWell {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let open = window.use_keyed_state(
            ElementId::Name(SharedString::from(format!("{}-open", self.id))),
            cx,
            |_, _| Open::default(),
        );
        let is_open = open.read(cx).0;
        let id = self.id;
        let toggler = open.clone();
        let well = div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .size(px(26.0))
            .rounded(theme.skin.radius_md)
            .border_1()
            .border_color(theme.c.line2)
            .bg(self.colour.unwrap_or(theme.c.card2))
            .cursor_pointer()
            .on_click(move |_, _, cx| {
                toggler.update(cx, |open, cx| {
                    open.0 = !open.0;
                    cx.notify();
                });
            });
        let ring = Ring {
            corner: theme.skin.radius_md,
            ink: theme.c.accent,
        };
        let well = TabStop::new(id, window, cx).wrap(well, ring, window);
        div()
            .relative()
            .flex_none()
            .child(well)
            .when(is_open, |holder| {
                holder.child(
                    div()
                        .absolute()
                        .left_0()
                        .top_full()
                        .child(self.sheet(&open, theme.c.line2)),
                )
            })
    }
}
