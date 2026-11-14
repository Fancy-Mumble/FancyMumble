//! A small worded button on a plate of its own: the accent for the action
//! a card is there for, the raised card colour for stopping it. It can
//! show how far along what it started is, as a bar filling it. The web
//! UI's `GateButton` and its "Hear yourself" button.

use gpui::{
    App, ClickEvent, Hsla, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window,
    div, prelude::*, px, relative,
};

use super::focus::{Ring, TabStop};
use crate::theme::ActiveTheme;

type OnClick = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// The button.
///
/// ```ignore
/// PlateButton::new("gate-test", "Test microphone").primary(true).on_click(...)
/// ```
#[derive(IntoElement)]
pub(crate) struct PlateButton {
    id: &'static str,
    label: SharedString,
    primary: bool,
    /// The room at either side of its words.
    side: f32,
    /// How far along, 0 to 1, and in what ink the bar is drawn.
    progress: Option<(f32, Hsla)>,
    on_click: Option<OnClick>,
}

impl PlateButton {
    /// `id` also names it to the tests.
    pub(crate) fn new(id: &'static str, label: impl Into<SharedString>) -> Self {
        Self {
            id,
            label: label.into(),
            primary: false,
            side: 15.0,
            progress: None,
            on_click: None,
        }
    }

    /// On the accent: the action the card is there for.
    pub(crate) fn primary(mut self, primary: bool) -> Self {
        self.primary = primary;
        self
    }

    /// `side` pixels at either side of its words, where not 15.
    pub(crate) fn side(mut self, side: f32) -> Self {
        self.side = side;
        self
    }

    /// A bar filling it `along` (0 to 1) in `ink`, faint.
    pub(crate) fn progress(mut self, along: f32, ink: Hsla) -> Self {
        self.progress = Some((along.clamp(0.0, 1.0), ink));
        self
    }

    pub(crate) fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Box::new(handler));
        self
    }
}

impl RenderOnce for PlateButton {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let (ground, ink, hover) = if self.primary {
            (theme.c.accent, theme.c.on_accent, theme.c.accent)
        } else {
            (theme.c.card2, theme.c.text, theme.c.hover)
        };
        let stop = TabStop::new(self.id, window, cx);
        let ring = Ring {
            corner: theme.skin.radius_sm,
            ink: if self.primary {
                theme.c.on_accent
            } else {
                theme.c.accent
            },
        };
        let id = self.id;
        let button = div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .relative()
            .overflow_hidden()
            .flex_none()
            .px(px(self.side))
            .py(px(7.0))
            .rounded(theme.skin.radius_sm)
            .bg(ground)
            .text_color(ink)
            .text_size(px(12.0))
            .font_weight(gpui::FontWeight::MEDIUM)
            .whitespace_nowrap()
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .when_some(self.progress, |button, (along, bar)| {
                button.child(
                    div()
                        .absolute()
                        .top_0()
                        .left_0()
                        .h_full()
                        .w(relative(along))
                        .bg(bar.opacity(0.35)),
                )
            })
            .when_some(self.on_click, |button, handler| button.on_click(handler))
            .child(div().relative().child(self.label));
        stop.wrap(button, ring, window)
    }
}
