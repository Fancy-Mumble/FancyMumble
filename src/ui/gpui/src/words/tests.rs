//! The lookup, its data, and the source that uses it.

use std::collections::BTreeSet;
use std::path::Path;

use super::table::Said;
use super::web::Web;
use super::*;

const SHARED: &str = include_str!("../../locales/shared.json");

/// The entries of one of this client's files.
fn entries(text: &str) -> serde_json::Map<String, serde_json::Value> {
    serde_json::from_str(text).expect("a file of words is one JSON object")
}

/// This client's own file for `language`.
fn own(language: Language) -> String {
    let path = format!(
        "{}/locales/{}.json",
        env!("CARGO_MANIFEST_DIR"),
        language.code()
    );
    std::fs::read_to_string(path).unwrap_or_else(|_| "{}".to_owned())
}

/// The `{{names}}` in `text`.
fn names(text: &str) -> BTreeSet<&str> {
    text.split("{{")
        .skip(1)
        .filter_map(|rest| rest.split_once("}}"))
        .map(|(name, _)| name.split(',').next().unwrap_or_default().trim())
        .collect()
}

/// The texts `t!` is asked for in `source`; for a count, the English for
/// any other count, which is what a language keys it by.
pub(crate) fn asked(source: &str) -> Vec<String> {
    let mut found = Vec::new();
    for (at, _) in source.match_indices("t!(") {
        let named = source[..at]
            .chars()
            .next_back()
            .is_some_and(|before| before.is_alphanumeric() || before == '_');
        if named {
            continue;
        }
        let mut rest = source[at + 3..].trim_start();
        let mut last = None;
        while let Some((literal, after)) = literal(rest) {
            last = Some(literal);
            rest = after.trim_start();
            match rest.strip_prefix(',') {
                Some(after) => rest = after.trim_start(),
                None => break,
            }
        }
        found.extend(last);
    }
    found
}

/// The string literal `text` starts with, and what follows it.
fn literal(text: &str) -> Option<(String, &str)> {
    let mut chars = text.strip_prefix('"')?.char_indices();
    let mut value = String::new();
    while let Some((at, c)) = chars.next() {
        match c {
            '"' => return Some((value, &text[at + 2..])),
            '\\' => match chars.next()?.1 {
                'n' => value.push('\n'),
                other => value.push(other),
            },
            c => value.push(c),
        }
    }
    None
}

/// Every string literal in `source` outside its `//` comments.
pub(crate) fn literals(source: &str) -> Vec<String> {
    let mut found = Vec::new();
    for line in source.lines() {
        let mut rest = line.split("//").next().unwrap_or_default();
        while let Some(at) = rest.find('"') {
            match literal(&rest[at..]) {
                Some((value, after)) => {
                    found.push(value);
                    rest = after;
                }
                None => break,
            }
        }
    }
    found
}

/// Every text `t!` is asked for in the view's source, outside the tests.
fn asked_in_source() -> BTreeSet<String> {
    fn walk(dir: &Path, found: &mut BTreeSet<String>) {
        for entry in std::fs::read_dir(dir)
            .expect("the source is readable")
            .flatten()
        {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if path.is_dir() {
                if name != "words" {
                    walk(&path, found);
                }
            } else if name.ends_with(".rs") && !name.starts_with("tests") {
                let source = std::fs::read_to_string(&path).expect("readable");
                found.extend(asked(&source));
            }
        }
    }
    let mut found = BTreeSet::new();
    walk(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut found,
    );
    found
}

#[test]
fn english_is_said_as_it_is_written() {
    let words = Words::english();
    assert_eq!(words.text("Text size"), "Text size");
    assert_eq!(words.counted(1_u32, "1 file", "{{count}} files"), "1 file");
    assert_eq!(
        words.counted(0_u32, "1 file", "{{count}} files"),
        "{{count}} files"
    );
}

