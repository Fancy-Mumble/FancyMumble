//! The small pieces every part of the shell draws with.

use gpui::{Hsla, Pixels, SharedString, Styled, Svg, div, px, svg};

use crate::theme::Theme;

/// The weight of a name, a title, the selected row.
///
/// Semibold, as the web UI sets them. The bundled Inter has that face; a
/// family without one answers with its bold.
pub(crate) const EMPHASIS: gpui::FontWeight = gpui::FontWeight::SEMIBOLD;

/// A bundled icon, `size` square, in `color`.
pub(crate) fn icon(name: &'static str, size: f32, color: Hsla) -> Svg {
    svg()
        .path(SharedString::from(format!("icons/{name}.svg")))
        .size(px(size))
        .flex_none()
        .text_color(color)
}

/// A user's avatar: their picture, or until it has arrived (or if they
/// have none) their initial on the theme's placeholder tile.
pub(crate) fn avatar(
    name: &str,
    picture: Option<&std::sync::Arc<gpui::Image>>,
    size: f32,
    theme: &Theme,
) -> gpui::AnyElement {
    use gpui::prelude::*;

    let radius = avatar_radius(size, theme);
    if let Some(picture) = picture {
        return gpui::img(std::sync::Arc::clone(picture))
            .flex_none()
            .size(px(size))
            .rounded(radius)
            .object_fit(gpui::ObjectFit::Cover)
            .into_any_element();
    }
    let initial: String = name
        .chars()
        .next()
        .map(|first| first.to_uppercase().collect())
        .unwrap_or_default();
    div()
        .flex_none()
        .size(px(size))
        .rounded(radius)
        .bg(theme.c.tile)
        .flex()
        .items_center()
        .justify_center()
        .text_size(px((size * 0.42).max(9.0)))
        .font_weight(EMPHASIS)
        .text_color(theme.c.text)
        .child(initial)
        .into_any_element()
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

/// `HH:MM` on a clock `offset_secs` east of UTC, for a Unix epoch time in
/// milliseconds; nothing for a message that carries no time.
pub(crate) fn clock(sent_at_ms: Option<u64>, offset_secs: i64) -> String {
    let Some(sent_at_ms) = sent_at_ms else {
        return String::new();
    };
    let seconds = i64::try_from(sent_at_ms / 1000).unwrap_or(i64::MAX);
    let minutes = seconds.saturating_add(offset_secs).div_euclid(60);
    format!(
        "{:02}:{:02}",
        (minutes / 60).rem_euclid(24),
        minutes.rem_euclid(60)
    )
}

/// How far east of UTC the local clock is right now, in seconds.
pub(crate) fn local_utc_offset() -> i64 {
    use chrono::Offset;

    i64::from(chrono::Local::now().offset().fix().local_minus_utc())
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
        assert_eq!(clock(Some(0), 0), "00:00");
        assert_eq!(clock(Some(1_760_045_820_000), 0), "21:37");
        assert_eq!(clock(Some(1_760_045_820_000 + 23 * 60_000), 0), "22:00");
        assert_eq!(
            clock(Some(1_760_045_820_000), 3600),
            "22:37",
            "an hour east"
        );
        assert_eq!(
            clock(Some(0), -3600),
            "23:00",
            "an hour west, the day before"
        );
        assert_eq!(clock(None, 0), "");
    }
}
