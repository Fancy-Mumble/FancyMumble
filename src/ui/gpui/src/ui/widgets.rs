//! The small pieces every part of the shell draws with.

use gpui::{Hsla, SharedString};

use crate::theme::Theme;

/// The weight of a name, a title, the selected row.
///
/// Semibold, as the web UI sets them. The bundled Inter has that face; a
/// family without one answers with its bold.
pub(crate) const EMPHASIS: gpui::FontWeight = gpui::FontWeight::SEMIBOLD;

pub(crate) use super::kit::icon;

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

/// The clock a time is read on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Zone {
    /// The system's, with the offset it had at the time being read: a
    /// message from last summer is shown in summer time.
    Local,
    /// This many seconds east of UTC, always: a clock a test can rely on.
    #[cfg(test)]
    Fixed(i64),
}

impl Zone {
    /// How far east of UTC this clock was at `at_ms`, in seconds.
    pub(crate) fn offset_at(self, at_ms: u64) -> i64 {
        use chrono::{Offset, TimeZone};

        match self {
            #[cfg(test)]
            Self::Fixed(seconds) => seconds,
            Self::Local => i64::try_from(at_ms)
                .ok()
                .and_then(|at| chrono::Local.timestamp_millis_opt(at).single())
                .map_or(0, |then| i64::from(then.offset().fix().local_minus_utc())),
        }
    }

    /// `at_ms` in seconds since the epoch, as this clock's wall time.
    pub(crate) fn wall_seconds(self, at_ms: u64) -> i64 {
        let seconds = i64::try_from(at_ms / 1000).unwrap_or(i64::MAX);
        seconds.saturating_add(self.offset_at(at_ms))
    }
}

/// `HH:MM` on `zone`, for a Unix epoch time in milliseconds; nothing for a
/// message that carries no time.
pub(crate) fn clock(sent_at_ms: Option<u64>, zone: Zone) -> String {
    let Some(sent_at_ms) = sent_at_ms else {
        return String::new();
    };
    let minutes = zone.wall_seconds(sent_at_ms).div_euclid(60);
    format!(
        "{:02}:{:02}",
        (minutes / 60).rem_euclid(24),
        minutes.rem_euclid(60)
    )
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
        assert_eq!(clock(Some(0), Zone::Fixed(0)), "00:00");
        assert_eq!(clock(Some(1_760_045_820_000), Zone::Fixed(0)), "21:37");
        assert_eq!(
            clock(Some(1_760_045_820_000 + 23 * 60_000), Zone::Fixed(0)),
            "22:00"
        );
        assert_eq!(
            clock(Some(1_760_045_820_000), Zone::Fixed(3600)),
            "22:37",
            "an hour east"
        );
        assert_eq!(
            clock(Some(0), Zone::Fixed(-3600)),
            "23:00",
            "an hour west, the day before"
        );
        assert_eq!(clock(None, Zone::Fixed(0)), "");
    }
}
