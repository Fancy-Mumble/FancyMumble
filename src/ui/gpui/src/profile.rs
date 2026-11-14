//! A Fancy Mumble profile, as it rides in a user's comment.
//!
//! The comment begins with `<!--FANCY:{...}-->`, a JSON object inside an
//! HTML comment that other clients do not show, and what follows is what
//! the user wrote about themselves. This reads the part of the object a
//! card is drawn from. A profile is somebody else's, so nothing in it is
//! ever fetched: a picture is used only when the profile carries it whole.
//!
//! What somebody wrote about themselves is read by [`Said::of`]: the
//! profile's `about`, the format of `PROFILE_FORMAT.md`, or for the older
//! format only the basic words of the HTML, which is not kept after that.

use std::sync::Arc;

use gpui::Hsla;
use mumble_tauri_lib::engine_api::about::{About, Block, Page, PageRef, Run, Section, Written};
use serde::Deserialize;

use crate::rich::{Rich, Style};
use crate::theme::parse_color;

/// What somebody wrote about themselves, as a card draws it.
#[derive(Debug, Clone, Default)]
pub(crate) enum Said {
    /// Nothing.
    #[default]
    Nothing,
    /// The about of the new format.
    About(Arc<Shown>),
    /// The older format: its basic words, all that is kept of its HTML.
    /// `flagged` when it came with a Fancy profile, whose card says it is
    /// the older format.
    Older { words: Rich, flagged: bool },
}

/// An about, with each of its thumbnails as a picture to draw, in the
/// order of its pictures.
#[derive(Debug)]
pub(crate) struct Shown {
    pub about: About,
    pub thumbs: Vec<Option<Arc<gpui::Image>>>,
}

impl Shown {
    /// `about`, its thumbnails read.
    pub(crate) fn of(about: About) -> Self {
        let thumbs = about
            .pictures()
            .map(|picture| {
                picture
                    .thumb_bytes()
                    .and_then(crate::picture::picture)
                    .map(Arc::new)
            })
            .collect();
        Self { about, thumbs }
    }
}

impl Said {
    /// What `comment` says of its writer, and where their full profile is
    /// kept if they have one.
    pub(crate) fn of(comment: &str) -> (Self, Option<PageRef>) {
        let written = Written::read(comment);
        let page = written.page();
        let said = match written.about() {
            Some(about) if about.is_empty() => Self::Nothing,
            Some(about) => Self::About(Arc::new(Shown::of(about))),
            None => {
                let words = Rich::basic(written.html);
                if words.text.trim().is_empty() {
                    Self::Nothing
                } else {
                    Self::Older {
                        words,
                        flagged: written.profile.is_some(),
                    }
                }
            }
        };
        (said, page)
    }

    /// Whether this is the older format of a Fancy profile, which its
    /// owner can convert.
    pub(crate) const fn is_older(&self) -> bool {
        matches!(self, Self::Older { flagged: true, .. })
    }

    /// Its words, as one text: for where blocks are not drawn.
    pub(crate) fn words(&self) -> Rich {
        match self {
            Self::Nothing => Rich::default(),
            Self::Older { words, .. } => words.clone(),
            Self::About(shown) => words_of(&shown.about),
        }
    }
}

/// Full pictures to keep in the server's file store: each by its place
/// among an about's pictures, and its bytes as they were.
pub(crate) type Kept = Vec<(usize, Arc<Vec<u8>>)>;

/// What the local user saves of what they say about themselves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Save {
    /// The about.
    pub about: About,
    /// Full pictures to keep in the server's file store first: the place of
    /// each among the about's pictures, and its bytes as they were.
    pub keep: Kept,
    /// The whole text, where the card's about had to cut it: it goes into
    /// the full profile.
    pub full_text: Option<Vec<Block>>,
    /// The full profile the profile names now, kept as it is unless a new
    /// one is written.
    pub page: Option<PageRef>,
    /// The headings of a full profile's text and its pictures.
    pub titles: (String, String),
}

impl Save {
    /// The full profile to write once the pictures are kept and `about`
    /// names their keys: the whole text and the kept pictures. `None` when
    /// there is nothing new for one, and the one named stays.
    pub(crate) fn page_for(&self, about: &About) -> Option<Page> {
        let kept: Vec<_> = about
            .pictures()
            .filter(|picture| picture.key.is_some())
            .cloned()
            .collect();
        if self.full_text.is_none() && self.keep.is_empty() {
            return None;
        }
        let mut sections = Vec::new();
        if let Some(blocks) = &self.full_text {
            sections.push(Section::Text {
                title: self.titles.0.clone(),
                blocks: blocks.clone(),
            });
        }
        if !kept.is_empty() {
            sections.push(Section::Gallery {
                title: self.titles.1.clone(),
                pictures: kept,
            });
        }
        (!sections.is_empty()).then_some(Page { sections })
    }

