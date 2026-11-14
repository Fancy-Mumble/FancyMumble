//! The view in another language: the settings page, and choosing one there.

use gpui::TestAppContext;

use super::tests::{click, shell};
use crate::store::Store;
use crate::words::tests::{asked, literals};
use crate::words::{self, Language, Words, t};

/// Every file of the settings, one after the other.
const SETTINGS: &str = concat!(
    include_str!("settings/mod.rs"),
    include_str!("settings/nav.rs"),
    include_str!("settings/search.rs"),
    include_str!("settings/advanced.rs"),
    include_str!("settings/identities.rs"),
    include_str!("settings/localization.rs"),
    include_str!("settings/notifications.rs"),
    include_str!("settings/personalize.rs"),
    include_str!("settings/privacy.rs"),
    include_str!("settings/profile/mod.rs"),
    include_str!("settings/profile/page.rs"),
    include_str!("settings/profile/style.rs"),
    include_str!("settings/shortcuts.rs"),
    include_str!("settings/voice.rs"),
    include_str!("settings/voice_check.rs"),
    include_str!("settings/voice_gate.rs"),
    include_str!("settings/voice_more.rs"),
    include_str!("settings/wall.rs"),
);

#[test]
fn every_word_on_the_settings_page_is_asked_for() {
    let asked = asked(SETTINGS);
    let bare: Vec<_> = literals(SETTINGS)
        .into_iter()
        .filter(|text| text.starts_with(|c: char| c.is_ascii_uppercase()))
        .filter(|text| !asked.contains(text))
        .collect();
    assert!(bare.is_empty(), "said without asking for words: {bare:?}");
}

#[test]
fn every_word_on_the_settings_page_is_there_in_every_language() {
    for language in [Language::German, Language::French, Language::Chinese] {
        let words = Words::new(language);
        let missing: Vec<_> = asked(SETTINGS)
            .into_iter()
            .filter(|english| !words.has(english))
            .collect();
        assert!(
            missing.is_empty(),
            "{language:?} has no words for {missing:?}"
        );
    }
}

#[gpui::test]
fn the_settings_page_reads_in_german_once_german_is_chosen_and_it_is_kept(cx: &mut TestAppContext) {
    let dir = std::env::temp_dir().join(format!("fancy-gpui-words-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let (shell, _engine, cx) = shell(cx);
    shell.update(cx, |shell, _| shell.store = Some(Store::new(&dir)));
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-localization");
    assert_eq!(words::spoken(), Language::English);
    assert_eq!(t!("Language & format"), "Language & format");

    click(cx, "language");
    click(cx, "language-1");
    assert_eq!(words::spoken(), Language::German);
    assert_eq!(t!("Language & format"), "Sprache & Format");
    assert_eq!(t!("Time Display"), "Zeitanzeige");
    assert_eq!(t!("SETTINGS"), "EINSTELLUNGEN");
    assert_eq!(Store::new(&dir).settings().language, Language::German);
    // The page is drawn again in German, and still works.
    click(cx, "settings-personalize");
    click(cx, "text-size-2");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.panels.settings.format.text,
            crate::store::TextSize::Large
        );
    });

    click(cx, "settings-localization");
    click(cx, "language");
    click(cx, "language-0");
    assert_eq!(words::spoken(), Language::English);
    assert_eq!(t!("SETTINGS"), "SETTINGS");
    assert!(Store::new(&dir).settings().language.is_english());
    let _ = std::fs::remove_dir_all(dir);
}
