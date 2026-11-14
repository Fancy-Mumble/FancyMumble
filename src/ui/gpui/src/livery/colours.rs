//! A server's colours, folded into the theme the user chose: the web
//! client's `liveryTokens`, and its contrast floor, ported as they are.
//!
//! What a server offers is a suggestion on top of the user's theme: a
//! colour it did not name leaves the theme's own, and a colour it did name
//! is moved, keeping its hue, until it reads against what it is drawn on.
//! So a server can choose a mood but cannot make its own Connect button
//! invisible, on anybody's theme.

use std::sync::Arc;

use gpui::{App, Global, Hsla, Rgba};

use super::{Palette, Rgb};
use crate::paint::Paint;
use crate::theme::Theme;

/// The contrast an accent must reach against its ground: WCAG's floor for
/// what has to be seen.
pub(crate) const CONTRAST_ACCENT: f64 = 3.0;

/// Relative luminance, the sRGB transfer undone first.
fn luminance(Rgb(colour): Rgb) -> f64 {
    let [r, g, b] = colour.map(|channel| {
        let value = f64::from(channel) / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    });
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

/// WCAG 2.1 contrast ratio, 1 to 21.
pub(crate) fn contrast(one: Rgb, other: Rgb) -> f64 {
    let (one, other) = (luminance(one), luminance(other));
    (one.max(other) + 0.05) / (one.min(other) + 0.05)
}

/// Hue in degrees, saturation and lightness from 0 to 1.
fn to_hsl(Rgb(colour): Rgb) -> (f64, f64, f64) {
    let [r, g, b] = colour.map(|channel| f64::from(channel) / 255.0);
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let lightness = f64::midpoint(max, min);
    let delta = max - min;
    if delta == 0.0 {
        return (0.0, 0.0, lightness);
    }
    let saturation = delta / (1.0 - (2.0 * lightness - 1.0).abs());
    #[expect(clippy::float_cmp, reason = "one of the three is the largest exactly")]
    let hue = if max == r {
        ((g - b) / delta).rem_euclid(6.0)
    } else if max == g {
        (b - r) / delta + 2.0
    } else {
        (r - g) / delta + 4.0
    };
    (hue * 60.0, saturation, lightness)
}

fn from_hsl(hue: f64, saturation: f64, lightness: f64) -> Rgb {
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let sector = hue.rem_euclid(360.0) / 60.0;
    let second = chroma * (1.0 - (sector % 2.0 - 1.0).abs());
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a sector from 0 to 5"
    )]
    let index = sector.floor() as u8;
    let (r, g, b) = match index % 6 {
        0 => (chroma, second, 0.0),
        1 => (second, chroma, 0.0),
        2 => (0.0, chroma, second),
        3 => (0.0, second, chroma),
        4 => (second, 0.0, chroma),
        _ => (chroma, 0.0, second),
    };
    let base = lightness - chroma / 2.0;
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "held to 0..=255 first"
    )]
    let channel = |value: f64| ((value + base) * 255.0).clamp(0.0, 255.0).round() as u8;
    Rgb([channel(r), channel(g), channel(b)])
}

/// Move `colour` until it reaches `target` against `behind`, keeping its
/// hue: both ways, nearest first, so the result is as close to what was
/// asked for as the floor allows. The web client's `clamp`, which mirrors
/// `starling_runtime::livery::clamp`.
pub(crate) fn clamp(colour: Rgb, behind: Rgb, target: f64) -> Rgb {
    let mut best = (colour, contrast(colour, behind));
    if best.1 >= target {
        return colour;
    }
    let (hue, saturation, lightness) = to_hsl(colour);
    for step in 1..=100 {
        let offset = f64::from(step) / 100.0;
        for candidate in [lightness + offset, lightness - offset] {
            if !(0.0..=1.0).contains(&candidate) {
                continue;
            }
            let moved = from_hsl(hue, saturation, candidate);
            let reached = contrast(moved, behind);
            if reached >= target {
                return moved;
            }
            if reached > best.1 {
                best = (moved, reached);
            }
        }
    }
    best.0
}

/// A colour of the theme's, as three channels.
fn rgb_of(color: Hsla) -> Rgb {
    let Rgba { r, g, b, .. } = color.to_rgb();
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "held to 0..=255 first"
    )]
    let channel = |value: f32| (value * 255.0).round().clamp(0.0, 255.0) as u8;
    Rgb([channel(r), channel(g), channel(b)])
}

fn hsla_of(Rgb([r, g, b]): Rgb, alpha: f32) -> Hsla {
    Hsla::from(Rgba {
        r: f32::from(r) / 255.0,
        g: f32::from(g) / 255.0,
        b: f32::from(b) / 255.0,
        a: alpha,
    })
}

/// The wash a server's two aura colours make, as the web client builds it:
/// from three numbers each, never from what the server wrote.
fn aura(palette: &Palette) -> Option<Paint> {
    let from = palette.aura_from.or(palette.aura_to)?;
    let to = palette.aura_to.unwrap_or(from);
    let rgba = |Rgb([r, g, b]): Rgb, alpha: f32| format!("rgba({r},{g},{b},{alpha})");
    Some(Paint::parse(&format!(
        "radial-gradient(1100px 500px at 22% -6%,{},transparent 58%),\
         radial-gradient(900px 560px at 102% 108%,{},transparent 62%)",
        rgba(from, 0.22),
        rgba(to, 0.15),
    )))
}

