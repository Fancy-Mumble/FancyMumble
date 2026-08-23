//! Inbound handler for the server's livery: what it says it looks like.
//!
//! The document is cached in shared state so a reconnect or an HMR reload
//! redraws without waiting for a re-broadcast, and so the connect screen for a
//! server the user has already visited paints from memory.
//!
//! # Artwork
//!
//! Images arrive as bytes on this connection and leave here as `data:` URIs.
//! Never a URL the server chose: the connect screen would then fetch it, and a
//! server in a list could learn a viewer's address from a browse. This is the
//! same reason link previews are fetched server-side.
//!
//! Bytes only arrive for keys the client said it did not hold, so an operator
//! editing a motto costs a few hundred bytes rather than the banner again. What
//! is already cached stays cached: a push carries no art at all, and the keys
//! on the document are what tell us whether the cache still matches.

use mumble_protocol::proto::fancy;
use serde::Serialize;

use super::{HandleMessage, HandlerContext};

/// One chip beside the server's name.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct LiveryTag {
    pub label: String,
    /// `NEUTRAL`, `OK`, `WARN`, `BAD` or `ACCENT`. A name rather than a colour:
    /// the client owns what each tone looks like in the theme in force.
    pub tone: String,
    pub href: Option<String>,
}

/// Colours a server offers for one mode, as `#rrggbb`.
///
/// Passed through as sent. The contrast clamp is the UI's, because it depends
/// on the theme the viewer picked, and a server cannot be trusted to have run
/// it: `livery.ts` parses each of these and drops anything that is not exactly
/// six hex digits.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct LiveryPalette {
    pub accent: Option<String>,
    pub surface: Option<String>,
    #[serde(rename = "auraFrom")]
    pub aura_from: Option<String>,
    #[serde(rename = "auraTo")]
    pub aura_to: Option<String>,
}

/// Where to anchor a banner that has to crop, as percentages.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub(crate) struct LiveryFocus {
    pub x: u32,
    pub y: u32,
}

/// A server's livery as the frontend receives it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct LiverySnapshot {
    pub version: u64,
    /// Lowercase hex, the same value the UDP ping carries.
    pub digest: String,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    pub tagline: Option<String>,
    pub motd: Option<String>,
    pub tags: Vec<LiveryTag>,
    #[serde(rename = "rulesUrl")]
    pub rules_url: Option<String>,
    #[serde(rename = "bannerKey")]
    pub banner_key: Option<String>,
    #[serde(rename = "iconKey")]
    pub icon_key: Option<String>,
    #[serde(rename = "bannerSrc")]
    pub banner_src: Option<String>,
    #[serde(rename = "iconSrc")]
    pub icon_src: Option<String>,
    #[serde(rename = "bannerFocus")]
    pub banner_focus: Option<LiveryFocus>,
    pub palette: LiveryPalettes,
}

/// One palette per mode, because the viewer picks light or dark, not the server.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct LiveryPalettes {
    pub dark: Option<LiveryPalette>,
    pub light: Option<LiveryPalette>,
}

/// Empty reads as absent everywhere in this document: every field is optional
/// and empty means "keep the client's".
fn some_unless_empty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_owned())
}

fn tone_name(tone: i32) -> String {
    fancy::domain::livery_doc::tag::Tone::try_from(tone)
        .unwrap_or(fancy::domain::livery_doc::tag::Tone::Neutral)
        .as_str_name()
        .to_owned()
}

fn palette(palette: Option<&fancy::domain::livery_doc::Palette>) -> Option<LiveryPalette> {
    let palette = palette?;
    let converted = LiveryPalette {
        accent: some_unless_empty(&palette.accent),
        surface: some_unless_empty(&palette.surface),
        aura_from: some_unless_empty(&palette.aura_from),
        aura_to: some_unless_empty(&palette.aura_to),
    };
    // A palette naming nothing is the same document as no palette, and saying
    // so here keeps the UI from rebuilding a theme over an empty object.
    let named = [
        &converted.accent,
        &converted.surface,
        &converted.aura_from,
        &converted.aura_to,
    ]
    .iter()
    .any(|entry| entry.is_some());
    named.then_some(converted)
}

/// Bytes to a `data:` URI the webview can render without fetching anything.
pub(crate) fn data_uri(content_type: &str, bytes: &[u8]) -> String {
    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    // The type the server sniffed from the bytes, not one any uploader claimed.
    format!("data:{content_type};base64,{encoded}")
}

