//! The operator API's livery JSON, read into the wire document.
//!
//! One document format for both write paths. The admin page builds the same
//! patch whether it goes out over HTTP or over the control channel, so a field
//! cannot end up settable one way and not the other.
//!
//! Deliberately strict in the same places the server is: an unknown key is
//! refused rather than dropped, because livery has no second author and a
//! misspelling can only be a typo — one whose symptom would otherwise be a
//! screen that did not change.

use mumble_protocol::proto::fancy::domain::{LiveryDoc, livery_doc};

/// Read a patch into `(fields, values)`.
///
/// # Errors
///
/// The first key that is not a livery field, or whose value is the wrong shape.
pub(crate) fn parse(patch: &serde_json::Value) -> Result<(Vec<String>, LiveryDoc), String> {
    let object = patch
        .as_object()
        .ok_or_else(|| "a livery patch must be an object".to_owned())?;

    let mut fields = Vec::new();
    let mut doc = LiveryDoc::default();

    for (key, value) in object {
        match key.as_str() {
            "display_name" => doc.display_name = string(key, value)?,
            "tagline" => doc.tagline = string(key, value)?,
            "motd" => doc.motd = string(key, value)?,
            "rules_url" => doc.rules_url = string(key, value)?,
            "banner_focus_x" => doc.banner_focus_x = count(key, value)?,
            "banner_focus_y" => doc.banner_focus_y = count(key, value)?,
            "tags" => doc.tags = tags(value)?,
            "dark" => doc.dark = Some(palette("dark", value)?),
            "light" => doc.light = Some(palette("light", value)?),
            // Settable through the operator API, which stores the bytes and
            // sets the key in one step. A client naming a key by hand would be
            // pointing the document at a blob it never uploaded.
            "banner_key" | "icon_key" => {
                return Err(format!("{key} is set by uploading an image"));
            }
            other => return Err(format!("no livery field is called {other}")),
        }
        fields.push(key.clone());
    }
    Ok((fields, doc))
}

fn string(field: &str, value: &serde_json::Value) -> Result<String, String> {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{field} must be a string"))
}

fn count(field: &str, value: &serde_json::Value) -> Result<u32, String> {
    value
        .as_u64()
        .and_then(|number| u32::try_from(number).ok())
        .ok_or_else(|| format!("{field} must be a whole number"))
}

fn tags(value: &serde_json::Value) -> Result<Vec<livery_doc::Tag>, String> {
    let entries = value.as_array().ok_or_else(|| "tags must be an array".to_owned())?;
    entries
        .iter()
        .map(|entry| {
            let object = entry
                .as_object()
                .ok_or_else(|| "each tag must be an object".to_owned())?;
            for key in object.keys() {
                if !matches!(key.as_str(), "label" | "tone" | "href") {
                    return Err(format!("no tag field is called {key}"));
                }
            }
            let tone = match object.get("tone") {
                None => livery_doc::tag::Tone::Neutral,
                Some(value) => {
                    let name = string("tags[].tone", value)?;
                    livery_doc::tag::Tone::from_str_name(&name)
                        .ok_or_else(|| format!("tags[].tone is {name}, which is not a tone"))?
                }
            };
            Ok(livery_doc::Tag {
                label: object
                    .get("label")
                    .map(|value| string("tags[].label", value))
                    .transpose()?
                    .unwrap_or_default(),
                tone: tone as i32,
                href: object
                    .get("href")
                    .map(|value| string("tags[].href", value))
                    .transpose()?
                    .unwrap_or_default(),
            })
        })
        .collect()
}

fn palette(mode: &str, value: &serde_json::Value) -> Result<livery_doc::Palette, String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("{mode} must be an object"))?;
    let mut palette = livery_doc::Palette::default();
    for (key, entry) in object {
        let field = format!("{mode}.{key}");
        let colour = string(&field, entry)?;
        match key.as_str() {
            "accent" => palette.accent = colour,
            "surface" => palette.surface = colour,
            "aura_from" => palette.aura_from = colour,
            "aura_to" => palette.aura_to = colour,
            _ => return Err(format!("no livery field is called {field}")),
        }
    }
    Ok(palette)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_only_the_fields_the_patch_carries() {
        let (fields, doc) = parse(&serde_json::json!({"tagline": "cozy"})).unwrap();
        assert_eq!(fields, vec!["tagline".to_owned()]);
        assert_eq!(doc.tagline, "cozy");
        assert_eq!(doc.motd, "", "an unnamed field stays empty");
    }

    #[test]
    fn reads_a_palette_and_a_tag() {
        let (_, doc) = parse(&serde_json::json!({
            "dark": {"accent": "#8a90ff", "aura_to": "#41b4f9"},
            "tags": [{"label": "Rules", "tone": "ACCENT", "href": "https://x"}],
        }))
        .unwrap();
        assert_eq!(doc.dark.as_ref().unwrap().accent, "#8a90ff");
        assert_eq!(doc.dark.as_ref().unwrap().aura_to, "#41b4f9");
        assert_eq!(doc.tags[0].label, "Rules");
        assert_eq!(doc.tags[0].tone, livery_doc::tag::Tone::Accent as i32);
    }

    #[test]
    fn refuses_a_typo_rather_than_dropping_it() {
        assert!(parse(&serde_json::json!({"taglin": "oops"})).is_err());
        assert!(parse(&serde_json::json!({"dark": {"glow": "#fff"}})).is_err());
    }

    #[test]
    fn refuses_the_fields_the_server_owns() {
        for key in ["version", "digest"] {
            assert!(parse(&serde_json::json!({ key: 1 })).is_err(), "{key}");
        }
    }

    #[test]
    fn refuses_an_image_key_named_by_hand() {
        // Uploading is what sets these; a key typed here would point the
        // document at a blob nobody stored.
        let refused = parse(&serde_json::json!({"banner_key": "abc"})).unwrap_err();
        assert!(refused.contains("uploading"), "unhelpful: {refused}");
    }

    #[test]
    fn refuses_a_value_of_the_wrong_shape() {
        assert!(parse(&serde_json::json!({"tagline": 7})).is_err());
        assert!(parse(&serde_json::json!({"tags": "no"})).is_err());
    }
}
