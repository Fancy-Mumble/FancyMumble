//! Words drawn as shapes: the outlines of their letters, laid down as a
//! path.
//!
//! For the marks a drawn theme sets that text cannot be: a word hollowed to
//! an outline, as CSS's `-webkit-text-stroke` draws one, and a word turned on
//! its side, as `writing-mode: vertical-rl` sets one. A word is set as a
//! browser sets it: shaped and kerned in its face (`faces`), a letter the
//! face lacks taken from the next face that has it, and each letter's
//! overlapping parts merged into one outline (`outline`).

mod faces;
mod outline;

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use gpui::{Hsla, Path, PathBuilder, Pixels, Point, Window, point, px};
use rustybuzz::ttf_parser::Tag;
use rustybuzz::{Feature, UnicodeBuffer};

pub(crate) use faces::Typeface;
use faces::{Found, Source, em, with_face};

/// How far a browser leans a face that has no italic of its own when an
/// italic is asked of it, in degrees: a skew of a quarter (Skia's).
pub(crate) const OBLIQUE: f32 = 14.036_243;

/// How a word is set: its face, size, lean and spacing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Lettering {
    pub typeface: Typeface,
    /// The size of the type, in pixels.
    pub size: f32,
    /// How far a letter from a face without a drawn italic leans, in
    /// degrees. A face that draws its own italic is not leant.
    pub slant: f32,
    /// Letter spacing, in ems.
    pub track: f32,
    /// Turned a quarter clockwise, reading downwards.
    pub turned: bool,
}

/// Everything a lettering is set by, as bits: its weight, width, size,
/// slant and track, and whether it is turned.
type Setting = ([u32; 5], bool);

/// What a lettering is drawn as.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Ink {
    /// Filled.
    Solid,
    /// Outlined, this wide.
    Hollow(f32),
}

/// A letter laid on its line.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Placed {
    source: Source,
    glyph: u16,
    /// Where its origin is along the line, and how far above the baseline,
    /// in pixels.
    along: f32,
    rise: f32,
    /// Pixels to the face's unit.
    scale: f32,
    /// How far it leans: across, for each pixel up.
    lean: f32,
}

/// A line of letters, laid.
#[derive(Debug, Clone, Default, PartialEq)]
struct Line {
    placed: Vec<Placed>,
    /// How long it runs.
    run: f32,
    /// Some letters wait for the system's faces to be listed, and are left
    /// out until they are.
    waiting: bool,
}

impl Lettering {
    /// The face the line's height and baseline come from: the first asked
    /// for, as a browser takes them from the first face of the stack.
    fn primary(&self) -> Source {
        match self.typeface {
            Typeface::Poster { .. } => Source::Poster,
            Typeface::Bold => Source::Bold,
        }
    }

    /// Everything a lettering is set by, as bits: a key to keep what is
    /// laid or built from it by.
    fn setting(&self) -> Setting {
        let (weight, width) = match self.typeface {
            Typeface::Poster { weight, width } => (weight, width),
            Typeface::Bold => (-1.0, -1.0),
        };
        (
            [weight, width, self.size, self.slant, self.track].map(f32::to_bits),
            self.turned,
        )
    }

    /// The primary face's ascent and descent below the baseline, in pixels:
    /// read from the face once for each setting.
    fn metrics(&self) -> (f32, f32) {
        thread_local! {
            static READ: RefCell<HashMap<Setting, (f32, f32)>> = RefCell::new(HashMap::new());
        }
        let key = self.setting();
        if let Some(known) = READ.with_borrow(|read| read.get(&key).copied()) {
            return known;
        }
        let metrics = with_face(self.primary(), self.typeface, |face| {
            let scale = self.size / em(face);
            (
                f32::from(face.ascender()) * scale,
                -f32::from(face.descender()) * scale,
            )
        })
        .unwrap_or((0.0, 0.0));
        let _ = READ.with_borrow_mut(|read| read.insert(key, metrics));
        metrics
    }

    /// How long `text` runs, and how deep it is from its top to the foot of
    /// its descenders, before any turn.
    pub(crate) fn measure(&self, text: &str) -> (f32, f32) {
        let (ascent, descent) = self.metrics();
        (self.lay(text).run, ascent + descent)
    }

