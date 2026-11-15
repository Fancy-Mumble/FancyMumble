//! The blocks an about is made of, as they are written in a profile's JSON.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::bounds::Limits;

/// Pictures a thumbnail may be, and how a thumbnail is written.
const THUMB_KINDS: &[&str] = &["jpeg", "png", "webp", "gif"];

/// What a user says about themselves: a short list of blocks.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct About {
    /// The blocks, in order.
    pub blocks: Vec<Block>,
}

/// One block of an about, or of a text of a full profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "t")]
pub enum Block {
    /// A line set apart as a heading.
    #[serde(rename = "h")]
    Heading {
        /// Its words.
        #[serde(rename = "x", default)]
        text: String,
        /// Where it stands.
        #[serde(rename = "a", default, skip_serializing_if = "Align::is_left")]
        align: Align,
    },
    /// Running text: a paragraph, its lines parted by `\n`.
    #[serde(rename = "p")]
    Text {
        /// Its runs.
        #[serde(rename = "r", default)]
        runs: Vec<Run>,
        /// Where its lines stand.
        #[serde(rename = "a", default, skip_serializing_if = "Align::is_left")]
        align: Align,
    },
    /// A list of one level, each item its runs.
    #[serde(rename = "list")]
    List {
        /// Numbered rather than bulleted.
        #[serde(rename = "n", default, skip_serializing_if = "is_false")]
        numbered: bool,
        /// Its items.
        #[serde(rename = "i", default)]
        items: Vec<Vec<Run>>,
        /// Where its items stand.
        #[serde(rename = "a", default, skip_serializing_if = "Align::is_left")]
        align: Align,
    },
    /// Somebody else's words, set apart.
    #[serde(rename = "quote")]
    Quote {
        /// Its runs.
        #[serde(rename = "r", default)]
        runs: Vec<Run>,
    },
    /// A line across.
    #[serde(rename = "hr")]
    Divider,
    /// Pictures side by side.
    #[serde(rename = "pics")]
    Pictures {
        /// The pictures, in order.
        #[serde(rename = "p", default)]
        pictures: Vec<Picture>,
    },
}

/// Where a block's lines stand.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "String", into = "String")]
pub enum Align {
    /// Against the left, as text usually is.
    #[default]
    Left,
    /// In the middle.
    Center,
    /// Against the right.
    Right,
}

/// A stretch of text, set one way.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Run {
    /// Its words; a line break is `\n`.
    #[serde(rename = "x", default)]
    pub text: String,
    /// Bold.
    #[serde(rename = "b", default, skip_serializing_if = "is_false")]
    pub bold: bool,
    /// Italic.
    #[serde(rename = "i", default, skip_serializing_if = "is_false")]
    pub italic: bool,
    /// Underlined.
    #[serde(rename = "u", default, skip_serializing_if = "is_false")]
    pub underline: bool,
    /// Struck through.
    #[serde(rename = "s", default, skip_serializing_if = "is_false")]
    pub strike: bool,
    /// Set as code.
    #[serde(rename = "c", default, skip_serializing_if = "is_false")]
    pub code: bool,
    /// Where it leads, a web address.
    #[serde(rename = "l", default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

/// A picture of an about: a small thumbnail carried in the profile, and
/// the full picture in the server's file store if it was kept there.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Picture {
    /// The thumbnail, as a `data:` address.
    #[serde(rename = "d", default, skip_serializing_if = "Option::is_none")]
    pub thumb: Option<String>,
    /// The full picture's width, in pixels.
    #[serde(rename = "w", default, skip_serializing_if = "is_zero")]
    pub width: u32,
    /// The full picture's height, in pixels.
    #[serde(rename = "h", default, skip_serializing_if = "is_zero")]
    pub height: u32,
    /// The key of the full picture in the server's file store.
    #[serde(rename = "k", default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// The full picture's size, in bytes.
    #[serde(rename = "n", default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    /// What it shows, in words.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub alt: String,
}

const fn is_false(value: &bool) -> bool {
    !*value
}

const fn is_zero(value: &u32) -> bool {
    *value == 0
}

impl About {
    /// What writes the about says which version it wrote.
    pub const VERSION: u32 = 1;

