//! Buttons: one that is an icon, one that is a word.

use gpui::{
    App, ClickEvent, ElementId, Hsla, IntoElement, MouseButton, ParentElement, RenderOnce,
    SharedString, Styled, Window, div, prelude::*, px,
};

use super::focus::{Ring, TabStop};
use super::{Finish, Tone, icon};
use crate::theme::{ActiveTheme, Kind, Theme};

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
    /// A dark disc that stays a cross over any picture it sits on: the way
    /// to take back a file waiting on its tile.
    Glass,
    /// The tone's own colour as a heavy edge over its wash: a control a
    /// drawn skin stands on a plate of its own (the rail's way off a
    /// server, as the web UI's plated `RailButton`).
    Plated,
    /// A raised fill and no edge.
    Filled,
    /// The accent itself, with the ink that reads on it.
    Solid,
    /// The accent's own wash and edge: something running, as a share is,
    /// and not a fault.
    Lit,
}

/// The corner a button takes from the theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Corner {
    Small,
    #[default]
    Medium,
    Pill,
    /// A circle whatever the theme does to its corners: the disc on a
    /// waiting file's tile.
    Round,
}

impl Corner {
    fn of(self, theme: &Theme) -> gpui::Pixels {
        match self {
            Self::Small => theme.skin.radius_sm,
            Self::Medium => theme.skin.radius_md,
            Self::Pill => theme.skin.radius_pill,
            Self::Round => px(9999.0),
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
        // The web UI's TileClose: rgba(8,11,18,.78) under #dfe4ec.
        Variant::Glass => Coat {
            fill: Some(gpui::Rgba { r: 8.0 / 255.0, g: 11.0 / 255.0, b: 18.0 / 255.0, a: 0.78 }.into()),
            ink: gpui::Rgba { r: 223.0 / 255.0, g: 228.0 / 255.0, b: 236.0 / 255.0, a: 1.0 }.into(),
            ..plain
        },
        Variant::Plated => Coat {
            fill: Some(faded(0.14)),
            edge: ink,
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
        Variant::Lit => Coat {
            fill: Some(theme.c.accent_soft),
            edge: theme.c.accent_line,
            ink: theme.c.accent,
            ..plain
        },
    }
}

/// `coat` as one of a bank of switches: lit at rest, on the second card
/// colour inside the accent's edge, and in its own colours when on.
fn banked(coat: Coat, theme: &Theme) -> Coat {
    match coat.fill {
        None => Coat {
            fill: Some(theme.c.card2),
            edge: theme.c.accent_line,
            dashed: false,
            ink: theme.c.text,
        },
        Some(_) => coat,
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
    /// Stood on a plate where the theme cuts its controls to one.
    plated: bool,
    /// One of a row of voice controls, which a theme may draw as a bank of
    /// equal switches.
    spread: bool,
    /// What it says under a pointer that rests on it, and the key that does
    /// the same, if one does.
    tip: Option<(SharedString, Option<SharedString>)>,
    on_click: Option<OnClick>,
}

impl IconButton {
    /// Stand it on a plate of its own where the theme cuts its controls to
    /// one (a header's buttons); where it cuts none, nothing changes.
    pub(crate) fn plated(mut self) -> Self {
        self.plated = true;
        self
    }

    /// One of the dock's row of voice controls: where the theme draws them
    /// as a bank of switches (`marks.dock_bank`), an equal plate across the
    /// row, lit at rest, with a heavier edge and a hard plate under it, as
    /// the web UI's `DockButton` with `spread`; elsewhere drawn as given.
    pub(crate) fn spread(mut self) -> Self {
        self.spread = true;
        self
    }

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
            plated: false,
            spread: false,
            tip: None,
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

    /// What it does, in a word or two, for a pointer that rests on it: an
    /// icon alone does not say.
    pub(crate) fn tip(mut self, says: impl Into<SharedString>) -> Self {
        self.tip = Some((says.into(), None));
        self
    }

    /// The same, naming the key that does it too.
    /// What it says when rested on, with the key that does the same where
    /// there is one.
    pub(crate) fn tip_with_chosen_key(
        mut self,
        says: impl Into<SharedString>,
        key: Option<SharedString>,
    ) -> Self {
        self.tip = Some((says.into(), key));
        self
    }

    pub(crate) fn tip_with_key(
        mut self,
        says: impl Into<SharedString>,
        key: impl Into<SharedString>,
    ) -> Self {
        self.tip = Some((says.into(), Some(key.into())));
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
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let bank = theme.skin.marks.dock_bank.filter(|_| self.spread);
        // Only a switch at rest stands on its plate, as the web UI's does.
        let resting = coat(self.variant, self.tone, &theme).fill.is_none();
        let coat = match bank {
            Some(_) => banked(coat(self.variant, self.tone, &theme), &theme),
            None => coat(self.variant, self.tone, &theme),
        };
        let hover = theme.c.hover;
        let selector = self.selector;
        // Only a button that does something is a place for the keyboard.
        let stop = self
            .on_click
            .is_some()
            .then(|| TabStop::new(self.id.clone(), window, cx));
        let ring = Ring {
            corner: self.corner.of(&theme),
            ink: if self.variant == Variant::Solid {
                theme.c.on_accent
            } else {
                theme.c.accent
            },
        };
        // A plate the theme cuts takes the edge and the hover itself, inside
        // its shape.
        let cut = self
            .plated
            .then(|| theme.skin.cuts.of(Kind::Plate))
            .flatten();
        let button = div()
            .id(self.id)
            .when_some(selector, |button, selector| {
                button.debug_selector(move || selector.to_string())
            })
            .map(|button| match bank {
                // Equal shares of the row, as `flex: 1` gives them.
                Some(bank) => button.flex_1().h(px(bank.switch_height)),
                None => button.flex_none().w(px(self.width)).h(px(self.height)),
            })
            .map(|button| match cut {
                Some(cut) => {
                    let fill = coat.fill.unwrap_or(theme.c.card);
                    let finish = Finish::new(fill, Some(theme.c.tile)).hover(hover);
                    super::cut_into(button, cut, finish, theme.skin.line_width)
                }
                None => button
                    .rounded(self.corner.of(&theme))
                    .map(|button| match bank {
                        // Upright, unlike the header's plates, on a hard
                        // plate: a drawn skin has no light to cast a shadow.
                        Some(_) if !resting => button.border_2(),
                        Some(_) => button.border_2().shadow(vec![gpui::BoxShadow {
                            color: theme.c.line2,
                            offset: gpui::point(px(3.0), px(3.0)),
                            blur_radius: px(0.0),
                            spread_radius: px(0.0),
                        }]),
                        None if self.variant == Variant::Plated => button.border_2(),
                        None => button.border_1(),
                    })
                    .border_color(coat.edge)
                    .when(coat.dashed, Styled::border_dashed)
                    .when_some(coat.fill, Styled::bg)
                    .when(coat.fill.is_none(), |button| {
                        button.hover(move |style| style.bg(hover))
                    }),
            })
            .when(self.faded, |button| button.opacity(0.45))
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            // A press on a button is not a drag of whatever it sits on.
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .when_some(self.on_click, |button, handler| button.on_click(handler))
            .when_some(self.tip, |button, (says, key)| {
                button.tooltip(super::keyed_tip(says, key))
            })
            .child(
                icon(self.glyph, self.glyph_size, coat.ink)
                    .when(self.settle_left, |icon| icon.ml(px(-1.0))),
            );
        match stop {
            Some(stop) => stop.wrap_cut(button, ring, cut, window),
            None => button,
        }
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
    /// The web UI's small button: a setting's action, beside its words.
    Compact,
}

/// How a worded button is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Emphasis {
    /// The words alone; a wash under the pointer.
    #[default]
    Text,
    /// Filled: the one a dialog is there for.
    Contained,
    /// Edged in the stronger hairline, the words in the text ink.
    Outlined,
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
    /// How tall it is, where it stands as tall as a field beside it.
    height: Option<f32>,
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
            height: None,
            on_click: None,
        }
    }

    /// What the tests call it, where that is not its id.
    pub(crate) fn selector(mut self, selector: impl Into<SharedString>) -> Self {
        self.selector = selector.into();
        self
    }

    /// `height` tall, its size otherwise as it is: as tall as the field it
    /// stands beside in a toolbar, as the web UI's stretch.
    pub(crate) fn height(mut self, height: f32) -> Self {
        self.height = Some(height);
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
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let hover = theme.c.hover;
        let selector = self.selector;
        let stop = self
            .on_click
            .is_some()
            .then(|| TabStop::new(self.id.clone(), window, cx));
        let (height, side, text) = match self.size {
            Size::Small => (34.0, 10.0, 12.5),
            Size::Medium => (36.0, 18.0, 14.0),
            Size::Compact => (35.1, 13.0, 12.0),
        };
        let height = self.height.unwrap_or(height);
        let contained = self.emphasis == Emphasis::Contained;
        let outlined = self.emphasis == Emphasis::Outlined;
        // A contained button is the accent unless it is told it destroys.
        let (fill, ink) = match (contained, self.tone) {
            (true, Tone::Danger) => (Some(theme.c.bad), theme.c.on_accent),
            (true, _) => (Some(theme.c.accent), theme.c.on_accent),
            (false, Tone::Danger) => (None, theme.c.bad),
            (false, _) if outlined => (None, theme.c.text),
            (false, tone) => (None, tone.of(&theme)),
        };
        let ring = Ring {
            corner: theme.skin.radius_md,
            ink: if fill.is_some() {
                theme.c.on_accent
            } else {
                theme.c.accent
            },
        };
        let button = div()
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
            .when(outlined, |button| button.border_1().border_color(theme.c.line2))
            .when(self.size == Size::Compact, |button| {
                button.font_weight(gpui::FontWeight::MEDIUM)
            })
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
            .child(crate::ui::widgets::label(&self.label, &theme));
        match stop {
            Some(stop) => stop.wrap(button, ring, window),
            None => button,
        }
    }
}
