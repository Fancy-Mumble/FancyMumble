//! Choices of which one is taken, laid out as pills, as cards that say
//! what each does, or as a grid of cards that show what each looks like.
//!
//! The web UI's `PillGroup`, `ChoiceCards` and `OptionCardGrid`: one
//! component with three shapes, since all that differs is how a choice
//! is boxed and what it says under its name. Two choices side by side in
//! one track are [`super::Segmented`].

use std::rc::Rc;

use gpui::{
    App, IntoElement, ParentElement, RenderOnce, SharedString, Stateful, Styled, Window, div,
    prelude::*, px, relative,
};

use super::focus::{Ring, TabStop};
use super::heading::LINE;
use crate::theme::{ActiveTheme, Theme};

type OnChoose = Rc<dyn Fn(&usize, &mut Window, &mut App) + 'static>;

/// How the choices are laid out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Shape {
    /// Small pills in a row that wraps.
    Pills,
    /// Cards side by side sharing the row, each naming a mode and saying
    /// in a sentence what it does.
    Cards,
    /// A grid of this many columns, each card naming a format and showing
    /// what it looks like.
    Grid(u16),
}

/// One choice: its name, and the line under it, if it has one.
pub(crate) struct Choice {
    pub name: SharedString,
    pub detail: Option<SharedString>,
}

impl Choice {
    pub(crate) fn new(name: impl Into<SharedString>) -> Self {
        Self {
            name: name.into(),
            detail: None,
        }
    }

    pub(crate) fn detail(mut self, detail: impl Into<SharedString>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

/// Choices of which exactly one is taken.
///
/// ```ignore
/// Choices::new("activation", Shape::Cards, choices, taken).on_choose(...)
/// ```
#[derive(IntoElement)]
pub(crate) struct Choices {
    id: &'static str,
    shape: Shape,
    choices: Vec<Choice>,
    taken: usize,
    on_choose: Option<OnChoose>,
}

impl Choices {
    /// `id` names it for the tests: each choice is `<id>-<its place>`.
    pub(crate) fn new(id: &'static str, shape: Shape, choices: Vec<Choice>, taken: usize) -> Self {
        Self {
            id,
            shape,
            choices,
            taken,
            on_choose: None,
        }
    }

    /// What taking a choice does, told its place among the choices.
    pub(crate) fn on_choose(
        mut self,
        handler: impl Fn(&usize, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_choose = Some(Rc::new(handler));
        self
    }
}

impl Choices {
    /// The box of the choice at `at`, with its words, before it is made a
    /// stop.
    fn boxed(&self, at: usize, choice: Choice, theme: &Theme) -> Stateful<gpui::Div> {
        let id = self.id;
        let taken = at == self.taken;
        let hover = theme.c.hover;
        let (fill, edge) = if taken {
            (theme.c.accent_soft, theme.c.accent_line)
        } else {
            (theme.c.card, theme.c.line)
        };
        let named = div()
            .text_size(px(if self.shape == Shape::Pills {
                12.0
            } else {
                12.5
            }))
            .font_weight(if taken {
                gpui::FontWeight::SEMIBOLD
            } else if self.shape == Shape::Pills {
                gpui::FontWeight::NORMAL
            } else {
                gpui::FontWeight::MEDIUM
            })
            .when(self.shape == Shape::Pills && !taken, |name| {
                name.text_color(theme.c.muted)
            })
            .child(choice.name);
        let detail = choice.detail.map(|detail| {
            let line = div().text_size(px(11.0)).text_color(theme.c.muted);
            match self.shape {
                Shape::Grid(_) => line.mt(px(3.0)).font_family(theme.skin.mono.clone()),
                _ => line.line_height(relative(1.5)),
            }
            .child(detail)
        });
        let named = if self.shape == Shape::Cards {
            named.mb(px(3.0))
        } else {
            named
        };
        div()
            .id((id, at))
            .debug_selector(move || format!("{id}-{at}"))
            .rounded(theme.skin.radius_md)
            .bg(fill)
            // The theme's own line, as the web UI's `--nebula-line-width`.
            .border(theme.skin.line_width)
            .border_color(edge)
            .cursor_pointer()
            .line_height(relative(LINE))
            .map(|card| match self.shape {
                Shape::Pills => card.px(px(13.0)).py(px(7.0)),
                // As the web UI's: what a card says sits in its middle
                // when a neighbour's longer words make the row taller.
                Shape::Cards => card
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .justify_center()
                    .px(px(13.0))
                    .py(px(12.0))
                    .when(!taken, |card| {
                        card.hover(move |style| style.border_color(hover))
                    }),
                Shape::Grid(_) => card
                    .px(px(13.0))
                    .py(px(10.0))
                    .when(!taken, |card| card.hover(move |style| style.bg(hover))),
            })
            .child(named)
            .children(detail)
    }
}

impl RenderOnce for Choices {
    fn render(mut self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let ring = Ring {
            corner: theme.skin.radius_md,
            ink: theme.c.accent,
        };
        let choices = std::mem::take(&mut self.choices);
        let mut drawn = Vec::with_capacity(choices.len());
        for (at, choice) in choices.into_iter().enumerate() {
            let card = self.boxed(at, choice, &theme);
            drawn.push(match self.on_choose.clone() {
                Some(handler) => TabStop::new((self.id, at), window, cx).wrap(
                    card.on_click(move |_, window, cx| handler(&at, window, cx)),
                    ring,
                    window,
                ),
                None => card,
            });
        }
        match self.shape {
            Shape::Pills => div().flex().flex_wrap().gap(px(7.0)),
            Shape::Cards => div().flex().gap(px(9.0)),
            Shape::Grid(columns) => div().grid().grid_cols(columns).gap(px(8.0)),
        }
        .children(drawn)
    }
}