/// `base` with `palette` folded in: the web client's `liveryTokens`.
pub(crate) fn dressed(base: &Theme, palette: &Palette) -> Theme {
    let mut theme = base.clone();
    // What the accent will actually sit on: the server's ground if it named
    // one, the theme's otherwise.
    let surface = palette.surface.unwrap_or_else(|| rgb_of(base.c.bg0));
    let accent = palette.accent.map_or_else(
        || rgb_of(base.c.accent),
        |accent| clamp(accent, surface, CONTRAST_ACCENT),
    );
    if let Some(surface) = palette.surface {
        theme.c.bg0 = hsla_of(surface, 1.0);
    }
    theme.c.accent = hsla_of(accent, 1.0);
    // From the accent that survived the floor, not the one that was sent.
    theme.c.accent_soft = hsla_of(accent, 0.22);
    theme.c.accent_line = hsla_of(accent, 0.52);
    if let Some(aura) = aura(palette) {
        theme.c.tint = Arc::new(aura);
    }
    theme
}

/// The theme in force with the colours of the server on screen folded in,
/// while there is such a server: what [`crate::theme::ActiveTheme::get`]
/// hands out in place of the user's own theme.
#[derive(Default)]
pub(crate) struct Dressed(Option<Worn>);

struct Worn {
    /// The user's theme it was made from: one chosen since makes it stale.
    base: Arc<Theme>,
    palette: Palette,
    theme: Arc<Theme>,
}

impl Global for Dressed {}

impl Dressed {
    /// What to draw in, given the user's own theme `base`.
    pub(crate) fn over(base: &Arc<Theme>, cx: &App) -> Arc<Theme> {
        cx.try_global::<Self>()
            .and_then(|dressed| dressed.0.as_ref())
            .filter(|worn| Arc::ptr_eq(&worn.base, base))
            .map_or_else(|| Arc::clone(base), |worn| Arc::clone(&worn.theme))
    }

    /// Wear `palette` over `base` from now on, or nothing. Cheap when that
    /// is already so.
    pub(crate) fn wear(base: &Arc<Theme>, palette: Option<Palette>, cx: &mut App) {
        let dressed = cx.default_global::<Self>();
        let same = match (&dressed.0, palette) {
            (Some(worn), Some(palette)) => Arc::ptr_eq(&worn.base, base) && worn.palette == palette,
            (None, None) => true,
            _ => false,
        };
        if same {
            return;
        }
        dressed.0 = palette.map(|palette| Worn {
            base: Arc::clone(base),
            palette,
            theme: Arc::new(self::dressed(base, &palette)),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WHITE: Rgb = Rgb([255, 255, 255]);
    const NEAR_WHITE: Rgb = Rgb([0xf4, 0xf4, 0xf8]);

    #[test]
    fn contrast_is_wcags() {
        assert!((contrast(WHITE, Rgb([0, 0, 0])) - 21.0).abs() < 1e-9);
        assert!((contrast(WHITE, WHITE) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn a_colour_that_reads_is_left_alone() {
        let red = Rgb([0xe0, 0x24, 0x5e]);
        assert_eq!(clamp(red, Rgb([0x10, 0x10, 0x18]), CONTRAST_ACCENT), red);
    }

    #[test]
    fn a_colour_that_does_not_read_is_moved_until_it_does_keeping_its_hue() {
        // A pale accent on a pale ground: invisible as sent.
        let pale = Rgb([0xee, 0xe8, 0xff]);
        let moved = clamp(pale, NEAR_WHITE, CONTRAST_ACCENT);
        assert!(contrast(moved, NEAR_WHITE) >= CONTRAST_ACCENT, "{moved:?}");
        let (hue, _, _) = to_hsl(pale);
        let (moved_hue, _, _) = to_hsl(moved);
        assert!((hue - moved_hue).abs() < 2.0, "{hue} against {moved_hue}");
    }

    #[test]
    fn hsl_goes_there_and_back() {
        for colour in [Rgb([0xe0, 0x24, 0x5e]), Rgb([12, 200, 99]), Rgb([7, 7, 7])] {
            let (h, s, l) = to_hsl(colour);
            assert_eq!(from_hsl(h, s, l), colour);
        }
    }

    #[test]
    fn a_server_names_what_it_changes_and_nothing_else() {
        let base = crate::theme::emergency_theme();
        let palette = Palette::read([Some("#e0245e"), None, None, None]).expect("an accent");
        let theme = dressed(&base, &palette);
        assert_eq!(rgb_of(theme.c.accent), Rgb([0xe0, 0x24, 0x5e]));
        assert_eq!(theme.c.bg0, base.c.bg0, "the ground is the theme's");
        assert_eq!(theme.c.text, base.c.text);
        assert!((theme.c.accent_soft.a - 0.22).abs() < 1e-6);
        let ground = Palette::read([Some("#f4f4f8"), Some("#f4f4f8"), None, None]).expect("both");
        let theme = dressed(&base, &ground);
        assert!(contrast(rgb_of(theme.c.accent), NEAR_WHITE) >= CONTRAST_ACCENT - 0.05);
        assert_eq!(rgb_of(theme.c.bg0), NEAR_WHITE);
    }
}
