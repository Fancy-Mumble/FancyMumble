//! A picture a message names by its web address, a GIF somebody picked
//! among them, drawn under the message.
//!
//! Where it is a copy a connected server announced as its own (its GIF
//! service's address), it reaches nobody new and is fetched at once, as
//! the web client loads it. Anything else is a third party, which would
//! learn who reads the message and when: it waits behind "Load content",
//! as a picture a link leads to does, unless its host was trusted. Either
//! way it is fetched into the store of what links show, within its
//! budget, and drawn a frame at a time.

use std::sync::Arc;

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::super::Shell;
use super::super::embeds::{Asking, ROOM, Showing, Want, gate};
use crate::pictures::{Fit, shown};
use crate::theme::Theme;
use crate::words::t;

/// The most pictures of one message drawn: what a message says beyond is
/// not worth fetching.
const MOST: usize = 4;

impl Shell {
    /// The pictures message `index` names on the web, or what stands for
    /// them.
    pub(in crate::ui) fn web_pictures(
        &mut self,
        index: usize,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let Some(urls) = self
            .bodies
            .get(&index)
            .map(|body| {
                body.web_pictures()
                    .iter()
                    .take(MOST)
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .filter(|urls| !urls.is_empty())
        else {
            return Vec::new();
        };
        // What the server on screen announces is known before it is asked.
        let _ = self.gif_plan();
        let mut asking: Vec<SharedString> = Vec::new();
        let mut drawn = Vec::new();
        for (at, url) in urls.into_iter().enumerate() {
            let url = SharedString::from(url);
            let trusted = self.panels.gifs.is_a_servers_own(&url)
                || crate::embed::host_of(&url)
                    .is_some_and(|host| self.panels.links.trusted.contains(&host));
            if self.panels.embeds.wants(&url, trusted) {
                self.fetch_embed(url.clone(), Want::Picture, cx);
            }
            match self.panels.embeds.showing(&url, trusted) {
                Showing::Picture(picture) => drawn.push(tile(&picture, index, at, cx)),
                Showing::Ask => asking.push(url),
                Showing::Waiting => drawn.push(note(index, at, t!("Loading the picture…"), theme)),
                Showing::Refused(why) => drawn.push(note(
                    index,
                    at,
                    t!("The picture cannot be shown: {{why}}", why = why),
                    theme,
                )),
            }
        }
        // One question for all that wait for it.
        if let Some(first) = asking.first() {
            let host = crate::embed::host_of(first).unwrap_or_default();
            let what = if asking.len() == 1 {
                format!("Picture from {host}")
            } else {
                format!("{} pictures from {host} and elsewhere", asking.len())
            };
            let asked = Asking {
                index,
                what,
                host: &host,
            };
            drawn.push(gate(&asked, theme, cx, move |shell, _, cx| {
                shell.load_embeds(asking.clone(), cx);
            }));
        }
        drawn
    }
}

/// A picture, in the room its file says it takes; a click opens it large.
fn tile(
    picture: &Arc<gpui::Image>,
    index: usize,
    at: usize,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let natural = crate::picture::dimensions(picture.bytes());
    let (width, height) = natural.map_or(ROOM, |natural| crate::picture::fitted(natural, ROOM));
    let opened = Arc::clone(picture);
    div()
        .id(("web-picture", index * MOST + at))
        .debug_selector(move || format!("web-picture-{index}-{at}"))
        .flex_none()
        .w(px(width))
        .h(px(height))
        .cursor_pointer()
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.lightbox = Some(Arc::clone(&opened));
            cx.notify();
        }))
        .child(
            gpui::img(shown(picture, Fit::Tile))
                .size_full()
                .object_fit(gpui::ObjectFit::Contain),
        )
        .into_any_element()
}

/// A quiet line where a picture is on its way, or could not be had.
fn note(index: usize, at: usize, said: SharedString, theme: &Theme) -> AnyElement {
    div()
        .debug_selector(move || format!("web-picture-note-{index}-{at}"))
        .max_w(px(ROOM.0))
        .text_size(px(12.0))
        .text_color(theme.c.dim)
        .child(said)
        .into_any_element()
}
