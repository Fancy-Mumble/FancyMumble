//! What a theme draws besides colour and corners: the marks of a drawn,
//! poster-like skin, and the voices its labels are set in.
//!
//! The web UI gates these behind one word in a theme's skin, `chrome:
//! "stencil"`, and draws each in the component it belongs to. Here each is a
//! named, measured mark the kit draws where a theme asks for it. The measures
//! are the web components' own (named beside each), not read off a picture.
//! A theme that asks for none of them carries `Marks::default()`, every
//! slot empty, and nothing is drawn or computed for it.

use gpui::FontWeight;

/// A band of slanted dashes: warning tape, or a hatched rule.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Stripes {
    /// The direction the stripes run, in degrees as CSS gives a gradient's.
    pub angle: f32,
    /// How long each dash is, and the gap after it, along the band.
    pub dash: f32,
    pub gap: f32,
    /// How tall the band is.
    pub height: f32,
    /// How strongly it is drawn.
    pub opacity: f32,
}

/// One circle outline in the conversation's far corner.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Ring {
    pub diameter: f32,
    /// Where its box stands against the conversation's top and right edges
    /// (negative: past them).
    pub top: f32,
    pub right: f32,
    pub width: f32,
    pub opacity: f32,
    /// Dashes along the circle, or a solid line.
    pub dashed: bool,
}

/// The room's name set huge and hollow low in the conversation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Watermark {
    pub size: f32,
    /// Its distance from the conversation's right and bottom edges.
    pub right: f32,
    pub bottom: f32,
    /// Line height, as a share of the size.
    pub leading: f32,
    pub stroke: f32,
    /// The weight and the width (in percent) the poster face is set at.
    pub weight: f32,
    pub width: f32,
    /// Letter spacing, in ems.
    pub track: f32,
}

/// The ground the conversation stands on: deepening to the tile colour
/// towards the bottom, with a hatched rule above where the composer sits.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Ground {
    /// How tall the deepening is.
    pub fade: f32,
    /// How far above the conversation's foot the rule runs.
    pub rule_bottom: f32,
    pub rule: Stripes,
}

/// The gold ellipse floated above every face.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Halo {
    /// Its width, as a share of the face.
    pub width: f32,
    /// Its height, as a share of the face, and at least this many pixels.
    pub height: f32,
    pub least_height: f32,
    /// How far above the face's top it stands, as a share, and at least.
    pub lift: f32,
    pub least_lift: f32,
}

impl Halo {
    /// Width, height and lift for a face `size` across.
    pub(crate) fn measures(self, size: f32) -> (f32, f32, f32) {
        (
            size * self.width,
            (size * self.height).max(self.least_height),
            (size * self.lift).max(self.least_lift),
        )
    }
}

/// How a label is set: its case, slant, spacing, weight and face.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct Voice {
    pub caps: bool,
    pub italic: bool,
    /// Letter spacing, in ems.
    pub track: f32,
    /// Its own weight, or the one the view gives it.
    pub weight: Option<FontWeight>,
}

/// The voices of the roles a theme may set apart.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct Voices {
    /// A section's heading: "JOIN AS", a server over its channels.
    pub heading: Voice,
    /// The line under a conversation's name.
    pub subtitle: Voice,
    /// Words on a plate: the server's name over the column.
    pub plate: Voice,
    /// The day on its plate between two days' messages.
    pub day: Voice,
    /// A state said aloud: voice off.
    pub tag: Voice,
    /// The product's name, printed as a mark.
    pub wordmark: Voice,
}

/// The measures of a dock drawn as a bank of switches.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DockBank {
    /// How far the card stands from the column's edges.
    pub margin: f32,
    /// Its padding, top and bottom then left and right.
    pub padding: (f32, f32),
    /// The name's size and weight.
    pub name_size: f32,
    pub name_weight: f32,
    /// How tall each switch is.
    pub switch_height: f32,
}

/// Every mark a theme may draw, each in the place it belongs.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct Marks {
    /// Warning tape across the top of the server rail (`ServerRail`).
    pub hazard: Option<Stripes>,
    /// The rail's expander drawn as a ring round a lit core.
    pub expander_ring: bool,
    /// The rail's own spacing, where it stands its tiles further apart:
    /// the gap between them, and the room above the first (clear of the
    /// tape).
    pub rail_spacing: Option<(f32, f32)>,
    /// The product's name down the foot of the rail.
    pub rail_wordmark: bool,
    /// The flash at the rail's edge beside the server on screen, this wide.
    pub rail_flash: Option<f32>,
    /// The way off a server stood on a plate of its own colour.
    pub leave_plate: bool,
    /// The server's name on a leaning plate atop the channel column
    /// (`SidebarShell`), and the column's heading with its count.
    pub column_plate: bool,
    /// A section heading runs a dashed rule out to the edge (`SectionLabel`):
    /// dash and gap.
    pub heading_rule: Option<(f32, f32)>,
    /// Every channel row stands on a plate, not only the selected one.
    pub plated_rows: bool,
    /// The conversation's name stands behind a leaning mark of the accent,
    /// and its subtitle behind a presence dot (`ChatHeader`).
    pub header_mark: bool,
    /// The header's buttons each stand on a plate.
    pub header_plates: bool,
    /// The user's own dock (`VoiceDock`) as a drawn skin has it: its voice
    /// controls a bank of equal plated switches across the whole card, its
    /// name set large, and the card further from the column's edges.
    pub dock_bank: Option<DockBank>,
    /// Circles in the conversation's far corner (`ChatBackdrop`).
    pub rings: [Option<Ring>; 2],
    pub watermark: Option<Watermark>,
    pub ground: Option<Ground>,
    /// The day's rule is dashed, the day on a plate (`DayDivider`): the
    /// rule's weight.
    pub day_plate: Option<f32>,
    /// Over every face (`UserAvatar`).
    pub halo: Option<Halo>,
    /// Every face outlined in the rail's line, this wide.
    pub face_ring: Option<f32>,
    /// What floats stands on a hard plate this far down and across, not on
    /// a soft shadow.
    pub hard_shadow: Option<f32>,
    /// The composer says how to break a line.
    pub composer_hint: bool,
    pub voices: Voices,
}

