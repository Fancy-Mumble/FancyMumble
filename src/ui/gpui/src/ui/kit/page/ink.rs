//! Text that can be read on what it is drawn on.
//!
//! A document gives its words colours for the surface its writer saw, and
//! this client may show them on another: white on a panel the document
//! made translucent, black on a dark surface where the document set no
//! fill. Each run is held to WCAG's contrast against the ground it really
//! lands on, and a colour that falls short keeps its hue and is made
//! lighter or darker until it reads.

use std::cell::RefCell;

use gpui::{Hsla, Rgba};

use super::Surface;
use crate::page::{Frame, Ink, Look, Role};
use crate::theme::Theme;

/// The contrast body text needs, and large text: WCAG's AA.
pub(crate) const BODY: f32 = 4.5;
pub(crate) const LARGE: f32 = 3.0;

/// What a run of `size` pixels at `weight` needs: large text is 24 pixels,
/// or 18.66 in bold.
pub(crate) fn wanted(size: f32, weight: u16) -> f32 {
    if size >= 24.0 || (size >= 18.66 && weight >= 700) {
        LARGE
    } else {
        BODY
    }
}

/// How light a colour is to the eye, from 0 to 1: its relative luminance.
pub(crate) fn luminance(color: Hsla) -> f32 {
    let rgb = Rgba::from(color);
    let linear = |part: f32| {
        if part <= 0.039_28 {
            part / 12.92
        } else {
            ((part + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
}

/// WCAG's contrast ratio between two opaque colours: 1 for the same, 21
/// for black on white.
pub(crate) fn contrast(a: Hsla, b: Hsla) -> f32 {
    let (a, b) = (luminance(a), luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

/// `top` laid over the opaque `under`: what the eye sees.
pub(crate) fn over(top: Hsla, under: Hsla) -> Hsla {
    let (top, under) = (Rgba::from(top), Rgba::from(under));
    let mix = |a: f32, b: f32| a * top.a + b * (1.0 - top.a);
    Rgba {
        r: mix(top.r, under.r),
        g: mix(top.g, under.g),
        b: mix(top.b, under.b),
        a: 1.0,
    }
    .into()
}

/// The least contrast `ink` has on any of `grounds`.
fn worst(ink: Hsla, grounds: &[Hsla]) -> f32 {
    grounds
        .iter()
        .map(|ground| contrast(over(ink, *ground), *ground))
        .fold(f32::INFINITY, f32::min)
}

/// `ink`, made to read on every one of `grounds` (one, or a wash's two
/// ends) at `needed`: left alone if it does, else the nearest lightness of
/// the same hue that does, away from how light the grounds are. Where no
/// lightness does, the one that comes nearest.
pub(crate) fn readable(ink: Hsla, grounds: &[Hsla], needed: f32) -> Hsla {
    if grounds.is_empty() || worst(ink, grounds) >= needed {
        return ink;
    }
    let light = grounds.iter().map(|ground| luminance(*ground)).sum::<f32>() / grounds.len() as f32;
    // Towards white on a dark ground, towards black on a light one.
    let target = if light < 0.18 { 1.0 } else { 0.0 };
    let solid = Hsla { a: 1.0, ..ink };
    let at = |step: u8| Hsla {
        l: solid.l + (target - solid.l) * f32::from(step) / 40.0,
        ..solid
    };
    (1..=40_u8)
        .map(at)
        .find(|tried| worst(*tried, grounds) >= needed)
        .unwrap_or_else(|| {
            // Neither end reads on all of them: the better of the two.
            let (black, white) = (Hsla { l: 0.0, ..solid }, Hsla { l: 1.0, ..solid });
            if worst(black, grounds) > worst(white, grounds) {
                black
            } else {
                white
            }
        })
}

/// The colours a page is drawn in, and what each part of it stands on.
pub(crate) struct Grounds<'a> {
    theme: &'a Theme,
    surface: Surface,
    /// What the part being drawn stands on, innermost last: one colour, or
    /// a wash's two ends, each opaque.
    stack: RefCell<Vec<Vec<Hsla>>>,
}

impl<'a> Grounds<'a> {
    /// A page on `surface`, in `theme`.
    pub(crate) fn new(theme: &'a Theme, surface: Surface) -> Self {
        Self {
            theme,
            surface,
            stack: RefCell::new(vec![vec![surface.ground]]),
        }
    }

    /// The colour `ink` is in this theme, on this surface.
    pub(crate) fn ink(&self, ink: Ink) -> Hsla {
        let c = &self.theme.c;
        match ink {
            Ink::Rgba([r, g, b, a]) => Rgba {
                r: f32::from(r) / 255.0,
                g: f32::from(g) / 255.0,
                b: f32::from(b) / 255.0,
                a: f32::from(a) / 255.0,
            }
            .into(),
            Ink::Current => self.surface.ink,
            Ink::Role(role) => match role {
                Role::Accent => c.accent,
                Role::AccentSoft => c.accent_soft,
                Role::OnAccent => c.on_accent,
                Role::Line => c.line,
                Role::Surface => c.card,
                Role::Text => c.text,
                Role::Muted => c.muted,
                Role::Link => self.surface.link,
            },
        }
    }

    /// What is under what is drawn now, with `fill` laid over it.
    fn under(&self, fill: Option<Ink>) -> Vec<Hsla> {
        let under = self.stack.borrow().last().cloned().unwrap_or_default();
        match fill {
            Some(fill) => {
                let fill = self.ink(fill);
                under.iter().map(|below| over(fill, *below)).collect()
            }
            None => under,
        }
    }

    /// Run `content` standing on the ground `frame` gives, if it gives one.
    pub(crate) fn within<T>(&self, frame: &Frame, content: impl FnOnce() -> T) -> T {
        if frame.ground.is_none() && frame.wash.is_none() {
            return content();
        }
        let base = self.under(frame.ground);
        let ground = match frame.wash {
            Some(wash) => [self.ink(wash.from), self.ink(wash.to)]
                .iter()
                .flat_map(|end| base.iter().map(|below| over(*end, *below)))
                .collect(),
            None => base,
        };
        self.stack.borrow_mut().push(ground);
        let done = content();
        let _ = self.stack.borrow_mut().pop();
        done
    }

    /// The colour a run set as `look` is drawn in: its own, or the
    /// surface's, made to read on what it stands on.
    pub(crate) fn text(&self, look: &Look) -> Hsla {
        let asked = look.ink.map_or(self.surface.ink, |ink| self.ink(ink));
        let size = super::text::rounded_size(look.size.at(self.surface.size));
        readable(asked, &self.under(look.ground), wanted(size, look.weight))
    }

    /// How a run set as `look` reads where it stands, and what it needs.
    #[cfg(test)]
    pub(crate) fn reads(&self, look: &Look) -> (f32, f32) {
        let size = super::text::rounded_size(look.size.at(self.surface.size));
        (
            worst(self.text(look), &self.under(look.ground)),
            wanted(size, look.weight),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(rgb: u32) -> Hsla {
        gpui::rgb(rgb).into()
    }

    #[test]
    fn contrast_is_wcags() {
        assert!((contrast(hex(0x000000), hex(0xffffff)) - 21.0).abs() < 0.01);
        assert!((contrast(hex(0x777777), hex(0xffffff)) - 4.48).abs() < 0.02);
    }

    #[test]
    fn a_colour_that_reads_is_left_alone_and_one_that_does_not_keeps_its_hue() {
        let dark = hex(0x0f1420);
        let white = hex(0xe7ecfa);
        assert_eq!(readable(white, &[dark], BODY), white);
        // Black on the dark surface: made light, and still the same hue.
        let black = hex(0x101828);
        let made = readable(black, &[dark], BODY);
        assert!(contrast(made, dark) >= BODY);
        assert!((made.h - black.h).abs() < 1e-3 && (made.s - black.s).abs() < 1e-3);
        // White on a light page: made dark.
        let light = hex(0xe9eefb);
        let made = readable(hex(0xf7f8f8), &[light], BODY);
        assert!(contrast(made, light) >= BODY && made.l < 0.5);
    }

    #[test]
    fn a_translucent_ink_is_read_as_it_lands_and_a_wash_at_both_ends() {
        let dark = hex(0x0f1420);
        let faint = Hsla {
            a: 0.2,
            ..hex(0xffffff)
        };
        let made = readable(faint, &[dark], BODY);
        assert!(contrast(over(made, dark), dark) >= BODY);
        let wash = [hex(0x202020), hex(0x404040)];
        let made = readable(hex(0x505050), &wash, BODY);
        assert!(wash.iter().all(|ground| contrast(made, *ground) >= BODY));
    }

    #[test]
    fn large_text_needs_less() {
        assert_eq!(wanted(13.0, 400), BODY);
        assert_eq!(wanted(24.0, 400), LARGE);
        assert_eq!(wanted(19.0, 700), LARGE);
    }
}
