//! Accounts chosen for something, as chips, and a field to add one by name
//! or number: the web UI's `MemberPicker` (`nebula/components/admin`).
//!
//! ```ignore
//! MemberPicker::new("role-members", field)
//!     .chosen(members).suggested(matches).empty(t!("No explicit members"))
//!     .on_remove(cx.listener(|shell, id: &u32, _, cx| ...))
//!     .on_pick(cx.listener(|shell, id: &u32, _, cx| ...))
//! ```

use std::rc::Rc;

use gpui::{
    App, ElementId, Entity, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window,
    div, prelude::*, px,
};

use super::{IconButton, Reachable, TextBox};
use crate::theme::ActiveTheme;
use crate::ui::text_input::TextInput;

/// What choosing or letting go of an account does, told which.
type OnAccount = Rc<dyn Fn(&u32, &mut Window, &mut App)>;

/// The chips and the field.
#[derive(IntoElement)]
pub(crate) struct MemberPicker {
    id: &'static str,
    field: Entity<TextInput>,
    chosen: Vec<(u32, SharedString)>,
    suggested: Vec<(u32, SharedString)>,
    empty: SharedString,
    locked: bool,
    on_remove: Option<OnAccount>,
    on_pick: Option<OnAccount>,
}

impl MemberPicker {
    /// `id` names its parts for the tests: the field `<id>`, a chip's way
    /// out `<id>-remove-<account>`, a suggestion `<id>-pick-<account>`.
    pub(crate) fn new(id: &'static str, field: Entity<TextInput>) -> Self {
        Self {
            id,
            field,
            chosen: Vec::new(),
            suggested: Vec::new(),
            empty: SharedString::default(),
            locked: false,
            on_remove: None,
            on_pick: None,
        }
    }

    /// The accounts chosen, each with its name.
    #[must_use]
    pub(crate) fn chosen(mut self, chosen: Vec<(u32, SharedString)>) -> Self {
        self.chosen = chosen;
        self
    }

    /// The accounts what is typed matches, to choose from.
    #[must_use]
    pub(crate) fn suggested(mut self, suggested: Vec<(u32, SharedString)>) -> Self {
        self.suggested = suggested;
        self
    }

    /// What it says while none is chosen.
    #[must_use]
    pub(crate) fn empty(mut self, empty: impl Into<SharedString>) -> Self {
        self.empty = empty.into();
        self
    }

    /// Shown, and not to be changed.
    #[must_use]
    pub(crate) fn locked(mut self, locked: bool) -> Self {
        self.locked = locked;
        self
    }

    #[must_use]
    pub(crate) fn on_remove(mut self, handler: impl Fn(&u32, &mut Window, &mut App) + 'static) -> Self {
        self.on_remove = Some(Rc::new(handler));
        self
    }

    #[must_use]
    pub(crate) fn on_pick(mut self, handler: impl Fn(&u32, &mut Window, &mut App) + 'static) -> Self {
        self.on_pick = Some(Rc::new(handler));
        self
    }
}

/// One chosen account: the first letter of its name in a disc, the name,
/// and the way to let it go.
fn chip(id: &'static str, account: u32, name: SharedString, on_remove: Option<OnAccount>, cx: &App) -> impl IntoElement + use<> {
    let theme = ActiveTheme::get(cx);
    let letter = SharedString::from(name.chars().next().map(|first| first.to_uppercase().to_string()).unwrap_or_default());
    div()
        .flex_none()
        .h(px(24.0))
        .pl(px(4.0))
        .pr(px(if on_remove.is_some() { 2.0 } else { 10.0 }))
        .flex()
        .items_center()
        .gap(px(6.0))
        .rounded(px(12.0))
        .bg(theme.c.card2)
        .text_size(px(12.0))
        .child(
            div()
                .flex_none()
                .size(px(18.0))
                .rounded_full()
                .bg(theme.c.hover)
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(10.0))
                .text_color(theme.c.muted)
                .child(letter),
        )
        .child(name)
        .children(on_remove.map(|handler| {
            IconButton::at(id, usize::try_from(account).unwrap_or(usize::MAX), "x")
                .selector(format!("{id}-remove-{account}"))
                .size(20.0)
                .glyph_size(12.0)
                .on_click(move |_, window, cx| handler(&account, window, cx))
        }))
}

impl RenderOnce for MemberPicker {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let id = self.id;
        let remove = (!self.locked).then_some(self.on_remove).flatten();
        let chips = div().flex().flex_wrap().gap(px(4.0)).min_h(px(24.0));
        let chips = if self.chosen.is_empty() {
            chips.child(
                div()
                    .py(px(2.0))
                    .text_size(px(12.0))
                    .text_color(theme.c.dim)
                    .child(self.empty),
            )
        } else {
            chips.children(
                self.chosen
                    .into_iter()
                    .map(|(account, name)| chip(id, account, name, remove.clone(), cx)),
            )
        };
        let hover = theme.c.hover;
        let suggestions: Vec<_> = self.suggested.into_iter().map(|(account, name)| {
            let pick = self.on_pick.clone();
            let selector = SharedString::from(format!("{id}-pick-{account}"));
            let named = selector.clone();
            let row = div()
                .id(ElementId::Name(selector.clone()))
                .debug_selector(move || named.to_string())
                .px(px(10.0))
                .py(px(6.0))
                .rounded(theme.skin.radius_sm)
                .text_size(px(12.5))
                .cursor_pointer()
                .hover(move |style| style.bg(hover))
                .when_some(pick, |row, pick| {
                    row.on_click(move |_, window, cx| pick(&account, window, cx))
                })
                .child(name);
            Reachable::new(ElementId::Name(selector), row)
        }).collect();
        div()
            .flex()
            .flex_col()
            .gap(px(6.0))
            .child(chips)
            .when(!self.locked, |picker| {
                picker
                    .child(div().debug_selector(move || id.to_owned()).child(TextBox::new(self.field)))
                    .child(div().flex().flex_col().children(suggestions))
            })
    }
}
