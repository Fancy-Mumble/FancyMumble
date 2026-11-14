//! A page in a box it may be longer than.
//!
//! Drawn whole, a page is built and laid out from its first block to its
//! last on every frame it is on screen, scrolled or not: a long welcome
//! cost a frame of 16 ms at any scroll, against 3 ms for a short one. So
//! the first frame draws it whole, in a box that scrolls, and finds out
//! whether it is longer than the box; from then on a long page is drawn as
//! a list of its blocks, of which only those in view are built. What is
//! kept for that (the box's handle, the list and its measured blocks) is
//! kept beside the page and let go of with it.

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;

use gpui::{App, Global, ListAlignment, ListState, ScrollHandle, px};

use crate::page::Page;

/// How far past the box the list builds blocks, so a block scrolled into
/// view was laid out already.
const OVERDRAW: f32 = 400.0;

/// What is kept for one page shown in a box.
#[derive(Clone)]
pub(crate) struct Scrolled {
    scroll: ScrollHandle,
    list: ListState,
    /// Whether the page is longer than its box, once a frame has said.
    long: Rc<Cell<Option<bool>>>,
}

impl std::fmt::Debug for Scrolled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Scrolled")
            .field("long", &self.long.get())
            .finish_non_exhaustive()
    }
}

/// Every page shown in a box, while it is held anywhere else.
#[derive(Default)]
struct Kept(Vec<(std::sync::Weak<Page>, Scrolled)>);

impl Global for Kept {}

impl Scrolled {
    /// What is kept for `page`, made the first time it is asked for.
    pub(crate) fn of(page: &Arc<Page>, cx: &mut App) -> Self {
        let kept = cx.default_global::<Kept>();
        kept.0.retain(|(held, _)| held.strong_count() > 0);
        if let Some((_, scrolled)) = kept
            .0
            .iter()
            .find(|(held, _)| std::ptr::eq(held.as_ptr(), Arc::as_ptr(page)))
        {
            return scrolled.clone();
        }
        let scrolled = Self {
            scroll: ScrollHandle::new(),
            list: ListState::new(page.blocks.len(), ListAlignment::Top, px(OVERDRAW)),
            long: Rc::default(),
        };
        kept.0.push((Arc::downgrade(page), scrolled.clone()));
        scrolled
    }

    /// Whether the page is longer than its box: `None` until a frame has
    /// laid it out whole in the box that [`Self::scroll`] follows.
    pub(crate) fn long(&self) -> Option<bool> {
        if let Some(long) = self.long.get() {
            return Some(long);
        }
        if self.scroll.bounds().size.height <= px(0.0) {
            return None;
        }
        let long = self.scroll.max_offset().height > px(0.5);
        self.long.set(Some(long));
        Some(long)
    }

    /// The handle of the box the page is first drawn whole in.
    pub(crate) fn scroll(&self) -> &ScrollHandle {
        &self.scroll
    }

    /// The list a long page is drawn as.
    pub(crate) fn list(&self) -> ListState {
        self.list.clone()
    }
}
