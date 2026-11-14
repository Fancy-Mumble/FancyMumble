//! The small controls: a row of a menu, a switch, a radio mark.

use gpui::{
    App, ClickEvent, ElementId, IntoElement, MouseButton, ParentElement, RenderOnce, SharedString,
    Styled, Window, div, prelude::*, px,
};

use super::focus::{Ring, TabStop};
use super::icon;
use crate::theme::ActiveTheme;

type OnClick = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// One row of a menu or of a list of choices: what it says, a tick at its
/// end if it is the one in force.
///
/// ```ignore
/// MenuItem::new(("menu-item", index), "Rename…").selector("menu-Rename…").on_click(...)
/// ```
#[derive(IntoElement)]
pub(crate) struct MenuItem {
    id: ElementId,
    selector: Option<SharedString>,
    label: SharedString,
    lead: Option<gpui::AnyElement>,
    /// A line under the words, saying what it does.
    hint: Option<SharedString>,
    /// Something drawn at the row's end: a switch, a chevron.
    trail: Option<gpui::AnyElement>,
    danger: bool,
    ticked: bool,
    selected: bool,
    /// Drawn in the measures of the web UI's sheet over the dock: larger
    /// words, more room round them, as tall as they make it.
    roomy: bool,
    height: f32,
    on_click: Option<OnClick>,
}

impl MenuItem {
    pub(crate) fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            selector: None,
            label: label.into(),
            lead: None,
            hint: None,
            trail: None,
            danger: false,
            ticked: false,
            selected: false,
            roomy: false,
            height: 30.0,
            on_click: None,
        }
    }

    /// What the tests call it.
    pub(crate) fn selector(mut self, selector: impl Into<SharedString>) -> Self {
        self.selector = Some(selector.into());
        self
    }

    /// Something drawn before the words: a swatch, an icon.
    pub(crate) fn lead(mut self, lead: impl IntoElement) -> Self {
        self.lead = Some(lead.into_any_element());
        self
    }

    /// A line under the words, saying what it does.
    pub(crate) fn hint(mut self, hint: impl Into<SharedString>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    /// Something drawn at the row's end: a switch that shows the state, a
    /// chevron for a row that opens somewhere else.
    pub(crate) fn trail(mut self, trail: impl IntoElement) -> Self {
        self.trail = Some(trail.into_any_element());
        self
    }

    /// In the measures of the web UI's sheet over the dock.
    pub(crate) fn roomy(mut self) -> Self {
        self.roomy = true;
        self
    }

    /// In the destructive ink.
    pub(crate) fn danger(mut self, danger: bool) -> Self {
        self.danger = danger;
        self
    }

    /// With a tick at its end.
    pub(crate) fn ticked(mut self, ticked: bool) -> Self {
        self.ticked = ticked;
        self
    }

    /// Washed in the accent: the choice in force.
    pub(crate) fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    /// The row's height, in pixels.
    pub(crate) fn height(mut self, height: f32) -> Self {
        self.height = height;
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

impl RenderOnce for MenuItem {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let hover = theme.c.hover;
        let stop = self
            .on_click
            .is_some()
            .then(|| TabStop::new(self.id.clone(), window, cx));
        let ring = Ring {
            corner: theme.skin.radius_md,
            ink: theme.c.accent,
        };
        let row = div()
            .id(self.id)
            .when_some(self.selector, |row, selector| {
                row.debug_selector(move || selector.to_string())
            })
            .flex_none()
            .flex()
            .map(|row| {
                if self.roomy {
                    // `MenuItem` in the web UI's sheet: 13.5px words, 8px by
                    // 12px round them, 12px between them and the glyph; a
                    // row with a line under its words leads with the glyph
                    // on the first line.
                    row.py(px(8.0))
                        .px(px(12.0))
                        .gap(px(12.0))
                        .text_size(px(13.5))
                        .line_height(px(20.925))
                        .when(self.hint.is_some(), Styled::items_start)
                        .when(self.hint.is_none(), Styled::items_center)
                } else {
                    row.h(px(self.height))
                        .items_center()
                        .gap(px(8.0))
                        .px(px(10.0))
                        .text_size(px(13.0))
                }
            })
            .rounded(theme.skin.radius_md)
            .cursor_pointer()
            .when(self.danger, |row| row.text_color(theme.c.bad))
            .map(|row| {
                if self.selected {
                    row.bg(theme.c.accent_soft)
                } else {
                    row.hover(move |style| style.bg(hover))
                }
            })
            // Not also a press on whatever the menu floats over.
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .when_some(self.on_click, |row, handler| row.on_click(handler))
            .children(self.lead.map(|lead| {
                div()
                    .flex_none()
                    .flex()
                    .when(self.hint.is_some(), |lead| lead.mt(px(1.0)))
                    .child(lead)
            }))
            .map(|row| match self.hint {
                Some(hint) => row.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(1.0))
                        .child(self.label)
                        // On one line, as the web UI's menu rows keep theirs,
                        // running on under what stands at the row's end.
                        .child(
                            div()
                                .whitespace_nowrap()
                                .text_size(px(11.0))
                                .line_height(px(14.85))
                                .text_color(theme.c.muted)
                                .child(hint),
                        ),
                ),
                None => row.child(div().flex_1().min_w_0().truncate().child(self.label)),
            })
            .children(self.trail)
            .when(self.ticked, |row| {
                row.child(icon("check", 13.0, theme.c.accent_text))
            });
        match stop {
            Some(stop) => stop.wrap(row, ring, window),
            None => row,
        }
    }
}

