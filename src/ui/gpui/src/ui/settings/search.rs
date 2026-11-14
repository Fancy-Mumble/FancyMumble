//! Finding a setting by name: the web UI's `settingsSearchIndex` and
//! `SettingsSearch`.
//!
//! The index lists the headings each page draws, with words that should
//! find them without being written on them. A query finds the pages where
//! every one of its words is in a heading, in its English, or in its
//! words; a result names the page and how many of its headings matched,
//! and choosing one turns to the page with those headings lit.

use std::time::Duration;

use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::Reachable;
use super::super::text_input::InputEvent;
use super::Page;
use crate::theme::Theme;
use crate::words::t;

/// How long a heading stays lit after the search sent the reader to it.
const LIT_FOR: Duration = Duration::from_millis(2200);

/// One heading worth landing on: the page it is on, what it says (the
/// English, which is also the key its words are asked for by), and words
/// that should find it.
struct Entry {
    page: Page,
    title: fn() -> SharedString,
    english: &'static str,
    keywords: &'static [&'static str],
}

/// An entry for the heading `$english`, asked for with `t!` so that the
/// search matches what is on the screen in any language.
macro_rules! entry {
    ($page:ident, $english:literal, [$($keyword:literal),*]) => {
        Entry {
            page: Page::$page,
            title: || t!($english),
            english: $english,
            keywords: &[$($keyword),*],
        }
    };
}

/// Every heading of the pages this client has, page by page. Only what
/// the pages draw: a result must land on something.
const INDEX: &[Entry] = &[
    entry!(Profile, "Pronouns", []),
    entry!(Profile, "Contact", ["email", "link"]),
    entry!(Profile, "Status", ["away", "busy", "online"]),
    entry!(Profile, "Avatar", ["picture", "photo"]),
    entry!(Profile, "Banner", ["header image"]),
    entry!(
        Profile,
        "Card style",
        ["colors", "card background", "gradient"]
    ),
    entry!(
        Profile,
        "Card colours",
        ["colors", "card background", "gradient"]
    ),
    entry!(
        Profile,
        "Name style",
        ["font", "name colour", "bold", "italic"]
    ),
    entry!(
        Profile,
        "What the card shows",
        ["visibility", "hide fields"]
    ),
    entry!(Voice, "Input device", ["microphone", "mic"]),
    entry!(Voice, "Output device", ["speaker", "headphones"]),
    entry!(Voice, "Microphone volume", ["input volume"]),
    entry!(Voice, "Speaker volume", ["output volume"]),
    entry!(
        Voice,
        "Activation mode",
        ["voice activity", "vad", "push to talk", "ptt", "continuous"]
    ),
    entry!(
        Voice,
        "Voice gate",
        ["threshold", "sensitivity", "calibration"]
    ),
    entry!(Voice, "Auto gain", ["agc", "amplification", "levels"]),
    entry!(
        Voice,
        "Noise suppression",
        ["denoise", "denoiser", "background noise", "rnnoise"]
    ),
    entry!(
        Voice,
        "Transmission",
        ["bitrate", "bandwidth", "compression", "quality"]
    ),
    entry!(
        Voice,
        "Force TCP audio",
        ["udp", "firewall", "nat", "tunnel"]
    ),
    entry!(
        Voice,
        "Exclusive microphone mode",
        ["exclusive", "wasapi", "device in use"]
    ),
    entry!(
        Voice,
        "Hear yourself",
        ["record sample", "playback", "listen", "test"]
    ),
    entry!(Voice, "Max amplification", ["gain", "agc", "boost"]),
    entry!(Voice, "Processing", ["filters", "agc"]),
    entry!(Voice, "Fine tuning", ["denoiser", "knobs", "strength"]),
    entry!(Voice, "Legacy audio backend", ["cpal", "rodio", "backend"]),
    entry!(
        Voice,
        "Audio statistics",
        ["packets", "loss", "late", "udp"]
    ),
    entry!(Personalize, "Theme", ["dark", "light", "colours", "colors"]),
    entry!(
        Personalize,
        "Appearance",
        ["dark", "light", "system", "mode"]
    ),
    entry!(
        Personalize,
        "Text size",
        ["font size", "larger", "smaller", "zoom"]
    ),
    entry!(
        Personalize,
        "Message style",
        ["bubbles", "flat", "compact"]
    ),
    entry!(
        Personalize,
        "Chat background",
        ["wallpaper", "blur", "dim", "opacity", "picture"]
    ),
    entry!(Personalize, "Compact mode", ["density", "avatars", "spacing"]),
    entry!(
        Personalize,
        "Always show message actions",
        ["hover", "toolbar", "react", "reply"]
    ),
    entry!(
        Personalize,
        "Server list",
        ["rail", "title bar", "switcher"]
    ),
    entry!(
        Personalize,
        "Channel viewer",
        ["classic", "flat", "modern", "sidebar"]
    ),
    entry!(
        Notifications,
        "Notification sounds",
        ["sound", "audio alert", "chime"]
    ),
    entry!(
        Notifications,
        "Native notifications",
        ["os notifications", "desktop", "toast"]
    ),
    entry!(Notifications, "Welcome message", ["welcome", "motd", "popup"]),
    entry!(Privacy, "Disable read receipts", ["seen", "read receipts"]),
    entry!(Privacy, "Disable typing indicators", ["typing"]),
    entry!(Privacy, "Disable link previews", ["embeds", "previews"]),
    entry!(Privacy, "Enable dual-path sending", ["encryption", "dual path"]),
    entry!(Privacy, "Streamer mode", ["stream", "hide ip"]),
    entry!(Privacy, "Trusted sites", ["links", "browser", "hosts"]),
    entry!(
        Localization,
        "Language",
        ["language", "translation", "locale"]
    ),
    entry!(
        Localization,
        "Time Display",
        ["time format", "12h", "24h", "clock"]
    ),
    entry!(
        Localization,
        "Convert to local time",
        ["server time", "timezone"]
    ),
    entry!(Localization, "Date Display", ["date format"]),
    entry!(Localization, "Number Format", ["separator", "decimal"]),
    entry!(
        Shortcuts,
        "Voice - global",
        ["push to talk", "ptt", "mute", "deafen", "priority", "hotkey"]
    ),
    entry!(Shortcuts, "Voice - in-app", ["activation mode", "hotkey"]),
    entry!(
        Shortcuts,
        "Channel and navigation",
        ["quick search", "sidebar", "member panel", "hotkey"]
    ),
    entry!(
        Shortcuts,
        "Window",
        ["fullscreen", "open settings", "hotkey"]
    ),
    entry!(
        Shortcuts,
        "Whisper and shout",
        ["whisper", "shout", "voice target", "hotkey"]
    ),
    entry!(
        Shortcuts,
        "Chat - built-in (not configurable)",
        ["composer", "bold", "italic", "emoji", "mention"]
    ),
    entry!(
        Identities,
        "Identities",
        ["certificate", "key", "identity", "import", "export"]
    ),
    entry!(Advanced, "Expert Mode", ["expert"]),
    entry!(Advanced, "Developer Mode", ["developer", "debug"]),
    entry!(Advanced, "Log Level", ["logging", "log"]),
    entry!(Advanced, "Log to file", ["logging", "log", "file"]),
    entry!(
        Advanced,
        "Auto-compress old logs",
        ["logging", "log", "zip", "compress", "zstd"]
    ),
    entry!(
        Advanced,
        "Terminal logging (release builds)",
        ["logging", "log", "terminal", "console", "stdout"]
    ),
    entry!(Advanced, "Auto Reconnect", ["reconnect"]),
    entry!(
        Advanced,
        "Disconnect confirmation",
        ["disconnect", "confirmation"]
    ),
    entry!(Advanced, "Danger Zone", ["reset", "delete", "wipe"]),
    entry!(Advanced, "Log files", ["logging", "log", "folder"]),
];