    /// `about` with the full picture `at` kept under `key`, `size` bytes.
    pub(crate) fn note_kept(about: &mut About, at: usize, key: String, size: u64) {
        if let Some(picture) = about.pictures_mut().nth(at) {
            picture.key = Some(key);
            picture.size = Some(size);
        }
    }
}

/// `runs` as one text set the way they say.
pub(crate) fn rich_of(runs: &[Run]) -> Rich {
    let mut rich = Rich::default();
    push_runs(&mut rich, runs);
    rich
}

fn push_runs(rich: &mut Rich, runs: &[Run]) {
    for run in runs {
        let start = rich.text.len();
        rich.text.push_str(&run.text);
        let range = start..rich.text.len();
        let style = Style {
            bold: run.bold,
            italic: run.italic,
            underline: run.underline,
            strike: run.strike,
            code: run.code,
            ..Style::default()
        };
        if style != Style::default() {
            rich.spans.push((range.clone(), style));
        }
        if let Some(link) = &run.link {
            rich.links.push((range, link.clone()));
        }
    }
}

/// An about's words as one text, a line or more a block: for where its
/// blocks are not drawn, such as the sheet of what the server knows.
pub(crate) fn words_of(about: &About) -> Rich {
    let mut rich = Rich::default();
    for block in &about.blocks {
        let before = rich.text.len();
        if before > 0 {
            rich.text.push('\n');
        }
        match block {
            Block::Heading { text, .. } => push_runs(
                &mut rich,
                &[Run {
                    bold: true,
                    ..Run::plain(text.clone())
                }],
            ),
            Block::Text { runs, .. } | Block::Quote { runs } => push_runs(&mut rich, runs),
            Block::List {
                numbered, items, ..
            } => {
                for (at, item) in items.iter().enumerate() {
                    if at > 0 {
                        rich.text.push('\n');
                    }
                    let mark = if *numbered {
                        format!("{}. ", at + 1)
                    } else {
                        "\u{2022} ".to_owned()
                    };
                    rich.text.push_str(&mark);
                    push_runs(&mut rich, item);
                }
            }
            Block::Divider => rich.text.push_str("\u{2014}\u{2014}\u{2014}"),
            Block::Pictures { .. } => rich.text.truncate(before),
        }
    }
    rich
}

const PREFIX: &str = "<!--FANCY:";
const SUFFIX: &str = "-->";

/// What a profile says, of what this view draws.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Profile {
    /// What the user says they are doing.
    pub status: Option<String>,
    pub pronouns: Option<String>,
    /// How to reach them elsewhere.
    pub contact: Option<String>,
    /// The banner's colour, and its picture as encoded bytes.
    pub banner_color: Option<Hsla>,
    /// The banner as two colours run into each other, and the angle they
    /// run at, where the profile gives it so.
    pub banner_rake: Option<(f32, Hsla, Hsla)>,
    pub banner_picture: Option<Vec<u8>>,
    /// The colour the name is set in.
    pub name_color: Option<Hsla>,
    /// Bold unless the profile says not: a name is bold on a card.
    pub name_bold: bool,
    pub name_italic: bool,
    /// The face the name is set in, where it is not the card's own.
    pub name_face: Option<Face>,
    /// The rows of the card the owner has switched off.
    pub hidden: Hidden,
}

/// A face a name can be set in, other than the card's own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Face {
    Serif,
    Mono,
    Cursive,
    Fantasy,
}

impl Face {
    /// The families that stand for it, most wanted first, as the web UI's
    /// catalogue lists them.
    pub(crate) const fn stack(self) -> &'static str {
        match self {
            Self::Serif => "Georgia, serif",
            Self::Mono => r#""Courier New", monospace"#,
            Self::Cursive => r#""Segoe Script", "Comic Sans MS", serif"#,
            Self::Fantasy => r#""Impact", "Haettenschweiler", sans-serif"#,
        }
    }

    fn named(id: &str) -> Option<Self> {
        match id {
            "serif" => Some(Self::Serif),
            "mono" => Some(Self::Mono),
            "cursive" => Some(Self::Cursive),
            "fantasy" => Some(Self::Fantasy),
            _ => None,
        }
    }
}

