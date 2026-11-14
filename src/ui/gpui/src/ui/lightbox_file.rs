//! A picture shared as a file, opened large: the whole picture, not the
//! conversation's small copy of it.
//!
//! A shared picture is drawn in the conversation from the small copy that
//! stands in for it (480 pixels on its longer side), and that copy was all
//! the lightbox ever had: it was drawn at its own size, never larger, so a
//! photograph opened "large" was a soft thumbnail in a big dark window. Now
//! opening one asks the server for the file itself, once; the small copy
//! stands in the box the whole picture will fill, at the whole picture's
//! size, until it arrives; and when the lightbox closes the whole picture
//! is let go of. Saving it saves the file the server keeps; copying it
//! copies the whole picture.

use std::sync::Arc;

use gpui::{Context, SharedString};

use super::Shell;
use crate::engine::{Attachment, OpenTo};

/// A shared file open large.
#[derive(Debug, Default)]
pub(crate) struct LargeFile {
    /// What the server keeps it under: what is fetched.
    key: SharedString,
    /// What it is called, to save it under.
    name: SharedString,
    /// How large it is, as its sender said.
    pixels: Option<(u32, u32)>,
    /// The small copy it was opened from, which stands in until it comes.
    stand_in: Option<Arc<gpui::Image>>,
    /// The whole picture, once fetched.
    whole: Option<Arc<gpui::Image>>,
    /// Copy it as soon as it comes: Copy was pressed before it had.
    copy_when_whole: bool,
    /// The album it was opened from, and where in it, to step through.
    album: Vec<Attachment>,
    nth: usize,
}

impl LargeFile {
    /// Whether the whole picture is still on its way.
    pub(crate) fn waiting(&self) -> bool {
        self.whole.is_none()
    }
}

impl Shell {
    /// Open the picture `file` large, from `stand_in`, the copy the
    /// conversation shows, and ask for the whole of it.
    pub(super) fn open_shared_large(
        &mut self,
        file: &Attachment,
        stand_in: &Arc<gpui::Image>,
        cx: &mut Context<Self>,
    ) {
        self.lightbox = Some(Arc::clone(stand_in));
        let key = file
            .key
            .clone()
            .filter(|_| file.open_to != OpenTo::Password);
        // The file itself was fetched to be shown: it is the whole already.
        let whole = key
            .as_ref()
            .filter(|key| file.shown_from() == Some(*key))
            .map(|_| Arc::clone(stand_in));
        self.large = key.map(|key| LargeFile {
            key: key.clone(),
            name: file.name.clone(),
            pixels: file.pixels,
            stand_in: Some(Arc::clone(stand_in)),
            whole: whole.clone(),
            copy_when_whole: false,
            album: Vec::new(),
            nth: 0,
        });
        match (&self.large, whole) {
            (Some(large), None) => self.engine.fetch_shared(large.key.clone()),
            (_, Some(whole)) => self.lightbox = Some(whole),
            (None, None) => {}
        }
        cx.notify();
    }

    /// Whether `key`, just fetched, is the whole of the picture open large:
    /// then it is shown in its small copy's place. Says whether it was.
    pub(super) fn took_large_picture(
        &mut self,
        key: &str,
        picture: Option<&Arc<gpui::Image>>,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(large) = self.large.as_mut().filter(|large| large.key == key) else {
            return false;
        };
        let Some(picture) = picture else {
            // Not a picture after all, or gone: the small copy stays.
            return true;
        };
        large.whole = Some(Arc::clone(picture));
        let showing_stand_in = match (&self.lightbox, &large.stand_in) {
            (Some(open), Some(stand_in)) => open.id() == stand_in.id(),
            _ => false,
        };
        if showing_stand_in {
            self.lightbox = Some(Arc::clone(picture));
        }
        if std::mem::take(&mut large.copy_when_whole) {
            cx.write_to_clipboard(gpui::ClipboardItem::new_image(picture));
        }
        cx.notify();
        true
    }

