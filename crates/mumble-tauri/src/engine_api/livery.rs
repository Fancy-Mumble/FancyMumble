//! A server's livery, as a view that is not a web page holds it: the words
//! and colours as sent, the pictures as their bytes.
//!
//! The engine keeps a livery as the web client draws it, its pictures as
//! `data:` addresses; a view that draws pictures itself wants the file, so
//! they are read back here once, as they leave the engine.

use crate::state::LiverySnapshot;

/// One of a livery's pictures: its file, and what the server says it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveryArt {
    /// `image/png`, `image/jpeg` or `image/webp`: what the server read the
    /// bytes as.
    pub content_type: String,
    /// The file.
    pub bytes: Vec<u8>,
}

/// One chip beside a server's name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveryTagInfo {
    /// What it says.
    pub label: String,
    /// `NEUTRAL`, `OK`, `WARN`, `BAD` or `ACCENT`: how it is toned, never a
    /// colour.
    pub tone: String,
    /// Where it leads, for a chip that is a link.
    pub href: Option<String>,
}

/// The colours a server offers for one mode, each `#rrggbb` as sent: a
/// view parses them, and holds them to its own contrast.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LiveryColours {
    /// What buttons and marks are drawn in.
    pub accent: Option<String>,
    /// The window's ground.
    pub surface: Option<String>,
    /// The two colours of the wash behind everything.
    pub aura_from: Option<String>,
    /// See [`Self::aura_from`].
    pub aura_to: Option<String>,
}

/// What a server says it looks like. Every part may be missing; a missing
/// part leaves the view's own.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LiveryInfo {
    /// Raised by the server on every change.
    pub version: u64,
    /// Lowercase hex: the same value the server's ping carries, which is
    /// what a copy kept from an earlier visit is checked against.
    pub digest: String,
    /// The name the server goes by.
    pub display_name: Option<String>,
    /// A line under the name.
    pub tagline: Option<String>,
    /// The greeting, as plain text.
    pub motd: Option<String>,
    /// The chips beside the name.
    pub tags: Vec<LiveryTagInfo>,
    /// Where the server's rules are read.
    pub rules_url: Option<String>,
    /// The picture across the head of the server's page.
    pub banner: Option<LiveryArt>,
    /// The server's own tile.
    pub icon: Option<LiveryArt>,
    /// Where a banner that has to be cut is cut around, as percentages
    /// across and down.
    pub banner_focus: Option<(u32, u32)>,
    /// The colours offered for a dark theme.
    pub dark: Option<LiveryColours>,
    /// The colours offered for a light theme.
    pub light: Option<LiveryColours>,
}

/// The file in a `data:` address, and what it says the file is.
fn art(uri: Option<&str>) -> Option<LiveryArt> {
    use base64::Engine as _;
    let (head, encoded) = uri?.strip_prefix("data:")?.split_once(";base64,")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    Some(LiveryArt {
        content_type: head.to_owned(),
        bytes,
    })
}

impl From<&LiverySnapshot> for LiveryInfo {
    fn from(livery: &LiverySnapshot) -> Self {
        let colours = |palette: Option<&crate::state::LiveryPalette>| {
            palette.map(|palette| LiveryColours {
                accent: palette.accent.clone(),
                surface: palette.surface.clone(),
                aura_from: palette.aura_from.clone(),
                aura_to: palette.aura_to.clone(),
            })
        };
        Self {
            version: livery.version,
            digest: livery.digest.clone(),
            display_name: livery.display_name.clone(),
            tagline: livery.tagline.clone(),
            motd: livery.motd.clone(),
            tags: livery
                .tags
                .iter()
                .map(|tag| LiveryTagInfo {
                    label: tag.label.clone(),
                    tone: tag.tone.clone(),
                    href: tag.href.clone(),
                })
                .collect(),
            rules_url: livery.rules_url.clone(),
            banner: art(livery.banner_src.as_deref()),
            icon: art(livery.icon_src.as_deref()),
            banner_focus: livery.banner_focus.map(|focus| (focus.x, focus.y)),
            dark: colours(livery.palette.dark.as_ref()),
            light: colours(livery.palette.light.as_ref()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::data_uri;

    #[test]
    fn a_picture_leaves_the_engine_as_its_file() {
        let livery = LiverySnapshot {
            digest: "ab".to_owned(),
            banner_src: Some(data_uri("image/webp", &[1, 2, 3])),
            icon_src: Some("https://example.org/not-a-file.png".to_owned()),
            ..Default::default()
        };
        let info = LiveryInfo::from(&livery);
        let banner = info.banner.expect("the banner");
        assert_eq!(banner.content_type, "image/webp");
        assert_eq!(banner.bytes, [1, 2, 3]);
        assert!(info.icon.is_none(), "only a file is ever handed on");
        assert_eq!(info.digest, "ab");
    }
}
