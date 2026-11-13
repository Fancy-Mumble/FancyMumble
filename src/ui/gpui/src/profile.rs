//! A Fancy Mumble profile, as it rides in a user's comment.
//!
//! The comment begins with `<!--FANCY:{...}-->`, a JSON object inside an
//! HTML comment that other clients do not show, and what follows is what
//! the user wrote about themselves. This reads the part of the object a
//! card is drawn from. A profile is somebody else's, so nothing in it is
//! ever fetched: a picture is used only when the profile carries it whole.

use gpui::Hsla;
use serde::Deserialize;

use crate::theme::parse_color;

const PREFIX: &str = "<!--FANCY:";
const SUFFIX: &str = "-->";

/// What a profile says, of what this view draws.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Profile {
    /// What the user says they are doing.
    pub status: Option<String>,
    pub pronouns: Option<String>,
    /// How to reach them elsewhere.
    pub contact: Option<String>,
    /// The banner's colour, and its picture as encoded bytes.
    pub banner_color: Option<Hsla>,
    pub banner_picture: Option<Vec<u8>>,
    /// The colour the name is set in.
    pub name_color: Option<Hsla>,
    pub name_bold: bool,
    pub name_italic: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Raw {
    status: Option<String>,
    pronouns: Option<String>,
    contact: Option<String>,
    banner: RawBanner,
    name_style: RawNameStyle,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawBanner {
    color: Option<String>,
    image: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawNameStyle {
    color: Option<String>,
    gradient: Option<(String, String)>,
    bold: bool,
    italic: bool,
}

impl Profile {
    /// The profile at the head of `comment`, if it has one that can be
    /// read. A comment written by another client has none.
    pub(crate) fn of(comment: &str) -> Option<Self> {
        let rest = comment.strip_prefix(PREFIX)?;
        let json = &rest[..rest.find(SUFFIX)?];
        let raw: Raw = serde_json::from_str(json).ok()?;
        let said = |text: Option<String>| {
            text.map(|text| text.trim().to_owned())
                .filter(|text| !text.is_empty())
        };
        let color = |css: Option<&String>| css.and_then(|css| parse_color(css)).map(Hsla::from);
        Some(Self {
            status: said(raw.status),
            pronouns: said(raw.pronouns),
            contact: said(raw.contact),
            banner_color: color(raw.banner.color.as_ref()),
            banner_picture: raw
                .banner
                .image
                .as_deref()
                .and_then(crate::rich::embedded_picture),
            // A name set in a gradient is drawn in the colour it starts in.
            name_color: color(raw.name_style.color.as_ref())
                .or_else(|| color(raw.name_style.gradient.as_ref().map(|(from, _)| from))),
            name_bold: raw.name_style.bold,
            name_italic: raw.name_style.italic,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_profile_is_read_from_the_head_of_a_comment() {
        let comment = r##"<!--FANCY:{"v":1,"status":" Painting ","pronouns":"she/her","banner":{"color":"#336699"},"nameStyle":{"gradient":["#ff0000","#0000ff"],"bold":true}}-->
<b>Draws</b> characters."##;
        let profile = Profile::of(comment).expect("a profile");
        assert_eq!(profile.status.as_deref(), Some("Painting"));
        assert_eq!(profile.pronouns.as_deref(), Some("she/her"));
        assert_eq!(profile.contact, None);
        assert!(profile.banner_color.is_some() && profile.banner_picture.is_none());
        let red = gpui::Rgba::from(profile.name_color.expect("the gradient's first colour"));
        assert!(red.r > 0.99 && red.b < 0.01);
        assert!(profile.name_bold && !profile.name_italic);
    }

    #[test]
    fn a_plain_comment_or_a_broken_head_is_no_profile() {
        assert_eq!(Profile::of("Just somebody."), None);
        assert_eq!(Profile::of("<!--FANCY:{not json}-->bio"), None);
        assert_eq!(Profile::of("<!--FANCY:{\"v\":1"), None, "never closed");
        // An empty object is a profile that says nothing.
        assert_eq!(Profile::of("<!--FANCY:{}-->"), Some(Profile::default()));
    }

    #[test]
    fn a_banner_that_is_an_address_is_not_a_picture() {
        let remote = r#"<!--FANCY:{"banner":{"image":"https://example.org/track.png","color":"url(https://example.org/x)"}}-->"#;
        let profile = Profile::of(remote).expect("a profile");
        assert!(profile.banner_picture.is_none(), "nothing is fetched");
        assert!(profile.banner_color.is_none(), "nor is that a colour");
        let inline = r#"<!--FANCY:{"banner":{"image":"data:image/png;base64,iVBORw0KGgo="}}-->"#;
        assert!(
            Profile::of(inline)
                .expect("a profile")
                .banner_picture
                .is_some()
        );
    }
}