pub(crate) fn to_snapshot(
    doc: &fancy::domain::LiveryDoc,
    art: impl Fn(&str) -> Option<String>,
) -> LiverySnapshot {
    LiverySnapshot {
        version: doc.version,
        digest: doc.digest.iter().map(|byte| format!("{byte:02x}")).collect(),
        display_name: some_unless_empty(&doc.display_name),
        tagline: some_unless_empty(&doc.tagline),
        motd: some_unless_empty(&doc.motd),
        tags: doc
            .tags
            .iter()
            .map(|tag| LiveryTag {
                label: tag.label.clone(),
                tone: tone_name(tag.tone),
                href: some_unless_empty(&tag.href),
            })
            .collect(),
        rules_url: some_unless_empty(&doc.rules_url),
        banner_key: some_unless_empty(&doc.banner_key),
        icon_key: some_unless_empty(&doc.icon_key),
        banner_src: some_unless_empty(&doc.banner_key).and_then(|key| art(&key)),
        icon_src: some_unless_empty(&doc.icon_key).and_then(|key| art(&key)),
        banner_focus: (doc.banner_focus_x != 0 || doc.banner_focus_y != 0).then_some(LiveryFocus {
            x: doc.banner_focus_x,
            y: doc.banner_focus_y,
        }),
        palette: LiveryPalettes {
            dark: palette(doc.dark.as_ref()),
            light: palette(doc.light.as_ref()),
        },
    }
}

#[derive(Serialize)]
struct LiveryPayload {
    livery: LiverySnapshot,
}

impl HandleMessage for fancy::domain::LiveryDoc {
    fn handle(&self, ctx: &HandlerContext) {
        let Ok(mut state) = ctx.shared.lock() else {
            return;
        };

        // Art the server sent this time goes into the cache, keyed by the
        // content hash that names it. A push carries none, which is exactly why
        // the cache has to outlive the document it arrived with.
        for art in &self.art {
            if art.key.is_empty() || art.bytes.is_empty() {
                continue;
            }
            let _ = state
                .livery_art
                .insert(art.key.clone(), data_uri(&art.content_type, &art.bytes));
        }

        // Drop anything the document no longer names, so a banner an operator
        // removed does not sit in memory for the life of the session.
        let named: Vec<String> = [&self.banner_key, &self.icon_key]
            .into_iter()
            .filter(|key| !key.is_empty())
            .cloned()
            .collect();
        state.livery_art.retain(|key, _| named.contains(key));

        let snapshot = to_snapshot(self, |key| state.livery_art.get(key).cloned());
        state.livery = Some(snapshot.clone());
        drop(state);

        ctx.emit("server-livery", LiveryPayload { livery: snapshot });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc() -> fancy::domain::LiveryDoc {
        fancy::domain::LiveryDoc {
            version: 2,
            digest: vec![0xde, 0xad, 0xbe, 0xef],
            tagline: "cozy corner".to_owned(),
            ..Default::default()
        }
    }

    #[test]
    fn empty_fields_read_as_absent_rather_than_as_empty_strings() {
        // The whole ladder depends on this: a field a server did not set has to
        // be indistinguishable from one it never had, or the UI renders an
        // empty motto card.
        let snapshot = to_snapshot(&doc(), |_| None);
        assert_eq!(snapshot.tagline.as_deref(), Some("cozy corner"));
        assert!(snapshot.motd.is_none());
        assert!(snapshot.display_name.is_none());
        assert!(snapshot.banner_src.is_none());
        assert!(snapshot.palette.dark.is_none());
    }

    #[test]
    fn the_digest_is_hex_so_it_compares_against_the_pings() {
        assert_eq!(to_snapshot(&doc(), |_| None).digest, "deadbeef");
    }

    #[test]
    fn a_palette_naming_nothing_is_no_palette() {
        let mut empty = doc();
        empty.dark = Some(fancy::domain::livery_doc::Palette::default());
        assert!(to_snapshot(&empty, |_| None).palette.dark.is_none());
    }

    #[test]
    fn artwork_becomes_a_data_uri_and_never_a_url_the_server_chose() {
        let mut with_art = doc();
        with_art.banner_key = "abc".to_owned();
        let snapshot = to_snapshot(&with_art, |key| {
            (key == "abc").then(|| data_uri("image/png", &[1, 2, 3]))
        });
        let banner = snapshot.banner_src.expect("a banner");
        assert!(banner.starts_with("data:image/png;base64,"));
        assert!(!banner.contains("http"));
    }

    #[test]
    fn a_tone_the_client_does_not_know_falls_back_rather_than_vanishing() {
        let mut tagged = doc();
        tagged.tags = vec![fancy::domain::livery_doc::Tag {
            label: "Rules".to_owned(),
            tone: 99,
            href: String::new(),
        }];
        let snapshot = to_snapshot(&tagged, |_| None);
        assert_eq!(snapshot.tags[0].tone, "NEUTRAL");
        assert_eq!(snapshot.tags[0].label, "Rules");
    }
}