    /// The about in `value`, the profile's `about` field, cut to the card's
    /// limits. A block that does not read, or is of a kind this does not
    /// know, is left out on its own.
    #[must_use]
    pub fn read(value: &Value) -> Self {
        Self {
            blocks: read_blocks(value.get("blocks"), Limits::CARD),
        }
    }

    /// The about as the profile's `about` field.
    #[must_use]
    pub fn to_value(&self) -> Value {
        serde_json::json!({ "v": Self::VERSION, "blocks": self.blocks })
    }

    /// The same, cut to `limits`.
    #[must_use]
    pub fn bounded(self, limits: Limits) -> Self {
        Self {
            blocks: limits.bound(self.blocks),
        }
    }

    /// Whether it says nothing.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty()
    }

    /// Its pictures, in order.
    pub fn pictures(&self) -> impl Iterator<Item = &Picture> {
        self.blocks.iter().flat_map(|block| match block {
            Block::Pictures { pictures } => pictures.as_slice(),
            _ => &[],
        })
    }

    /// Its pictures, in order, to be changed.
    pub fn pictures_mut(&mut self) -> impl Iterator<Item = &mut Picture> {
        self.blocks.iter_mut().flat_map(|block| match block {
            Block::Pictures { pictures } => pictures.as_mut_slice(),
            _ => &mut [],
        })
    }
}

/// The blocks in `value`, a JSON array, cut to `limits`.
pub(super) fn read_blocks(value: Option<&Value>, limits: Limits) -> Vec<Block> {
    let read = value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        // Not more than could be kept, whatever the array holds.
        .take(limits.blocks * 4)
        .filter_map(|block| serde_json::from_value::<Block>(block.clone()).ok());
    limits.bound(read)
}

impl Block {
    /// Whether there is nothing in it to show.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        match self {
            Self::Heading { text, .. } => text.trim().is_empty(),
            Self::Text { runs, .. } | Self::Quote { runs } => runs.is_empty(),
            Self::List { items, .. } => items.is_empty(),
            Self::Pictures { pictures } => pictures.is_empty(),
            Self::Divider => false,
        }
    }
}

impl Align {
    /// Whether it is the usual left.
    #[must_use]
    pub const fn is_left(&self) -> bool {
        matches!(self, Self::Left)
    }
}

/// Anything not known is the usual left.
impl From<String> for Align {
    fn from(written: String) -> Self {
        match written.as_str() {
            "c" => Self::Center,
            "r" => Self::Right,
            _ => Self::Left,
        }
    }
}

impl From<Align> for String {
    fn from(align: Align) -> Self {
        match align {
            Align::Left => "l",
            Align::Center => "c",
            Align::Right => "r",
        }
        .to_owned()
    }
}

impl Run {
    /// `text`, set plainly.
    #[must_use]
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Self::default()
        }
    }

    /// Whether it is set the same way as `other`, link and all.
    #[must_use]
    pub fn same_setting(&self, other: &Self) -> bool {
        self.bold == other.bold
            && self.italic == other.italic
            && self.underline == other.underline
            && self.strike == other.strike
            && self.code == other.code
            && self.link == other.link
    }
}

impl Picture {
    /// How many bytes its thumbnail holds, decoded, if it has one that is a
    /// picture this format allows.
    #[must_use]
    pub fn thumb_weight(&self) -> Option<usize> {
        let (kind, encoded) = self
            .thumb
            .as_deref()?
            .strip_prefix("data:image/")?
            .split_once(";base64,")?;
        if !THUMB_KINDS.contains(&kind) {
            return None;
        }
        let padding = encoded.bytes().rev().take_while(|byte| *byte == b'=').count();
        Some((encoded.len() * 3 / 4).saturating_sub(padding))
    }

    /// Its thumbnail's bytes, if it has one that reads.
    #[must_use]
    pub fn thumb_bytes(&self) -> Option<Vec<u8>> {
        use base64::Engine as _;
        let _allowed = self.thumb_weight()?;
        let (_, encoded) = self.thumb.as_deref()?.split_once(";base64,")?;
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .ok()
            .filter(|bytes| !bytes.is_empty())
    }

    /// `bytes`, a JPEG, as a thumbnail's `data:` address.
    #[must_use]
    pub fn thumb_address(bytes: &[u8]) -> String {
        use base64::Engine as _;
        format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    }
}
