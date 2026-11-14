//! A letter's outline as one shape.
//!
//! A face may draw a letter as parts that overlap (a stem and a diagonal
//! as two closed shapes) or as one outline that crosses itself, as
//! variable fonts and the faces cut from them do: Inter's bold draws K and
//! D the one way, N, M and W the other. Filled, the overlap does not show;
//! outlined as drawn, an edge runs through the letter. So the parts are merged first: the
//! outline is the edge of the whole filled letter, with its holes.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use i_overlay::core::fill_rule::FillRule;
use i_overlay::float::simplify::SimplifyShape;
use rustybuzz::Face;
use rustybuzz::ttf_parser::{GlyphId, OutlineBuilder};

use super::faces::{Source, Typeface, em, with_face};

/// Closed rings of points in the face's units, its y running upwards.
pub(super) type Contours = Vec<Vec<[f32; 2]>>;

/// The merged outline of `glyph` in the face `source` names, set as
/// `typeface` asks. Each letter is merged once a run and remembered: a few
/// hundred points, for the few letters a name is spelt with.
pub(super) fn merged(source: Source, typeface: Typeface, glyph: u16) -> Rc<Contours> {
    type Key = (Source, u16, u32, u32);
    thread_local! {
        static MERGED: RefCell<HashMap<Key, Rc<Contours>>> = RefCell::new(HashMap::new());
    }
    let (weight, width) = match typeface {
        Typeface::Poster { weight, width } if source == Source::Poster => (weight, width),
        _ => (0.0, 0.0),
    };
    let key = (source, glyph, weight.to_bits(), width.to_bits());
    if let Some(known) = MERGED.with_borrow(|merged| merged.get(&key).cloned()) {
        return known;
    }
    let contours =
        with_face(source, typeface, |face| merge(&parts(face, glyph))).unwrap_or_default();
    let contours = Rc::new(contours);
    let _ = MERGED.with_borrow_mut(|merged| merged.insert(key, Rc::clone(&contours)));
    contours
}

/// The parts `face` draws `glyph` as, each a closed ring, their curves
/// laid as short straight runs no further than a two-thousandth of an em
/// from the curve: under a tenth of a pixel at 150px.
pub(super) fn parts(face: &Face<'_>, glyph: u16) -> Contours {
    let mut pen = Flatten {
        tolerance: em(face) / 2000.0,
        rings: Vec::new(),
        ring: Vec::new(),
        at: [0.0, 0.0],
    };
    let _ = face.outline_glyph(GlyphId(glyph), &mut pen);
    pen.finish();
    pen.rings
}

/// The parts merged: the edge of everything a part covers, as the face's
/// own non-zero rule fills them. Outer edges and the edges of holes come
/// out turning opposite ways, so even-odd filling them fills the same.
pub(super) fn merge(parts: &Contours) -> Contours {
    parts
        .simplify_shape(FillRule::NonZero)
        .into_iter()
        .flatten()
        .filter(|ring| ring.len() > 2)
        .collect()
}

/// Lays an outline into rings of points.
struct Flatten {
    tolerance: f32,
    rings: Contours,
    ring: Vec<[f32; 2]>,
    at: [f32; 2],
}

impl Flatten {
    fn finish(&mut self) {
        let ring = std::mem::take(&mut self.ring);
        if ring.len() > 2 {
            self.rings.push(ring);
        }
    }

    /// How many straight runs keep a curve whose control points turn by
    /// `bend` (the largest second difference) within the tolerance.
    fn steps(&self, bend: f32) -> u16 {
        let steps = (bend / self.tolerance).sqrt().ceil().clamp(1.0, 64.0);
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "clamped to 1..=64"
        )]
        let steps = steps as u16;
        steps
    }

    fn to(&mut self, point: [f32; 2]) {
        self.ring.push(point);
        self.at = point;
    }
}

fn bend(a: [f32; 2], b: [f32; 2], c: [f32; 2]) -> f32 {
    (a[0] - 2.0 * b[0] + c[0]).hypot(a[1] - 2.0 * b[1] + c[1])
}

impl OutlineBuilder for Flatten {
    fn move_to(&mut self, x: f32, y: f32) {
        self.finish();
        self.to([x, y]);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.to([x, y]);
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (p0, p1, p2) = (self.at, [x1, y1], [x, y]);
        // A quadratic strays from its chords by a quarter of its bend over
        // the square of the steps.
        let steps = self.steps(bend(p0, p1, p2) / 4.0);
        for step in 1..=steps {
            let t = f32::from(step) / f32::from(steps);
            let u = 1.0 - t;
            self.to([
                u * u * p0[0] + 2.0 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2.0 * u * t * p1[1] + t * t * p2[1],
            ]);
        }
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (p0, p1, p2, p3) = (self.at, [x1, y1], [x2, y2], [x, y]);
        // A cubic by three quarters of its larger bend.
        let steps = self.steps(bend(p0, p1, p2).max(bend(p1, p2, p3)) * 0.75);
        for step in 1..=steps {
            let t = f32::from(step) / f32::from(steps);
            let u = 1.0 - t;
            let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
            self.to([
                a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
                a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
            ]);
        }
    }

