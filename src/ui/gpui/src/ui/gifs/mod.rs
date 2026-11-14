//! GIFs in the conversation: the chip in the composer that opens the
//! browser, the browser, and a GIF somebody picked, drawn where it was
//! sent.
//!
//! Where they come from, and who learns what of it, is `crate::gif`. The
//! chip is there only when GIFs can be had without reaching anybody the
//! user has not agreed to: the server serves them itself, or the user set
//! a Klipy key of their own. Every picture the browser shows is fetched
//! into the store of what links show (`super::embeds`), held within its
//! budget and let go of when the browser closes.

mod browser;
mod shown;

use std::sync::Arc;

use gpui::Focusable as _;
use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::kit::Reachable;
use crate::embed::{Fetch, Web};
use crate::gif::{Gif, MediaBase, Plan};
use crate::words::t;

#[cfg(test)]
pub(super) use browser::PAUSE;
pub(super) use browser::render;

/// The GIFs of this window: the user's key, the servers' own addresses,
/// and the browser while it is open.
pub(super) struct Gifs {
    /// The user's own Klipy key, from the settings.
    pub(super) key: Option<String>,
    /// The addresses servers announced for their own copies of GIFs this
    /// session: a picture from one is shown without asking.
    bases: Vec<MediaBase>,
    /// What reaches Klipy, with the user's key.
    pub(super) fetch: Arc<dyn Fetch>,
    /// The browser, while it is open.
    browser: Option<browser::Browser>,
}

impl Default for Gifs {
    fn default() -> Self {
        Self::keeping(None)
    }
}

impl Gifs {
    /// With the user's Klipy `key`, if they set one.
    pub(super) fn keeping(key: Option<String>) -> Self {
        Self {
            key: key.filter(|key| !key.trim().is_empty()),
            bases: Vec::new(),
            fetch: Arc::new(Web),
            browser: None,
        }
    }

    /// Whether the browser is open.
    #[cfg(test)]
    pub(super) fn is_open(&self) -> bool {
        self.browser.is_some()
    }

    /// The key to keep in the settings.
    pub(super) fn kept_key(&self) -> Option<String> {
        self.key.clone()
    }

    /// Whether the picture at `url` is a server's own copy: one of the
    /// addresses a server announced serves it.
    fn is_a_servers_own(&self, url: &str) -> bool {
        self.bases.iter().any(|base| base.serves(url))
    }

    /// Remember `base`, which a server announced.
    fn note_base(&mut self, base: Option<MediaBase>) {
        if let Some(base) = base
            && !self.bases.contains(&base)
        {
            self.bases.push(base);
        }
    }
}

impl Shell {
    /// How GIFs are found here now, if they are.
    fn gif_plan(&mut self) -> Option<Plan> {
        let service = self.engine.gif_service();
        if let Some(service) = &service {
            self.panels
                .gifs
                .note_base(service.support.media_base.clone());
        }
        let gifs = &self.panels.gifs;
        Plan::of(
            service.as_ref(),
            gifs.key.as_deref(),
            Arc::clone(&gifs.fetch),
        )
    }

    /// Whether the chip that opens the browser is shown: in a
    /// conversation, where GIFs can be had.
    pub(super) fn offers_gifs(&self) -> bool {
        let service = self.engine.gif_service();
        self.open.is_some()
            && Plan::of(
                service.as_ref(),
                self.panels.gifs.key.as_deref(),
                Arc::clone(&self.panels.gifs.fetch),
            )
            .is_some()
    }

    /// Put the browser away, and let go of what it fetched. Whether it was
    /// open.
    pub(super) fn close_gifs(&mut self, cx: &mut Context<Self>) -> bool {
        let Some(browser) = self.panels.gifs.browser.take() else {
            return false;
        };
        let pictures = self.panels.embeds.forget(&browser.previews);
        let ids: Vec<u64> = pictures.iter().map(|picture| picture.id()).collect();
        crate::pictures::forget(&ids, cx);
        cx.notify();
        true
    }

    /// Use `gif`, picked in the browser, for what the browser was opened
    /// for, and put the browser away.
    fn pick_gif(&mut self, gif: &Gif, window: &mut gpui::Window, cx: &mut Context<Self>) {
        let purpose = self
            .panels
            .gifs
            .browser
            .as_ref()
            .map_or(For::Composer, |browser| browser.purpose);
        // What the browser drew is the size wanted: taken before it goes.
        let held = match self.panels.embeds.showing(&gif.preview, true) {
            super::embeds::Showing::Picture(picture) => Some(picture.bytes().to_vec()),
            _ => None,
        };
        let _ = self.close_gifs(cx);
        match purpose {
            For::Composer => self.send_picked_gif(gif, window, cx),
            For::Picture(then) => self.fetch_gif_picture(gif, held, then, cx),
        }
    }

