//! Shared-locale lookups for the QML UI.
//!
//! The full client's locale bundles
//! (`crates/mumble-tauri/ui/src/locales/{lang}/{ns}.json`) are embedded at
//! build time (see `build.rs`), so both clients are translated from the
//! same JSON files. Keys are the i18next paths prefixed with the
//! namespace: `tr("server.fields.host")` reads `server.json` →
//! `fields.host`.
//!
//! Lookup order: detected UI language, then the default locale, then the
//! key itself (which makes missing keys obvious in the UI instead of
//! crashing). Plurals use the i18next `_one`/`_other` suffix convention
//! via [`tr_n`].

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::constants::DEFAULT_LOCALE;

include!(concat!(env!("OUT_DIR"), "/fancy_locales.rs"));

/// Flattened `key path → string` map for one language.
type Bundle = HashMap<String, String>;

fn flatten(prefix: &str, value: &serde_json::Value, out: &mut Bundle) {
    match value {
        serde_json::Value::Object(map) => {
            for (k, v) in map {
                let key = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                flatten(&key, v, out);
            }
        }
        serde_json::Value::String(s) => {
            let _ = out.insert(prefix.to_owned(), s.clone());
        }
        _ => {} // numbers/bools/null are not UI strings
    }
}

fn parse_lang(lang: &str) -> Bundle {
    let mut bundle = Bundle::new();
    if let Some((_, namespaces)) = LOCALE_JSON.iter().find(|(l, _)| *l == lang) {
        for (ns, raw) in namespaces.iter() {
            // The web bundles are saved with a UTF-8 BOM, which the JS
            // toolchain tolerates but serde_json rejects - strip it.
            let raw = raw.trim_start_matches('\u{feff}');
            match serde_json::from_str::<serde_json::Value>(raw) {
                Ok(v) => flatten(ns, &v, &mut bundle),
                Err(e) => tracing::error!("embedded locale {lang}/{ns}.json is invalid: {e}"),
            }
        }
    }
    bundle
}

/// Detect the UI language: `FANCY_LANG` override (e2e/debug), then the OS
/// locale, reduced to a primary subtag we ship (e.g. "de-DE" → "de").
fn detect_lang() -> String {
    let raw = std::env::var("FANCY_LANG")
        .ok()
        .or_else(sys_locale::get_locale)
        .unwrap_or_else(|| DEFAULT_LOCALE.to_owned());
    let primary = raw.split(['-', '_']).next().unwrap_or(DEFAULT_LOCALE);
    if LOCALE_JSON.iter().any(|(l, _)| *l == primary) {
        primary.to_owned()
    } else {
        DEFAULT_LOCALE.to_owned()
    }
}

fn bundles() -> &'static (Bundle, Bundle) {
    static BUNDLES: OnceLock<(Bundle, Bundle)> = OnceLock::new();
    BUNDLES.get_or_init(|| {
        let lang = detect_lang();
        tracing::info!("ui language: {lang}");
        let primary = parse_lang(&lang);
        let fallback = if lang == DEFAULT_LOCALE {
            Bundle::new() // primary already is the default locale
        } else {
            parse_lang(DEFAULT_LOCALE)
        };
        (primary, fallback)
    })
}

/// Translate a namespaced key ("ns.path.to.key"); falls back to the
/// default locale, then to the key itself.
pub fn tr(key: &str) -> String {
    let (primary, fallback) = bundles();
    primary
        .get(key)
        .or_else(|| fallback.get(key))
        .cloned()
        .unwrap_or_else(|| key.to_owned())
}

/// Plural-aware translate following i18next's suffix convention:
/// `key_one` when `count == 1`, otherwise `key_other` (languages without
/// a singular form, e.g. zh, only ship `_other`). `{{count}}` in the
/// resolved string is replaced with the number.
pub fn tr_n(key: &str, count: i64) -> String {
    let (primary, fallback) = bundles();
    let one = format!("{key}_one");
    let other = format!("{key}_other");
    let lookup = |k: &str| primary.get(k).or_else(|| fallback.get(k)).cloned();
    let template = if count == 1 {
        lookup(&one).or_else(|| lookup(&other))
    } else {
        lookup(&other).or_else(|| lookup(&one))
    }
    .or_else(|| lookup(key))
    .unwrap_or_else(|| key.to_owned());
    template.replace("{{count}}", &count.to_string())
}