    fn close(&mut self) {
        // The ring closes back to its start; a last point on it is a repeat.
        if self.ring.len() > 1 && self.ring.first() == self.ring.last() {
            let _ = self.ring.pop();
        }
        self.finish();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// How many times the rings wind round `point`: not zero inside the
    /// filled shape, under the non-zero rule glyphs are filled by.
    fn winding(rings: &Contours, point: [f32; 2]) -> i32 {
        let mut winding = 0;
        for ring in rings {
            for (i, a) in ring.iter().enumerate() {
                let b = ring[(i + 1) % ring.len()];
                let side = (b[0] - a[0]) * (point[1] - a[1]) - (point[0] - a[0]) * (b[1] - a[1]);
                if a[1] <= point[1] && b[1] > point[1] && side > 0.0 {
                    winding += 1;
                } else if a[1] > point[1] && b[1] <= point[1] && side < 0.0 {
                    winding -= 1;
                }
            }
        }
        winding
    }

    /// The stretches of `drawn` that run through the inside of the letter
    /// `parts` fill: filled on both sides, where an edge has the letter on
    /// one side only. Looked at a thousandth of an em (a seventh of a pixel
    /// at 150px) to each side of each stretch's middle: further out, a
    /// look across a letter's narrow notch lands in the letter again.
    fn inside(drawn: &Contours, parts: &Contours, em: f32) -> usize {
        let reach = em / 1000.0;
        let mut inside = 0;
        for ring in drawn {
            for (i, a) in ring.iter().enumerate() {
                let b = ring[(i + 1) % ring.len()];
                let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
                let long = dx.hypot(dy);
                if long < reach * 3.0 {
                    continue;
                }
                let middle = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
                let (nx, ny) = (-dy / long * reach, dx / long * reach);
                let left = winding(parts, [middle[0] + nx, middle[1] + ny]) != 0;
                let right = winding(parts, [middle[0] - nx, middle[1] - ny]) != 0;
                if left && right {
                    inside += 1;
                }
            }
        }
        inside
    }

    /// Every letter and digit a room's name can be spelt in, capitals as a
    /// poster sets them, with the accents of the languages users write in.
    const LETTERS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ÄÖÜÀÁÂÃÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕØÙÚÛÝŒŠŽ";

    fn letters_of(
        source: Source,
        typeface: Typeface,
        text: &str,
    ) -> Vec<(char, Contours, Contours)> {
        with_face(source, typeface, |face| {
            text.chars()
                .filter_map(|letter| {
                    let glyph = face.glyph_index(letter)?.0;
                    let parts = parts(face, glyph);
                    Some((letter, merge(&parts), parts))
                })
                .collect()
        })
        .expect("the face")
    }

    #[test]
    fn a_letter_drawn_in_parts_is_outlined_as_one_shape() {
        let poster = Typeface::Poster {
            weight: 800.0,
            width: 78.0,
        };
        for (source, typeface, em) in [
            (Source::Poster, poster, 1000.0),
            (Source::Bold, Typeface::Bold, 2048.0),
        ] {
            let letters = letters_of(source, typeface, LETTERS);
            assert_eq!(
                letters.len(),
                LETTERS.chars().count(),
                "{source:?} has them all"
            );
            for (letter, merged, parts) in &letters {
                assert_eq!(
                    inside(merged, parts, em),
                    0,
                    "{letter} in {source:?}: no edge runs through the letter"
                );
                assert!(!merged.is_empty(), "{letter} in {source:?}");
            }
        }
    }

    /// What the user saw: Inter's bold draws K and D as overlapping parts,
    /// and N, M and W as one outline that crosses itself; outlined as they
    /// are, an edge ran through the inside of each. The check above fails
    /// on them, and passes on the letters drawn as one plain shape.
    #[test]
    fn outlined_as_drawn_the_bold_crosses_its_own_letters() {
        for (letter, _, parts) in letters_of(Source::Bold, Typeface::Bold, "KNDMW") {
            assert!(
                inside(&parts, &parts, 2048.0) > 0,
                "{letter} crosses itself"
            );
        }
        for (letter, _, parts) in letters_of(Source::Bold, Typeface::Bold, "EULO") {
            assert_eq!(inside(&parts, &parts, 2048.0), 0, "{letter} is one shape");
        }
    }

    #[test]
    fn a_letter_is_merged_once_and_remembered() {
        let glyph = with_face(Source::Bold, Typeface::Bold, |face| {
            face.glyph_index('K').expect("a K").0
        })
        .expect("the face");
        let first = merged(Source::Bold, Typeface::Bold, glyph);
        let again = merged(Source::Bold, Typeface::Bold, glyph);
        assert!(Rc::ptr_eq(&first, &again));
        // A hole stays a hole: the O is two rings.
        let o = with_face(Source::Bold, Typeface::Bold, |face| {
            merge(&parts(face, face.glyph_index('O').expect("an O").0))
        })
        .expect("the face");
        assert_eq!(o.len(), 2);
    }
}
