//! A full profile: the richer document a profile may point to, kept in the
//! server's file store and fetched only when somebody asks to see it.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::bounds::{Limits, linkable};
use super::model::{Block, Picture, read_blocks};

/// Where a profile's full profile is kept: the profile's `page` field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageRef {
    /// Its key in the server's file store.
    #[serde(rename = "k")]
    pub key: String,
    /// Its size, in bytes.
    #[serde(rename = "n")]
    pub size: u64,
    /// The version it was written in.
    #[serde(default = "first_version")]
    pub v: u32,
}

const fn first_version() -> u32 {
    Page::VERSION
}

/// A full profile: sections, each of a kind.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Page {
    /// The sections, in order.
    pub sections: Vec<Section>,
}

/// One section of a full profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Section {
    /// Text, as an about's blocks, longer.
    Text {
        /// Its heading.
        title: String,
        /// Its blocks.
        blocks: Vec<Block>,
    },
    /// Pictures, whose full copies are in the file store.
    Gallery {
        /// Its heading.
        title: String,
        /// The pictures.
        pictures: Vec<Picture>,
    },
    /// Places elsewhere.
    Links {
        /// Its heading.
        title: String,
        /// The links.
        links: Vec<Link>,
    },
}

/// A link of a full profile's list of links.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Link {
    /// What it says.
    #[serde(rename = "x", default)]
    pub text: String,
    /// Where it leads, a web address.
    #[serde(rename = "l", default)]
    pub url: String,
}

/// A section as it is written, before it is cut to its limits.
#[derive(Deserialize, Serialize)]
#[serde(tag = "t")]
enum Stored {
    #[serde(rename = "text")]
    Text {
        #[serde(default)]
        title: String,
        #[serde(default)]
        blocks: Value,
    },
    #[serde(rename = "gallery")]
    Gallery {
        #[serde(default)]
        title: String,
        #[serde(rename = "p", default)]
        pictures: Vec<Picture>,
    },
    #[serde(rename = "links")]
    Links {
        #[serde(default)]
        title: String,
        #[serde(default)]
        links: Vec<Link>,
    },
}

impl Page {
    /// The version this writes.
    pub const VERSION: u32 = 1;
    /// The most bytes a full profile may have.
    pub const MOST_BYTES: u64 = 256 * 1024;
    /// The most sections.
    pub const SECTIONS: usize = 16;
    /// The most links in a list of links.
    pub const LINKS: usize = 24;
    /// The longest heading of a section, in characters.
    pub const TITLE: usize = 80;

    /// The full profile in `bytes`, cut to its limits; `None` if it is too
    /// large or is not one. A section of a kind this does not know, or that
    /// does not read, is left out on its own.
    #[must_use]
    pub fn read(bytes: &[u8]) -> Option<Self> {
        if bytes.len() as u64 > Self::MOST_BYTES {
            return None;
        }
        let value: Value = serde_json::from_slice(bytes).ok()?;
        let sections = value
            .get("sections")?
            .as_array()?
            .iter()
            .take(Self::SECTIONS * 4)
            .filter_map(|section| serde_json::from_value::<Stored>(section.clone()).ok())
            .filter_map(Section::bounded)
            .take(Self::SECTIONS)
            .collect();
        Some(Self { sections })
    }

    /// The full profile as the bytes of its file.
    #[must_use]
    pub fn to_bytes(&self) -> Vec<u8> {
        let sections: Vec<Stored> = self.sections.iter().map(Section::written).collect();
        serde_json::json!({ "v": Self::VERSION, "sections": sections })
            .to_string()
            .into_bytes()
    }

    /// Whether it has nothing in it.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.sections.is_empty()
    }
}

impl Section {
    /// `written`, cut to the limits of its kind; `None` if nothing is left.
    fn bounded(written: Stored) -> Option<Self> {
        let title = |title: String| title.chars().take(Page::TITLE).collect::<String>();
        let section = match written {
            Stored::Text { title: name, blocks } => Self::Text {
                title: title(name),
                blocks: read_blocks(Some(&blocks), Limits::PAGE),
            },
            Stored::Gallery { title: name, pictures } => {
                // A gallery is one long row, as far as the limits go.
                let gallery = Limits {
                    row: Limits::PAGE.pictures,
                    ..Limits::PAGE
                };
                let cut = gallery.bound([Block::Pictures { pictures }]);
                Self::Gallery {
                    title: title(name),
                    pictures: match cut.into_iter().next() {
                        Some(Block::Pictures { pictures }) => pictures,
                        _ => Vec::new(),
                    },
                }
            }
            Stored::Links { title: name, links } => Self::Links {
                title: title(name),
                links: links
                    .into_iter()
                    .filter(|link| linkable(&link.url))
                    .take(Page::LINKS)
                    .map(|mut link| {
                        link.text = link.text.chars().take(Page::TITLE).collect();
                        link
                    })
                    .collect(),
            },
        };
        (!section.is_empty()).then_some(section)
    }

    fn written(&self) -> Stored {
        match self.clone() {
            Self::Text { title, blocks } => Stored::Text {
                title,
                blocks: serde_json::to_value(blocks).unwrap_or_default(),
            },
            Self::Gallery { title, pictures } => Stored::Gallery { title, pictures },
            Self::Links { title, links } => Stored::Links { title, links },
        }
    }

    /// Whether there is nothing in it to show.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        match self {
            Self::Text { blocks, .. } => blocks.is_empty(),
            Self::Gallery { pictures, .. } => pictures.is_empty(),
            Self::Links { links, .. } => links.is_empty(),
        }
    }
}

impl PageRef {
    /// The reference in `value`, the profile's `page` field, if it is one
    /// that can be fetched.
    #[must_use]
    pub fn read(value: &Value) -> Option<Self> {
        let page: Self = serde_json::from_value(value.clone()).ok()?;
        let fits = page.size > 0 && page.size <= Page::MOST_BYTES;
        (fits && !page.key.is_empty() && page.key.len() <= Limits::KEY).then_some(page)
    }
}