#[test]
fn a_language_says_its_own_words_and_the_web_clients() {
    let german = Words::new(Language::German);
    // From the web client's files, through `shared.json`.
    assert_eq!(german.text("Text size"), "Textgröße");
    assert_eq!(german.text("Language & format"), "Sprache & Format");
    // From this client's own.
    assert_eq!(german.text("Voice"), "Audio");
    // The web client's French, where this client has no word of its own.
    assert_eq!(Words::new(Language::French).text("Voice"), "Voix");
}

#[test]
fn this_clients_own_words_win_over_the_web_clients() {
    // The web client's German calls the voice settings "Sprache", which is
    // also its word for language; this client says otherwise.
    assert_eq!(Words::new(Language::German).text("Voice"), "Audio");
    let words = Words::read(
        Language::German,
        r#"{ "Text size": "Schriftgröße" }"#,
        r#"{ "Text size": "nebulaSettings:personalize.textSize" }"#,
    );
    assert_eq!(words.text("Text size"), "Schriftgröße");
}

#[test]
fn what_a_language_has_no_words_for_is_said_in_english_never_as_a_key() {
    let german = Words::new(Language::German);
    assert_eq!(german.text("Nothing says this"), "Nothing says this");
    // A key the web client does not have, a file that is not JSON, and an
    // entry that is not a text all leave the English.
    let words = Words::read(
        Language::German,
        r#"{ "Small": 3 }"#,
        r#"{ "Large": "settings:no.such.key", "Small": "nowhere:at.all" }"#,
    );
    assert_eq!(words.text("Large"), "Large");
    assert_eq!(words.text("Small"), "Small");
    let broken = Words::read(Language::German, "{ not json", "[]");
    assert_eq!(broken.text("Large"), "Large");
    assert!(!broken.has("Large"));
}

#[test]
fn values_are_put_in_by_name() {
    let said = fill(
        "{{who}} has {{ count, number }} new {{what}}".into(),
        &[("who", &"Rin"), ("count", &3)],
    );
    assert_eq!(
        said, "Rin has 3 new {{what}}",
        "a value not given stays as written"
    );
    assert_eq!(fill("No values".into(), &[("who", &"Rin")]), "No values");
    assert_eq!(
        fill("Unclosed {{who".into(), &[("who", &"Rin")]),
        "Unclosed {{who"
    );
    let error = "the disk is full";
    assert_eq!(
        t!("The picture could not be kept: {{error}}", error = error),
        "The picture could not be kept: the disk is full"
    );
}

#[test]
fn a_count_takes_the_plural_form_of_the_language() {
    let file =
        r#"{ "{{count}} files": { "one": "{{count}} Datei", "other": "{{count}} Dateien" } }"#;
    let german = Words::read(Language::German, file, "{}");
    assert_eq!(
        german.counted(1_u32, "{{count}} file", "{{count}} files"),
        "{{count}} Datei"
    );
    assert_eq!(
        german.counted(2_u32, "{{count}} file", "{{count}} files"),
        "{{count}} Dateien"
    );
    // French says one for nought as well.
    let file =
        r#"{ "{{count}} files": { "one": "{{count}} fichier", "other": "{{count}} fichiers" } }"#;
    let french = Words::read(Language::French, file, "{}");
    assert_eq!(
        french.counted(0_u32, "{{count}} file", "{{count}} files"),
        "{{count}} fichier"
    );
    // Chinese has one form for every count.
    let file = r#"{ "{{count}} files": { "other": "{{count}} 个文件" } }"#;
    let chinese = Words::read(Language::Chinese, file, "{}");
    assert_eq!(
        chinese.counted(1_u32, "{{count}} file", "{{count}} files"),
        "{{count}} 个文件"
    );
    // Without a translation, English's own rule picks the English.
    assert_eq!(
        german.counted(1_u32, "{{count}} pin", "{{count}} pins"),
        "{{count}} pin"
    );
    assert_eq!(
        german.counted(0_u32, "{{count}} pin", "{{count}} pins"),
        "{{count}} pins"
    );
}

#[test]
fn plural_forms_come_from_the_web_clients_files_too() {
    let shared = r#"{ "hold {{count}} frames": "nebulaSettings:gate.readoutHold" }"#;
    let german = Words::read(Language::German, "{}", shared);
    let one = german.counted(1_u32, "hold {{count}} frame", "hold {{count}} frames");
    let many = german.counted(5_u32, "hold {{count}} frame", "hold {{count}} frames");
    assert_ne!(one, "hold {{count}} frame");
    assert_ne!(one, many, "German says one frame and five frames apart");
}

