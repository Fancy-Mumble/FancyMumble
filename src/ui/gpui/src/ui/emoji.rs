//! The emoji picker: every emoji the system's font is likely to draw, in
//! the groups Unicode files them under, found by name; for a reaction or
//! into what is being written.
//!
//! The emoji and what they are called come from the `emojis` crate, which
//! carries Unicode's own table. They are drawn as text, by the system's
//! emoji font, and only the rows in view are built.

use gpui::{
    AnyElement, Context, Entity, IntoElement, ParentElement, ScrollStrategy, SharedString, Styled,
    UniformListScrollHandle, Window, div, prelude::*, px, uniform_list,
};

use super::Shell;
use super::kit::Dialog;
use super::text_input::TextInput;
use super::widgets::{EMPHASIS, icon};
use crate::engine::{Action, ChannelId};
use crate::theme::Theme;

/// How many emoji stand in a row, and how large each one's cell is.
const ACROSS: usize = 9;
const CELL: f32 = 38.0;

/// How many of those last used are kept.
const RECENT: usize = 2 * ACROSS;

/// The newest Unicode version whose emoji are offered: what the emoji
/// fonts of the systems this runs on have. A newer one would be a box.
const NEWEST: u32 = 15;

/// The groups, in Unicode's order: what each is called, and the emoji
/// that stands for it on its tab.
const GROUPS: [(emojis::Group, &str, &str); 9] = [
    (emojis::Group::SmileysAndEmotion, "Smileys", "😀"),
    (emojis::Group::PeopleAndBody, "People", "👋"),
    (emojis::Group::AnimalsAndNature, "Nature", "🐱"),
    (emojis::Group::FoodAndDrink, "Food", "🍕"),
    (emojis::Group::TravelAndPlaces, "Places", "🚀"),
    (emojis::Group::Activities, "Activities", "🎉"),
    (emojis::Group::Objects, "Objects", "💡"),
    (emojis::Group::Symbols, "Symbols", "✅"),
    (emojis::Group::Flags, "Flags", "🏁"),
];

/// What a picked emoji is for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum For {
    /// Into what is being written.
    Composer,
    /// Onto a message, as a reaction.
    Reaction { channel: ChannelId, id: String },
}

