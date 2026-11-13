//! The small pieces every part of the shell draws with.

use gpui::{Hsla, IntoElement, ParentElement, Pixels, SharedString, Styled, Svg, div, px, svg};

use crate::theme::Theme;

/// The weight of a name, a title, the selected row.
///
/// Bold rather than semibold: most system UI faces have no 600, and a
/// request for one quietly comes back regular.
pub(crate) const EMPHASIS: gpui::FontWeight = gpui::FontWeight::BOLD;

/// A bundled icon, `size` square, in `color`.
pub(crate) fn icon(name: &'static str, size: f32, color: Hsla) -> Svg {
    svg()
        .path(SharedString::from(format!("icons/{name}.svg")))
        .size(px(size))
        .flex_none()
        .text_color(color)
}

/// A user's avatar: until pictures are drawn, their initial on the theme's
/// placeholder tile.
pub(crate) fn avatar(name: &str, size: f32, theme: &Theme) -> impl IntoElement + use<> {
    let initial: String = name
        .chars()
        .next()
        .map(|first| first.to_uppercase().collect())
        .unwrap_or_default();
    div()
        .flex_none()
        .size(px(size))
        .rounded(avatar_radius(size, theme))
        .bg(theme.c.tile)
        .flex()
        .items_center()
        .justify_center()
        .text_size(px((size * 0.42).max(9.0)))
        .font_weight(EMPHASIS)
        .text_color(theme.c.text)
        .child(initial)
}

/// The corner an avatar of `size` gets: a circle unless the theme squares
/// its avatars off.
pub(crate) fn avatar_radius(size: f32, theme: &Theme) -> Pixels {
    theme.skin.radius_avatar.unwrap_or(px(size / 2.0))
}

/// `color` as it looks painted over `ground`, with no transparency left.
///
/// For a surface that floats over other content. Themes with glass give
/// their cards an alpha, which is right for a card on the window and wrong
/// for a menu over a conversation.
pub(crate) fn opaque(color: Hsla, ground: Hsla) -> Hsla {
    let top = gpui::Rgba::from(color);
    let under = gpui::Rgba::from(ground);
    let mix = |over: f32, below: f32| over * top.a + below * (1.0 - top.a);
    Hsla::from(gpui::Rgba {
        r: mix(top.r, under.r),
        g: mix(top.g, under.g),
        b: mix(top.b, under.b),
        a: 1.0,
    })
}

/// `label` as the theme sets its labels: in capitals where the theme shouts.
pub(crate) fn label(text: &str, theme: &Theme) -> SharedString {
    if theme.skin.caps {
        text.to_uppercase().into()
    } else {
        text.to_owned().into()
    }
}

/// `HH:MM` for a Unix epoch time in milliseconds.
///
/// UTC for now: the local offset comes from the engine's settings once the
/// real engine is behind the view.
pub(crate) fn clock(sent_at_ms: u64) -> String {
    let minutes = sent_at_ms / 60_000;
    format!("{:02}:{:02}", (minutes / 60) % 24, minutes % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_translucent_colour_flattens_onto_its_ground() {
        let white = Hsla::from(gpui::rgb(0xff_ffff));
        let mut half_black = Hsla::from(gpui::rgb(0x00_0000));
        half_black.a = 0.5;
        let flat = gpui::Rgba::from(opaque(half_black, white));
        assert!((flat.r - 0.5).abs() < 0.01 && (flat.a - 1.0).abs() < f32::EPSILON);
        // An opaque colour is left as it is.
        let same = gpui::Rgba::from(opaque(white, half_black));
        assert!((same.r - 1.0).abs() < 0.01);
    }

    #[test]
    fn formats_a_time_of_day() {
        assert_eq!(clock(0), "00:00");
        assert_eq!(clock(1_760_045_820_000), "21:37");
        assert_eq!(clock(1_760_045_820_000 + 23 * 60_000), "22:00");
    }
}