/// A switch: a track with a knob at the end that says on. It only shows;
/// the row it sits in takes the click.
#[derive(IntoElement)]
pub(crate) struct Switch {
    on: bool,
}

impl Switch {
    pub(crate) fn new(on: bool) -> Self {
        Self { on }
    }
}

impl RenderOnce for Switch {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        // Off, the knob is what the web UI's switch comes with: white in a
        // light scheme, a pale grey in a dark one.
        let off = if theme.mode == crate::theme::Mode::Light {
            gpui::rgb(0xff_ffff)
        } else {
            gpui::rgb(0xe0_e0e0)
        };
        let (track, knob) = if self.on {
            (theme.c.accent, theme.c.on_accent)
        } else {
            (theme.c.card2, off.into())
        };
        // A capsule and a circle whatever the theme does to its corners.
        div()
            .flex_none()
            .w(px(32.0))
            .h(px(18.0))
            .p(px(2.0))
            .rounded_full()
            .bg(track)
            .flex()
            .when(self.on, Styled::justify_end)
            .child(div().size(px(14.0)).rounded_full().bg(knob))
    }
}

/// A radio mark: a ring, filled when it is the one chosen. It only shows;
/// the row it sits in takes the click.
#[derive(IntoElement)]
pub(crate) struct Radio {
    chosen: bool,
}

impl Radio {
    pub(crate) fn new(chosen: bool) -> Self {
        Self { chosen }
    }
}

impl RenderOnce for Radio {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        // Chosen, the ring is five pixels of accent round a hole.
        div().flex_none().size(px(16.0)).rounded_full().map(|ring| {
            if self.chosen {
                ring.border(px(5.0)).border_color(theme.c.accent)
            } else {
                ring.border_1().border_color(theme.c.line2)
            }
        })
    }
}

/// How a [`SwitchRow`] is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Look {
    /// A row of a list or a dialog: washed under the pointer.
    #[default]
    List,
    /// A setting on a page of them: its title in the heading weight and
    /// a line of what it does under it, the switch at the first line.
    Setting,
    /// A setting that stands alone, on a card of its own, the switch in
    /// the middle of its height.
    Card,
}

/// A setting that is on or off: what it is called, and its switch, on a
/// row that takes the click.
///
/// ```ignore
/// SwitchRow::new("no-typing", "Tell others when I am writing", on).on_click(...)
/// SwitchRow::new("compact", "Compact mode", on).look(Look::Card).hint("Hides avatars.")
/// ```
#[derive(IntoElement)]
pub(crate) struct SwitchRow {
    id: &'static str,
    label: SharedString,
    hint: Option<SharedString>,
    look: Look,
    on: bool,
    trailing: Option<gpui::AnyElement>,
    under: Vec<gpui::AnyElement>,
    lit: bool,
    on_click: Option<OnClick>,
}

