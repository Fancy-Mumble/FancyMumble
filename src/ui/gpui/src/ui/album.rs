//! Several pictures shared in one message, drawn as the web client draws
//! them (`AttachmentGallery`): one block of tiles rather than a stack of
//! pictures and cards.
//!
//! Two side by side keep a landscape shape; three are two squares over one
//! that spans the block; from four up they are squares, two to a row, and
//! past four the fourth is dimmed under a "+n" that shows the rest. Each
//! tile is the whole picture, centred over a blurred, dimmed copy of itself
//! that fills what it does not reach. Over the block's upper left a chip
//! says what the batch is ("11 items · 31 MiB · 6d left"), over its upper
//! right "Save all" saves every picture into one folder, and on each tile
//! the flag that copies its link where it has one. A click opens a tile
//! large, and the lightbox steps through the album.
//!
//! Tiles are drawn from the small copies fetched for the conversation
//! (`Fit::Tile`); nothing full-size is read for a block.

use std::collections::HashSet;
use std::sync::Arc;

use gpui::{
    AnyElement, Context, Global, IntoElement, ParentElement, SharedString, Styled, div, prelude::*,
    px,
};

use super::Shell;
use super::kit::icon;
use super::kit::over_picture::{FactsChip, OverButton};
use super::shared_picture::{coarse, expired, now_secs};
use crate::engine::{Attachment, OpenTo};
use crate::theme::Theme;
use crate::words::t;

/// How wide the block is: `GRID_W`.
const WIDE: f32 = 460.0;
/// The gap between tiles.
const GAP: f32 = 4.0;
/// How many tiles a block draws before the rest go behind a "+n".
pub(crate) const TILE_CAP: usize = 4;

/// Whether `file` is something a tile can be a picture of.
pub(crate) fn tileable(file: &Attachment) -> bool {
    if file.voice.is_some() {
        return false;
    }
    let name = file.name.to_ascii_lowercase();
    file.pixels.is_some()
        || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]
            .iter()
            .any(|ending| name.ends_with(ending))
}

/// The size of tile `nth` of `count` shown (`tileAspect`).
pub(crate) fn tile_size(count: usize, nth: usize) -> (f32, f32) {
    let half = (WIDE - GAP) / 2.0;
    match (count, nth) {
        (2, _) => (half, half * 2.0 / 3.0),
        (3, 2) => (WIDE, WIDE / 2.0),
        _ => (half, half),
    }
}

