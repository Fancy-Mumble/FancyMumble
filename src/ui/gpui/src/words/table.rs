//! What one language says for each thing the view says in English.

use std::collections::HashMap;

use gpui::SharedString;
use icu_plurals::PluralCategory;
use rust_embed::RustEmbed;
use serde_json::{Map, Value};

use super::Language;
use super::web::Web;

/// This client's own files: `<code>.json` for each language, and
/// `shared.json`, which names the web client's key for what both clients
/// say alike.
#[derive(RustEmbed)]
#[folder = "locales/"]
#[include = "*.json"]
struct Files;

/// What a language says for one English text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Said {
    Plain(SharedString),
    /// What it says for a count, one text for each of its plural forms.
    Counted(Vec<(PluralCategory, SharedString)>),
}

impl Said {
    /// A value of a language file: a text, or an object of plural forms.
    fn from_value(value: &Value) -> Option<Self> {
        match value {
            Value::String(text) => Some(Self::Plain(text.clone().into())),
            // Every entry a plural form with its text, or it is not one.
            Value::Object(given) => {
                let forms: Vec<_> = given
                    .iter()
                    .filter_map(|(form, said)| {
                        let category = PluralCategory::get_for_cldr_string(form)?;
                        Some((category, said.as_str()?.to_owned().into()))
                    })
                    .collect();
                (!forms.is_empty() && forms.len() == given.len()).then_some(Self::Counted(forms))
            }
            _ => None,
        }
    }

    /// The text for the plural form `category`; the `other` form where the
    /// language gave none for it, and the first it gave where it gave no
    /// `other`.
    pub(super) fn form(&self, category: PluralCategory) -> Option<&SharedString> {
        match self {
            Self::Plain(said) => Some(said),
            Self::Counted(forms) => {
                let given = |wanted| forms.iter().find(|(form, _)| *form == wanted);
                given(category)
                    .or_else(|| given(PluralCategory::Other))
                    .or_else(|| forms.first())
                    .map(|(_, said)| said)
            }
        }
    }
}

/// What one language says for each English text the view says. English
/// itself says nothing of its own: the text is what is said.
#[derive(Debug)]
pub(crate) struct Words {
    language: Language,
    said: HashMap<String, Said>,
}

impl Words {
    /// English: every text is said as it is written.
    pub(crate) fn english() -> Self {
        Self::with(Language::English, HashMap::new())
    }

    /// What `language` says: its own file, over the web client's words for
    /// what both clients say alike.
    pub(crate) fn new(language: Language) -> Self {
        if language.is_english() {
            return Self::english();
        }
        let own = file(&format!("{}.json", language.code()));
        Self::read(language, &own, &file("shared.json"))
    }

    /// What `language` says, from `own`, written as its file is, and
    /// `shared`, written as `shared.json` is.
    pub(super) fn read(language: Language, own: &str, shared: &str) -> Self {
        let mut said = HashMap::new();
        let mut web = Web::new(language);
        for (english, reference) in table(shared, "shared.json") {
            if let Some(found) = reference.as_str().and_then(|key| web.said(key)) {
                let _ = said.insert(english, found);
            }
        }
        for (english, value) in table(own, language.code()) {
            match Said::from_value(&value) {
                Some(found) => {
                    let _ = said.insert(english, found);
                }
                None => tracing::warn!(?language, english, "a translation that is not a text"),
            }
        }
        Self::with(language, said)
    }

    const fn with(language: Language, said: HashMap<String, Said>) -> Self {
        Self { language, said }
    }

    /// The language these are the words of.
    pub(crate) const fn language(&self) -> Language {
        self.language
    }

    /// What is said for `english`.
    pub(crate) fn text(&self, english: &'static str) -> SharedString {
        self.said(english)
            .and_then(|said| said.form(PluralCategory::Other))
            .cloned()
            .unwrap_or(SharedString::new_static(english))
    }

    /// What the language says of its own for `english`, if anything.
    pub(super) fn said(&self, english: &str) -> Option<&Said> {
        self.said.get(english)
    }

    /// Whether the language says something of its own for `english`.
    #[cfg(test)]
    pub(crate) fn has(&self, english: &str) -> bool {
        self.said.contains_key(english)
    }
}

/// One of this client's own files, as text; an empty table where it is
/// missing.
fn file(name: &str) -> String {
    Files::get(name)
        .and_then(|file| String::from_utf8(file.data.into_owned()).ok())
        .unwrap_or_else(|| "{}".to_owned())
}

/// The entries of a file written as one JSON object; none, and a warning,
/// where it is not one.
fn table(text: &str, name: &str) -> Map<String, Value> {
    serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .inspect_err(|error| tracing::warn!(name, %error, "a file of words could not be read"))
        .unwrap_or_default()
}