    /// Let go of the whole picture once the lightbox no longer shows it or
    /// its small copy.
    pub(super) fn let_go_of_large(&mut self) {
        let shows = |large: &LargeFile, open: &Arc<gpui::Image>| {
            [&large.stand_in, &large.whole]
                .into_iter()
                .flatten()
                .any(|picture| picture.id() == open.id())
        };
        let keep = match (&self.large, &self.lightbox) {
            (Some(large), Some(open)) => shows(large, open),
            _ => false,
        };
        if !keep {
            self.large = None;
        }
    }

    /// How large the picture `open` is to be shown: the whole picture's
    /// size while its small copy stands in for it.
    pub(super) fn natural_of(&self, open: &gpui::Image) -> Option<(u32, u32)> {
        let standing_in = self.large.as_ref().filter(|large| {
            large
                .stand_in
                .as_ref()
                .is_some_and(|stand_in| stand_in.id() == open.id())
        });
        standing_in
            .and_then(|large| large.pixels)
            .or_else(|| crate::picture::dimensions(open.bytes()))
    }

    /// The shared file open large, if one is.
    pub(super) fn large_file(&self) -> Option<&LargeFile> {
        self.large.as_ref()
    }

    /// Save the file open large as the server keeps it. Says whether one
    /// is open large.
    pub(super) fn save_large(&mut self, cx: &mut Context<Self>) -> bool {
        let Some((key, name)) = self
            .large
            .as_ref()
            .map(|large| (large.key.clone(), large.name.clone()))
        else {
            return false;
        };
        self.save_attachment(key, &name, cx);
        true
    }

    /// Copy the whole of the picture open large, now or once it has come.
    /// Says whether one is open large.
    pub(super) fn copy_large(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(large) = self.large.as_mut() else {
            return false;
        };
        match &large.whole {
            Some(whole) => cx.write_to_clipboard(gpui::ClipboardItem::new_image(whole)),
            None => large.copy_when_whole = true,
        }
        true
    }

    /// Open picture `nth` of `album` large, from `stand_in`, its small copy,
    /// to step through the album from there.
    pub(super) fn open_album_large(
        &mut self,
        album: &[Attachment],
        nth: usize,
        stand_in: &Arc<gpui::Image>,
        cx: &mut Context<Self>,
    ) {
        let Some(file) = album.get(nth) else {
            return;
        };
        self.open_shared_large(file, stand_in, cx);
        if let Some(large) = self.large.as_mut() {
            large.album = album.to_vec();
            large.nth = nth;
        }
    }

    /// The pictures of the album open large that can be stepped to, after
    /// the open one or with `forward` false before it: `None` where none is
    /// open from an album.
    fn album_steps(&self, forward: bool) -> Option<Vec<(usize, Arc<gpui::Image>)>> {
        let large = self.large.as_ref().filter(|large| large.album.len() > 1)?;
        let shown = |nth: usize| {
            let file = large.album.get(nth)?;
            let picture = self.panels.shared.get(file.shown_from()?)?.clone()?;
            Some((nth, picture))
        };
        Some(if forward {
            (large.nth + 1..large.album.len())
                .filter_map(shown)
                .collect()
        } else {
            (0..large.nth).rev().filter_map(shown).collect()
        })
    }

    /// Whether there is a picture of the open album to step to that way;
    /// `None` where none is open from an album.
    pub(super) fn album_has_beyond(&self, forward: bool) -> Option<bool> {
        self.album_steps(forward).map(|steps| !steps.is_empty())
    }

    /// Step to the next picture of the open album, or with `forward` false
    /// the one before. `None` where none is open from an album; else
    /// whether there was one.
    pub(super) fn step_album(&mut self, forward: bool, cx: &mut Context<Self>) -> Option<bool> {
        let (nth, picture) = match self.album_steps(forward)?.into_iter().next() {
            Some(next) => next,
            None => return Some(false),
        };
        let album = self.large.as_ref().map(|large| large.album.clone())?;
        self.panels.looking = super::zoom::View::default();
        self.open_album_large(&album, nth, &picture, cx);
        Some(true)
    }
}
