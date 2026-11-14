//! One block being edited, and the way between blocks and what is edited:
//! a block's words are typed with the composer's marks, a list an item a
//! line, through the engine's one reading of those marks.

use std::rc::Rc;
use std::sync::Arc;

use gpui::{App, AppContext as _, Context, Entity, SharedString};
use mumble_tauri_lib::engine_api::about::{
    About, Align, Block, Limits, Picture, Thumbnailer, runs_of_typed, typed_of_runs,
};

use super::super::Shell;
use super::super::format_bar::FormatBar;
use super::super::text_input::{ReadsMarks, TextInput};
use crate::profile::Shown;
use crate::words::t;

/// The largest picture file taken into an about, in bytes.
const MOST_PICTURE: usize = 32 << 20;

/// The kinds of block there are to add.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Heading,
    Text,
    List,
    Quote,
    Divider,
    Pictures,
}

impl Kind {
    /// Every kind, in the order they are offered.
    pub(crate) const ALL: [Self; 6] = [
        Self::Heading,
        Self::Text,
        Self::List,
        Self::Quote,
        Self::Divider,
        Self::Pictures,
    ];

    /// What it is called.
    pub(crate) fn name(self) -> SharedString {
        match self {
            Self::Heading => t!("Heading"),
            Self::Text => t!("Text"),
            Self::List => t!("List"),
            Self::Quote => t!("Quote"),
            Self::Divider => t!("Divider"),
            Self::Pictures => t!("Pictures"),
        }
    }

    /// What its button for adding one is named, also for the tests.
    pub(crate) const fn add_id(self) -> &'static str {
        match self {
            Self::Heading => "about-add-heading",
            Self::Text => "about-add-text",
            Self::List => "about-add-list",
            Self::Quote => "about-add-quote",
            Self::Divider => "about-add-divider",
            Self::Pictures => "about-add-pictures",
        }
    }

    /// Whether it has words to type.
    const fn typed(self) -> bool {
        !matches!(self, Self::Divider | Self::Pictures)
    }

    /// Whether its words stand where it says.
    pub(crate) const fn aligns(self) -> bool {
        matches!(self, Self::Heading | Self::Text | Self::List)
    }
}

/// A picture of a block being edited: what goes into the about, its
/// thumbnail to draw, and the full picture where it was added here.
pub(crate) struct Pictured {
    pub picture: Picture,
    pub thumb: Option<Arc<gpui::Image>>,
    pub full: Option<Arc<Vec<u8>>>,
}

/// A block being edited.
pub(crate) struct Draft {
    pub kind: Kind,
    /// Where its words are typed, for a kind that has words.
    pub field: Option<Entity<TextInput>>,
    pub align: Align,
    pub numbered: bool,
    pub pictures: Vec<Pictured>,
}

impl Draft {
    /// A new block of `kind`, with `typed` in it.
    pub(crate) fn new(kind: Kind, typed: &str, shell: &Shell, cx: &mut Context<Shell>) -> Self {
        Self {
            kind,
            field: kind.typed().then(|| field(shell, kind, typed, cx)),
            align: Align::Left,
            numbered: false,
            pictures: Vec::new(),
        }
    }

    /// The block it makes, if it says anything.
    fn block(&self, cx: &App) -> Option<Block> {
        let typed = self
            .field
            .as_ref()
            .map(|field| field.read(cx).text().to_owned())
            .unwrap_or_default();
        let block = match self.kind {
            Kind::Heading => Block::Heading {
                text: typed.trim().replace('\n', " "),
                align: self.align,
            },
            Kind::Text => Block::Text {
                runs: runs_of_typed(&typed),
                align: self.align,
            },
            Kind::List => Block::List {
                numbered: self.numbered,
                items: typed
                    .lines()
                    .filter(|line| !line.trim().is_empty())
                    .map(runs_of_typed)
                    .collect(),
                align: self.align,
            },
            Kind::Quote => Block::Quote {
                runs: runs_of_typed(&typed),
            },
            Kind::Divider => Block::Divider,
            Kind::Pictures => Block::Pictures {
                pictures: self.pictures.iter().map(|p| p.picture.clone()).collect(),
            },
        };
        (!block.is_empty()).then_some(block)
    }

    /// Stand its words next where they can: left, the middle, right.
    pub(crate) const fn turn_align(&mut self) {
        self.align = match self.align {
            Align::Left => Align::Center,
            Align::Center => Align::Right,
            Align::Right => Align::Left,
        };
    }

