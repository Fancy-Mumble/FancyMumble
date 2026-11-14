//! The words the view shows, in the language chosen.
//!
//! Every view asks here for what it says, written in English, with [`t!`]:
//!
//! ```ignore
//! t!("Text size")
//! t!("The picture could not be kept: {{error}}", error = error)
//! t!("{{count}} frame", "{{count}} frames", count = frames)
//! ```
//!
//! The English is the key, so it cannot be missing. Another language is
//! data: this client's own file (`locales/<code>.json`), over the web
//! client's files for what both clients say alike (`locales/shared.json`
//! names its key for each). What a language has no words for is said in
//! English. `TRANSLATING.md` beside `Cargo.toml` says how to add some.
//!
//! The language belongs to the thread that draws. Each test runs on a
//! thread of its own, so a test that changes it changes it for no other.

pub(crate) mod count;
mod fill;
mod language;
mod table;
mod web;

#[cfg(test)]
pub(crate) mod tests;

use std::cell::RefCell;
use std::rc::Rc;

use gpui::SharedString;

pub(crate) use fill::fill;
pub(crate) use language::Language;
pub(crate) use table::Words;

thread_local! {
    /// The words of the language the view is in.
    static SPOKEN: RefCell<Rc<Words>> = RefCell::new(Rc::new(Words::english()));
}

/// What the view says for `english`, in its language.
///
/// With values for the `{{names}}` in it: `t!("Hello, {{name}}", name = who)`.
/// With a count: `t!("{{count}} file", "{{count}} files", count = n)`, the
/// English for one first; the count is `{{count}}`.
macro_rules! t {
    ($english:literal $(,)?) => {
        $crate::words::text($english)
    };
    ($english:literal, $($name:ident = $value:expr),+ $(,)?) => {
        $crate::words::fill(
            $crate::words::text($english),
            &[$((stringify!($name), &$value as &dyn ::std::fmt::Display)),+],
        )
    };
    ($one:literal, $other:literal, count = $count:expr $(, $name:ident = $value:expr)* $(,)?) => {{
        let count = $count;
        $crate::words::fill(
            $crate::words::count::counted(count, $one, $other),
            &[
                ("count", &count as &dyn ::std::fmt::Display),
                $((stringify!($name), &$value as &dyn ::std::fmt::Display)),*
            ],
        )
    }};
}
pub(crate) use t;

/// What the view says for `english`, in its language. Use [`t!`].
pub(crate) fn text(english: &'static str) -> SharedString {
    SPOKEN.with_borrow(|words| words.text(english))
}

/// Say everything in `language` from now on. The view is drawn again by
/// whoever asked.
pub(crate) fn speak(language: Language) {
    if spoken() != language {
        SPOKEN.set(Rc::new(Words::new(language)));
    }
}

/// The language the view is in.
pub(crate) fn spoken() -> Language {
    SPOKEN.with_borrow(|words| words.language())
}

/// Speak the language the environment names, else the one kept.
///
/// `FANCY_GPUI_LANGUAGE=de` overrides what is kept, for looking at a
/// language without choosing it.
pub(crate) fn start(store: Option<&crate::store::Store>) {
    let named = std::env::var("FANCY_GPUI_LANGUAGE")
        .ok()
        .and_then(|code| code.parse().ok());
    let kept = || store.map(|store| store.settings().language);
    speak(named.or_else(kept).unwrap_or_default());
}
