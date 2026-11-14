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
    /// Small chips in a row that wraps, a figure after the name where it
    /// has one: the web UI's choices on the tray of files to send.
    Chips,
}

/// One choice: its name, and the line under it, if it has one.
pub(crate) struct Choice {
    pub name: SharedString,
    pub detail: Option<SharedString>,
    /// A bundled icon before the name.
    pub glyph: Option<&'static str>,
}

impl Choice {
    pub(crate) fn new(name: impl Into<SharedString>) -> Self {
        Self {
            name: name.into(),
            detail: None,
            glyph: None,
        }
    }

    pub(crate) fn glyph(mut self, glyph: &'static str) -> Self {
        self.glyph = Some(glyph);
        self
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
        if self.shape == Shape::Chips {
            return chip(taken, theme)
                .id((id, at))
                .debug_selector(move || format!("{id}-{at}"))
                .when_some(choice.glyph, |chip, glyph| {
                    let ink = if taken { theme.c.text } else { theme.c.muted };
                    chip.child(crate::ui::widgets::icon(glyph, 12.0, ink))
                })
                .child(choice.name)
                .when_some(choice.detail, |chip, detail| {
                    chip.child(
                        div()
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .opacity(0.7)
                            .child(detail),
                    )
                });
        }
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
                // Drawn by `chip` above, and returned before this.
                Shape::Pills | Shape::Chips => card.px(px(13.0)).py(px(7.0)),
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
                // A web button centres what it holds: a card whose words
                // are one line, in a row a neighbour's two lines make
                // taller, has them in its middle.
                Shape::Grid(_) => card
                    .flex()
                    .flex_col()
                    .justify_center()
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
            Shape::Chips => div().flex().flex_wrap().gap(px(6.0)),
        }
        .children(drawn)
    }
}

/// A chip as the web UI's tray draws one: small, lit in the accent's wash
/// while it is the one taken.
fn chip(lit: bool, theme: &Theme) -> gpui::Div {
    let hover = theme.c.hover;
    let (fill, edge, ink) = if lit {
        (theme.c.accent_soft, theme.c.accent_line, theme.c.text)
    } else {
        (theme.c.card2, theme.c.line, theme.c.muted)
    };
    div()
        .flex_none()
        .flex()
        .items_center()
        .gap(px(5.0))
        .px(px(9.0))
        .py(px(4.0))
        .rounded(theme.skin.radius_md)
        .bg(fill)
        .border(theme.skin.line_width)
        .border_color(edge)
        .text_size(px(10.5))
        .line_height(relative(1.2))
        .font_weight(gpui::FontWeight::SEMIBOLD)
        .text_color(ink)
        .cursor_pointer()
        .when(!lit, |chip| chip.hover(move |style| style.bg(hover)))
}

/// A button drawn as one of those chips: words and a small mark after
/// them, as the tray's "Options" that folds its choices out.
#[derive(IntoElement)]
pub(crate) struct ChipButton {
    id: &'static str,
    label: SharedString,
    glyph: &'static str,
    tip: Option<SharedString>,
    on_click: Option<Rc<dyn Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static>>,
}

impl ChipButton {
    /// `id` also names it for the tests.
    pub(crate) fn new(id: &'static str, label: impl Into<SharedString>, glyph: &'static str) -> Self {
        Self {
            id,
            label: label.into(),
            glyph,
            tip: None,
            on_click: None,
        }
    }

    pub(crate) fn tip(mut self, tip: impl Into<SharedString>) -> Self {
        self.tip = Some(tip.into());
        self
    }

    pub(crate) fn on_click(
        mut self,
        handler: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for ChipButton {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let id = self.id;
        let ring = Ring {
            corner: theme.skin.radius_md,
            ink: theme.c.accent,
        };
        let button = chip(false, &theme)
            .id(id)
            .debug_selector(move || id.to_owned())
            .child(self.label)
            .child(crate::ui::widgets::icon(self.glyph, 9.0, theme.c.muted))
            .when_some(self.tip, |button, tip| {
                button.tooltip(super::keyed_tip(tip, None::<&str>))
            });
        match self.on_click {
            Some(handler) => TabStop::new(id, window, cx).wrap(
                button.on_click(move |event, window, cx| handler(event, window, cx)),
                ring,
                window,
            ),
            None => button,
        }
    }
}