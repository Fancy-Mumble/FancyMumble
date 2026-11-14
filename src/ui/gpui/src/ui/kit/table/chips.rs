//! A row's pills that open what they name: the web UI's `RoleChip` with
//! an `onClick`, as the Users table has its roles' pills open the Roles
//! page on that role.

use std::rc::Rc;

use gpui::{App, ElementId, Hsla, IntoElement, ParentElement, SharedString, Styled, Window, div, prelude::*, px};

use super::cell::Cell;
use crate::theme::Theme;
use crate::ui::kit::{Reachable, RolePill};

/// What a click on a pill does, told its row and its place in the row.
pub(super) type OnChip = Rc<dyn Fn(&(usize, usize), &mut Window, &mut App)>;

/// The pills of the row `row`, each a button.
pub(super) fn clickable(
    id: &'static str,
    row: usize,
    pills: Vec<(SharedString, Option<Hsla>)>,
    handler: &OnChip,
    theme: &Theme,
) -> Cell {
    let buttons = pills.into_iter().enumerate().map(|(at, (name, colour))| {
        let named = SharedString::from(format!("{id}-{row}-{at}"));
        let selector = named.clone();
        let handler = handler.clone();
        let button = div()
            .id(ElementId::Name(named.clone()))
            .debug_selector(move || selector.to_string())
            .cursor_pointer()
            .on_click(move |_, window, cx| handler(&(row, at), window, cx))
            .child(RolePill::new(name, colour));
        Reachable::new(ElementId::Name(named), button).corner(theme.skin.radius_pill)
    });
    Cell::Own(
        div()
            .min_w_0()
            .flex()
            .flex_wrap()
            .gap(px(super::cell::PILL_GAP))
            .children(buttons)
            .into_any_element(),
    )
}
