//! The languages the view can be read in.

use std::str::FromStr;

use icu_locale_core::LanguageIdentifier;
use serde::{Deserialize, Serialize};

/// A language the view is offered in: the web client's four.
///
/// Kept by its code (`de`). A code this build does not know reads as
/// English, so a settings file from a newer build still opens.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(into = "&'static str", from = "String")]
pub(crate) enum Language {
    #[default]
    English,
    German,
    French,
    Chinese,
}

impl Language {
    /// Every language, in the order they are offered.
    pub(crate) const ALL: [Self; 4] = [Self::English, Self::German, Self::French, Self::Chinese];

    /// Its code: the name of its files, here and in the web client.
    pub(crate) const fn code(self) -> &'static str {
        match self {
            Self::English => "en",
            Self::German => "de",
            Self::French => "fr",
            Self::Chinese => "zh",
        }
    }

    /// What it calls itself, which is how it is found whatever language
    /// the window is in.
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::English => "English",
            Self::German => "Deutsch",
            Self::French => "Français",
            Self::Chinese => "中文",
        }
    }

    /// Whether it is English, which is what is kept when nothing is said.
    pub(crate) fn is_english(&self) -> bool {
        *self == Self::English
    }

    /// The language as Unicode's rules know it.
    pub(super) fn identifier(self) -> LanguageIdentifier {
        self.code().parse().unwrap_or(LanguageIdentifier::UNKNOWN)
    }
}

/// A code that names none of the languages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UnknownLanguage(String);

impl std::fmt::Display for UnknownLanguage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "no language has the code `{}`", self.0)
    }
}

impl FromStr for Language {
    type Err = UnknownLanguage;

    fn from_str(code: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|language| language.code().eq_ignore_ascii_case(code.trim()))
            .ok_or_else(|| UnknownLanguage(code.to_owned()))
    }
}

impl From<Language> for &'static str {
    fn from(language: Language) -> Self {
        language.code()
    }
}

impl From<String> for Language {
    fn from(code: String) -> Self {
        code.parse().unwrap_or_default()
    }
}
