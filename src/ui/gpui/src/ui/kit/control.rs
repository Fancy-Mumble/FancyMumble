//! The small controls: a row of a menu, a switch, a radio mark.

use gpui::{
    App, ClickEvent, ElementId, IntoElement, MouseButton, ParentElement, RenderOnce, SharedString,
    Styled, Window, div, prelude::*, px,
};

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
    danger: bool,
    ticked: bool,
    selected: bool,
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
            danger: false,
            ticked: false,
            selected: false,
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
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let hover = theme.c.hover;
        div()
            .id(self.id)
            .when_some(self.selector, |row, selector| {
                row.debug_selector(move || selector.to_string())
            })
            .flex_none()
            .h(px(self.height))
            .flex()
            .items_center()
            .gap(px(8.0))
            .px(px(10.0))
            .rounded(theme.skin.radius_md)
            .cursor_pointer()
            .text_size(px(13.0))
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
            .children(self.lead)
            .child(div().flex_1().min_w_0().truncate().child(self.label))
            .when(self.ticked, |row| {
                row.child(icon("check", 13.0, theme.c.accent_text))
            })
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
        // Off, the knob is the pale grey the web UI's switch comes with.
        let (track, knob) = if self.on {
            (theme.c.accent, theme.c.on_accent)
        } else {
            (theme.c.card2, gpui::rgb(0xe0_e0e0).into())
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

/// A setting that is on or off: what it is called, and its switch, on a
/// row that takes the click.
///
/// ```ignore
/// SwitchRow::new("no-typing", "Tell others when I am writing", on).on_click(...)
/// ```
#[derive(IntoElement)]
pub(crate) struct SwitchRow {
    id: &'static str,
    label: SharedString,
    on: bool,
    trailing: Option<gpui::AnyElement>,
    on_click: Option<OnClick>,
}

impl SwitchRow {
    /// `id` also names it for the tests.
    pub(crate) fn new(id: &'static str, label: impl Into<SharedString>, on: bool) -> Self {
        Self {
            id,
            label: label.into(),
            on,
            trailing: None,
            on_click: None,
        }
    }

    /// Something that goes with the setting, drawn after its switch.
    pub(crate) fn trailing(mut self, trailing: impl IntoElement) -> Self {
        self.trailing = Some(trailing.into_any_element());
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

impl RenderOnce for SwitchRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let hover = theme.c.hover;
        let id = self.id;
        div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .min_h(px(30.0))
            .flex()
            .items_center()
            .gap(px(8.0))
            .px(px(8.0))
            .rounded(theme.skin.radius_md)
            .cursor_pointer()
            .text_size(px(13.0))
            .hover(move |style| style.bg(hover))
            .when_some(self.on_click, |row, handler| row.on_click(handler))
            .child(div().flex_1().min_w_0().child(self.label))
            .child(Switch::new(self.on))
            .children(self.trailing)
    }
}