    /// `text` broken into lines no longer than `room`, as a browser breaks
    /// it: at a space, or between two letters of a script written without
    /// spaces (Chinese, Japanese), never before a letter that may not start
    /// a Japanese line. A word longer than the room stands on its own line.
    pub(crate) fn wrap(&self, text: &str, room: f32) -> Vec<String> {
        let mut lines: Vec<String> = Vec::new();
        let mut line = String::new();
        for piece in pieces(text) {
            let longer = format!("{line}{piece}");
            if !line.trim().is_empty() && self.lay(longer.trim_end()).run > room {
                lines.push(line.trim_end().to_owned());
                line = piece.trim_start().to_owned();
            } else {
                line = longer;
            }
        }
        if !line.trim().is_empty() {
            lines.push(line.trim_end().to_owned());
        }
        lines
    }

    /// `text` laid on a line. A few lines are remembered, so a mark drawn
    /// each frame is shaped once.
    fn lay(&self, text: &str) -> Rc<Line> {
        type Key = (String, Setting);
        thread_local! {
            static LAID: RefCell<HashMap<Key, Rc<Line>>> = RefCell::new(HashMap::new());
        }
        let key = (text.to_owned(), self.setting());
        if let Some(line) = LAID.with_borrow(|laid| laid.get(&key).cloned()) {
            return line;
        }
        let line = Rc::new(self.shape(text));
        if !line.waiting {
            LAID.with_borrow_mut(|laid| {
                if laid.len() >= 64 {
                    laid.clear();
                }
                let _ = laid.insert(key, Rc::clone(&line));
            });
        }
        line
    }

    /// `text` shaped: run by run of letters one face sets, each shaped and
    /// kerned in it, spacing after every letter as CSS gives it. A letter
    /// no face has is left out, never drawn as a box.
    fn shape(&self, text: &str) -> Line {
        let mut line = Line::default();
        let mut runs: Vec<(Source, String)> = Vec::new();
        for letter in text.chars() {
            let found = if letter.is_whitespace() {
                Found::In(runs.last().map_or(self.primary(), |(source, _)| *source))
            } else {
                self.typeface.find(letter)
            };
            match found {
                Found::In(source) => match runs.last_mut() {
                    Some((last, run)) if *last == source => run.push(letter),
                    _ => runs.push((source, letter.to_string())),
                },
                Found::Later => line.waiting = true,
                Found::Nowhere => {}
            }
        }
        let lean = self.slant.to_radians().tan();
        for (source, run) in runs {
            let lean = if source.is_italic() { 0.0 } else { lean };
            let _ = with_face(source, self.typeface, |face| {
                self.shape_run(face, source, lean, &run, &mut line);
            });
        }
        line
    }

    fn shape_run(
        &self,
        face: &rustybuzz::Face<'_>,
        source: Source,
        lean: f32,
        run: &str,
        line: &mut Line,
    ) {
        let scale = self.size / em(face);
        let mut buffer = UnicodeBuffer::new();
        buffer.push_str(run);
        buffer.guess_segment_properties();
        // A browser sets no common ligatures in spaced type.
        let features: Vec<Feature> = if self.track == 0.0 {
            Vec::new()
        } else {
            [b"liga", b"clig"]
                .map(|tag| Feature::new(Tag::from_bytes(tag), 0, ..))
                .to_vec()
        };
        let shaped = rustybuzz::shape(face, &features, buffer);
        let infos = shaped.glyph_infos();
        let at = |units: i32| {
            #[expect(clippy::cast_precision_loss, reason = "a face's units")]
            let units = units as f32;
            units * scale
        };
        for (index, (info, position)) in infos.iter().zip(shaped.glyph_positions()).enumerate() {
            // Glyph 0 is the face's box for "missing": never drawn.
            if let Ok(glyph @ 1..) = u16::try_from(info.glyph_id) {
                line.placed.push(Placed {
                    source,
                    glyph,
                    along: line.run + at(position.x_offset),
                    rise: at(position.y_offset),
                    scale,
                    lean,
                });
            }
            line.run += at(position.x_advance);
            let next = infos.get(index + 1).map(|next| next.cluster);
            if next != Some(info.cluster) {
                let start = info.cluster as usize;
                let end = next.map_or(run.len(), |next| next as usize);
                let letters = run
                    .get(start..end)
                    .map_or(1, |cluster| cluster.chars().count());
                #[expect(clippy::cast_precision_loss, reason = "a few letters")]
                let letters = letters as f32;
                line.run += self.track * self.size * letters;
            }
        }
    }

