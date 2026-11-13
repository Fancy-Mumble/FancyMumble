//! The view's own assets, compiled into the binary.
//!
//! Icons and one typeface. The icons are outline glyphs from Lucide (ISC, see `assets/icons/LICENSE`),
//! each a few hundred bytes, drawn in whatever colour the theme asks for, and
//! the brand's monogram, an outline lifted from Great Vibes (OFL, see
//! `assets/icons/brand-OFL.txt`) by the web UI's `brandGlyph.ts`.
//!
//! The typeface is Inter (OFL, see `assets/fonts/Inter-OFL.txt`), the face
//! the web UI ships and sets everything in: five static faces cut from its
//! variable font by `assets/fonts/instances.py`.

use std::borrow::Cow;

use gpui::{AssetSource, Result, SharedString};

macro_rules! icons {
    ($($name:literal),* $(,)?) => {
        /// `(asset path, file)` for every bundled icon.
        const ICONS: &[(&str, &[u8])] = &[
            $((
                concat!("icons/", $name, ".svg"),
                include_bytes!(concat!("../assets/icons/", $name, ".svg")),
            )),*
        ];
    };
}

icons![
    "at-sign",
    "brand",
    "check",
    "check-check",
    "chevron-down",
    "chevron-right",
    "download",
    "ear",
    "file",
    "ellipsis-vertical",
    "hash",
    "headphone-off",
    "headphones",
    "info",
    "key-round",
    "log-out",
    "mic",
    "mic-off",
    "minus",
    "monitor-up",
    "moon",
    "palette",
    "paperclip",
    "pencil",
    "pin",
    "plus",
    "reply",
    "search",
    "send",
    "settings-2",
    "smile",
    "square",
    "star",
    "sun",
    "trash-2",
    "users",
    "volume-2",
    "x",
];

/// The bundled faces of Inter: regular, medium, semibold, bold and italic.
///
/// About 290 KiB each, and the text system copies what it is given, so this
/// is some 1.4 MiB held for the whole run. It buys the same letterforms and
/// the same line breaks as the web UI on a system that has no Inter, where
/// the fallback would be whatever sans the system names.
pub(crate) fn fonts() -> Vec<Cow<'static, [u8]>> {
    macro_rules! face {
        ($name:literal) => {
            Cow::Borrowed(&include_bytes!(concat!("../assets/fonts/Inter-", $name, ".ttf"))[..])
        };
    }
    vec![
        face!("Regular"),
        face!("Medium"),
        face!("SemiBold"),
        face!("Bold"),
        face!("Italic"),
    ]
}

/// Serves the bundled assets to GPUI.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        Ok(ICONS
            .iter()
            .find(|(name, _)| *name == path)
            .map(|(_, bytes)| Cow::Borrowed(*bytes)))
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        Ok(ICONS
            .iter()
            .filter(|(name, _)| name.starts_with(path))
            .map(|(name, _)| SharedString::from(*name))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_bundled_icon_loads_and_is_an_svg() {
        for (name, _) in ICONS {
            let bytes = Assets
                .load(name)
                .expect("loading never fails")
                .expect("a listed icon is present");
            assert!(bytes.starts_with(b"<svg"), "{name}");
        }
        assert!(
            Assets
                .load("icons/no-such.svg")
                .expect("no error")
                .is_none()
        );
    }
}