#[test]
fn the_language_changes_while_running() {
    assert_eq!(
        spoken(),
        Language::English,
        "every thread starts in English"
    );
    assert_eq!(t!("Text size"), "Text size");
    speak(Language::German);
    assert_eq!(spoken(), Language::German);
    assert_eq!(t!("Text size"), "Textgröße");
    assert_eq!(
        t!("{{count}} pebble", "{{count}} pebbles", count = 2_u32),
        "2 pebbles",
        "a count with no translation is English, its count put in"
    );
    speak(Language::Chinese);
    assert_eq!(t!("Text size"), "文字大小");
    speak(Language::English);
    assert_eq!(t!("Text size"), "Text size");
}

#[test]
fn a_language_is_kept_by_its_code_and_an_unknown_one_reads_as_english() {
    for language in Language::ALL {
        let kept = serde_json::to_string(&language).expect("serialisable");
        assert_eq!(kept, format!("\"{}\"", language.code()));
        assert_eq!(
            serde_json::from_str::<Language>(&kept).expect("readable"),
            language
        );
        assert_eq!(language.code().parse(), Ok(language));
    }
    assert_eq!(
        serde_json::from_str::<Language>("\"tlh\"").expect("readable"),
        Language::English
    );
    assert!("tlh".parse::<Language>().is_err());
    assert_eq!(" DE ".parse(), Ok(Language::German));
}

#[test]
fn every_shared_wording_means_in_english_what_this_client_says() {
    let mut english = Web::new(Language::English);
    for (says, reference) in entries(SHARED) {
        let reference = reference.as_str().expect("a key is a text");
        let found = english.said(reference);
        let means = match &found {
            Some(Said::Plain(text)) => Some(text.as_ref()),
            Some(Said::Counted(forms)) => forms
                .iter()
                .find(|(form, _)| *form == icu_plurals::PluralCategory::Other)
                .map(|(_, text)| text.as_ref()),
            None => None,
        };
        assert_eq!(
            means,
            Some(says.as_str()),
            "{reference} says something else in English"
        );
    }
}

#[test]
fn every_shared_wording_is_there_in_every_language() {
    for language in Language::ALL {
        let mut web = Web::new(language);
        for (says, reference) in entries(SHARED) {
            let reference = reference.as_str().expect("a key is a text");
            assert!(
                web.said(reference).is_some(),
                "{language:?} has no {reference} for {says}"
            );
        }
    }
}

#[test]
fn every_translation_keeps_the_values_its_english_has() {
    for language in Language::ALL {
        for (english, said) in entries(&own(language)) {
            let texts: Vec<&str> = match &said {
                serde_json::Value::Object(forms) => {
                    forms.values().filter_map(|v| v.as_str()).collect()
                }
                other => other.as_str().into_iter().collect(),
            };
            assert!(!texts.is_empty(), "{language:?}: {english} is not a text");
            for text in texts {
                assert_eq!(names(text), names(&english), "{language:?}: {text}");
            }
        }
    }
}

#[test]
fn every_translation_is_of_something_the_view_says() {
    let asked = asked_in_source();
    let shared = entries(SHARED);
    let kept = Language::ALL.into_iter().flat_map(|language| {
        entries(&own(language))
            .into_iter()
            .map(|(english, _)| english)
    });
    for english in shared.keys().cloned().chain(kept) {
        assert!(asked.contains(&english), "nothing asks for {english:?}");
    }
}

#[test]
fn the_source_scan_finds_what_t_is_asked_for() {
    let source = r#"assert!(x); t!("One"); t!( "Hello, {{name}}", name = n); t!("{{count}} a", "{{count}} b", count = 2); t!("Say \"hi\"")"#;
    assert_eq!(
        asked(source),
        ["One", "Hello, {{name}}", "{{count}} b", "Say \"hi\""]
    );
}
