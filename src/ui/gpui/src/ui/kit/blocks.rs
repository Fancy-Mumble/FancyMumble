//! The blocks a page of settings is built of besides its controls: a card
//! that groups rows, a note that says what a setting costs, the note a
//! list leaves when it is empty, and the rule between groups.
//!
//! The web UI's `SettingsCard`, `Banner`, `EmptyState` and `GroupRule`.

use gpui::{
    AnyElement, App, Div, Hsla, IntoElement, ParentElement, RenderOnce, SharedString,
    StyleRefinement, Styled, Window, div, prelude::*, px, relative,
};

use super::heading::LINE;
use crate::theme::{ActiveTheme, Mode};
use crate::ui::widgets::EMPHASIS;

/// A card that groups rows of one kind. Style it and fill it like a `div`.
#[derive(IntoElement)]
pub(crate) struct Card {
    base: Div,
    children: Vec<AnyElement>,
    lit: bool,
}

impl Card {
    pub(crate) fn new() -> Self {
        Self {
            base: div(),
            children: Vec::new(),
            lit: false,
        }
    }

    /// Edged in the accent: the one in use.
    pub(crate) fn lit(mut self, lit: bool) -> Self {
        self.lit = lit;
        self
    }
}

impl ParentElement for Card {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for Card {
    fn style(&mut self) -> &mut StyleRefinement {
        self.base.style()
    }
}

impl RenderOnce for Card {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        self.base
            .px(px(16.0))
            .py(px(14.0))
            .rounded(theme.skin.radius_lg)
            .bg(theme.c.card)
            .border_1()
            .border_color(if self.lit {
                theme.c.accent_line
            } else {
                theme.c.line
            })
            .children(self.children)
    }
}

/// What a note is about, which is the colour it is edged in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Note {
    #[default]
    Info,
    Warn,
    /// What costs the user's safety while it is so.
    Danger,
    /// What was asked for was done.
    Ok,
}

/// What a setting does, said where the setting is: a wash of the tone's
/// colour with a rule of it down the leading edge.
#[derive(IntoElement)]
pub(crate) struct Banner {
    tone: Note,
    title: Option<SharedString>,
    body: Vec<AnyElement>,
}

impl Banner {
    pub(crate) fn new(tone: Note) -> Self {
        Self {
            tone,
            title: None,
            body: Vec::new(),
        }
    }

    pub(crate) fn title(mut self, title: impl Into<SharedString>) -> Self {
        self.title = Some(title.into());
        self
    }
}

impl ParentElement for Banner {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.body.extend(elements);
    }
}

impl RenderOnce for Banner {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let key = match self.tone {
            Note::Info => theme.c.accent,
            Note::Warn => theme.c.warn,
            Note::Danger => theme.c.bad,
            Note::Ok => theme.c.ok,
        };
        let wash = Hsla {
            a: if theme.mode == Mode::Dark { 0.1 } else { 0.07 },
            ..key
        };
        let has_body = !self.body.is_empty();
        div()
            .mt(px(10.0))
            .px(px(12.0))
            .py(px(10.0))
            .rounded(theme.skin.radius_md)
            .border_l_2()
            .border_color(key)
            .bg(wash)
            .text_size(px(11.5))
            .line_height(relative(LINE))
            .text_color(theme.c.muted)
            .children(self.title.map(|title| {
                div()
                    .font_weight(EMPHASIS)
                    .when(has_body, |title| title.mb(px(3.0)))
                    .child(title)
            }))
            .children(self.body)
    }
}

/// What a list says when there is nothing in it, in a dashed outline.
#[derive(IntoElement)]
pub(crate) struct Empty {
    says: SharedString,
}

impl Empty {
    pub(crate) fn new(says: impl Into<SharedString>) -> Self {
        Self { says: says.into() }
    }
}

impl RenderOnce for Empty {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div()
            .px(px(16.0))
            .py(px(28.0))
            .flex()
            .justify_center()
            .rounded(theme.skin.radius_lg)
            .border_1()
            .border_dashed()
            .border_color(theme.c.line2)
            .text_size(px(12.0))
            .text_color(theme.c.muted)
            .child(self.says)
    }
}

/// The rule between groups of settings.
pub(crate) fn rule(cx: &App) -> Div {
    let theme = ActiveTheme::get(cx);
    div().my(px(20.0)).h(theme.skin.line_width).bg(theme.c.line)
}
