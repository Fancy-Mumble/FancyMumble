//! A livery as the real engine hands it over, as this view holds it.

use std::sync::Arc;

use mumble_tauri_lib::engine_api::{LiveryArt, LiveryColours, LiveryInfo};

use super::{Livery, Palette, Tag, TagTone, said};

/// A picture, if its bytes are one.
fn picture(art: Option<LiveryArt>) -> Option<Arc<gpui::Image>> {
    crate::picture::picture(art?.bytes).map(Arc::new)
}

fn palette(colours: Option<&LiveryColours>) -> Option<Palette> {
    let colours = colours?;
    Palette::read([
        colours.accent.as_deref(),
        colours.surface.as_deref(),
        colours.aura_from.as_deref(),
        colours.aura_to.as_deref(),
    ])
}

impl From<LiveryInfo> for Livery {
    fn from(info: LiveryInfo) -> Self {
        Self {
            version: info.version,
            name: said(info.display_name.as_deref()),
            tagline: said(info.tagline.as_deref()),
            motd: said(info.motd.as_deref()),
            tags: info
                .tags
                .iter()
                .map(|tag| Tag::new(&tag.label, TagTone::named(&tag.tone), tag.href.as_deref()))
                .collect(),
            focus: Livery::focus_of(info.banner_focus),
            dark: palette(info.dark.as_ref()),
            light: palette(info.light.as_ref()),
            banner: picture(info.banner),
            icon: picture(info.icon),
            digest: info.digest.into(),
        }
    }
}
