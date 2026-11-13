//! Buttons: one that is an icon, one that is a word.

use gpui::{
    App, ClickEvent, ElementId, Hsla, IntoElement, MouseButton, ParentElement, RenderOnce,
    SharedString, Styled, Window, div, prelude::*, px,
};

use super::{Tone, icon};
use crate::theme::{ActiveTheme, Theme};

type OnClick = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// How a button is drawn at rest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Variant {
    /// Nothing but the icon; a wash under the pointer.
    #[default]
    Ghost,
    /// A dashed hairline: a place to add something.
    Dashed,
    /// A raised fill inside a hairline: the one that is on.
    Tonal,
    /// A wash and an edge of the tone's own colour: a state worth noticing.
    Soft,
    /// A raised fill and no edge.
    Filled,
    /// The accent itself, with the ink that reads on it.
    Solid,
}

/// The corner a button takes from the theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Corner {
    Small,
    #[default]
    Medium,
    Pill,
}

impl Corner {
    fn of(self, theme: &Theme) -> gpui::Pixels {
        match self {
            Self::Small => theme.skin.radius_sm,
            Self::Medium => theme.skin.radius_md,
            Self::Pill => theme.skin.radius_pill,
        }
    }
}

/// What a variant paints with: fill, edge and ink.
struct Coat {
    fill: Option<Hsla>,
    edge: Hsla,
    dashed: bool,
    ink: Hsla,
}

fn coat(variant: Variant, tone: Tone, theme: &Theme) -> Coat {
    let ink = tone.of(theme);
    let clear = gpui::transparent_black();
    let faded = |alpha: f32| Hsla { a: alpha, ..ink };
    let plain = Coat {
        fill: None,
        edge: clear,
        dashed: false,
        ink,
    };
    match variant {
        Variant::Ghost => plain,
        Variant::Dashed => Coat {
            edge: theme.c.line2,
            dashed: true,
            ..plain
        },
        Variant::Tonal => Coat {
            fill: Some(theme.c.card2),
            edge: theme.c.line2,
            ..plain
        },
        Variant::Soft => Coat {
            fill: Some(faded(0.16)),
            edge: faded(0.34),
            ..plain
        },
        Variant::Filled => Coat {
            fill: Some(theme.c.card2),
            ..plain
        },
        Variant::Solid => Coat {
            fill: Some(theme.c.accent),
            ink: theme.c.on_accent,
            ..plain
        },
    }
}

/// A button that is an icon.
///
/// ```ignore
/// IconButton::new("leave", "log-out")
///     .tone(Tone::Danger)
///     .on_click(cx.listener(|shell, _, _, _| shell.engine.disconnect()))
/// ```
#[derive(IntoElement)]
pub(crate) struct IconButton {
    id: ElementId,
    selector: Option<SharedString>,
    glyph: &'static str,
    width: f32,
    height: f32,
    glyph_size: f32,
    variant: Variant,
    tone: Tone,
    corner: Corner,
    faded: bool,
    settle_left: bool,
    on_click: Option<OnClick>,
}

impl IconButton {
    /// A 28px ghost button showing the bundled icon `glyph` at 14px, in the
    /// muted ink. `id` also names it for the tests.
    pub(crate) fn new(id: &'static str, glyph: &'static str) -> Self {
        Self {
            id: id.into(),
            selector: Some(id.into()),
            glyph,
            width: 28.0,
            height: 28.0,
            glyph_size: 14.0,
            variant: Variant::default(),
            tone: Tone::Muted,
            corner: Corner::default(),
            faded: false,
            settle_left: false,
            on_click: None,
        }
    }

    /// The same button for the row at `at` of a list: `id` and the place
    /// together tell it from its neighbours, and name it `<id>-<at>` for
    /// the tests.
    pub(crate) fn at(id: &'static str, at: usize, glyph: &'static str) -> Self {
        Self {
            id: (id, at).into(),
            selector: Some(format!("{id}-{at}").into()),
            ..Self::new(id, glyph)
        }
    }

    /// What the tests call it, where that is not its id.
    pub(crate) fn selector(mut self, selector: impl Into<SharedString>) -> Self {
        self.selector = Some(selector.into());
        self
    }

    /// Both sides, in pixels.
    pub(crate) fn size(self, side: f32) -> Self {
        self.dims(side, side)
    }

    /// Width and height, in pixels.
    pub(crate) fn dims(mut self, width: f32, height: f32) -> Self {
        self.width = width;
        self.height = height;
        self
    }

    /// The icon's side, in pixels.
    pub(crate) fn glyph_size(mut self, side: f32) -> Self {
        self.glyph_size = side;
        self
    }

    pub(crate) fn variant(mut self, variant: Variant) -> Self {
        self.variant = variant;
        self
    }

    pub(crate) fn tone(mut self, tone: Tone) -> Self {
        self.tone = tone;
        self
    }

    pub(crate) fn corner(mut self, corner: Corner) -> Self {
        self.corner = corner;
        self
    }

