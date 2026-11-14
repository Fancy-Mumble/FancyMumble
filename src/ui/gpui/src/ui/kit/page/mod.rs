//! A page a server or a user wrote (see `crate::page`), drawn: the
//! component a welcome message and a channel's description are shown in.
//!
//! ```ignore
//! PageView::new("welcome", page, Surface::text(13.0, 1.55, &theme))
//!     .on_link(move |url, _, cx| { /* ask before leaving */ })
//! ```
//!
//! It takes the page as read (an `Arc`, shared with whoever keeps it) and
//! holds nothing of its own: what it draws is built again each frame from
//! the page, and pictures are drawn through `crate::pictures`, which keeps
//! a copy at the size they are seen and lets it go when they are not. A
//! view lets go of a page by dropping its `Arc`.
//!
//! Text cannot be selected here, as it cannot in the conversation.

#[cfg(test)]
mod audit;
mod boxes;
pub(crate) mod ink;
mod lists;
mod natural;
mod text;

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

use gpui::{
    AnyElement, App, Div, ElementId, Hsla, IntoElement, ParentElement, RenderOnce, SharedString,
    Styled, Window, div, prelude::*, px,
};

use crate::page::{Block, Frame, Ink, Kind, Look, Page};
use crate::theme::{ActiveTheme, Theme};

/// What a page is drawn on: the size, the line and the ink of its text,
/// and the ink of its links, as the surface showing it sets them.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Surface {
    /// The size its text is set in, in pixels.
    pub size: f32,
    /// How tall a line is, as a multiple of its text.
    pub lead: f32,
    pub ink: Hsla,
    pub link: Hsla,
    /// What the page is drawn on, opaque: what its text has to read on
    /// where the document sets no ground of its own.
    pub ground: Hsla,
}

impl Surface {
    /// Text `size` high on lines `lead` times that, in the theme's ink, its
    /// links in the accent, on the theme's window.
    pub(crate) fn text(size: f32, lead: f32, theme: &Theme) -> Self {
        Self {
            size,
            lead,
            ink: theme.c.text,
            link: theme.c.accent_text,
            ground: theme.c.bg0,
        }
    }

    /// The same, in `ink`.
    pub(crate) fn inked(self, ink: Hsla) -> Self {
        Self { ink, ..self }
    }
}

/// What is done with a link that is clicked: asked about, as a rule.
type Follow = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;

/// A page, drawn.
#[derive(IntoElement)]
pub(crate) struct PageView {
    id: SharedString,
    page: Arc<Page>,
    surface: Surface,
    follow: Option<Follow>,
}

impl PageView {
    /// `page` on `surface`, its parts named after `id`.
    pub(crate) fn new(id: impl Into<SharedString>, page: Arc<Page>, surface: Surface) -> Self {
        Self {
            id: id.into(),
            page,
            surface,
            follow: None,
        }
    }

    /// Hand a link that is clicked to `follow`. Without it a link is not
    /// followed at all.
    pub(crate) fn on_link(
        mut self,
        follow: impl Fn(SharedString, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.follow = Some(Rc::new(follow));
        self
    }
}

impl RenderOnce for PageView {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let painter = Painter {
            text: window.text_system().clone(),
            id: self.id.clone(),
            surface: self.surface,
            theme: &theme,
            follow: self.follow.clone(),
            next: Cell::new(0),
            counted: RefCell::default(),
            grounds: ink::Grounds::new(&theme, self.surface),
            families: {
                let mut families = boxes::Families::take(cx);
                families.learn(boxes::stacks(&self.page.blocks).into_iter(), cx);
                families
            },
        };
        let element = div()
            .debug_selector(move || format!("page-{}", self.id))
            .w_full()
            .flex()
            .flex_col()
            .text_size(px(self.surface.size))
            .text_color(self.surface.ink)
            .children(painter.stack(&self.page.blocks, (true, true)));
        painter.families.give_back(cx);
        element
    }
}

/// Draws one page, once.
pub(super) struct Painter<'a> {
    /// Shapes text, to measure a table nobody gave a width.
    text: Rc<gpui::WindowTextSystem>,
    id: SharedString,
    surface: Surface,
    theme: &'a Theme,
    follow: Option<Follow>,
    /// The number the next named part takes.
    next: Cell<usize>,
    /// How many parts of each kind have been tagged, for tests to find.
    counted: RefCell<HashMap<&'static str, usize>>,
    /// What the part being drawn stands on, and the colours it is drawn in.
    grounds: ink::Grounds<'a>,
    families: boxes::Families,
}

