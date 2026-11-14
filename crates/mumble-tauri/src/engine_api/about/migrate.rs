//! Turning a profile of the older format, HTML after the mark, into an
//! about: what its owner asks for, never done to somebody else's.

use super::bounds::Limits;
use super::model::{About, Block, Picture};
use super::page::{Page, Section};
use super::reader::Reader;
use super::tags::Tokens;
use super::thumb::Thumbnailer;

/// A picture that was pasted into the HTML whole.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Embedded {
    /// Its bytes, as they were pasted.
    pub bytes: Vec<u8>,
}

/// A profile's HTML, read as blocks.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Migration {
    /// Everything that was read, up to a full profile's limits. Its
    /// pictures stand in the order of `embedded`, one for one.
    pub about: About,
    /// The pictures pasted in, whole, in the order they stand.
    pub embedded: Vec<Embedded>,
}

impl Migration {
    /// Read `html`: a bio, or a whole comment with its profile's mark.
    #[must_use]
    pub fn read(html: &str) -> Self {
        let mut reader = Reader::default();
        Tokens::new(html).for_each(|token| reader.token(token));
        let (about, embedded) = reader.finish();
        Self {
            about,
            embedded: embedded
                .into_iter()
                .map(|bytes| Embedded { bytes })
                .collect(),
        }
    }

    /// Give each picture a thumbnail, all of them together within `room`
    /// bytes. A picture that cannot be read here gets none.
    pub fn thumbnail(&mut self, room: usize) {
        let mut maker = Thumbnailer::new(room, self.embedded.len());
        for (picture, embedded) in self.about.pictures_mut().zip(&self.embedded) {
            if let Some(thumb) = maker.thumb(&embedded.bytes) {
                picture.thumb = Some(thumb.address);
                picture.width = thumb.width;
                picture.height = thumb.height;
            }
        }
    }

    /// Note that the full picture `at`, counted in order, is kept in the
    /// server's file store under `key`, `size` bytes long.
    pub fn kept(&mut self, at: usize, key: String, size: u64) {
        if let Some(picture) = self.about.pictures_mut().nth(at) {
            picture.key = Some(key);
            picture.size = Some(size);
        }
    }

    /// The about for the card: as much as its limits hold.
    #[must_use]
    pub fn card(&self) -> About {
        self.about.clone().bounded(Limits::CARD)
    }

    /// Whether the card leaves out text that was read.
    #[must_use]
    pub fn cut(&self) -> bool {
        let words = |about: &About| {
            about
                .blocks
                .iter()
                .filter(|block| !matches!(block, Block::Pictures { .. }))
                .map(words_in)
                .sum::<usize>()
        };
        words(&self.card()) < words(&self.about)
    }

    /// How many pictures the card cannot keep: no thumbnail, and not kept
    /// in the file store.
    #[must_use]
    pub fn lost(&self) -> usize {
        self.embedded.len() - self.card().pictures().count()
    }

    /// The full profile it makes, headed `text` and `gallery`: the whole
    /// text where the card had to cut it, and the pictures kept in the file
    /// store. Empty when it would add nothing to the card.
    #[must_use]
    pub fn page(&self, text: &str, gallery: &str) -> Page {
        let mut sections = Vec::new();
        if self.cut() {
            let blocks = self
                .about
                .blocks
                .iter()
                .filter(|block| !matches!(block, Block::Pictures { .. }))
                .cloned();
            sections.push(Section::Text {
                title: text.to_owned(),
                blocks: Limits::PAGE.bound(blocks),
            });
        }
        let kept: Vec<Picture> = self
            .about
            .pictures()
            .filter(|picture| picture.key.is_some())
            .cloned()
            .collect();
        if !kept.is_empty() {
            sections.push(Section::Gallery {
                title: gallery.to_owned(),
                pictures: kept,
            });
        }
        Page { sections }
    }
}

/// How many characters of text a block holds.
fn words_in(block: &Block) -> usize {
    let runs = |runs: &[super::model::Run]| runs.iter().map(|run| run.text.chars().count()).sum();
    match block {
        Block::Heading { text, .. } => text.chars().count(),
        Block::Text { runs: held, .. } | Block::Quote { runs: held } => runs(held),
        Block::List { items, .. } => items.iter().map(|item| runs(item)).sum::<usize>(),
        Block::Divider | Block::Pictures { .. } => 0,
    }
}