    /// Whether another picture fits in it.
    pub(crate) fn takes_picture(&self) -> bool {
        self.kind == Kind::Pictures && self.pictures.len() < Limits::CARD.row
    }
}

/// A field for a block's words, which sets them as they will be shown, with
/// the bar of marks over what is selected.
fn field(shell: &Shell, kind: Kind, typed: &str, cx: &mut Context<Shell>) -> Entity<TextInput> {
    let engine = Arc::clone(&shell.engine);
    let reads: ReadsMarks = Rc::new(move |text: &str| engine.typed(text));
    let placeholder = match kind {
        Kind::List => t!("An item a line"),
        _ => t!("Write here"),
    };
    let field = cx.new(|cx| {
        let mut field = TextInput::new(placeholder, cx)
            .multiline()
            .setting_marks(reads);
        field.set_text(typed);
        field
    });
    FormatBar::attach(&field, |_, _| {}, cx);
    field
}

/// The blocks of `shown`, to be edited.
pub(super) fn drafts_of(shell: &Shell, shown: &Shown, cx: &mut Context<Shell>) -> Vec<Draft> {
    let mut thumbs = shown.thumbs.iter();
    shown
        .about
        .blocks
        .iter()
        .map(|block| {
            let (kind, typed) = match block {
                Block::Heading { text, .. } => (Kind::Heading, text.clone()),
                Block::Text { runs, .. } => (Kind::Text, typed_of_runs(runs)),
                Block::List { items, .. } => (
                    Kind::List,
                    items
                        .iter()
                        .map(|item| typed_of_runs(item))
                        .collect::<Vec<_>>()
                        .join("\n"),
                ),
                Block::Quote { runs } => (Kind::Quote, typed_of_runs(runs)),
                Block::Divider => (Kind::Divider, String::new()),
                Block::Pictures { .. } => (Kind::Pictures, String::new()),
            };
            let mut draft = Draft::new(kind, &typed, shell, cx);
            match block {
                Block::Heading { align, .. } | Block::Text { align, .. } => draft.align = *align,
                Block::List {
                    numbered, align, ..
                } => {
                    draft.align = *align;
                    draft.numbered = *numbered;
                }
                Block::Pictures { pictures } => {
                    draft.pictures = pictures
                        .iter()
                        .map(|picture| Pictured {
                            picture: picture.clone(),
                            thumb: thumbs.next().cloned().flatten(),
                            full: None,
                        })
                        .collect();
                }
                _ => {}
            }
            draft
        })
        .collect()
}

/// The about `drafts` make, and the full pictures to keep in the server's
/// file store with it (each by its place among the about's pictures) where
/// `keep_full` says to.
pub(super) fn about_of(
    drafts: &[Draft],
    keep_full: bool,
    cx: &App,
) -> (About, crate::profile::Kept) {
    let blocks: Vec<Block> = drafts.iter().filter_map(|draft| draft.block(cx)).collect();
    let keep = drafts
        .iter()
        .flat_map(|draft| &draft.pictures)
        .enumerate()
        .filter_map(|(at, pictured)| Some((at, Arc::clone(pictured.full.as_ref()?))))
        .filter(|_| keep_full)
        .collect();
    (About { blocks }.bounded(Limits::CARD), keep)
}

/// What `drafts` make, ready to draw.
pub(super) fn shown_of(drafts: &[Draft], cx: &App) -> Shown {
    let (about, _) = about_of(drafts, false, cx);
    let thumbs = drafts
        .iter()
        .flat_map(|draft| &draft.pictures)
        .map(|pictured| pictured.thumb.clone())
        .collect();
    Shown { about, thumbs }
}

/// A picture for an about, made from `bytes`: its thumbnail, and the bytes
/// kept for the file store. `None` if it is not a picture that can be read.
pub(super) fn pictured(bytes: Vec<u8>) -> Result<Pictured, String> {
    if bytes.len() > MOST_PICTURE {
        return Err("That picture file is too large.".to_owned());
    }
    let thumb = Thumbnailer::new(Limits::CARD.thumb, 1)
        .thumb(&bytes)
        .ok_or("That is not a picture that can be read.")?;
    let picture = Picture {
        thumb: Some(thumb.address),
        width: thumb.width,
        height: thumb.height,
        ..Picture::default()
    };
    let drawn = picture
        .thumb_bytes()
        .and_then(crate::picture::picture)
        .map(Arc::new);
    Ok(Pictured {
        picture,
        thumb: drawn,
        full: Some(Arc::new(bytes)),
    })
}
