//! What the demo's people say about themselves: the comments their cards
//! are drawn from, in the older format (HTML after the profile's mark) and
//! in the new one (an "about" in the profile, and a full profile kept as a
//! file), and what the local user saves.
//!
//! `FANCY_GPUI_DEMO_BIO=<folder>` gives Rin an older-format comment with
//! every picture in that folder pasted into it whole, as a person with a
//! heavy profile has: for measuring what drawing such a card costs. With
//! `FANCY_GPUI_DEMO_BIO_FORMAT=new` it is the same profile converted, its
//! full pictures kept as files and a full profile to open.

use std::collections::HashMap;

use gpui::SharedString;
use mumble_tauri_lib::engine_api::about::{
    Limits, Link, Migration, Page, PageRef, Section, with_about,
};

use crate::engine::Session;
use crate::profile::Save;

/// The local user's session.
const OWN: Session = super::OWN;

/// What somebody wrote in the older format: centred lines, some of them
/// bold, a link, a heading over a list, and pictures in a row. Modelled on
/// a real profile; `{pictures}` is where its pictures go.
const OLDER: &str = concat!(
    r#"<p style="text-align:center"><strong>Hello World!</strong></p>"#,
    r#"<p style="text-align:center"><strong>Memories</strong></p>"#,
    r#"<p style="text-align:center">R.I.P. Nooblounge - &#10013;20.07.2021</p>"#,
    r#"<p style="text-align:center"><a href="https://example.org/halb-acht">Morgens halb acht auf Mumble</a></p>"#,
    r#"<p style="text-align:center"><strong>Quotes</strong></p>"#,
    r#"<ul style="text-align:center"><li>Make the world more exciting</li>"#,
    r#"<li>her smile was shining with the brightness of a triple star system</li>"#,
    "<li>\u{3046}\u{308b}\u{3055}\u{3044}</li></ul>",
    r#"<p style="text-align:center">{pictures}</p>"#,
);

/// The profiles the demo's people carry, and what the local user wrote.
#[derive(Debug, Default)]
pub(super) struct Profiles {
    /// Comments as a server holds them, by session.
    comments: HashMap<Session, String>,
    /// The files kept for profiles: full profiles and full pictures.
    files: HashMap<SharedString, Vec<u8>>,
    /// How often a full profile was fetched: a test reads it.
    pub(super) fetched: u32,
}

impl Profiles {
    /// Scout's profile in the new format, the local user's in the older
    /// one, and Rin's from `FANCY_GPUI_DEMO_BIO` if it is set.
    pub(super) fn seeded() -> Self {
        let mut comments = HashMap::new();
        let mut files = HashMap::new();
        let small = [
            painted(240, 160, [214, 96, 77]),
            painted(160, 200, [64, 132, 196]),
        ];
        // Flora says nothing about herself: somebody has to.
        let _ = comments.insert(4, converted("scout", &small, &mut files));
        let _ = comments.insert(
            1,
            format!(
                r#"<!--FANCY:{{"v":1,"pronouns":"they/them"}}-->{}"#,
                concat!(
                    r#"<p><strong>Plays</strong> the <em>drums</em>, badly.</p>"#,
                    r#"<p>Find me at <a href="https://example.org/alex">example.org/alex</a></p>"#,
                )
            ) + &picture_tag(&small[0]),
        );
        if let Some(folder) = std::env::var_os("FANCY_GPUI_DEMO_BIO") {
            let pictures: Vec<Vec<u8>> = super::sorted(std::path::Path::new(&folder))
                .into_iter()
                .filter(|path| path.is_file())
                .filter_map(|path| std::fs::read(path).ok())
                .collect();
            // `FANCY_GPUI_DEMO_BIO_FORMAT=new`: the same, converted.
            let converting = std::env::var("FANCY_GPUI_DEMO_BIO_FORMAT").is_ok_and(|f| f == "new");
            let written = if converting {
                converted("rin", &pictures, &mut files)
            } else {
                older(r#"{"v":1,"status":"Sketching"}"#, &pictures)
            };
            let _ = comments.insert(3, written);
        }
        Self {
            comments,
            files,
            fetched: 0,
        }
    }

    /// A file kept for a profile: a full picture, to be looked at large.
    pub(super) fn file(&self, key: &str) -> Option<&Vec<u8>> {
        self.files.get(key)
    }

    /// Save what the local user says about themselves, as a server with a
    /// file store would: the full pictures and the full profile kept, the
    /// about written into their comment.
    pub(super) fn save(&mut self, save: &Save) -> Result<usize, String> {
        let mut about = save.about.clone();
        for (at, bytes) in &save.keep {
            let key = format!("0/demo/own-{}-{at}.png", self.files.len());
            Save::note_kept(&mut about, *at, key.clone(), bytes.len() as u64);
            let _ = self.files.insert(key.into(), bytes.to_vec());
        }
        let page = match save.page_for(&about) {
            Some(page) => Some(self.keep_page("own", &page)),
            None => save.page.clone(),
        };
        let held = self.comments.get(&OWN).cloned().unwrap_or_default();
        let fitted = with_about(&held, &about, page.as_ref(), 0)?;
        let _ = self.comments.insert(OWN, fitted.comment);
        Ok(fitted.dropped)
    }

    /// The full profile kept under `page`, counted.
    pub(super) fn page(&mut self, page: &PageRef) -> Result<Page, String> {
        self.fetched += 1;
        let bytes = self
            .files
            .get(page.key.as_str())
            .ok_or("The full profile is no longer on the server.")?;
        Page::read(bytes).ok_or_else(|| "That is not a full profile.".to_owned())
    }

    fn keep_page(&mut self, whose: &str, page: &Page) -> PageRef {
        let bytes = page.to_bytes();
        let key = format!("0/demo/{whose}-{}/profile.json", self.files.len());
        let size = bytes.len() as u64;
        let _ = self.files.insert(key.clone().into(), bytes);
        PageRef {
            key,
            size,
            v: Page::VERSION,
        }
    }

    /// The comment `session` carries, with `banner` written into its
    /// profile where they were given one; `None` for somebody this does
    /// not keep a comment for.
    pub(super) fn comment_of(&self, session: Session, banner: Option<&Vec<u8>>) -> Option<String> {
        let held = self.comments.get(&session)?;
        Some(match banner {
            Some(banner) => {
                let profile = crate::profile::with_banner(held, banner);
                let words = held
                    .split_once("-->")
                    .map_or(held.as_str(), |(_, words)| words);
                format!("<!--FANCY:{profile}-->{words}")
            }
            None => held.clone(),
        })
    }
}

/// What a test reads and changes of the profiles.
#[cfg(test)]
impl super::DemoEngine {
    /// How often a full profile was fetched.
    pub(crate) fn pages_fetched(&self) -> u32 {
        self.with_state(|state| state.profiles.fetched)
    }