impl Painter<'_> {
    /// A name for a part that needs one, unique in the page.
    fn name(&self) -> ElementId {
        let next = self.next.get();
        self.next.set(next + 1);
        ElementId::NamedInteger(self.id.clone(), next as u64)
    }

    /// The tag a test finds the next part of `kind` by:
    /// `page-<id>-<kind>-<n>`, counted from nought.
    fn tag(&self, kind: &'static str) -> String {
        let mut counted = self.counted.borrow_mut();
        let count = counted.entry(kind).or_default();
        let tag = format!("page-{}-{kind}-{count}", self.id);
        *count += 1;
        tag
    }

    /// The colour `ink` is here.
    fn ink(&self, ink: Ink) -> Hsla {
        self.grounds.ink(ink)
    }

    /// Draw `content` standing on the ground `frame` gives, if it gives one.
    fn grounded_by<T>(&self, frame: &Frame, content: impl FnOnce() -> T) -> T {
        self.grounds.within(frame, content)
    }

    /// The colour a run set as `look` is drawn in, made to read on what it
    /// stands on.
    fn text_ink(&self, look: &Look) -> Hsla {
        self.grounds.text(look)
    }

    /// `blocks` one under another, the room between two the larger of
    /// what each asks for, as a browser folds margins. Where a box keeps
    /// its edges (`kept`: above, below) the room the first and last ask for
    /// is inside it; elsewhere it was taken out to the box around.
    fn stack(&self, blocks: &[Block], kept: (bool, bool)) -> Vec<AnyElement> {
        let base = self.surface.size;
        let count = blocks.len();
        let mut above = 0.0_f32;
        blocks
            .iter()
            .enumerate()
            .map(|(at, block)| {
                let (top, bottom) = boxes::margins(block, base);
                let room = if at == 0 && !kept.0 {
                    0.0
                } else {
                    above.max(top)
                };
                above = bottom;
                let last = at + 1 == count;
                let element = self.block(block);
                // A table that is as wide as its words stands in a row of its
                // own, where its width can give way to the room's.
                let column = !block_shrinks(block);
                div()
                    .flex_none()
                    .flex()
                    .when(column, Styled::flex_col)
                    .mt(px(room))
                    .when(last && kept.1, |held| held.mb(px(bottom)))
                    .child(element)
                    .into_any_element()
            })
            .collect()
    }

    /// One block in its box.
    fn block(&self, block: &Block) -> AnyElement {
        if let Kind::Picture(picture) = &block.kind {
            return self.picture(picture, &block.frame);
        }
        let tag = self.tag("block");
        let content: Vec<AnyElement> = self.grounded_by(&block.frame, || match &block.kind {
            Kind::Para(para) => vec![self.para(para)],
            Kind::Stack(blocks) => self.stack(blocks, boxes::keeps_edges(&block.frame)),
            Kind::Row(row) => vec![self.row(row)],
            Kind::List(items) => vec![self.list(items, block.frame.padding.left)],
            Kind::Table(table) => vec![self.table(table, &block.frame)],
            Kind::Rule | Kind::Picture(_) => Vec::new(),
        });
        let listed = matches!(block.kind, Kind::List(_));
        let shrinks = block_shrinks(block);
        let part = self
            .framed(
                div().debug_selector(move || tag).flex().flex_col(),
                &block.frame,
                listed,
                shrinks,
            )
            // As wide as its words where they fit in its room, as wide as
            // its room where they do not, and never narrower than its
            // longest word.
            .when(shrinks, |part| {
                part.flex_basis(px(self.natural_box(block).ceil()))
                    .flex_shrink_1()
            })
            .children(content);
        self.linked(part, block.frame.link.as_ref())
    }

    /// Hand a click on `part` to the link it leads to.
    fn linked(&self, part: Div, to: Option<&Arc<str>>) -> AnyElement {
        let (Some(to), Some(follow)) = (to, self.follow.clone()) else {
            return part.into_any_element();
        };
        let to = SharedString::from(to.to_string());
        let tip = to.clone();
        let tag = self.tag("link");
        part.debug_selector(move || tag)
            .id(self.name())
            .cursor_pointer()
            .tooltip(move |window, cx| super::keyed_tip(tip.clone(), None::<&str>)(window, cx))
            .on_click(move |_, window, cx| follow(to.clone(), window, cx))
            .into_any_element()
    }
}

/// Whether a block is only as wide as what is in it, rather than its row:
/// a table nobody gave a width, which is how a browser lays one out.
fn block_shrinks(block: &Block) -> bool {
    matches!(block.kind, Kind::Table(_)) && block.frame.width == crate::page::Extent::Auto
}
