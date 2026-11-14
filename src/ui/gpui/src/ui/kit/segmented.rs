//! A segmented control: a few choices side by side, one of them taken.

use gpui::{
    App, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div, prelude::*, px,
};

use super::focus::{Ring, TabStop};
use crate::theme::ActiveTheme;

type OnChoose = Box<dyn Fn(&usize, &mut Window, &mut App) + 'static>;

/// A row of choices of which exactly one is taken: where there are too few
/// for a list and they are too alike for separate switches.
///
/// ```ignore
/// Segmented::new("hours", ["Auto", "12-hour", "24-hour"], 0).on_choose(|at, _, cx| ...)
/// ```
#[derive(IntoElement)]
pub(crate) struct Segmented {
    id: &'static str,
    choices: Vec<SharedString>,
    taken: usize,
    on_choose: Option<OnChoose>,
}

impl Segmented {
    /// `id` names it for the tests: each choice is `<id>-<its place>`.
    pub(crate) fn new<S: Into<SharedString>>(
        id: &'static str,
        choices: impl IntoIterator<Item = S>,
        taken: usize,
    ) -> Self {
        Self {
            id,
            choices: choices.into_iter().map(Into::into).collect(),
            taken,
            on_choose: None,
        }
    }

    /// What taking a choice does, told its place among the choices.
    pub(crate) fn on_choose(
        mut self,
        handler: impl Fn(&usize, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_choose = Some(Box::new(handler));
        self
    }
}

impl RenderOnce for Segmented {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let (id, taken) = (self.id, self.taken);
        let on_choose = self.on_choose.map(std::rc::Rc::new);
        let ring = Ring {
            corner: theme.skin.radius_md,
            ink: theme.c.accent,
        };
        let choosable = on_choose.is_some();
        let mut choices = Vec::with_capacity(self.choices.len());
        // The web UI's segmented track: the one taken lifted in the second
        // card colour, the rest bare words.
        for (at, says) in self.choices.into_iter().enumerate() {
            let on_choose = on_choose.clone();
            let choice = div()
                .id((id, at))
                .debug_selector(move || format!("{id}-{at}"))
                .px(px(15.0))
                .py(px(6.0))
                .flex()
                .items_center()
                .rounded(theme.skin.radius_md)
                .text_size(px(12.0))
                .line_height(gpui::relative(super::heading::LINE))
                .cursor_pointer()
                .map(|choice| {
                    if at == taken {
                        choice
                            .bg(theme.c.card2)
                            .text_color(theme.c.text)
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                    } else {
                        choice.text_color(theme.c.muted)
                    }
                })
                .when_some(on_choose, |choice, handler| {
                    choice.on_click(move |_, window, cx| handler(&at, window, cx))
                })
                .child(says);
            // Each choice is a stop of its own, taken with Enter or Space.
            choices.push(if choosable {
                TabStop::new((id, at), window, cx).wrap(choice, ring, window)
            } else {
                choice
            });
        }
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(3.0))
            .p(px(3.0))
            .rounded(theme.skin.radius_md)
            .bg(theme.c.card)
            .border_1()
            .border_color(theme.c.line)
            .children(choices)
    }
}
