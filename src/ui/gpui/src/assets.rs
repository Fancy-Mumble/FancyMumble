//! The view's own assets, compiled into the binary.
//!
//! Only icons: outline glyphs from Lucide (ISC, see `assets/icons/LICENSE`),
//! each a few hundred bytes, drawn in whatever colour the theme asks for, and
//! the brand's monogram, an outline lifted from Great Vibes (OFL, see
//! `assets/icons/brand-OFL.txt`) by the web UI's `brandGlyph.ts`.

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
    "chevron-down",
    "chevron-right",
    "download",
    "ear",
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
    "search",
    "send",
    "settings-2",
    "square",
    "star",
    "sun",
    "trash-2",
    "users",
    "volume-2",
    "x",
];

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
