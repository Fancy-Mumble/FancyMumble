//! The faces a lettering is set in: a bundled one, and for a letter it
//! lacks the next face down the list that has it, as a browser falls back
//! along a `font-family` stack and then to the system's faces.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use rustybuzz::ttf_parser::Tag;
use rustybuzz::{Face, Variation};

use crate::assets::{INTER_BOLD, INTER_POSTER_ITALIC, SAIRA_ITALIC};

/// The face a lettering asks for.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Typeface {
    /// Saira's drawn italic at this weight and width (in percent of its
    /// normal width): the web UI's poster voice.
    Poster { weight: f32, width: f32 },
    /// Inter's bold, upright.
    Bold,
}

/// Where a letter's outline comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum Source {
    Poster,
    /// Inter's drawn italic at 800: what the browser takes for a letter
    /// the poster face lacks.
    PosterItalic,
    Bold,
    System(fontdb::ID),
}

impl Source {
    /// Whether the face draws its own italic, or is leant to make one.
    pub(super) fn is_italic(self) -> bool {
        match self {
            Self::Poster | Self::PosterItalic => true,
            Self::Bold => false,
            Self::System(id) => system().is_some_and(|faces| {
                faces
                    .face(id)
                    .is_some_and(|face| face.style != fontdb::Style::Normal)
            }),
        }
    }
}

/// What a letter is set in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Found {
    In(Source),
    /// No face has it.
    Nowhere,
    /// Only the system's faces might, and they are still being listed.
    Later,
}

impl Typeface {
    /// The faces to look in, in order, before the system's: the web UI's
    /// stack for each (`"Saira","Archivo","Inter",system-ui` set italic,
    /// which takes Inter's own italic, and Inter), less the faces it does
    /// not ship.
    fn stack(self) -> &'static [Source] {
        match self {
            Self::Poster { .. } => &[Source::Poster, Source::PosterItalic],
            Self::Bold => &[Source::Bold],
        }
    }

    /// The face that sets `letter`.
    pub(super) fn find(self, letter: char) -> Found {
        for &source in self.stack() {
            if with_face(source, self, |face| face.glyph_index(letter).is_some()) == Some(true) {
                return Found::In(source);
            }
        }
        match system() {
            None => Found::Later,
            Some(faces) => system_face(faces, letter)
                .map_or(Found::Nowhere, |id| Found::In(Source::System(id))),
        }
    }

    /// The axes set on the poster face.
    fn variations(self) -> Vec<Variation> {
        match self {
            Self::Poster { weight, width } => vec![
                Variation {
                    tag: Tag::from_bytes(b"wght"),
                    value: weight,
                },
                Variation {
                    tag: Tag::from_bytes(b"wdth"),
                    value: width,
                },
            ],
            Self::Bold => Vec::new(),
        }
    }
}

/// How many of a face's units make its em.
pub(super) fn em(face: &Face<'_>) -> f32 {
    #[expect(clippy::cast_precision_loss, reason = "16 to 16384")]
    let em = face.units_per_em() as f32;
    em
}

/// Run `read` on the face `source` names, set as `typeface` asks.
pub(super) fn with_face<R>(
    source: Source,
    typeface: Typeface,
    read: impl FnOnce(&Face<'_>) -> R,
) -> Option<R> {
    match source {
        Source::Poster => {
            let mut face = Face::from_slice(SAIRA_ITALIC, 0)?;
            face.set_variations(&typeface.variations());
            Some(read(&face))
        }
        Source::PosterItalic => Face::from_slice(INTER_POSTER_ITALIC, 0).map(|face| read(&face)),
        Source::Bold => Face::from_slice(INTER_BOLD, 0).map(|face| read(&face)),
        Source::System(id) => system()?
            .with_face_data(id, |data, index| {
                Face::from_slice(data, index).map(|face| read(&face))
            })
            .flatten(),
    }
}

/// The system's faces, once they are listed. The first ask starts listing
/// them on a thread of its own (a few dozen milliseconds, once a run) and
/// is answered `None` until it is done; nothing is listed for a run that
/// never sets a letter the bundled faces lack.
fn system() -> Option<&'static fontdb::Database> {
    static FACES: OnceLock<fontdb::Database> = OnceLock::new();
    static LISTING: AtomicBool = AtomicBool::new(false);
    if let Some(faces) = FACES.get() {
        return Some(faces);
    }
    if !LISTING.swap(true, Ordering::AcqRel) {
        let started = std::thread::Builder::new()
            .name("system faces".to_owned())
            .spawn(|| {
                let mut faces = fontdb::Database::new();
                faces.load_system_fonts();
                let _ = FACES.set(faces);
            });
        if started.is_err() {
            let _ = FACES.set(fontdb::Database::new());
        }
    }
    FACES.get()
}

/// The families a browser falls back to on the systems this runs on, for
/// the scripts the bundled faces lack (Japanese, Chinese, Korean and the
/// rest), bold where there is a bold: on Windows those of Chromium's own
/// table, which sets Japanese in Yu Gothic (not its narrower "UI" cut),
/// then macOS's and the usual Linux ones.
const FALLBACK: &[&str] = &[
    "Yu Gothic",
    "Meiryo",
    "Microsoft YaHei",
    "Microsoft JhengHei",
    "Malgun Gothic",
    "Segoe UI",
    "Nirmala UI",
    "Leelawadee UI",
    "Ebrima",
    "Gadugi",
    "Segoe UI Historic",
    "Hiragino Sans",
    "Hiragino Kaku Gothic ProN",
    "PingFang SC",
    "Apple SD Gothic Neo",
    "Noto Sans CJK JP",
    "Noto Sans JP",
    "Noto Sans",
    "DejaVu Sans",
];

/// The system face that sets `letter`: the boldest of the first fallback
/// family that has it, or any face that has it. Remembered for the run.
fn system_face(faces: &fontdb::Database, letter: char) -> Option<fontdb::ID> {
    static FOUND: OnceLock<Mutex<HashMap<char, Option<fontdb::ID>>>> = OnceLock::new();
    let found = FOUND.get_or_init(Mutex::default);
    if let Some(known) = found
        .lock()
        .ok()
        .and_then(|known| known.get(&letter).copied())
    {
        return known;
    }
    let has = |id: fontdb::ID| {
        faces
            .with_face_data(id, |data, index| {
                ttf_parser::Face::parse(data, index)
                    .is_ok_and(|face| face.glyph_index(letter).is_some())
            })
            .unwrap_or(false)
    };
    let bold = |family: &str| {
        faces.query(&fontdb::Query {
            families: &[fontdb::Family::Name(family)],
            weight: fontdb::Weight(800),
            stretch: fontdb::Stretch::Normal,
            style: fontdb::Style::Italic,
        })
    };
    let face = FALLBACK
        .iter()
        .filter_map(|family| bold(family))
        .find(|&id| has(id))
        .or_else(|| faces.faces().map(|face| face.id).find(|&id| has(id)));
    if let Ok(mut known) = found.lock() {
        let _ = known.insert(letter, face);
    }
    face
}