    /// Where an odd icon in an even button leaves half a pixel over, give
    /// it to the right-hand side, as a browser does; this text system
    /// would give it to the left.
    pub(crate) fn settle_left(mut self) -> Self {
        self.settle_left = true;
        self
    }

    /// Drawn at less than half strength: there, but not on offer right now.
    pub(crate) fn faded(mut self, faded: bool) -> Self {
        self.faded = faded;
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

impl RenderOnce for IconButton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let coat = coat(self.variant, self.tone, &theme);
        let hover = theme.c.hover;
        let selector = self.selector;
        div()
            .id(self.id)
            .when_some(selector, |button, selector| {
                button.debug_selector(move || selector.to_string())
            })
            .flex_none()
            .w(px(self.width))
            .h(px(self.height))
            .rounded(self.corner.of(&theme))
            .border_1()
            .border_color(coat.edge)
            .when(coat.dashed, Styled::border_dashed)
            .when_some(coat.fill, Styled::bg)
            .when(self.faded, |button| button.opacity(0.45))
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .when(coat.fill.is_none(), |button| {
                button.hover(move |style| style.bg(hover))
            })
            // A press on a button is not a drag of whatever it sits on.
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .when_some(self.on_click, |button, handler| button.on_click(handler))
            .child(
                icon(self.glyph, self.glyph_size, coat.ink)
                    .when(self.settle_left, |icon| icon.ml(px(-1.0))),
            )
    }
}

/// How much room a worded button takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Size {
    /// A row in a column of links.
    Small,
    /// A dialog's action.
    #[default]
    Medium,
}

/// How a worded button is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Emphasis {
    /// The words alone; a wash under the pointer.
    #[default]
    Text,
    /// Filled: the one a dialog is there for.
    Contained,
}

/// A button that is a word, with an icon before it if it has one.
///
/// ```ignore
/// Button::new("save", "Save").emphasis(Emphasis::Contained).on_click(...)
/// Button::new("forget", "Forget").tone(Tone::Danger).on_click(...)
/// ```
#[derive(IntoElement)]
pub(crate) struct Button {
    id: ElementId,
    selector: SharedString,
    label: SharedString,
    glyph: Option<&'static str>,
    emphasis: Emphasis,
    tone: Tone,
    size: Size,
    wide: bool,
    on_click: Option<OnClick>,
}

impl Button {
    /// A medium text button saying `label`. `id` also names it for the
    /// tests.
    pub(crate) fn new(id: &'static str, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            selector: id.into(),
            label: label.into(),
            glyph: None,
            emphasis: Emphasis::default(),
            tone: Tone::Muted,
            size: Size::default(),
            wide: false,
            on_click: None,
        }
    }

    /// What the tests call it, where that is not its id.
    pub(crate) fn selector(mut self, selector: impl Into<SharedString>) -> Self {
        self.selector = selector.into();
        self
    }

    /// A bundled icon before the words.
    pub(crate) fn start_icon(mut self, glyph: &'static str) -> Self {
        self.glyph = Some(glyph);
        self
    }

    pub(crate) fn emphasis(mut self, emphasis: Emphasis) -> Self {
        self.emphasis = emphasis;
        self
    }

    /// The ink of a text button, or the fill of a contained one.
    pub(crate) fn tone(mut self, tone: Tone) -> Self {
        self.tone = tone;
        self
    }

    pub(crate) fn size(mut self, size: Size) -> Self {
        self.size = size;
        self
    }

    /// As wide as what it is in, with the words at its leading edge.
    pub(crate) fn wide(mut self) -> Self {
        self.wide = true;
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

impl RenderOnce for Button {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let hover = theme.c.hover;
        let selector = self.selector;
        let (height, side, text) = match self.size {
            Size::Small => (34.0, 10.0, 12.5),
            Size::Medium => (36.0, 18.0, 14.0),
        };
        let contained = self.emphasis == Emphasis::Contained;
        // A contained button is the accent unless it is told it destroys.
        let (fill, ink) = match (contained, self.tone) {
            (true, Tone::Danger) => (Some(theme.c.bad), theme.c.on_accent),
            (true, _) => (Some(theme.c.accent), theme.c.on_accent),
            (false, tone) => (None, tone.of(&theme)),
        };
        div()
            .id(self.id)
            .debug_selector(move || selector.to_string())
            .flex_none()
            .h(px(height))
            .px(px(side))
            .when(self.wide, Styled::w_full)
            .flex()
            .items_center()
            .gap(px(8.0))
            .rounded(theme.skin.radius_md)
            .cursor_pointer()
            .text_size(px(text))
            .text_color(ink)
            .map(|button| match fill {
                Some(fill) => button
                    .bg(fill)
                    .font_weight(crate::ui::widgets::EMPHASIS)
                    .hover(|style| style.opacity(0.9)),
                None => button.hover(move |style| style.bg(hover)),
            })
            .when_some(self.on_click, |button, handler| button.on_click(handler))
            .when_some(self.glyph, |button, glyph| {
                button.child(icon(glyph, 14.0, ink))
            })
            .child(crate::ui::widgets::label(&self.label, &theme))
    }
}
