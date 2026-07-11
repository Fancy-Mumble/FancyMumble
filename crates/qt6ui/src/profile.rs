//! Fancy Mumble profile comments.
//!
//! A user's Mumble comment can carry a Fancy Mumble profile: a JSON payload
//! inside an HTML comment (invisible to legacy clients) followed by the
//! visible bio HTML - see `mumble-tauri/ui/src/profileFormat.ts`:
//!
//! ```text
//! <!--FANCY:{"v":1,"status":"...","banner":{"color":"#123456"},...}-->
//! (bio HTML here)
//! ```
//!
//! Only the fields the QML `NameCard` renders are extracted here.

const FANCY_PREFIX: &str = "<!--FANCY:";
const FANCY_SUFFIX: &str = "-->";

/// The subset of a Fancy Mumble profile the name card displays.
/// (`PartialEq` only: the glow size is an `f64`.)
#[derive(Debug, Default, Clone, PartialEq)]
pub struct CardProfile {
    /// Custom status line ("Do not disturb", ...); empty when unset.
    pub status: String,
    /// Visible bio HTML (everything after the FANCY marker, or the whole
    /// comment for legacy clients).
    pub bio_html: String,
    /// Banner CSS color (`banner.color`); empty when unset.
    pub banner_color: String,
    /// Banner image as a data URI (`banner.image`); empty when unset.
    pub banner_image: String,
    /// Custom name color (`nameStyle.color`); empty when unset.
    pub name_color: String,
    /// `nameStyle.bold`
    pub name_bold: bool,
    /// `nameStyle.italic`
    pub name_italic: bool,
    /// Two-stop name gradient (`nameStyle.gradient`); empty when unset.
    pub name_gradient: Vec<String>,
    /// Name glow (`nameStyle.glow`): color + blur size; empty color = none.
    pub name_glow_color: String,
    pub name_glow_size: f64,
    /// Theme colors (`themeColors`, 1-5 hex values) for the card gradient,
    /// border accent and adaptive text color.
    pub theme_colors: Vec<String>,
    /// `cardGlass`: translucent gradient stops.
    pub card_glass: bool,
    /// `cardBackground` preset id ("custom" uses `card_background_custom`).
    pub card_background: String,
    pub card_background_custom: String,
}

/// Split a comment into its raw FANCY JSON payload (when present and
/// valid) and the visible bio HTML. Used by the settings page to update
/// individual profile fields without wiping ones this client does not
/// edit (nameStyle, themeColors, ... set from the full client).
pub fn split_comment(comment: &str) -> (Option<serde_json::Value>, String) {
    let Some(rest) = comment.strip_prefix(FANCY_PREFIX) else {
        return (None, comment.to_owned());
    };
    let Some(end) = rest.find(FANCY_SUFFIX) else {
        return (None, comment.to_owned());
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&rest[..end]) else {
        return (None, comment.to_owned());
    };
    let bio = &rest[end + FANCY_SUFFIX.len()..];
    (Some(value), bio.strip_prefix('\n').unwrap_or(bio).to_owned())
}

/// Build a comment string from a FANCY profile JSON + bio HTML
/// (`profileFormat.ts serializeProfile`).
pub fn build_comment(profile: &serde_json::Value, bio_html: &str) -> String {
    let marker = format!("{FANCY_PREFIX}{profile}{FANCY_SUFFIX}");
    if bio_html.is_empty() {
        marker
    } else {
        format!("{marker}\n{bio_html}")
    }
}

/// Parse a Mumble comment into the card-relevant profile fields.
/// Non-Fancy comments yield a default profile whose `bio_html` is the
/// comment itself.
pub fn parse_comment(comment: &str) -> CardProfile {
    let mut out = CardProfile::default();
    let Some(rest) = comment.strip_prefix(FANCY_PREFIX) else {
        out.bio_html = comment.to_owned();
        return out;
    };
    let Some(end) = rest.find(FANCY_SUFFIX) else {
        out.bio_html = comment.to_owned();
        return out;
    };
    let json = &rest[..end];
    let bio = &rest[end + FANCY_SUFFIX.len()..];
    out.bio_html = bio.strip_prefix('\n').unwrap_or(bio).to_owned();

    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        out.bio_html = comment.to_owned();
        return out;
    };
    let str_at = |v: &serde_json::Value, key: &str| {
        v.get(key).and_then(|s| s.as_str()).unwrap_or_default().to_owned()
    };
    out.status = str_at(&value, "status");
    if let Some(banner) = value.get("banner") {
        out.banner_color = str_at(banner, "color");
        out.banner_image = str_at(banner, "image");
    }
    if let Some(name_style) = value.get("nameStyle") {
        out.name_color = str_at(name_style, "color");
        out.name_bold = name_style.get("bold").and_then(serde_json::Value::as_bool).unwrap_or(false);
        out.name_italic =
            name_style.get("italic").and_then(serde_json::Value::as_bool).unwrap_or(false);
        out.name_gradient = str_list(name_style.get("gradient"));
        if let Some(glow) = name_style.get("glow") {
            out.name_glow_color = str_at(glow, "color");
            out.name_glow_size =
                glow.get("size").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
        }
    }
    out.theme_colors = str_list(value.get("themeColors"));
    out.card_glass = value.get("cardGlass").and_then(serde_json::Value::as_bool).unwrap_or(false);
    out.card_background = str_at(&value, "cardBackground");
    out.card_background_custom = str_at(&value, "cardBackgroundCustom");
    out
}

/// A JSON array of strings as owned Strings (non-strings skipped).
fn str_list(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|s| s.as_str().map(ToOwned::to_owned)).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_comment_is_bio() {
        let p = parse_comment("just a comment");
        assert_eq!(p.bio_html, "just a comment");
        assert_eq!(p.status, "");
    }

    #[test]
    fn fancy_comment_extracts_fields() {
        let p = parse_comment(
            "<!--FANCY:{\"v\":1,\"status\":\"afk\",\"banner\":{\"color\":\"#123456\"},\
             \"nameStyle\":{\"color\":\"#ff0000\",\"bold\":true}}-->\nhello <b>world</b>",
        );
        assert_eq!(p.status, "afk");
        assert_eq!(p.banner_color, "#123456");
        assert_eq!(p.name_color, "#ff0000");
        assert!(p.name_bold);
        assert!(!p.name_italic);
        assert_eq!(p.bio_html, "hello <b>world</b>");
    }

    #[test]
    fn broken_json_falls_back_to_whole_comment() {
        let p = parse_comment("<!--FANCY:{not json-->bio");
        assert_eq!(p.bio_html, "<!--FANCY:{not json-->bio");
    }
}
