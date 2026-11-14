//! What one cell of a table holds: a name, a quieter word, how long ago
//! something was, the pills of some roles, the menu of what can be done to
//! the row, or something a page draws itself.

use gpui::{AnyElement, App, Hsla, IntoElement, ParentElement, SharedString, Styled, div, px};

use super::measure::Setting;
use crate::theme::Theme;
use crate::ui::kit::RolePill;
use crate::words::t;

/// The words of a cell: 12 pixels on an 18-pixel line.
pub(super) const WORDS: f32 = 12.0;
pub(super) const WORDS_LINE: f32 = 18.0;

/// Between two pills, and what a pill has besides its name: its dot, the
/// gap after it, its sides and its edge.
pub(super) const PILL_GAP: f32 = 4.0;
const PILL_ROOM: f32 = 6.0 + 5.0 + 6.0 + 6.0 + 2.0;

/// The ellipsis button of a row's menu, square.
pub(super) const MENU_SIDE: f32 = 25.0;

/// One cell.
pub(crate) enum Cell {
    /// What the row is: its name, in the text ink and a little heavier.
    Strong(SharedString),
    /// Something about it, in the muted ink.
    Text(SharedString),
    /// Roles, as their pills, side by side: a name and a colour each.
    Chips(Vec<(SharedString, Option<Hsla>)>),
    /// The button that opens what can be done to the row.
    Menu,
    /// Drawn by the page: a field the row is being changed in.
    Own(AnyElement),
}

impl Cell {
    /// How long before `now_ms` the moment `at_ms` was, as the web UI's
    /// `formatRelativeDate` says it: in the largest whole unit.
    pub(crate) fn ago(at_ms: u64, now_ms: u64) -> Self {
        Self::Text(ago(at_ms, now_ms))
    }

    /// How wide the cell's content is when nothing is wrapped.
    pub(super) fn natural(&self, theme: &Theme, cx: &App) -> f32 {
        let words = |text: &str, weight| Setting::new(WORDS, weight).width(text, theme, cx);
        match self {
            Self::Strong(text) => words(text, gpui::FontWeight::MEDIUM),
            Self::Text(text) => words(text, gpui::FontWeight::NORMAL),
            Self::Chips(chips) => {
                let pill = Setting::new(11.0, gpui::FontWeight::SEMIBOLD);
                let names: f32 = chips
                    .iter()
                    .map(|(name, _)| pill.width(name, theme, cx) + PILL_ROOM)
                    .sum();
                names + PILL_GAP * chips.len().saturating_sub(1) as f32
            }
            Self::Menu => MENU_SIDE,
            Self::Own(_) => 0.0,
        }
    }

    /// The cell's content, for a cell already placed and padded.
    pub(super) fn content(self, theme: &Theme, menu: Option<AnyElement>) -> AnyElement {
        let words = |text: SharedString| {
            div()
                .min_w_0()
                .truncate()
                .text_size(px(WORDS))
                .line_height(px(WORDS_LINE))
                .child(text)
        };
        match self {
            Self::Strong(text) => words(text)
                .font_weight(gpui::FontWeight::MEDIUM)
                .text_color(theme.c.text)
                .into_any_element(),
            Self::Text(text) => words(text).text_color(theme.c.muted).into_any_element(),
            Self::Chips(chips) => div()
                .min_w_0()
                .flex()
                .flex_wrap()
                .gap(px(PILL_GAP))
                .children(
                    chips
                        .into_iter()
                        .map(|(name, color)| RolePill::new(name, color)),
                )
                .into_any_element(),
            Self::Menu => menu.unwrap_or_else(|| div().into_any_element()),
            Self::Own(element) => element,
        }
    }
}

/// `at_ms` before `now_ms`, in the largest whole unit: just now, minutes,
/// hours, days, months of thirty days, years of twelve months.
pub(crate) fn ago(at_ms: u64, now_ms: u64) -> SharedString {
    let minutes = now_ms.saturating_sub(at_ms) / 60_000;
    let hours = minutes / 60;
    let days = hours / 24;
    let months = days / 30;
    if minutes < 1 {
        t!("just now")
    } else if minutes < 60 {
        t!("{{count}}m ago", count = minutes)
    } else if hours < 24 {
        t!("{{count}}h ago", count = hours)
    } else if days < 30 {
        t!("{{count}}d ago", count = days)
    } else if months < 12 {
        t!("{{count}}mo ago", count = months)
    } else {
        t!("{{count}}y ago", count = months / 12)
    }
}

#[cfg(test)]
mod tests {
    use super::ago;

    #[test]
    fn a_moment_is_said_in_its_largest_whole_unit() {
        const MINUTE: u64 = 60_000;
        let now = 1_000_000 * MINUTE;
        let said = |minutes: u64| ago(now - minutes * MINUTE, now).to_string();
        assert_eq!(said(0), "just now");
        assert_eq!(said(59), "59m ago");
        assert_eq!(said(60), "1h ago");
        assert_eq!(said(24 * 60), "1d ago");
        assert_eq!(said(29 * 24 * 60), "29d ago");
        assert_eq!(said(30 * 24 * 60), "1mo ago");
        assert_eq!(said(365 * 24 * 60), "1y ago");
        // A moment after now, a clock set wrong: just now, as the web says.
        assert_eq!(ago(now + MINUTE, now).to_string(), "just now");
    }
}
