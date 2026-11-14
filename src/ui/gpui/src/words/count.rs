//! Saying a count of something: which of a language's plural forms a count
//! takes, by Unicode's rules for it.

use gpui::SharedString;
use icu_plurals::{PluralCategory, PluralOperands, PluralRules};

use super::{Language, SPOKEN, Words};

/// Which plural form a count takes in one language. Where the rules could
/// not be had, every count takes `other`.
#[derive(Debug)]
struct Plurals(Option<PluralRules>);

impl Plurals {
    fn new(language: Language) -> Self {
        let rules = PluralRules::try_new_cardinal(language.identifier().into());
        Self(
            rules
                .inspect_err(|error| tracing::warn!(?language, %error, "no plural rules"))
                .ok(),
        )
    }

    fn of(&self, count: PluralOperands) -> PluralCategory {
        self.0
            .as_ref()
            .map_or(PluralCategory::Other, |rules| rules.category_for(count))
    }
}

impl Words {
    /// What is said for `count` of something, where English says `one` for
    /// one and `other` for any other count. A language keys it by `other`.
    pub(crate) fn counted(
        &self,
        count: impl Into<PluralOperands>,
        one: &'static str,
        other: &'static str,
    ) -> SharedString {
        let count = count.into();
        if let Some(said) = self.said(other) {
            let form = Plurals::new(self.language()).of(count);
            if let Some(said) = said.form(form) {
                return said.clone();
            }
        }
        match Plurals::new(Language::English).of(count) {
            PluralCategory::One => SharedString::new_static(one),
            _ => SharedString::new_static(other),
        }
    }
}

/// What the view says for `count` of something. Use [`t!`](super::t).
pub(crate) fn counted(
    count: impl Into<PluralOperands>,
    one: &'static str,
    other: &'static str,
) -> SharedString {
    SPOKEN.with_borrow(|words| words.counted(count, one, other))
}