    /// The path of `text` with the top of its line at `origin` (the top
    /// right, turned): filled, or outlined. And whether some letters wait
    /// for the system's faces, so the caller draws again soon.
    pub(crate) fn path(
        &self,
        text: &str,
        origin: Point<Pixels>,
        ink: Ink,
    ) -> (Option<Path<Pixels>>, bool) {
        let line = self.lay(text);
        let (ascent, _) = self.metrics();
        let origin = (f32::from(origin.x), f32::from(origin.y));
        let mut path = match ink {
            Ink::Solid => PathBuilder::fill(),
            Ink::Hollow(width) => PathBuilder::stroke(px(width)),
        };
        let mut any = false;
        for placed in &line.placed {
            let rings = outline::merged(placed.source, self.typeface, placed.glyph);
            for ring in rings.iter() {
                let points: Vec<Point<Pixels>> = ring
                    .iter()
                    .map(|&[x, y]| self.at(origin, ascent, placed, x, y))
                    .collect();
                path.add_polygon(&points, true);
                any = true;
            }
        }
        let path = if any { path.build().ok() } else { None };
        (path, line.waiting)
    }

    /// A point of a letter's outline, in its face's units, on screen.
    fn at(
        &self,
        origin: (f32, f32),
        ascent: f32,
        placed: &Placed,
        x: f32,
        y: f32,
    ) -> Point<Pixels> {
        // Along the line, and down from its top: the face's y runs upwards.
        let rise = placed.rise + y * placed.scale;
        let along = placed.along + x * placed.scale + rise * placed.lean;
        let down = ascent - rise;
        let (x, y) = if self.turned {
            (origin.0 - down, origin.1 + along)
        } else {
            (origin.0 + along, origin.1 + down)
        };
        point(px(x), px(y))
    }

    /// Paint `text` at `origin` in `color`. True while some of its letters
    /// wait for the system's faces: draw again on the next frame.
    pub(crate) fn paint(
        &self,
        text: &str,
        origin: Point<Pixels>,
        ink: Ink,
        color: Hsla,
        window: &mut Window,
    ) -> bool {
        // Built once while it stays where it is; letters still waiting for
        // the system's faces are built again until they are all there.
        let (weight, width) = match self.typeface {
            Typeface::Poster { weight, width } => (weight, width),
            Typeface::Bold => (-1.0, -1.0),
        };
        let line = match ink {
            Ink::Solid => -1.0,
            Ink::Hollow(width) => width,
        };
        let numbers = [
            weight,
            width,
            self.size,
            self.slant,
            self.track,
            line,
            origin.x.into(),
            origin.y.into(),
        ];
        let from = (text, super::built::bits(&numbers), self.turned);
        let mut waiting = false;
        let mut build = || -> Vec<Path<Pixels>> {
            let (path, waits) = self.path(text, origin, ink);
            waiting = waits;
            path.into_iter().collect()
        };
        let paths = if self.lay(text).waiting {
            build().into()
        } else {
            super::built::paths(&from, build)
        };
        for path in paths.iter() {
            window.paint_path(path.clone(), color);
        }
        waiting
    }
}

/// `text` in the pieces a line may be broken between: a word with the
/// spaces after it, or a single letter of a script written without spaces
/// with what may not be parted from it.
fn pieces(text: &str) -> Vec<String> {
    let mut pieces: Vec<String> = Vec::new();
    let mut piece = String::new();
    let mut last: Option<char> = None;
    for letter in text.chars() {
        let breaks = last.is_some_and(|last| {
            (last.is_whitespace() && !letter.is_whitespace())
                || ((unspaced(last) || unspaced(letter))
                    && !letter.is_whitespace()
                    && !last.is_whitespace()
                    && !keeps_with_last(letter))
        });
        if breaks {
            pieces.push(std::mem::take(&mut piece));
        }
        piece.push(letter);
        last = Some(letter);
    }
    if !piece.is_empty() {
        pieces.push(piece);
    }
    pieces
}

