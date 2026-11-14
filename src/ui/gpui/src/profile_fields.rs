//! Changing some fields of the profile a comment carries, and leaving the
//! rest of it, read by this client or not, as it was.
//!
//! The profile is the JSON in a mark ahead of the comment's words,
//! `<!--FANCY:{...}-->` (see `crate::profile`, which reads it). A change
//! is a JSON object merged into the profile: an object goes into the one
//! there key by key, `null` takes a key away, anything else takes its
//! place.

use serde_json::{Map, Value, json};

/// The mark the profile is written in, as `crate::profile` reads it.
const PREFIX: &str = "<!--FANCY:";
const SUFFIX: &str = "-->";

/// The profile `comment` carries, if it carries one that can be read.
pub(crate) fn held(comment: &str) -> Option<Value> {
    let rest = comment.trim_start().strip_prefix(PREFIX)?;
    let json = &rest[..rest.find(SUFFIX)?];
    serde_json::from_str::<Value>(json)
        .ok()
        .filter(Value::is_object)
}

/// Merge `change` into `profile`, as the module says.
pub(crate) fn merge(profile: &mut Value, change: &Map<String, Value>) {
    let Some(fields) = profile.as_object_mut() else {
        return;
    };
    for (key, value) in change {
        match value {
            Value::Null => {
                let _ = fields.remove(key);
            }
            Value::Object(inner) if fields.get(key).is_some_and(Value::is_object) => {
                if let Some(there) = fields.get_mut(key) {
                    merge(there, inner);
                }
            }
            other => {
                let _ = fields.insert(key.clone(), other.clone());
            }
        }
    }
}

/// The profile `comment` carries, with `change` merged into it, as JSON:
/// what the engine's `set_profile` takes. A comment with no profile is
/// given one.
pub(crate) fn patched(comment: &str, change: &Map<String, Value>) -> String {
    let mut profile = held(comment).unwrap_or_else(|| json!({ "v": 1 }));
    merge(&mut profile, change);
    profile.to_string()
}

/// `comment` with `profile` (JSON) in place of the profile it carries,
/// its words as they were.
pub(crate) fn rewritten(comment: &str, profile: &str) -> String {
    let words = comment
        .trim_start()
        .strip_prefix(PREFIX)
        .and_then(|rest| rest.split_once(SUFFIX))
        .map_or(comment, |(_, words)| words);
    format!("{PREFIX}{profile}{SUFFIX}{words}")
}

/// `text` as it is typed in a field that reads marks, as the HTML a
/// profile's status holds: each stretch `settings` sets apart in its tags,
/// the marks themselves left out, and everything else as it is, escaped.
/// What the web UI's status field writes from its own buttons.
pub(crate) fn marked_html(
    text: &str,
    settings: &[(std::ops::Range<usize>, crate::engine::Setting)],
) -> String {
    let mut html = String::with_capacity(text.len());
    let mut at = 0;
    for (range, setting) in settings {
        if range.start < at || range.end > text.len() {
            continue;
        }
        escape_into(&mut html, &text[at..range.start]);
        at = range.end;
        if setting.mark {
            continue;
        }
        let tags: Vec<&str> = [
            (setting.bold, "b"),
            (setting.italic, "i"),
            (setting.underlined, "u"),
            (setting.struck, "s"),
            (setting.code, "code"),
        ]
        .into_iter()
        .filter_map(|(on, tag)| on.then_some(tag))
        .collect();
        for tag in &tags {
            html.push_str(&format!("<{tag}>"));
        }
        escape_into(&mut html, &text[range.clone()]);
        for tag in tags.iter().rev() {
            html.push_str(&format!("</{tag}>"));
        }
    }
    escape_into(&mut html, &text[at..]);
    html
}

/// `text` onto `html`, with what HTML would read as markup escaped.
fn escape_into(html: &mut String, text: &str) {
    for c in text.chars() {
        match c {
            '&' => html.push_str("&amp;"),
            '<' => html.push_str("&lt;"),
            '>' => html.push_str("&gt;"),
            '"' => html.push_str("&quot;"),
            other => html.push(other),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marked_text_becomes_the_html_a_status_holds() {
        use crate::engine::Setting;
        let text = "a **bold** <move> & _x_";
        let mark = Setting {
            mark: true,
            ..Setting::default()
        };
        let bold = Setting {
            bold: true,
            ..Setting::default()
        };
        let italic = Setting {
            italic: true,
            ..Setting::default()
        };
        let settings = [
            (2..4, mark),
            (4..8, bold),
            (8..10, mark),
            (20..21, mark),
            (21..22, italic),
            (22..23, mark),
        ];
        assert_eq!(
            marked_html(text, &settings),
            "a <b>bold</b> &lt;move&gt; &amp; <i>x</i>"
        );
        assert_eq!(marked_html("plain", &[]), "plain");
    }

    fn change(value: &Value) -> Map<String, Value> {
        value.as_object().cloned().expect("an object")
    }

    #[test]
    fn a_change_goes_in_key_by_key_and_null_takes_a_key_away() {
        let comment = r##"<!--FANCY:{"v":1,"status":"Around","banner":{"image":"data:x","color":"#111"}}-->Hello"##;
        let profile: Value = serde_json::from_str(&patched(
            comment,
            &change(&json!({ "status": null, "pronouns": "they/them", "banner": { "color": "#222" } })),
        ))
        .expect("JSON");
        assert_eq!(profile["status"], Value::Null);
        assert_eq!(profile["pronouns"], "they/them");
        assert_eq!(profile["banner"]["color"], "#222");
        assert_eq!(profile["banner"]["image"], "data:x", "the rest of the banner stays");
        assert_eq!(profile["v"], 1);
    }

    #[test]
    fn a_comment_without_a_profile_is_given_one_and_keeps_its_words() {
        let made = patched("Just words", &change(&json!({ "contact": "me@example.org" })));
        let rewritten = rewritten("Just words", &made);
        assert!(rewritten.ends_with("-->Just words"), "{rewritten}");
        let back = crate::profile::Profile::of(&rewritten).expect("read back");
        assert_eq!(back.contact.as_deref(), Some("me@example.org"));
        assert_eq!(held(&rewritten).expect("held")["v"], 1);
    }
}
