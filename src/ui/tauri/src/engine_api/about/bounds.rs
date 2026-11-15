//! How much an about, or a text of a full profile, may hold.
//!
//! Every reader cuts what it reads to these limits and every writer cuts what
//! it writes, so a hostile profile costs a reader no more than a friendly one.

use super::model::{Block, Picture, Run};

/// The most a list of blocks may hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Blocks.
    pub blocks: usize,
    /// Characters of text, in all.
    pub text: usize,
    /// Runs in one block, or in one item of a list.
    pub runs: usize,
    /// Items in one list.
    pub items: usize,
    /// Pictures, in all.
    pub pictures: usize,
    /// Pictures in one row.
    pub row: usize,
    /// Bytes of one thumbnail, decoded.
    pub thumb: usize,
    /// Bytes of thumbnails, in all, decoded.
    pub thumbs: usize,
}

impl Limits {
    /// What a card's about may hold: it rides in every comment.
    pub const CARD: Self = Self {
        blocks: 32,
        text: 3000,
        runs: 48,
        items: 12,
        pictures: 6,
        row: 3,
        thumb: 4096,
        thumbs: 12_288,
    };

    /// What a text of a full profile may hold: it is fetched on purpose.
    pub const PAGE: Self = Self {
        blocks: 128,
        text: 20_000,
        runs: 48,
        items: 32,
        pictures: 24,
        row: 4,
        thumb: 8192,
        thumbs: 196_608,
    };

    /// The longest address a link may have, in bytes.
    pub const LINK: usize = 1024;

    /// The longest key of a file in the server's store, in bytes.
    pub const KEY: usize = 256;

    /// The longest side of a thumbnail, in pixels.
    pub const THUMB_EDGE: u32 = 160;

    /// The longest description of a picture, in characters.
    pub const ALT: usize = 200;

    /// `blocks` cut to these limits: what is past them left out, what is
    /// not allowed (a link that is not to the web, a thumbnail that is not a
    /// picture) taken off, and blocks left with nothing in them dropped.
    #[must_use]
    pub fn bound(self, blocks: impl IntoIterator<Item = Block>) -> Vec<Block> {
        let mut budget = Budget::new(self);
        blocks
            .into_iter()
            .filter_map(|block| budget.take(block))
            .take(self.blocks)
            .collect()
    }
}

/// Whether `address` is one a profile may link to: the web, and nothing
/// that could end the attribute it is written into.
pub(super) fn linkable(address: &str) -> bool {
    (address.starts_with("https://") || address.starts_with("http://"))
        && address.len() <= Limits::LINK
        && !address.contains(|c: char| c.is_whitespace() || "\"<>`".contains(c))
}

/// What is left to spend while blocks are taken in.
struct Budget {
    limits: Limits,
    text: usize,
    pictures: usize,
    thumbs: usize,
}

impl Budget {
    const fn new(limits: Limits) -> Self {
        Self {
            limits,
            text: limits.text,
            pictures: limits.pictures,
            thumbs: limits.thumbs,
        }
    }

    /// `block`, cut to what is left; `None` if nothing of it is.
    fn take(&mut self, block: Block) -> Option<Block> {
        let block = match block {
            Block::Heading { text, align } => Block::Heading {
                text: self.text(text),
                align,
            },
            Block::Text { runs, align } => Block::Text {
                runs: self.runs(runs),
                align,
            },
            Block::Quote { runs } => Block::Quote {
                runs: self.runs(runs),
            },
            Block::List {
                numbered,
                items,
                align,
            } => Block::List {
                numbered,
                align,
                items: items
                    .into_iter()
                    .take(self.limits.items)
                    .map(|runs| self.runs(runs))
                    .filter(|runs| !runs.is_empty())
                    .collect(),
            },
            Block::Divider => Block::Divider,
            Block::Pictures { pictures } => Block::Pictures {
                pictures: pictures
                    .into_iter()
                    .take(self.limits.row)
                    .filter_map(|picture| self.picture(picture))
                    .collect(),
            },
        };
        (!block.is_empty()).then_some(block)
    }

    fn text(&mut self, text: String) -> String {
        let count = text.chars().count();
        if count <= self.text {
            self.text -= count;
            return text;
        }
        let cut = text.chars().take(self.text).collect();
        self.text = 0;
        cut
    }

    fn runs(&mut self, runs: Vec<Run>) -> Vec<Run> {
        runs.into_iter()
            .take(self.limits.runs)
            .filter_map(|run| self.run(run))
            .collect()
    }

    fn run(&mut self, mut run: Run) -> Option<Run> {
        run.link = run.link.filter(|link| linkable(link));
        run.text = self.text(run.text);
        (!run.text.is_empty()).then_some(run)
    }

    fn picture(&mut self, mut picture: Picture) -> Option<Picture> {
        if self.pictures == 0 {
            return None;
        }
        picture.key = picture
            .key
            .filter(|key| !key.is_empty() && key.len() <= Limits::KEY);
        let weight = picture.thumb_weight();
        if weight.is_none_or(|weight| weight > self.limits.thumb || weight > self.thumbs) {
            picture.thumb = None;
        }
        if picture.thumb.is_none() && picture.key.is_none() {
            return None;
        }
        if picture.thumb.is_some() {
            self.thumbs -= weight.unwrap_or_default();
        }
        picture.alt = picture.alt.chars().take(Limits::ALT).collect();
        self.pictures -= 1;
        Some(picture)
    }
}