/// A letter of a script written without spaces between words: a line may
/// break before or after it.
fn unspaced(letter: char) -> bool {
    matches!(u32::from(letter),
        0x3040..=0x30FF | 0x31F0..=0x31FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF | 0xFF66..=0xFF9F | 0x20000..=0x2FA1F)
}

/// What may not start a Japanese line: the long-vowel mark, the iteration
/// marks and the small kana.
fn keeps_with_last(letter: char) -> bool {
    matches!(
        letter,
        'ー' | 'ゝ'
            | 'ゞ'
            | 'ヽ'
            | 'ヾ'
            | '々'
            | 'ぁ'
            | 'ぃ'
            | 'ぅ'
            | 'ぇ'
            | 'ぉ'
            | 'っ'
            | 'ゃ'
            | 'ゅ'
            | 'ょ'
            | 'ゎ'
            | 'ァ'
            | 'ィ'
            | 'ゥ'
            | 'ェ'
            | 'ォ'
            | 'ッ'
            | 'ャ'
            | 'ュ'
            | 'ョ'
            | 'ヮ'
            | 'ヵ'
            | 'ヶ'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAIN: Lettering = Lettering {
        typeface: Typeface::Bold,
        size: 100.0,
        slant: 0.0,
        track: 0.0,
        turned: false,
    };

    const POSTER: Lettering = Lettering {
        typeface: Typeface::Poster {
            weight: 800.0,
            width: 78.0,
        },
        size: 150.0,
        slant: OBLIQUE,
        track: -0.01,
        turned: false,
    };

    #[test]
    fn a_word_is_as_long_as_its_letters_and_its_spacing() {
        let (run, depth) = PLAIN.measure("LOUNGE");
        assert!(run > 300.0 && run < 500.0, "{run}");
        assert!(depth > 100.0 && depth < 130.0, "{depth}");
        // Spacing follows every letter, the last too.
        let spaced = Lettering {
            track: 0.1,
            ..PLAIN
        };
        assert!((spaced.measure("LOUNGE").0 - (run + 60.0)).abs() < 0.01);
    }

    /// Measured in the web preview (`?dump`): the browser's box round the
    /// name "LOUNGE" is 382.5px long, and round "EINE SEBI" over
    /// "SEKUNDE" 457.5px, the longer line's.
    #[test]
    fn the_poster_face_runs_as_the_browser_sets_it() {
        let (run, _) = POSTER.measure("LOUNGE");
        assert!((run - 382.5).abs() < 1.5, "{run}");
        let longer = POSTER
            .measure("EINE SEBI")
            .0
            .max(POSTER.measure("SEKUNDE").0);
        assert!((longer - 457.5).abs() < 1.5, "{longer}");
        let wide = Lettering {
            typeface: Typeface::Poster {
                weight: 800.0,
                width: 100.0,
            },
            ..POSTER
        };
        assert!(
            wide.measure("LOUNGE").0 > run * 1.1,
            "the width axis is set"
        );
    }

    #[test]
    fn a_word_becomes_a_path_filled_or_hollow() {
        let origin = point(px(0.0), px(0.0));
        assert!(PLAIN.path("FANCY", origin, Ink::Solid).0.is_some());
        assert!(PLAIN.path("FANCY", origin, Ink::Hollow(2.0)).0.is_some());
        assert!(POSTER.path("LOUNGE", origin, Ink::Hollow(2.0)).0.is_some());
        assert!(
            PLAIN.path(" ", origin, Ink::Solid).0.is_none(),
            "nothing to draw"
        );
    }

    /// A letter the bundled faces lack is set in a face of the system's
    /// that has it, or left out while those are listed or when none has
    /// it: the rest of the line stands as it would, and no box is drawn.
    #[test]
    fn a_letter_no_bundled_face_has_is_never_a_box() {
        let alone = POSTER.lay("AB").run;
        for text in ["A\u{10FFFD}B", "AゲームB", "A😀B"] {
            let line = POSTER.lay(text);
            assert!(line.placed.iter().all(|placed| placed.glyph != 0), "{text}");
            let bundled: Vec<_> = line
                .placed
                .iter()
                .filter(|placed| placed.source == Source::Poster)
                .collect();
            assert_eq!(bundled.len(), 2, "{text}: A and B, from the poster face");
            assert!(line.run >= alone - 0.01, "{text}");
        }
        // A letter Saira lacks is Inter's own italic, as the browser takes
        // it, and is not leant again.
        let cyrillic = POSTER.lay("ЖИЗНЬ");
        assert!(!cyrillic.placed.is_empty());
        assert!(
            cyrillic
                .placed
                .iter()
                .all(|placed| placed.source == Source::PosterItalic && placed.lean == 0.0)
        );
        // Umlauts are the poster face's own.
        let umlauts = POSTER.lay("GRÜSSE MÜNCHEN");
        assert!(
            umlauts
                .placed
                .iter()
                .all(|placed| placed.source == Source::Poster)
        );
    }

    #[test]
    fn a_line_breaks_at_spaces_and_between_japanese_letters() {
        let words = POSTER.measure("EINE SEBI").0;
        assert_eq!(POSTER.wrap("EINE SEBI", words + 1.0), ["EINE SEBI"]);
        assert_eq!(POSTER.wrap("EINE SEBI", words - 1.0), ["EINE", "SEBI"]);
        assert_eq!(POSTER.wrap("EINE", 1.0), ["EINE"], "a word stands whole");
        assert_eq!(pieces("ゲーム部屋"), ["ゲー", "ム", "部", "屋"]);
        assert_eq!(pieces("CAFÉ 日本"), ["CAFÉ ", "日", "本"]);
    }

    /// `DirectWrite` lists a family by its typographic name plus whatever of
    /// the style name is not a weight, width or slope: a display face whose
    /// style was "`DisplayBold`" was listed as "Inter Display Display", and
    /// every heading asking for "Inter Display" fell back to Segoe UI.
    #[test]
    fn the_display_face_names_its_family_and_a_plain_style() {
        let bytes = include_bytes!("../../../../assets/fonts/Inter-DisplayBold.ttf");
        let face = ttf_parser::Face::parse(bytes, 0).expect("a face");
        let named = |id: u16| {
            face.names()
                .into_iter()
                .find(|name| name.name_id == id && name.is_unicode())
                .and_then(|name| name.to_string())
        };
        assert_eq!(named(16).as_deref(), Some("Inter Display"));
        assert_eq!(named(1).as_deref(), Some("Inter Display"));
        assert_eq!(named(17).as_deref(), Some("Bold"));
    }

    #[test]
    fn a_turned_word_runs_down_from_its_top_right() {
        let turned = Lettering {
            turned: true,
            ..PLAIN
        };
        let placed = Placed {
            source: Source::Bold,
            glyph: 1,
            along: 20.0,
            rise: 0.0,
            scale: 1.0,
            lean: 0.0,
        };
        // The pen's start on the baseline lands left of the corner by the
        // ascent, and below it by how far along the line it is.
        assert_eq!(
            turned.at((50.0, 10.0), 8.0, &placed, 0.0, 0.0),
            point(px(42.0), px(30.0))
        );
        // A lean carries the top of a letter forward.
        let leant = Placed {
            lean: 0.5,
            ..placed
        };
        assert_eq!(
            PLAIN.at((50.0, 10.0), 8.0, &leant, 0.0, 8.0),
            point(px(74.0), px(10.0))
        );
    }

    #[test]
    #[ignore = "a probe: prints the poster face's vertical metrics"]
    fn probe_poster_metrics() {
        let _ = with_face(Source::Poster, POSTER.typeface, |face| {
            let f: &ttf_parser::Face<'_> = face;
            println!(
                "upm {} hhea {} {} {} typo {:?} {:?} {:?} win {:?} {:?} use_typo {}",
                f.units_per_em(),
                f.ascender(),
                f.descender(),
                f.line_gap(),
                f.typographic_ascender(),
                f.typographic_descender(),
                f.typographic_line_gap(),
                f.tables().os2.map(|os2| os2.windows_ascender()),
                f.tables().os2.map(|os2| os2.windows_descender()),
                f.tables().os2.is_some_and(|os2| os2.use_typographic_metrics()),
            );
        });
        println!("metrics {:?}", POSTER.metrics());
    }
}