/// The rows of their card somebody has switched off. Every row shows
/// unless its owner said otherwise.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "one switch a row, each on its own"
)]
pub(crate) struct Hidden {
    pub identity: bool,
    pub status: bool,
    pub bio: bool,
    pub roles: bool,
    pub activity: bool,
    pub stats: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Raw {
    status: Option<String>,
    pronouns: Option<String>,
    contact: Option<String>,
    banner: RawBanner,
    name_style: RawNameStyle,
    sections: RawSections,
}

/// The owner's switches: a row is off only where it says `false`.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawSections {
    identity: Option<bool>,
    status: Option<bool>,
    bio: Option<bool>,
    roles: Option<bool>,
    activity: Option<bool>,
    stats: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawBanner {
    color: Option<String>,
    image: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawNameStyle {
    color: Option<String>,
    gradient: Option<(String, String)>,
    bold: Option<bool>,
    italic: bool,
    font: Option<String>,
}

/// The profile `comment` carries, as JSON, with `picture` for its banner;
/// no picture takes the banner's picture off. Everything else the profile
/// says stays, whether this client reads it or not.
pub(crate) fn with_banner(comment: &str, picture: &[u8]) -> String {
    use serde_json::{Value, json};
    let held = comment
        .trim_start()
        .strip_prefix(PREFIX)
        .and_then(|rest| Some(&rest[..rest.find(SUFFIX)?]))
        .and_then(|json| serde_json::from_str::<Value>(json).ok())
        .filter(Value::is_object);
    let mut profile = held.unwrap_or_else(|| json!({ "v": 1 }));
    if !profile["banner"].is_object() {
        profile["banner"] = json!({});
    }
    match crate::picture::data_uri(picture) {
        Some(address) => profile["banner"]["image"] = Value::String(address),
        None => {
            if let Some(banner) = profile["banner"].as_object_mut() {
                let _ = banner.remove("image");
            }
        }
    }
    profile.to_string()
}

impl Profile {
    /// The profile at the head of `comment`, if it has one that can be
    /// read. A comment written by another client has none.
    pub(crate) fn of(comment: &str) -> Option<Self> {
        let rest = comment.strip_prefix(PREFIX)?;
        let json = &rest[..rest.find(SUFFIX)?];
        let raw: Raw = serde_json::from_str(json).ok()?;
        let said = |text: Option<String>| {
            text.map(|text| text.trim().to_owned())
                .filter(|text| !text.is_empty())
        };
        let color = |css: Option<&String>| css.and_then(|css| parse_color(css)).map(Hsla::from);
        let off = |switch: Option<bool>| switch == Some(false);
        Some(Self {
            status: said(raw.status),
            pronouns: said(raw.pronouns),
            contact: said(raw.contact),
            banner_color: color(raw.banner.color.as_ref()),
            banner_rake: raw.banner.color.as_deref().and_then(rake),
            banner_picture: raw
                .banner
                .image
                .as_deref()
                .and_then(crate::rich::embedded_picture),
            // A name set in a gradient is drawn in the colour it starts in.
            name_color: color(raw.name_style.color.as_ref())
                .or_else(|| color(raw.name_style.gradient.as_ref().map(|(from, _)| from))),
            name_bold: raw.name_style.bold != Some(false),
            name_italic: raw.name_style.italic,
            name_face: raw.name_style.font.as_deref().and_then(Face::named),
            hidden: Hidden {
                identity: off(raw.sections.identity),
                status: off(raw.sections.status),
                bio: off(raw.sections.bio),
                roles: off(raw.sections.roles),
                activity: off(raw.sections.activity),
                stats: off(raw.sections.stats),
            },
        })
    }
}

/// A banner written as a CSS `linear-gradient`: the angle it runs at, in
/// degrees, and its first and last colours. Anything else is not one.
fn rake(css: &str) -> Option<(f32, Hsla, Hsla)> {
    let inside = css
        .trim()
        .strip_prefix("linear-gradient(")?
        .strip_suffix(')')?;
    // Commas part the arguments, but not those inside a colour's brackets.
    let mut parts = Vec::new();
    let (mut depth, mut from) = (0_u32, 0);
    for (at, character) in inside.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                parts.push(inside[from..at].trim());
                from = at + 1;
            }
            _ => {}
        }
    }
    parts.push(inside[from..].trim());
    // The angle is the first argument, if it is one; CSS runs to the
    // bottom without.
    let angle = parts
        .first()
        .and_then(|first| first.strip_suffix("deg"))
        .and_then(|degrees| degrees.trim().parse::<f32>().ok());
    let colors: Vec<Hsla> = parts
        .iter()
        .skip(usize::from(angle.is_some()))
        // A stop may say where it stands, after its colour: `#fff 20%`,
        // `rgb(0, 0, 255) 80%`.
        .filter_map(|stop| match stop.find(')') {
            Some(end) => stop.get(..=end),
            None => stop.split_whitespace().next(),
        })
        .filter_map(parse_color)
        .map(Hsla::from)
        .collect();
    Some((
        angle.unwrap_or(180.0),
        *colors.first()?,
        *colors.get(1..)?.last()?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_bold_unless_told_not_to_be_and_rows_show_unless_switched_off() {
        let plain = Profile::of("<!--FANCY:{}-->").expect("a profile");
        assert!(
            plain.name_bold,
            "nothing said: bold, as the web card draws it"
        );
        assert_eq!(plain.hidden, Hidden::default(), "every row shows");
        assert_eq!(plain.name_face, None);
        let set = Profile::of(
            r#"<!--FANCY:{"nameStyle":{"bold":false,"font":"cursive"},"sections":{"stats":false,"bio":true,"roles":false}}-->"#,
        )
        .expect("a profile");
        assert!(!set.name_bold);
        assert_eq!(set.name_face, Some(Face::Cursive));
        assert!(set.hidden.stats && set.hidden.roles);
        assert!(!set.hidden.bio && !set.hidden.status);
        // A face this client has never heard of is the card's own.
        let odd = Profile::of(r#"<!--FANCY:{"nameStyle":{"font":"wingdings"}}-->"#);
        assert_eq!(odd.and_then(|profile| profile.name_face), None);
    }

    #[test]
    fn a_banner_in_two_colours_keeps_both_and_its_angle() {
        let (angle, from, to) =
            rake("linear-gradient(135deg, #ff0000, rgb(0, 0, 255))").expect("one");
        assert!((angle - 135.0).abs() < f32::EPSILON);
        let (from, to) = (gpui::Rgba::from(from), gpui::Rgba::from(to));
        assert!(from.r > 0.99 && to.b > 0.99);
        // Three stops: the first and the last. No angle: to the bottom.
        let (angle, _, last) =
            rake("linear-gradient(#000 0%, #888 50%, #ffffff 100%)").expect("one");
        assert!((angle - 180.0).abs() < f32::EPSILON);
        assert!(gpui::Rgba::from(last).r > 0.99);
        assert!(rake("#336699").is_none());
        assert!(
            rake("linear-gradient(#fff)").is_none(),
            "one colour is no rake"
        );
        assert!(rake("url(https://example.org/x)").is_none());
        let profile = Profile::of(
            r##"<!--FANCY:{"banner":{"color":"linear-gradient(90deg,#102030,#405060)"}}-->"##,
        )
        .expect("a profile");
        assert!(profile.banner_rake.is_some() && profile.banner_color.is_none());
    }

    #[test]
    fn a_profile_is_read_from_the_head_of_a_comment() {
        let comment = r##"<!--FANCY:{"v":1,"status":" Painting ","pronouns":"she/her","banner":{"color":"#336699"},"nameStyle":{"gradient":["#ff0000","#0000ff"],"bold":true}}-->
<b>Draws</b> characters."##;
        let profile = Profile::of(comment).expect("a profile");
        assert_eq!(profile.status.as_deref(), Some("Painting"));
        assert_eq!(profile.pronouns.as_deref(), Some("she/her"));
        assert_eq!(profile.contact, None);
        assert!(profile.banner_color.is_some() && profile.banner_picture.is_none());
        let red = gpui::Rgba::from(profile.name_color.expect("the gradient's first colour"));
        assert!(red.r > 0.99 && red.b < 0.01);
        assert!(profile.name_bold && !profile.name_italic);
    }

    #[test]
    fn a_plain_comment_or_a_broken_head_is_no_profile() {
        assert_eq!(Profile::of("Just somebody."), None);
        assert_eq!(Profile::of("<!--FANCY:{not json}-->bio"), None);
        assert_eq!(Profile::of("<!--FANCY:{\"v\":1"), None, "never closed");
        // An empty object is a profile that says nothing.
        let nothing_said = Profile {
            name_bold: true,
            ..Profile::default()
        };
        assert_eq!(Profile::of("<!--FANCY:{}-->"), Some(nothing_said));
    }

    #[test]
    fn a_banner_picture_is_written_into_the_profile_and_the_rest_is_kept() {
        let held = r##"<!--FANCY:{"v":1,"status":"Out","sticker":{"id":7},"banner":{"color":"#336699"}}-->
Draws."##;
        let jpeg = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
        let written = with_banner(held, &jpeg);
        let read: serde_json::Value = serde_json::from_str(&written).expect("json");
        assert_eq!(read["status"], "Out");
        assert_eq!(read["sticker"]["id"], 7, "what is not read here is kept");
        assert_eq!(read["banner"]["color"], "#336699");
        // And it reads back as the same picture.
        let profile = Profile::of(&format!("{PREFIX}{written}{SUFFIX}")).expect("a profile");
        assert_eq!(profile.banner_picture.as_deref(), Some(&jpeg[..]));
        // Taken off again; and a comment with no profile gets one.
        let bare = with_banner(&format!("{PREFIX}{written}{SUFFIX}"), &[]);
        assert!(!bare.contains("image"));
        let first = with_banner("Just words.", &jpeg);
        assert!(first.contains(r#""v":1"#) && first.contains("data:image/jpeg"));
    }

    #[test]
    fn what_somebody_wrote_is_read_as_its_format_says() {
        use mumble_tauri_lib::engine_api::about::{Align, with_about};
        // The older format: basic words, no pictures, flagged.
        let older =
            r#"<!--FANCY:{"v":1}--><p><b>Hi</b> <img src="data:image/png;base64,aGkh"></p>"#;
        let (said, page) = Said::of(older);
        assert!(said.is_older() && page.is_none());
        let Said::Older { words, .. } = &said else {
            panic!("older");
        };
        assert_eq!(words.text, "Hi");
        assert!(words.images.is_empty());
        // Another client's comment: the same reading, not flagged.
        let (plain, _) = Said::of("<i>just</i> words");
        assert!(matches!(plain, Said::Older { flagged: false, .. }));
        // The new format, with where its full profile is.
        let about = About {
            blocks: vec![
                Block::Heading {
                    text: "Quotes".into(),
                    align: Align::Center,
                },
                Block::List {
                    numbered: false,
                    items: vec![vec![Run::plain("one")], vec![Run::plain("two")]],
                    align: Align::Left,
                },
            ],
        };
        let page = PageRef {
            key: "0/a/p.json".into(),
            size: 10,
            v: 1,
        };
        let written = with_about("", &about, Some(&page), 0).expect("written");
        let (said, kept) = Said::of(&written.comment);
        assert_eq!(kept, Some(page));
        let Said::About(shown) = &said else {
            panic!("the new format");
        };
        assert_eq!(shown.about, about);
        // As one text, for the sheet: a heading bold, a list as lines.
        let words = said.words();
        assert_eq!(words.text, "Quotes\n\u{2022} one\n\u{2022} two");
        assert!(words.spans[0].1.bold);
        // Nothing written is nothing.
        assert!(matches!(Said::of("").0, Said::Nothing));
        assert!(matches!(
            Said::of("<!--FANCY:{\"about\":{\"blocks\":[]}}-->").0,
            Said::Nothing
        ));
    }

    #[test]
    fn a_full_profile_is_written_only_when_there_is_something_new_for_it() {
        use mumble_tauri_lib::engine_api::about::Picture;
        let picture = Picture {
            thumb: Some("data:image/jpeg;base64,AAAA".into()),
            ..Picture::default()
        };
        let mut about = About {
            blocks: vec![Block::Pictures {
                pictures: vec![picture.clone(), picture],
            }],
        };
        let save = Save {
            about: about.clone(),
            keep: Vec::new(),
            full_text: None,
            page: None,
            titles: ("About".into(), "Pictures".into()),
        };
        assert_eq!(
            save.page_for(&about),
            None,
            "nothing new: the old one stays"
        );
        let keeping = Save {
            keep: vec![(1, Arc::new(vec![1, 2, 3]))],
            ..save
        };
        Save::note_kept(&mut about, 1, "0/k/two.png".into(), 3);
        let page = keeping.page_for(&about).expect("a gallery");
        let [Section::Gallery { pictures, title }] = page.sections.as_slice() else {
            panic!("one gallery: {page:?}");
        };
        assert_eq!(title, "Pictures");
        assert_eq!(pictures.len(), 1, "only the picture kept");
        assert_eq!(pictures[0].key.as_deref(), Some("0/k/two.png"));
    }

    #[test]
    fn a_banner_that_is_an_address_is_not_a_picture() {
        let remote = r#"<!--FANCY:{"banner":{"image":"https://example.org/track.png","color":"url(https://example.org/x)"}}-->"#;
        let profile = Profile::of(remote).expect("a profile");
        assert!(profile.banner_picture.is_none(), "nothing is fetched");
        assert!(profile.banner_color.is_none(), "nor is that a colour");
        let inline = r#"<!--FANCY:{"banner":{"image":"data:image/png;base64,iVBORw0KGgo="}}-->"#;
        assert!(
            Profile::of(inline)
                .expect("a profile")
                .banner_picture
                .is_some()
        );
    }
}