    /// Send `gif` into the conversation open, answering what is being
    /// answered: as the web client sends a pick, by its address.
    fn send_picked_gif(&mut self, gif: &Gif, window: &mut gpui::Window, cx: &mut Context<Self>) {
        let Some(conversation) = self.open else {
            return;
        };
        let reply_to = self.replying.take().map(|(to, _)| to);
        self.engine
            .send_gif(conversation, gif.url.clone(), reply_to);
        window.focus(&self.composer.focus_handle(cx), cx);
        cx.notify();
    }

    /// Open the browser for a picture of the user's own, a face or the
    /// head of their card, standing above `anchor`: what is picked is
    /// fetched and handed to `then` as its file's bytes. The web client
    /// keeps the bytes, never the address, of the size its grid draws
    /// (`ProfileSettings.tsx`, `pickGif`): a banner that is the provider's
    /// address would make everybody who opens the card fetch it there.
    pub(super) fn pick_gif_picture(
        &mut self,
        anchor: gpui::Point<gpui::Pixels>,
        then: fn(&mut Self, Vec<u8>, &mut Context<Self>),
        window: &mut gpui::Window,
        cx: &mut Context<Self>,
    ) {
        self.open_gifs(anchor, window, cx);
        if let Some(browser) = self.panels.gifs.browser.as_mut() {
            browser.purpose = For::Picture(then);
        }
    }

    /// Hand the bytes of the preview of `gif` to `then`: those `held`, or
    /// fetched.
    fn fetch_gif_picture(
        &mut self,
        gif: &Gif,
        held: Option<Vec<u8>>,
        then: fn(&mut Self, Vec<u8>, &mut Context<Self>),
        cx: &mut Context<Self>,
    ) {
        if let Some(bytes) = held {
            then(self, bytes, cx);
            cx.notify();
            return;
        }
        let told = self
            .panels
            .gifs
            .fetch
            .fetch(&gif.preview, crate::embed::PICTURE_MOST);
        cx.spawn(async move |shell, cx| {
            let fetched = told
                .recv()
                .await
                .unwrap_or_else(|_| Err("nothing fetched it".to_owned()));
            let _ = shell.update(cx, |shell, cx| {
                match fetched {
                    Ok(bytes) if crate::picture::is_picture(&bytes) => then(shell, bytes, cx),
                    _ => shell.notice = Some(t!("The GIF could not be fetched.")),
                }
                cx.notify();
            });
        })
        .detach();
    }
}

/// What the browser was opened for.
#[derive(Clone, Copy)]
pub(super) enum For {
    /// To send into the conversation.
    Composer,
    /// For a picture of the user's own: its bytes go to this.
    Picture(fn(&mut Shell, Vec<u8>, &mut Context<Shell>)),
}

/// The chip in the composer that opens the browser: a word, not a glyph,
/// as the web client has it, since no picture of "GIF" reads faster.
pub(super) fn chip(shell: &Shell, cx: &mut Context<Shell>) -> Option<AnyElement> {
    if !shell.offers_gifs() {
        return None;
    }
    let theme = crate::theme::ActiveTheme::get(cx);
    let (hover, ink) = (theme.c.hover, theme.c.text);
    let control = div()
        .id("gif-chip")
        .debug_selector(|| "gif-chip".to_owned())
        .flex_none()
        .px(px(8.0))
        .py(px(4.0))
        .rounded(theme.skin.radius_sm)
        .bg(theme.c.card2)
        .text_color(theme.c.muted)
        .text_size(px(10.0))
        .font_weight(gpui::FontWeight::SEMIBOLD)
        .cursor_pointer()
        .hover(move |style| style.bg(hover).text_color(ink))
        .tooltip(super::kit::keyed_tip(t!("Insert a GIF"), None::<&str>))
        .on_click(cx.listener(|shell, event: &gpui::ClickEvent, window, cx| {
            shell.open_gifs(event.position(), window, cx);
        }))
        .child(SharedString::from("GIF"));
    Some(
        Reachable::new("gif-chip", control)
            .corner(theme.skin.radius_sm)
            .into_any_element(),
    )
}