/// A page with something that matches, how much, and the headings that
/// did, as drawn.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Hit {
    pub page: Page,
    pub titles: Vec<SharedString>,
}

/// The pages matching `query`, in the column's order.
pub(super) fn search(query: &str) -> Vec<Hit> {
    let lowered = query.trim().to_lowercase();
    let words: Vec<&str> = lowered.split_whitespace().collect();
    if words.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<Hit> = Vec::new();
    for entry in INDEX {
        let title = (entry.title)();
        let haystack =
            format!("{title} {} {}", entry.english, entry.keywords.join(" ")).to_lowercase();
        if !words.iter().all(|word| haystack.contains(word)) {
            continue;
        }
        match hits.iter_mut().find(|hit| hit.page == entry.page) {
            Some(hit) => hit.titles.push(title),
            None => hits.push(Hit {
                page: entry.page,
                titles: vec![title],
            }),
        }
    }
    hits.sort_by_key(|hit| Page::ALL.iter().position(|page| *page == hit.page));
    hits
}

/// The headings a chosen result lit on its page: those whose words hold
/// what was typed, or where the page says it nowhere (it matched a word
/// that finds a heading without being on it), the headings it matched.
#[derive(Debug, Clone, Default)]
pub(crate) struct Lit {
    titles: Vec<SharedString>,
    /// Bumped at each choice, so that the one lit before does not put this
    /// one out.
    turn: u32,
    /// Whether the page is still to be scrolled to what is lit.
    pub(super) seek: std::rc::Rc<std::cell::Cell<bool>>,
}