/// What the chip over the block says (`batchSummary`): how many, how heavy,
/// how long until the first of them goes.
pub(crate) fn summary(files: &[&Attachment], now: u64) -> Vec<SharedString> {
    let bytes: u64 = files.iter().filter_map(|file| file.size).sum();
    let soonest = files.iter().filter_map(|file| file.expires_at).min();
    let left = soonest
        .and_then(|at| at.checked_sub(now))
        .filter(|left| *left > 0)
        .map(|left| t!("{{duration}} left", duration = coarse(left)));
    [
        Some(t!("{{count}} items", count = files.len())),
        Some(SharedString::from(super::size_in_words(bytes))),
        left,
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// Where a tile stands: its message and its place among the message's
/// files, its size, how many it hides behind a "+n", and its album.
struct Tile<'a> {
    index: usize,
    at: usize,
    size: (f32, f32),
    more: Option<usize>,
    album: &'a [Attachment],
    nth: usize,
    name: &'a SharedString,
}

/// The albums a "+n" was pressed on, by message, so they show every tile.
#[derive(Default)]
struct Unfolded(HashSet<SharedString>);

impl Global for Unfolded {}

/// What names the album of message `index` among the unfolded ones.
fn album_name(shell: &Shell, index: usize) -> SharedString {
    shell
        .messages
        .get(index)
        .and_then(|message| message.id.clone())
        .unwrap_or_else(|| SharedString::from(format!("row-{index}")))
}

impl Shell {
    /// The block of tiles for `files`, the pictures message `index` shares,
    /// each with where it stands among the message's files.
    pub(super) fn album(
        &self,
        index: usize,
        files: &[(usize, &Attachment)],
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let name = album_name(self, index);
        let unfolded = cx
            .try_global::<Unfolded>()
            .is_some_and(|unfolded| unfolded.0.contains(&name));
        let shown = if unfolded {
            files.len()
        } else {
            files.len().min(TILE_CAP)
        };
        let hidden = files.len() - shown;
        let album: Vec<Attachment> = files.iter().map(|(_, file)| (*file).clone()).collect();
        let tiles = files
            .iter()
            .take(shown)
            .enumerate()
            .map(|(nth, (at, file))| {
                let (width, height) = tile_size(shown, nth);
                let more = (hidden > 0 && nth + 1 == shown).then_some(hidden);
                self.album_tile(
                    file,
                    &Tile {
                        index,
                        at: *at,
                        size: (width, height),
                        more,
                        album: &album,
                        nth,
                        name: &name,
                    },
                    theme,
                    cx,
                )
            });
        let all: Vec<&Attachment> = files.iter().map(|(_, file)| *file).collect();
        div()
            .id(("album", index))
            .debug_selector(move || format!("album-{index}"))
            .relative()
            .flex_none()
            .w(px(WIDE))
            .flex()
            .flex_wrap()
            .gap(px(GAP))
            .children(tiles)
            .child(
                div()
                    .absolute()
                    .left(px(8.0))
                    .top(px(8.0))
                    .child(FactsChip::new(summary(&all, now_secs()))),
            )
            .child(
                div().absolute().right(px(8.0)).top(px(8.0)).child(
                    OverButton::new(("save-all", index), t!("Save all"))
                        .named(format!("save-all-{index}"))
                        .on_click(cx.listener(move |shell, _, _, cx| shell.save_album(index, cx))),
                ),
            )
            .into_any_element()
    }

    /// One tile: the picture over its blurred self, or what stands for one
    /// that cannot be shown; the flag that copies its link; and over the
    /// last tile shown, `more` hidden behind a "+n".
    fn album_tile(
        &self,
        file: &Attachment,
        place: &Tile<'_>,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Tile {
            index,
            at,
            size: (width, height),
            more,
            album,
            nth,
            name,
        } = *place;
        use crate::pictures::{Fit, shown};
        let gone = expired(file, now_secs());
        let picture = file
            .shown_from()
            .filter(|_| !gone)
            .and_then(|from| self.panels.shared.get(from)?.clone());
        let corner = px(8.0);
        let mut tile = div()
            .id(("album-tile", index * 16 + at))
            .debug_selector(move || format!("album-tile-{index}-{at}"))
            .relative()
            .flex_none()
            .w(px(width))
            .h(px(height))
            .rounded(corner)
            .overflow_hidden()
            .bg(theme.c.card2);
        tile = match &picture {
            Some(picture) => {
                let opened = Arc::clone(picture);
                let items = album.to_vec();
                tile.cursor_pointer()
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        shell.open_album_large(&items, nth, &opened, cx);
                    }))
                    .child(
                        // The picture again, blurred and dimmed, filling the tile.
                        gpui::img(shown(picture, Fit::Wall(18)))
                            .absolute()
                            .size_full()
                            .rounded(corner)
                            .object_fit(gpui::ObjectFit::Cover),
                    )
                    .child(
                        div()
                            .absolute()
                            .size_full()
                            .rounded(corner)
                            .bg(gpui::rgba(0x0000_0061)),
                    )
                    .child(
                        gpui::img(shown(picture, Fit::Tile))
                            .absolute()
                            .size_full()
                            .object_fit(gpui::ObjectFit::Contain),
                    )
            }
            None => {
                let glyph = match (gone, file.open_to) {
                    (true, _) => "clock",
                    (false, OpenTo::Password) => "lock",
                    (false, _) => "image",
                };
                tile.flex()
                    .items_center()
                    .justify_center()
                    .child(icon(glyph, 28.0, theme.c.dim))
            }
        };
        if let Some(flag) = self.reach_flag(file, (index, at), true, cx) {
            tile = tile.child(div().absolute().left(px(8.0)).bottom(px(8.0)).child(flag));
        }
        if let Some(more) = more {
            let name = name.clone();
            tile = tile.child(
                div()
                    .id(("album-more", index))
                    .debug_selector(move || format!("album-more-{index}"))
                    .absolute()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(gpui::rgba(0x090b_1199))
                    .text_color(gpui::rgba(0xf2f4_f9ff))
                    .text_size(px(18.0))
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .cursor_pointer()
                    .tooltip(super::kit::keyed_tip(
                        t!("Show all {{count}} items", count = album.len()),
                        None::<&str>,
                    ))
                    .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .on_click(cx.listener(move |_, _, _, cx| {
                        cx.stop_propagation();
                        let _ = cx.default_global::<Unfolded>().0.insert(name.clone());
                        cx.notify();
                    }))
                    .child(SharedString::from(format!("+{more}"))),
            );
        }
        tile.into_any_element()
    }

    /// Ask for a folder, and save every picture of message `index`'s album
    /// into it under its own name. One sealed with a password is left out:
    /// its own card asks for its password.
    fn save_album(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(message) = self.messages.get(index) else {
            return;
        };
        let files: Vec<(SharedString, SharedString)> = message
            .files
            .iter()
            .filter(|file| tileable(file) && file.open_to != OpenTo::Password)
            .filter_map(|file| Some((file.key.clone()?, file.name.clone())))
            .collect();
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some(t!("Save all")),
        });
        cx.spawn(async move |shell, cx| {
            let Ok(Ok(Some(mut folders))) = chosen.await else {
                return;
            };
            let Some(folder) = folders.pop() else { return };
            let _ = shell.update(cx, |shell, _| {
                for (key, name) in files {
                    shell.engine.save_file(key, folder.join(name.as_ref()));
                }
            });
        })
        .detach();
    }
}
