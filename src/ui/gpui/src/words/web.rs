//! The web client's own files of words, read where it says what this client
//! says too.
//!
//! The web client keeps them for i18next: one JSON file per namespace and
//! language, `locales/common/<code>/<file>.json` for what every design of
//! it says and `locales/nebula/<code>/<file>.json` for what only Nebula says,
//! named `<file>` and `nebula<File>`. A key is a dotted path into its file; a
//! word that changes with a count has one key per plural form, `<key>_one`,
//! `<key>_other`.

use std::collections::HashMap;

use icu_plurals::PluralCategory;
use rust_embed::RustEmbed;
use serde_json::Value;

use super::Language;
use super::table::Said;

/// The names of the plural forms, as Unicode gives them and the files
/// suffix them.
const FORMS: [&str; 6] = ["zero", "one", "two", "few", "many", "other"];

/// The web client's files, compiled in.
#[derive(RustEmbed)]
#[folder = "../../../crates/mumble-tauri/ui/src/core/locales/"]
#[include = "common/*/*.json"]
#[include = "nebula/*/*.json"]
struct Files;

/// The web client's words in one language, each namespace read the first
/// time something is asked of it.
#[derive(Debug)]
pub(super) struct Web {
    language: Language,
    read: HashMap<String, Option<Value>>,
}

impl Web {
    pub(super) fn new(language: Language) -> Self {
        Self {
            language,
            read: HashMap::new(),
        }
    }

    /// What `reference` (`namespace:dotted.key`) says, or nothing if the
    /// file or the key is not there.
    pub(super) fn said(&mut self, reference: &str) -> Option<Said> {
        let (namespace, key) = reference.split_once(':')?;
        let (parent, leaf) = match key.rsplit_once('.') {
            Some((parent, leaf)) => (Some(parent), leaf),
            None => (None, key),
        };
        let mut holder = self.namespace(namespace)?;
        for step in parent.into_iter().flat_map(|path| path.split('.')) {
            holder = holder.get(step)?;
        }
        if let Some(text) = holder.get(leaf).and_then(Value::as_str) {
            return Some(Said::Plain(text.to_owned().into()));
        }
        let forms: Vec<_> = FORMS
            .into_iter()
            .filter_map(|form| {
                let said = holder.get(format!("{leaf}_{form}"))?.as_str()?;
                Some((
                    PluralCategory::get_for_cldr_string(form)?,
                    said.to_owned().into(),
                ))
            })
            .collect();
        (!forms.is_empty()).then_some(Said::Counted(forms))
    }

    /// The parsed file of `namespace`, read once.
    fn namespace(&mut self, namespace: &str) -> Option<&Value> {
        let language = self.language;
        self.read
            .entry(namespace.to_owned())
            .or_insert_with(|| read(&path(namespace, language)))
            .as_ref()
    }
}

/// Where the web client keeps `namespace` in `language`.
fn path(namespace: &str, language: Language) -> String {
    let code = language.code();
    match namespace.strip_prefix("nebula") {
        Some(rest) if rest.starts_with(char::is_uppercase) => {
            let mut file = rest.to_owned();
            file[..1].make_ascii_lowercase();
            format!("nebula/{code}/{file}.json")
        }
        _ => format!("common/{code}/{namespace}.json"),
    }
}

/// A file of the web client's, parsed; the files begin with a byte-order
/// mark, which JSON does not allow.
fn read(path: &str) -> Option<Value> {
    let file = Files::get(path)?;
    let text = std::str::from_utf8(&file.data).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .inspect_err(
            |error| tracing::warn!(path, %error, "the web client's words could not be read"),
        )
        .ok()
}