impl Lit {
    fn new(page: Page, term: &str, matched: Vec<SharedString>, turn: u32) -> Self {
        let term = term.trim().to_lowercase();
        let typed: Vec<SharedString> = INDEX
            .iter()
            .filter(|entry| entry.page == page)
            .map(|entry| (entry.title)())
            .filter(|title| !term.is_empty() && title.to_lowercase().contains(&term))
            .collect();
        Self {
            titles: if typed.is_empty() { matched } else { typed },
            turn,
            seek: std::rc::Rc::new(std::cell::Cell::new(true)),
        }
    }

    /// Whether the heading saying `title` is lit.
    pub(crate) fn lights(&self, title: &str) -> bool {
        self.titles.iter().any(|lit| lit.as_ref() == title)
    }
}

impl Shell {
    /// Something was typed in the search, or Enter or Escape pressed there.
    pub(super) fn on_settings_search(&mut self, event: &InputEvent, cx: &mut Context<Self>) {
        match event {
            InputEvent::Submitted(query) => {
                if let Some(first) = search(query).into_iter().next() {
                    self.choose_found(first, cx);
                }
            }
            InputEvent::Cancelled => self.clear_settings_search(cx),
            _ => cx.notify(),
        }
    }

    /// What is typed in the search.
    fn settings_query(&self, cx: &gpui::App) -> String {
        self.panels
            .settings
            .search
            .as_ref()
            .map(|search| search.field.read(cx).text().to_owned())
            .unwrap_or_default()
    }

    fn clear_settings_search(&mut self, cx: &mut Context<Self>) {
        if let Some(search) = &self.panels.settings.search {
            search.field.update(cx, |field, cx| {
                field.clear();
                cx.notify();
            });
        }
        cx.notify();
    }

    /// Turn to the page of `hit` and light what it found there for a
    /// moment; the search is emptied.
    fn choose_found(&mut self, hit: Hit, cx: &mut Context<Self>) {
        let term = self.settings_query(cx);
        let turn = self.panels.settings.lit.turn.wrapping_add(1);
        self.turn_to(hit.page, cx);
        self.panels.settings.lit = Lit::new(hit.page, &term, hit.titles, turn);
        self.clear_settings_search(cx);
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(LIT_FOR).await;
            let _ = shell.update(cx, |shell, cx| {
                if shell.panels.settings.lit.turn == turn {
                    shell.panels.settings.lit = Lit {
                        turn,
                        ..Lit::default()
                    };
                    cx.notify();
                }
            });
        })
        .detach();
    }
}

/// What the search found, under the field, while something is typed.
pub(super) fn results(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<impl IntoElement + use<>> {
    let query = shell.settings_query(cx);
    if query.trim().is_empty() {
        return None;
    }
    let hits = search(&query);
    let list = div().mt(px(8.0)).flex().flex_col().gap(px(1.0));
    if hits.is_empty() {
        return Some(
            list.child(
                div()
                    .px(px(12.0))
                    .py(px(8.0))
                    .text_size(px(11.5))
                    .text_color(theme.c.dim)
                    .child(t!("Nothing matches that.")),
            ),
        );
    }
    Some(list.children(hits.into_iter().map(|hit| result(hit, theme, cx))))
}

/// One page the search found: its name, and how many of its headings.
fn result(hit: Hit, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let id = hit.page.id();
    let hover = theme.c.hover;
    let count = SharedString::from(hit.titles.len().to_string());
    let row = div()
        .id(SharedString::from(format!("found-{id}")))
        .debug_selector(move || format!("found-{id}"))
        .flex()
        .items_baseline()
        .gap(px(8.0))
        .px(px(12.0))
        .py(px(7.0))
        .rounded(theme.skin.radius_md)
        .text_size(px(12.5))
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .child(div().flex_1().min_w_0().child(hit.page.name()))
        .child(
            div()
                .flex_none()
                .text_size(px(11.0))
                .text_color(theme.c.muted)
                .child(count),
        )
        .on_click(cx.listener(move |shell, _, _, cx| shell.choose_found(hit.clone(), cx)));
    Reachable::new(SharedString::from(format!("found-{id}")), row)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_word_must_be_found_and_a_keyword_finds_what_it_is_not_written_on() {
        let pages = |query: &str| {
            search(query)
                .into_iter()
                .map(|hit| hit.page)
                .collect::<Vec<_>>()
        };
        assert_eq!(pages("ptt"), vec![Page::Voice, Page::Shortcuts]);
        assert_eq!(pages("text size"), vec![Page::Personalize]);
        assert_eq!(pages("log folder"), vec![Page::Advanced]);
        assert!(pages("nothing like this").is_empty());
        assert!(pages("  ").is_empty());
    }
}