    /// The comment `session` carries, as a server would hand it out.
    pub(crate) fn comment_of(&self, session: Session) -> Option<String> {
        self.with_state(|state| state.profiles.comment_of(session, None))
    }

    /// Have `session` carry `comment`.
    pub(crate) fn set_comment_of(&self, session: Session, comment: String) {
        let _ = self.with_state(|state| state.profiles.comments.insert(session, comment));
    }
}

/// The model older-format profile, converted: its about with thumbnails, its
/// full pictures and a full profile with a list of links kept in `files`.
fn converted(
    whose: &str,
    pictures: &[Vec<u8>],
    files: &mut HashMap<SharedString, Vec<u8>>,
) -> String {
    let pasted: String = pictures
        .iter()
        .map(|picture| picture_tag(picture))
        .collect();
    let mut migration = Migration::read(&OLDER.replace("{pictures}", &pasted));
    migration.thumbnail(Limits::CARD.thumbs);
    for (at, picture) in pictures.iter().enumerate() {
        let key = format!("0/demo/{whose}-{at}.picture");
        migration.kept(at, key.clone(), picture.len() as u64);
        let _ = files.insert(key.into(), picture.clone());
    }
    let mut page = migration.page("About", "Pictures");
    page.sections.push(Section::Links {
        title: "Elsewhere".into(),
        links: vec![Link {
            text: "Morgens halb acht".into(),
            url: "https://example.org/halb-acht".into(),
        }],
    });
    let bytes = page.to_bytes();
    let page = PageRef {
        key: format!("0/demo/{whose}/profile.json"),
        size: bytes.len() as u64,
        v: Page::VERSION,
    };
    let _ = files.insert(page.key.clone().into(), bytes);
    let held = r#"<!--FANCY:{"v":1,"status":"Out on a walk","pronouns":"he/him"}-->"#;
    with_about(held, &migration.card(), Some(&page), 0)
        .map(|fitted| fitted.comment)
        .unwrap_or_default()
}

/// An older-format comment: `profile` and the bio with `pictures` pasted in.
fn older(profile: &str, pictures: &[Vec<u8>]) -> String {
    let pasted: String = pictures
        .iter()
        .map(|picture| picture_tag(picture))
        .collect();
    format!(
        "<!--FANCY:{profile}-->{}",
        OLDER.replace("{pictures}", &pasted)
    )
}

/// `picture` as a bio's editor pastes one: whole, as a `data:` address.
fn picture_tag(picture: &[u8]) -> String {
    crate::picture::data_uri(picture)
        .map(|address| format!(r#"<img src="{address}" width="130">"#))
        .unwrap_or_default()
}

/// A small picture of one colour, darker to its foot, as PNG.
fn painted(width: u32, height: u32, [r, g, b]: [u8; 3]) -> Vec<u8> {
    let image = image::RgbImage::from_fn(width, height, |_, y| {
        let shade = |part: u8| {
            let dark = u32::from(part) * (height * 2 - y) / (height * 2);
            u8::try_from(dark).unwrap_or(u8::MAX)
        };
        image::Rgb([shade(r), shade(g), shade(b)])
    });
    let mut out = std::io::Cursor::new(Vec::new());
    let _ = image.write_to(&mut out, image::ImageFormat::Png);
    out.into_inner()
}