impl Marks {
    /// The marks of `chrome` as the web UI's skins name it: `stencil`, or
    /// anything else for none.
    pub(crate) fn of(chrome: &str) -> Self {
        if chrome == "stencil" {
            Self::stencil()
        } else {
            Self::default()
        }
    }

    /// A drawn, poster-like skin: every mark, measured as the web UI's
    /// components draw them.
    fn stencil() -> Self {
        let caps = |track: f32, weight: f32| Voice {
            caps: true,
            italic: true,
            track,
            weight: Some(FontWeight(weight)),
        };
        Self {
            // `repeating-linear-gradient(115deg, accent2 0 8px, transparent 8px 16px)`, 6px tall.
            hazard: Some(Stripes {
                angle: 115.0,
                dash: 8.0,
                gap: 8.0,
                height: 6.0,
                opacity: 1.0,
            }),
            expander_ring: true,
            // `gap: 16px`, `pt: 30px`.
            rail_spacing: Some((16.0, 30.0)),
            rail_wordmark: true,
            rail_flash: Some(6.0),
            leave_plate: true,
            column_plate: true,
            // `repeating-linear-gradient(90deg, line2 0 6px, transparent 6px 10px)`.
            heading_rule: Some((6.0, 4.0)),
            plated_rows: true,
            header_mark: true,
            header_plates: true,
            // `VoiceDock`: `m: 16px`, `p: 12px 14px`; the name at 16px in
            // 900; each switch `height: 34`.
            dock_bank: Some(DockBank {
                margin: 16.0,
                padding: (12.0, 14.0),
                name_size: 16.0,
                name_weight: 900.0,
                switch_height: 34.0,
            }),
            rings: [
                Some(Ring {
                    diameter: 760.0,
                    top: -180.0,
                    right: -220.0,
                    width: 3.0,
                    opacity: 0.5,
                    dashed: false,
                }),
                Some(Ring {
                    diameter: 520.0,
                    top: -60.0,
                    right: -100.0,
                    width: 3.0,
                    opacity: 0.34,
                    dashed: true,
                }),
            ],
            // 150px, `line-height: .86`, `-webkit-text-stroke: 2px`, italic
            // Saira at weight 800 and 78% width, `letter-spacing: -.01em`:
            // the face is the web UI's own file.
            watermark: Some(Watermark {
                size: 150.0,
                right: 60.0,
                bottom: 110.0,
                leading: 0.86,
                stroke: 2.0,
                weight: 800.0,
                width: 78.0,
                track: -0.01,
            }),
            ground: Some(Ground {
                fade: 190.0,
                rule_bottom: 84.0,
                rule: Stripes {
                    angle: 115.0,
                    dash: 12.0,
                    gap: 12.0,
                    height: 10.0,
                    opacity: 0.7,
                },
            }),
            day_plate: Some(2.0),
            halo: Some(Halo {
                width: 0.85,
                height: 0.26,
                least_height: 6.0,
                lift: 0.19,
                least_lift: 4.0,
            }),
            face_ring: Some(2.0),
            hard_shadow: Some(6.0),
            composer_hint: true,
            voices: Voices {
                heading: caps(0.18, 700.0),
                subtitle: caps(0.18, 700.0),
                plate: caps(0.06, 800.0),
                day: caps(0.14, 800.0),
                tag: Voice {
                    italic: false,
                    ..caps(0.16, 700.0)
                },
                wordmark: caps(0.26, 700.0),
            },
        }
    }

    /// Whether this theme draws any mark at all.
    #[cfg(test)]
    pub(crate) fn any(&self) -> bool {
        *self != Self::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_stencil_skin_draws_marks() {
        assert!(!Marks::of("plain").any());
        assert!(!Marks::of("").any());
        let stencil = Marks::of("stencil");
        assert!(stencil.any());
        assert!(stencil.halo.is_some() && stencil.watermark.is_some());
        assert_eq!(stencil.voices.heading.track, 0.18);
    }

    #[test]
    fn a_halo_is_measured_off_its_face_with_a_floor() {
        let halo = Marks::of("stencil").halo.expect("a halo");
        let (width, height, lift) = halo.measures(38.0);
        assert!((width - 32.3).abs() < 1e-3);
        assert!((height - 9.88).abs() < 1e-3);
        assert!((lift - 7.22).abs() < 1e-3);
        // A small face keeps a halo that can still be seen.
        let (_, small_height, small_lift) = halo.measures(20.0);
        assert_eq!((small_height, small_lift), (6.0, 4.0));
    }
}
