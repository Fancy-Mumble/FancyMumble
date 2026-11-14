//! The view's own assets, compiled into the binary.
//!
//! Icons and two typefaces. The icons are outline glyphs from Lucide (ISC, see `assets/icons/LICENSE`),
//! each a few hundred bytes, drawn in whatever colour the theme asks for, and
//! the brand's monogram, an outline lifted from Great Vibes (OFL, see
//! `assets/icons/brand-OFL.txt`) by the web UI's `brandGlyph.ts`.
//!
//! The typeface is Inter (OFL, see `assets/fonts/Inter-OFL.txt`), the face
//! the web UI ships and sets everything in: eight static faces cut from its
//! variable font by `assets/fonts/instances.py`. The other is the web UI's
//! poster face, Saira's italic (OFL, see `assets/fonts/Saira-OFL.txt`), its
//! variable font as the web UI ships it, whose outlines a drawn theme's
//! marks are laid from.

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
    "arrow-left",
    "at-sign",
    "badge-check",
    "bold",
    "brand",
    "check",
    "check-check",
    "clock",
    "chevron-down",
    "chevron-left",
    "chevron-right",
    "chevron-up",
    "code",
    "download",
    "bell",
    "ear",
    "file",
    "grip-vertical",
    "ellipsis-vertical",
    "hash",
    "headphone-off",
    "headphones",
    "info",
    "italic",
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
    "screen-share",
    "search",
    "send",
    "settings-2",
    "smile",
    "square",
    "star",
    "strikethrough",
    "sun",
    "text-quote",
    "trash-2",
    "users",
    "volume-2",
    "x",
    "zap",
    "monitor",
    "lock",
    "copy",
    "smile-plus",
    "underline",
    "link-2",
    "play",
    "pause",
    "image",
    // Screen sharing's stage and picker.
    "app-window",
    "camera",
    "chart-column",
    "maximize",
    "minimize",
    "webcam",
    "volume-x",
    "picture-in-picture-2",
    "pin-off",
    // The sheet over the user's own dock.
    "user-x",
    "shield",
    "circle-dot",
    "settings",
    // The about field's toolbar on the Profile page.
    "heading",
    "list",
    "type",
];

/// Inter's bold, which the kit also reads letter outlines from
/// (`ui::kit::lettering`).
pub(crate) const INTER_BOLD: &[u8] = include_bytes!("../assets/fonts/Inter-Bold.ttf");

/// Saira's italic (OFL, see `assets/fonts/Saira-OFL.txt`), the variable
/// font the web UI ships for a drawn theme's poster type: the room's name
/// behind the conversation. Its outlines are read and laid as a path
/// (`ui::kit::lettering`); the text system is never given it.
pub(crate) const SAIRA_ITALIC: &[u8] =
    include_bytes!("../assets/fonts/Saira-Italic-VariableFont_wdth,wght.ttf");

/// Inter's drawn italic at 800 and optical size 32, cut by
/// `assets/fonts/instances.py`: what the browser sets a letter of the
/// poster name in that Saira lacks (Greek, Cyrillic). Read as outlines
/// only (`ui::kit::lettering`), never given to the text system.
pub(crate) const INTER_POSTER_ITALIC: &[u8] =
    include_bytes!("../assets/fonts/Inter-PosterItalic.ttf");

/// The bundled faces of Inter: regular, medium, semibold, bold, black and
/// italic, and the bold of its display cuts (`Inter Display` at optical
/// size 24, `Inter Display Large` at 32), which is what a browser draws a
/// heading in. Black (900) is what a drawn theme's poster
/// labels ask for, such as the voice dock's name in Nimbus.
///
/// About 290 KiB each, and the text system copies what it is given, so this
/// is some 2 MiB held for the whole run. It buys the same letterforms and
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
        Cow::Borrowed(INTER_BOLD),
        face!("Black"),
        face!("Italic"),
        face!("DisplayBold"),
        face!("DisplayLargeBold"),
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