/// One row of the picker. Every row is as tall as a cell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Row {
    /// What the emoji under it have in common.
    Heading(&'static str),
    /// Up to a row's worth of emoji.
    Emoji(Vec<&'static str>),
}

/// The picker's own state: what narrows it, its rows, and what was used
/// last.
#[derive(Default)]
pub(super) struct Picker {
    /// What is typed to find an emoji; made the first time it opens.
    search: Option<Entity<TextInput>>,
    rows: Vec<Row>,
    /// Those last used, the newest first: what is written out.
    pub(super) recent: Vec<String>,
    scroll: UniformListScrollHandle,
}

impl Picker {
    /// Starting with the emoji used `recent`ly, the newest first.
    pub(super) fn remembering(recent: Vec<String>) -> Self {
        Self {
            recent,
            ..Self::default()
        }
    }

    /// Note that `emoji` was used: it goes to the head of those last used.
    fn used(&mut self, emoji: &str) {
        self.recent.retain(|known| known != emoji);
        self.recent.insert(0, emoji.to_owned());
        self.recent.truncate(RECENT);
    }
}

/// Whether the system's font can be expected to draw `emoji`.
fn offered(emoji: &emojis::Emoji) -> bool {
    emoji.unicode_version().major() <= NEWEST
}

/// Whether `emoji` is called `wanted`: a word of its name, or of a
/// shortcode people type for it, begins so. Words, not any letters in a
/// row: "cat" is a cat, and not an identifi-cat-ion card. Several words
/// are looked for as they stand.
fn called(emoji: &emojis::Emoji, wanted: &str) -> bool {
    if wanted.contains(' ') {
        return emoji.name().contains(wanted);
    }
    let begins = |words: &str| {
        words
            .split([' ', '-', '_'])
            .any(|word| word.starts_with(wanted))
    };
    begins(emoji.name()) || emoji.shortcodes().any(begins)
}

/// `emoji` laid out `ACROSS` to a row.
fn in_rows<'a>(emoji: &'a [&'static str]) -> impl Iterator<Item = Row> + 'a {
    emoji.chunks(ACROSS).map(|row| Row::Emoji(row.to_vec()))
}

/// The picker's rows. With nothing `wanted`: those used `recent`ly, then
/// every group under its name. With something wanted: the emoji whose name
/// or shortcode has it, in Unicode's order, under no heading.
pub(super) fn rows(wanted: &str, recent: &[String]) -> Vec<Row> {
    let wanted = wanted.trim().to_lowercase();
    if !wanted.is_empty() {
        let found: Vec<&'static str> = emojis::iter()
            .filter(|emoji| offered(emoji))
            .filter(|emoji| called(emoji, &wanted))
            .map(emojis::Emoji::as_str)
            .collect();
        return in_rows(&found).collect();
    }
    let mut rows = Vec::new();
    // Only what is still an emoji this picker offers: the file is the
    // user's to edit.
    let recent: Vec<&'static str> = recent
        .iter()
        .filter_map(|used| emojis::get(used))
        .map(emojis::Emoji::as_str)
        .collect();
    if !recent.is_empty() {
        rows.push(Row::Heading("Recently used"));
        rows.extend(in_rows(&recent));
    }
    for (group, name, _) in GROUPS {
        let of_group: Vec<&'static str> = group
            .emojis()
            .filter(|emoji| offered(emoji))
            .map(emojis::Emoji::as_str)
            .collect();
        rows.push(Row::Heading(name));
        rows.extend(in_rows(&of_group));
    }
    rows
}

impl Shell {
    /// Open the picker for `purpose`, on every emoji, with the field that
    /// narrows it ready to be typed in.
    pub(super) fn open_emoji(
        &mut self,
        purpose: For,
        window: Option<&mut Window>,
        cx: &mut Context<Self>,
    ) {
        let picker = &mut self.panels.emoji;
        let search = match &picker.search {
            Some(search) => search.clone(),
            None => {
                let search = cx.new(|cx| TextInput::new("Find an emoji", cx));
                cx.observe(&search, |shell, _, cx| shell.narrow_emoji(cx))
                    .detach();
                self.panels.emoji.search = Some(search.clone());
                search
            }
        };
        search.update(cx, |search, _| search.clear());
        if let Some(window) = window {
            window.focus(&search.focus_handle(cx), cx);
        }
        self.emoji_for = Some(purpose);
        self.narrow_emoji(cx);
    }

    /// What is typed to find an emoji changed: list them again, from the top.
    fn narrow_emoji(&mut self, cx: &mut Context<Self>) {
        let picker = &mut self.panels.emoji;
        let wanted = picker
            .search
            .as_ref()
            .map(|search| search.read(cx).text().to_owned())
            .unwrap_or_default();
        picker.rows = rows(&wanted, &picker.recent);
        picker.scroll.scroll_to_item(0, ScrollStrategy::Top);
        cx.notify();
    }

    /// Go to where the group called `name` begins.
    fn show_emoji_group(&mut self, name: &'static str, cx: &mut Context<Self>) {
        let picker = &self.panels.emoji;
        let at = picker
            .rows
            .iter()
            .position(|row| *row == Row::Heading(name));
        if let Some(at) = at {
            picker.scroll.scroll_to_item(at, ScrollStrategy::Top);
            cx.notify();
        }
    }

    /// Use `emoji` for what the picker was opened for, and close it.
    fn pick_emoji(&mut self, emoji: &'static str, window: &mut Window, cx: &mut Context<Self>) {
        self.panels.emoji.used(emoji);
        self.remember_settings(cx);
        match self.emoji_for.take() {
            Some(For::Composer) => {
                self.composer.update(cx, |composer, cx| {
                    composer.type_text(emoji);
                    composer.focus(window, cx);
                    cx.notify();
                });
            }
            Some(For::Reaction { channel, id }) => self.engine.act(Action::React {
                channel,
                id,
                emoji: emoji.to_owned(),
                add: true,
            }),
            None => {}
        }
        cx.notify();
    }

    /// The rows of the picker in view.
    fn emoji_rows(
        &mut self,
        range: std::ops::Range<usize>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let theme = crate::theme::ActiveTheme::get(cx);
        range
            .filter_map(|at| {
                Some(match self.panels.emoji.rows.get(at)? {
                    Row::Heading(name) => heading(name, &theme).into_any_element(),
                    Row::Emoji(emoji) => cells(emoji, at, &theme, cx).into_any_element(),
                })
            })
            .collect()
    }
}

/// What a stretch of the picker is called.
fn heading(name: &'static str, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .h(px(CELL))
        .flex()
        .items_end()
        .pb(px(6.0))
        .px(px(4.0))
        .text_size(px(11.0))
        .font_weight(EMPHASIS)
        .text_color(theme.c.muted)
        .child(name)
}

/// One row of emoji, each a click away from being used.
fn cells(
    emoji: &[&'static str],
    row: usize,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    div()
        .h(px(CELL))
        .flex()
        .children(emoji.iter().enumerate().map(|(at, emoji)| {
            let emoji: &'static str = emoji;
            div()
                .id(("emoji", row * ACROSS + at))
                .debug_selector(move || format!("emoji-{emoji}"))
                .size(px(CELL))
                .flex()
                .items_center()
                .justify_center()
                .rounded(theme.skin.radius_md)
                .cursor_pointer()
                .text_size(px(21.0))
                .hover(move |style| style.bg(hover))
                // Not also a click on the veil underneath.
                .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(cx.listener(move |shell, _, window, cx| {
                    shell.pick_emoji(emoji, window, cx);
                }))
                .child(SharedString::from(emoji))
        }))
}

/// The tabs: one emoji for each group, a click going to where it begins.
fn tabs(theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    div()
        .flex()
        .justify_between()
        .pb(px(4.0))
        .border_b_1()
        .border_color(theme.c.line)
        .children(GROUPS.iter().enumerate().map(|(at, (_, name, stands))| {
            let (name, stands): (&'static str, &'static str) = (name, stands);
            div()
                .id(("emoji-group", at))
                .debug_selector(move || format!("emoji-group-{name}"))
                .size(px(32.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded(theme.skin.radius_md)
                .cursor_pointer()
                .text_size(px(17.0))
                .hover(move |style| style.bg(hover))
                .tooltip(super::kit::keyed_tip(name, None::<&str>))
                .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(cx.listener(move |shell, _, _, cx| shell.show_emoji_group(name, cx)))
                .child(stands)
        }))
}

/// The picker, over a veil that closes it.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let picker = &shell.panels.emoji;
    let searching = picker
        .search
        .as_ref()
        .is_some_and(|search| !search.read(cx).text().trim().is_empty());
    let field = picker.search.clone().map(|search| {
        div()
            .flex_none()
            .h(px(36.0))
            .flex()
            .items_center()
            .gap(px(8.0))
            .px(px(12.0))
            .rounded(theme.skin.radius_md)
            .bg(theme.c.input)
            .border_1()
            .border_color(theme.c.line2)
            .text_size(px(13.0))
            // A press in the field is not one on the veil underneath.
            .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(icon("search", 12.0, theme.c.dim))
            .child(search)
    });
    let nothing = picker.rows.is_empty().then(|| {
        div()
            .py(px(30.0))
            .flex()
            .justify_center()
            .text_size(px(12.5))
            .text_color(theme.c.dim)
            .child("No emoji is called that.")
    });
    #[expect(clippy::cast_precision_loss, reason = "a handful of cells")]
    let width = CELL * ACROSS as f32;
    Dialog::new("emoji-picker")
        .veil(0.35)
        .on_dismiss(cx.listener(|shell, _, _, cx| {
            shell.emoji_for = None;
            cx.notify();
        }))
        .w(px(width + 32.0))
        .h(px(460.0))
        .gap(px(8.0))
        .p(px(16.0))
        .children(field)
        // The tabs go to a group: with a search there are none to go to.
        .when(!searching, |dialog| dialog.child(tabs(theme, cx)))
        .children(nothing)
        .child(
            uniform_list(
                "emoji-rows",
                picker.rows.len(),
                cx.processor(Shell::emoji_rows),
            )
            .track_scroll(&picker.scroll)
            .flex_1()
            .min_h_0(),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all(rows: &[Row]) -> Vec<&'static str> {
        rows.iter()
            .filter_map(|row| match row {
                Row::Emoji(emoji) => Some(emoji.clone()),
                Row::Heading(_) => None,
            })
            .flatten()
            .collect()
    }

    #[test]
    fn every_group_is_listed_under_its_name_and_no_emoji_twice() {
        let listed = rows("", &[]);
        let headings: Vec<_> = listed
            .iter()
            .filter_map(|row| match row {
                Row::Heading(name) => Some(*name),
                Row::Emoji(_) => None,
            })
            .collect();
        assert_eq!(headings.len(), GROUPS.len());
        assert_eq!(headings.first(), Some(&"Smileys"));
        let emoji = all(&listed);
        assert!(emoji.len() > 1000, "{}", emoji.len());
        let mut seen = std::collections::HashSet::new();
        for one in &emoji {
            assert!(seen.insert(*one), "{one} is there twice");
        }
        // No row is longer than it is drawn.
        assert!(listed.iter().all(|row| match row {
            Row::Emoji(emoji) => !emoji.is_empty() && emoji.len() <= ACROSS,
            Row::Heading(_) => true,
        }));
        // Each tab stands for its group with one of that group's own.
        for (group, _, stands) in GROUPS {
            assert_eq!(emojis::get(stands).map(emojis::Emoji::group), Some(group));
        }
    }

    #[test]
    fn an_emoji_is_found_by_what_it_is_called() {
        let found = all(&rows("  Party ", &[]));
        assert!(found.contains(&"🎉"), "party popper: {found:?}");
        assert!(found.contains(&"🥳"), "partying face");
        // By the shortcode people type, too.
        assert!(all(&rows("tada", &[])).contains(&"🎉"));
        assert!(rows("no emoji is called this", &[]).is_empty());
        // A word that begins so, not any letters in a row.
        let cats = all(&rows("cat", &[]));
        assert!(cats.contains(&"🐈") && !cats.contains(&"🪪"), "{cats:?}");
        assert!(all(&rows("red heart", &[])).contains(&"❤️"));
    }

    #[test]
    fn what_was_used_last_comes_first_and_is_not_kept_forever() {
        let mut picker = Picker::default();
        picker.used("🎉");
        picker.used("👍");
        picker.used("🎉");
        assert_eq!(picker.recent, ["🎉", "👍"], "the newest first, once each");
        for emoji in emojis::iter().take(RECENT + 5) {
            picker.used(emoji.as_str());
        }
        assert_eq!(picker.recent.len(), RECENT);
        let listed = rows("", &picker.recent);
        assert_eq!(listed.first(), Some(&Row::Heading("Recently used")));
        // What is no emoji is not listed, whatever the file says.
        let odd = rows("", &["not an emoji".to_owned()]);
        assert_eq!(odd.first(), Some(&Row::Heading("Smileys")));
    }
}
