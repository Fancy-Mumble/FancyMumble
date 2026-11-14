//! A server's livery: the presentation its operator supplies - a name, a
//! banner, an icon, a line under the name, chips, a greeting, colours - which
//! the web client draws on a server's page before anything is
//! authenticated, and here too.
//!
//! What a server sends has proven nothing yet, so nothing it sends is kept as
//! it came where that could matter: a colour is parsed to three numbers here
//! and nothing else of it survives, a picture is only ever bytes the engine
//! already holds (never an address that would be fetched), and a link is
//! followed only if it is `https://`, and then only as any link is.

mod colours;
mod ledger;
pub(crate) mod mapped;
mod page;
mod shelf;
mod status;

use std::sync::Arc;

use gpui::SharedString;

pub(crate) use colours::Dressed;
pub(crate) use ledger::Ledger;
pub(crate) use page::Landing;
pub(crate) use shelf::{Kept, Shelf};
pub(crate) use status::{Pinged, Probe, Resolved, Shown, Status, Tone as StatusTone, resolve};

/// How a chip beside the server's name is toned: what it means, never a
/// colour of the server's choosing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum TagTone {
    #[default]
    Neutral,
    Ok,
    Warn,
    Bad,
    Accent,
}

impl TagTone {
    /// The tone a server names, as the engine passes it on; one this client
    /// does not know is neutral rather than dropped.
    pub(crate) fn named(name: &str) -> Self {
        match name {
            "OK" => Self::Ok,
            "WARN" => Self::Warn,
            "BAD" => Self::Bad,
            "ACCENT" => Self::Accent,
            _ => Self::Neutral,
        }
    }

    /// The name the server gives it: how it is kept on disk.
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Neutral => "NEUTRAL",
            Self::Ok => "OK",
            Self::Warn => "WARN",
            Self::Bad => "BAD",
            Self::Accent => "ACCENT",
        }
    }
}

/// One chip beside the server's name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Tag {
    pub label: SharedString,
    pub tone: TagTone,
    /// Where it leads: only ever an `https://` address.
    pub href: Option<SharedString>,
}

impl Tag {
    pub(crate) fn new(label: &str, tone: TagTone, href: Option<&str>) -> Self {
        Self {
            label: label.to_owned().into(),
            tone,
            href: href
                .filter(|href| href.starts_with("https://"))
                .map(|href| href.to_owned().into()),
        }
    }
}

/// A colour, as three channels: all of a server's colour that is kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Rgb(pub [u8; 3]);

impl std::str::FromStr for Rgb {
    type Err = ();

    /// `#rrggbb` and nothing else, as the web client's `parseHex` reads it.
    fn from_str(value: &str) -> Result<Self, ()> {
        let digits = value.trim().strip_prefix('#').ok_or(())?;
        if digits.len() != 6 || !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(());
        }
        let channel = |at: usize| u8::from_str_radix(&digits[at..at + 2], 16).map_err(|_| ());
        Ok(Self([channel(0)?, channel(2)?, channel(4)?]))
    }
}

impl std::fmt::Display for Rgb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let [r, g, b] = self.0;
        write!(f, "#{r:02x}{g:02x}{b:02x}")
    }
}

/// The colours a server offers for one mode; any may be missing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Palette {
    pub accent: Option<Rgb>,
    pub surface: Option<Rgb>,
    pub aura_from: Option<Rgb>,
    pub aura_to: Option<Rgb>,
}

impl Palette {
    /// The palette of the four colours as sent, each kept only if it is a
    /// colour; `None` when none is.
    pub(crate) fn read(colours: [Option<&str>; 4]) -> Option<Self> {
        let [accent, surface, aura_from, aura_to] =
            colours.map(|colour| colour.and_then(|colour| colour.parse().ok()));
        let palette = Self {
            accent,
            surface,
            aura_from,
            aura_to,
        };
        (palette != Self::default()).then_some(palette)
    }
}

/// What a server says it looks like. Every part may be missing, and a
/// missing part leaves what the client draws anyway.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Livery {
    /// Raised by the server on every change.
    pub version: u64,
    /// Lowercase hex, as the server's ping carries it.
    pub digest: SharedString,
    pub name: Option<SharedString>,
    pub tagline: Option<SharedString>,
    /// The greeting: plain text, drawn as plain text.
    pub motd: Option<SharedString>,
    pub tags: Vec<Tag>,
    pub banner: Option<Arc<gpui::Image>>,
    pub icon: Option<Arc<gpui::Image>>,
    /// Where a banner that has to be cut is cut around, in percent across
    /// and down.
    pub focus: (u8, u8),
    pub dark: Option<Palette>,
    pub light: Option<Palette>,
}

/// The middle of a banner: where it is cut around when its server says
/// nowhere.
pub(crate) const MIDDLE: (u8, u8) = (50, 50);

impl Livery {
    /// A focus point as a server gives it, in percent, held to the picture.
    pub(crate) fn focus_of(focus: Option<(u32, u32)>) -> (u8, u8) {
        focus.map_or(MIDDLE, |(x, y)| {
            let percent = |value: u32| u8::try_from(value.min(100)).unwrap_or(50);
            (percent(x), percent(y))
        })
    }

    /// The colours offered for a theme in `dark` or light mode.
    pub(crate) fn palette(&self, dark: bool) -> Option<&Palette> {
        if dark {
            self.dark.as_ref()
        } else {
            self.light.as_ref()
        }
    }
}

/// `text`, unless there is none of it.
pub(crate) fn said(text: Option<&str>) -> Option<SharedString> {
    text.filter(|text| !text.trim().is_empty())
        .map(|text| text.to_owned().into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_colour_is_six_hex_digits_and_nothing_else() {
        assert_eq!("#E0245e".parse(), Ok(Rgb([0xe0, 0x24, 0x5e])));
        assert_eq!(" #000000 ".parse(), Ok(Rgb([0, 0, 0])));
        for bad in ["red", "#fff", "#e0245e;x", "e0245e", "#e0245g", ""] {
            assert!(bad.parse::<Rgb>().is_err(), "{bad}");
        }
        assert_eq!(Rgb([0xe0, 0x24, 0x5e]).to_string(), "#e0245e");
    }

    #[test]
    fn a_palette_naming_no_colour_is_none() {
        assert_eq!(Palette::read([Some("red"), None, Some(""), None]), None);
        let palette = Palette::read([None, Some("#101010"), None, None]).expect("a surface");
        assert_eq!(palette.surface, Some(Rgb([16, 16, 16])));
    }

    #[test]
    fn a_tag_leads_only_to_a_secure_address() {
        assert!(
            Tag::new("Rules", TagTone::Accent, Some("https://example.org"))
                .href
                .is_some()
        );
        for href in ["http://example.org", "javascript:alert(1)", "file:///c:/x"] {
            assert!(
                Tag::new("Rules", TagTone::Accent, Some(href))
                    .href
                    .is_none()
            );
        }
        assert_eq!(TagTone::named("SPARKLY"), TagTone::Neutral);
        assert_eq!(TagTone::named(TagTone::Warn.name()), TagTone::Warn);
    }

    #[test]
    fn a_focus_is_held_to_the_picture() {
        assert_eq!(Livery::focus_of(None), MIDDLE);
        assert_eq!(Livery::focus_of(Some((20, 250))), (20, 100));
    }
}
