//! Send on a plate of its own, worded: the composer's last plate on a
//! theme that stands the composer as plates (`marks.composer_plates`), as
//! the web UI's drawn skin has it. The accent running lighter across it, in
//! an edge of the accent's own ink, the word cut into it in capitals.

use gpui::{
    App, ClickEvent, Hsla, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window,
    div, prelude::*, px,
};

use super::focus::{Ring, TabStop};
use super::shape::{Finish, cut_into};
use crate::theme::{ActiveTheme, Kind};

type OnClick = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// The plate.
///
/// ```ignore
/// SendPlate::new("send", "Send").ready(armed).on_click(...)
/// ```
#[derive(IntoElement)]
pub(crate) struct SendPlate {
    id: &'static str,
    label: SharedString,
    tip: Option<(SharedString, Option<SharedString>)>,
    /// Something to send: lit. Nothing: the accent, faded, and no gradient.
    ready: bool,
    on_click: Option<OnClick>,
}

impl SendPlate {
    /// `id` also names it to the tests.
    pub(crate) fn new(id: &'static str, label: impl Into<SharedString>) -> Self {
        Self {
            id,
            label: label.into(),
            tip: None,
            ready: false,
            on_click: None,
        }
    }

    pub(crate) fn ready(mut self, ready: bool) -> Self {
        self.ready = ready;
        self
    }

    /// What it says under the pointer, and the key that does the same.
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

/// `color` mixed with white by `amount`, as MUI's `lighten` mixes it.
fn lighten(color: Hsla, amount: f32) -> Hsla {
    let rgba = gpui::Rgba::from(color);
    gpui::Rgba {
        r: rgba.r + (1.0 - rgba.r) * amount,
        g: rgba.g + (1.0 - rgba.g) * amount,
        b: rgba.b + (1.0 - rgba.b) * amount,
        a: rgba.a,
    }
    .into()
}

impl RenderOnce for SendPlate {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let cut = theme.skin.cuts.of(Kind::Plate);
        let ink = theme.c.on_accent;
        let finish = Finish::new(theme.c.accent, Some(theme.c.accent_text));
        let finish = if self.ready {
            finish.fading_to(100.0, lighten(theme.c.accent, 0.22))
        } else {
            finish
        };
        let id = self.id;
        let button = div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .flex_none()
            .h(px(56.0))
            .px(px(26.0))
            .flex()
            .items_center()
            .gap(px(10.0))
            .cursor_pointer()
            .when(!self.ready, |button| button.opacity(0.55))
            .map(|button| match cut {
                Some(cut) => cut_into(button, cut, finish, theme.skin.line_width),
                None => button
                    .rounded(theme.skin.radius_md)
                    .bg(theme.c.accent)
                    .border_2()
                    .border_color(theme.c.accent_text),
            })
            .child(
                div()
                    .relative()
                    .italic()
                    .font_weight(gpui::FontWeight::EXTRA_BOLD)
                    .text_size(px(12.5))
                    .line_height(px(12.5))
                    .letter_spacing(0.12)
                    .text_color(ink)
                    .child(SharedString::from(self.label.to_uppercase())),
            )
            .child(div().relative().child(crate::ui::widgets::icon("send", 14.0, ink)))
            .when_some(self.tip, |button, (says, key)| {
                button.tooltip(super::keyed_tip(says, key))
            })
            .when_some(self.on_click, |button, handler| button.on_click(handler));
        let ring = Ring {
            corner: theme.skin.radius_md,
            ink,
        };
        let stop = TabStop::new(id, window, cx);
        match cut {
            Some(cut) => stop.wrap_cut(button, ring, Some(cut), window),
            None => stop.wrap(button, ring, window),
        }
    }
}