impl SwitchRow {
    /// `id` also names it for the tests.
    pub(crate) fn new(id: &'static str, label: impl Into<SharedString>, on: bool) -> Self {
        Self {
            id,
            label: label.into(),
            hint: None,
            look: Look::default(),
            on,
            trailing: None,
            under: Vec::new(),
            lit: false,
            on_click: None,
        }
    }

    /// Its name lit for a moment: where the search sent the reader.
    pub(crate) fn lit(mut self, lit: bool) -> Self {
        self.lit = lit;
        self
    }

    pub(crate) fn look(mut self, look: Look) -> Self {
        self.look = look;
        self
    }

    /// A line of what the setting does, under its name.
    pub(crate) fn hint(mut self, hint: impl Into<SharedString>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    /// Something that goes with the setting, drawn after its switch.
    pub(crate) fn trailing(mut self, trailing: impl IntoElement) -> Self {
        self.trailing = Some(trailing.into_any_element());
        self
    }

    /// Something that hangs under the setting, inside it: what it says
    /// about itself, or a setting that only means something while it is
    /// on.
    pub(crate) fn under(mut self, under: impl IntoElement) -> Self {
        self.under.push(under.into_any_element());
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

impl SwitchRow {
    /// The name and the line under it, as a setting writes them.
    fn words(&self, theme: &crate::theme::Theme, cx: &App) -> gpui::Div {
        let card = self.look == Look::Card;
        div()
            .flex_1()
            .min_w_0()
            .child(super::lit::lit(
                div()
                    .text_size(px(12.5))
                    .font_weight(if card {
                        gpui::FontWeight::MEDIUM
                    } else {
                        crate::ui::widgets::EMPHASIS
                    })
                    .child(self.label.clone()),
                self.lit,
                cx,
            ))
            .children(self.hint.clone().map(|hint| {
                div()
                    .mt(px(if card { 2.0 } else { 3.0 }))
                    .text_size(px(if card { 11.0 } else { 11.5 }))
                    .line_height(gpui::relative(1.5))
                    .text_color(theme.c.muted)
                    .child(hint)
            }))
    }
}

impl RenderOnce for SwitchRow {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let hover = theme.c.hover;
        let id = self.id;
        let stop = TabStop::new(id, window, cx);
        let ring = Ring {
            corner: theme.skin.radius_md,
            ink: theme.c.accent,
        };
        let row = div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .flex()
            .rounded(theme.skin.radius_md)
            .cursor_pointer();
        let row = match self.look {
            Look::List => row
                .min_h(px(30.0))
                .items_center()
                .gap(px(8.0))
                .px(px(8.0))
                .text_size(px(13.0))
                .hover(move |style| style.bg(hover))
                .child(div().flex_1().min_w_0().child(self.label.clone())),
            Look::Setting => row
                .items_start()
                .gap(px(16.0))
                .child(self.words(&theme, cx))
                .child(div().flex_none().mt(px(1.0)).child(Switch::new(self.on))),
            Look::Card => row
                .items_center()
                .gap(px(12.0))
                .child(self.words(&theme, cx))
                .child(Switch::new(self.on)),
        };
        let row = row
            .when(self.look == Look::List, |row| {
                row.child(Switch::new(self.on))
            })
            .when_some(self.on_click, |row, handler| row.on_click(handler))
            .children(self.trailing);
        let row = stop.wrap(row, ring, window);
        match self.look {
            Look::List => row.into_any_element(),
            Look::Setting => div()
                .mb(px(14.0))
                .child(row)
                .children(self.under)
                .into_any_element(),
            Look::Card => div()
                .px(px(14.0))
                .py(px(12.0))
                .rounded(theme.skin.radius_md)
                .bg(theme.c.card)
                // The theme's own line, as the web UI's `--nebula-line-width`.
                .border(theme.skin.line_width)
                .border_color(theme.c.line)
                .child(row)
                .children(self.under)
                .into_any_element(),
        }
    }
}
