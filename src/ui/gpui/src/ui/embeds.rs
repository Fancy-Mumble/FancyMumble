//! What a link shows under its message: the picture it is or names, or
//! a `YouTube` video's card, in place of or under the server's card.
//!
//! Nothing here reaches a host the server's card did not already come
//! from until the reader asks with "Load content", or has trusted that
//! host from the question a link asks. What they let in is kept for the
//! session. A video's card is drawn in `video_card`, and played in
//! `playing`; see the module `crate::embed` for what is recognised.

use std::collections::{HashMap, HashSet, VecDeque};
use std::rc::Rc;
use std::sync::Arc;

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::kit::{Button, Emphasis, Size};
use super::widgets::{EMPHASIS, icon};
use crate::embed::{Embed, Fetch, Fetched, PICTURE_MOST, TITLE_MOST, Web, youtube};
use crate::pictures::{Fit, shown};
use crate::player::Screens;
use crate::theme::Theme;

/// How much of what was fetched is held, in bytes of files. The oldest
/// go first, and are asked for again.
const HELD_MOST: usize = 24 << 20;
/// The room a picture is drawn in, and a video's card.
pub(super) const ROOM: (f32, f32) = (420.0, 320.0);

/// What a fetch was for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Want {
    Picture,
    Title,
}

/// What came of something let in.
#[derive(Debug, Clone)]
enum Got {
    Waiting,
    Picture(Arc<gpui::Image>),
    Title(SharedString),
    Refused(SharedString),
}

/// What stands where a picture from the web goes, for now.
#[derive(Debug, Clone)]
pub(super) enum Showing {
    /// The reader has not let it in.
    Ask,
    /// It is on its way.
    Waiting,
    Picture(Arc<gpui::Image>),
    /// It could not be had, for this reason.
    Refused(SharedString),
}

/// What the reader let in from the web, and what came of it.
pub(super) struct Embeds {
    /// The addresses let in this session.
    allowed: HashSet<SharedString>,
    /// What was fetched, or is on its way, by address.
    got: HashMap<SharedString, Got>,
    /// The addresses fetched, oldest first.
    order: VecDeque<SharedString>,
    fetch: Arc<dyn Fetch>,
    /// What plays videos in place, if anything here can.
    pub(super) screens: Rc<dyn Screens>,
    /// The video playing in place.
    pub(super) playing: Option<super::playing::Playing>,
    /// The message whose video waits for `YouTube` to be let in.
    pub(super) asking_play: Option<usize>,
}

impl Default for Embeds {
    fn default() -> Self {
        Self::fetching_with(Arc::new(Web))
    }
}

impl Embeds {
    /// Fetching through `fetch` rather than from the web.
    pub(super) fn fetching_with(fetch: Arc<dyn Fetch>) -> Self {
        Self {
            allowed: HashSet::new(),
            got: HashMap::new(),
            order: VecDeque::new(),
            fetch,
            screens: crate::player::screens(),
            playing: None,
            asking_play: None,
        }
    }

    /// Playing videos through `screens` rather than this system's.
    #[cfg(test)]
    pub(super) fn playing_with(mut self, screens: Rc<dyn Screens>) -> Self {
        self.screens = screens;
        self
    }

    /// Whether the video `id` may be fetched from `YouTube`: its host is
    /// trusted, or its still was let in.
    pub(super) fn lets_in_video(&self, id: &str, trusted: bool) -> bool {
        trusted || self.allowed.contains(youtube::still(id).as_str())
    }

    /// What shows for `url`, whose host the reader trusts or not.
    pub(super) fn showing(&self, url: &str, trusted: bool) -> Showing {
        match self.got.get(url) {
            Some(Got::Picture(picture)) => Showing::Picture(Arc::clone(picture)),
            Some(Got::Refused(why)) => Showing::Refused(why.clone()),
            Some(Got::Waiting | Got::Title(_)) => Showing::Waiting,
            None if trusted || self.allowed.contains(url) => Showing::Waiting,
            None => Showing::Ask,
        }
    }

    /// The title fetched at `url`, if one was.
    pub(super) fn title(&self, url: &str) -> Option<SharedString> {
        match self.got.get(url)? {
            Got::Title(title) => Some(title.clone()),
            _ => None,
        }
    }

    /// Whether `url` is let in and still to be fetched.
    pub(super) fn wants(&self, url: &str, trusted: bool) -> bool {
        !self.got.contains_key(url) && (trusted || self.allowed.contains(url))
    }

    /// Let `urls` in.
    pub(super) fn allow(&mut self, urls: impl IntoIterator<Item = SharedString>) {
        self.allowed.extend(urls);
    }

    /// Keep what came of fetching `url`, and let the oldest go while too
    /// much is held.
    fn landed(&mut self, url: SharedString, want: Want, fetched: Fetched) {
        let got = match (want, fetched) {
            (_, Err(why)) => Got::Refused(why.into()),
            (Want::Picture, Ok(bytes)) => crate::picture::picture(bytes).map_or_else(
                || Got::Refused("not a picture".into()),
                |picture| Got::Picture(Arc::new(picture)),
            ),
            (Want::Title, Ok(bytes)) => youtube::title(&bytes).map_or_else(
                || Got::Refused("no title".into()),
                |title| Got::Title(title.into()),
            ),
        };
        let _ = self.got.insert(url.clone(), got);
        self.order.push_back(url);
        while self.held() > HELD_MOST {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            let _ = self.got.remove(&oldest);
        }
    }

    /// Let go of what was fetched at `urls`, which are not to be shown
    /// again soon: the pictures let go of.
    pub(super) fn forget(&mut self, urls: &[SharedString]) -> Vec<Arc<gpui::Image>> {
        self.order.retain(|url| !urls.contains(url));
        urls.iter()
            .filter_map(|url| match self.got.remove(url)? {
                Got::Picture(picture) => Some(picture),
                _ => None,
            })
            .collect()
    }

    /// The bytes of the files held.
    fn held(&self) -> usize {
        self.got
            .values()
            .map(|got| match got {
                Got::Picture(picture) => picture.bytes().len(),
                _ => 0,
            })
            .sum()
    }
}

impl Shell {
    /// What the first link of message `index` shows under it: the
    /// server's card, a picture, a video's card, or the question whether
    /// to load one.
    pub(super) fn link_embeds(
        &mut self,
        index: usize,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let Some(link) = self.bodies.get(&index).and_then(|body| body.first_link()) else {
            return Vec::new();
        };
        let preview = self.previews.get(&link).cloned().flatten();
        let Some(embed) = Embed::of(&link, preview.as_deref()) else {
            return self.link_card(index, theme, cx).into_iter().collect();
        };
        let card = (!embed.replaces_card())
            .then(|| self.link_card(index, theme, cx))
            .flatten();
        let trusted = embed
            .host()
            .is_some_and(|host| self.panels.links.trusted.contains(&host));
        let shown = match embed {
            Embed::Picture { url, alone } => {
                // The server's own copy, where the link is a picture and
                // the server sent one: it contacts nobody.
                let sent = preview.and_then(|preview| preview.picture.clone());
                match sent.filter(|_| alone) {
                    Some(sent) => picture_tile(&sent, index, cx),
                    None => self.web_picture(index, &url, trusted, theme, cx),
                }
            }
            Embed::YouTube { id } => self.video_card(index, &id, preview, trusted, theme, cx),
        };
        card.into_iter().chain([shown]).collect()
    }

    /// A picture from the web at `url`, or what stands for it.
    fn web_picture(
        &mut self,
        index: usize,
        url: &SharedString,
        trusted: bool,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if self.panels.embeds.wants(url, trusted) {
            self.fetch_embed(url.clone(), Want::Picture, cx);
        }
        let host = crate::embed::host_of(url).unwrap_or_default();
        match self.panels.embeds.showing(url, trusted) {
            Showing::Picture(picture) => picture_tile(&picture, index, cx),
            Showing::Ask => {
                let urls = vec![url.clone()];
                let asking = Asking {
                    index,
                    what: format!("Picture from {host}"),
                    host: &host,
                };
                gate(&asking, theme, cx, move |shell, _, cx| {
                    shell.load_embeds(urls.clone(), cx)
                })
            }
            Showing::Waiting => note(index, format!("Loading the picture from {host}…"), theme),
            Showing::Refused(why) => note(
                index,
                format!("The picture from {host} cannot be shown: {why}"),
                theme,
            ),
        }
    }

    /// Fetch `url` for what `want`s it, once.
    pub(super) fn fetch_embed(&mut self, url: SharedString, want: Want, cx: &mut Context<Self>) {
        let embeds = &mut self.panels.embeds;
        if embeds.got.contains_key(&url) {
            return;
        }
        let _ = embeds.got.insert(url.clone(), Got::Waiting);
        let most = match want {
            Want::Picture => PICTURE_MOST,
            Want::Title => TITLE_MOST,
        };
        let told = embeds.fetch.fetch(&url, most);
        cx.spawn(async move |shell, cx| {
            let fetched = told
                .recv()
                .await
                .unwrap_or_else(|_| Err("nothing fetched it".to_owned()));
            let _ = shell.update(cx, |shell, cx| {
                shell.panels.embeds.landed(url, want, fetched);
                cx.notify();
            });
        })
        .detach();
    }

    /// The reader let `urls` in: fetch them.
    pub(super) fn load_embeds(&mut self, urls: Vec<SharedString>, cx: &mut Context<Self>) {
        self.panels.embeds.allow(urls);
        cx.notify();
    }
}

/// A picture, in the room its file says it takes; a click opens it large.
fn picture_tile(picture: &Arc<gpui::Image>, index: usize, cx: &mut Context<Shell>) -> AnyElement {
    let natural = crate::picture::dimensions(picture.bytes());
    let (width, height) = natural.map_or(ROOM, |natural| crate::picture::fitted(natural, ROOM));
    let opened = Arc::clone(picture);
    div()
        .id(("embed-picture", index))
        .debug_selector(move || format!("embed-picture-{index}"))
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

/// What a gate asks about: what of message `index`, from where.
pub(super) struct Asking<'a> {
    pub(super) index: usize,
    pub(super) what: String,
    pub(super) host: &'a str,
}

/// The question whether to load what `asking` names; `load` is what
/// Load content does.
pub(super) fn gate(
    asking: &Asking<'_>,
    theme: &Theme,
    cx: &mut Context<Shell>,
    load: impl Fn(&mut Shell, &mut gpui::Window, &mut Context<Shell>) + 'static,
) -> AnyElement {
    let (index, host) = (asking.index, asking.host);
    div()
        .id(("embed-gate", index))
        .debug_selector(move || format!("embed-gate-{index}"))
        .max_w(px(ROOM.0))
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(12.0))
        .py(px(9.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.card)
        .border_1()
        .border_color(theme.c.line2)
        .child(icon("image", 18.0, theme.c.muted))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    div()
                        .truncate()
                        .text_size(px(13.0))
                        .font_weight(EMPHASIS)
                        .child(SharedString::from(asking.what.clone())),
                )
                .child(div().text_size(px(12.0)).text_color(theme.c.muted).child(
                    SharedString::from(format!("This embed loads external content from {host}.")),
                )),
        )
        .child(
            Button::new("embed-load", "Load content")
                .selector(format!("embed-load-{index}"))
                .size(Size::Small)
                .emphasis(Emphasis::Contained)
                .on_click(cx.listener(move |shell, _, window, cx| load(shell, window, cx))),
        )
        .into_any_element()
}

/// A quiet line where a picture is on its way, or could not be had.
fn note(index: usize, said: String, theme: &Theme) -> AnyElement {
    div()
        .debug_selector(move || format!("embed-note-{index}"))
        .max_w(px(ROOM.0))
        .text_size(px(12.0))
        .text_color(theme.c.dim)
        .child(SharedString::from(said))
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fetches nothing.
    struct Nowhere;

    impl Fetch for Nowhere {
        fn fetch(&self, _: &str, _: usize) -> async_channel::Receiver<Fetched> {
            async_channel::bounded(1).1
        }
    }

    fn png() -> Vec<u8> {
        let mut bytes = Vec::new();
        image::RgbaImage::new(4, 3)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("a picture");
        bytes
    }

    #[test]
    fn nothing_shows_from_the_web_until_it_is_let_in_or_trusted() {
        let mut embeds = Embeds::fetching_with(Arc::new(Nowhere));
        let cat = "https://cats.example/cat.png";
        assert!(matches!(embeds.showing(cat, false), Showing::Ask));
        assert!(!embeds.wants(cat, false), "not asked for");
        assert!(embeds.wants(cat, true), "trusted: fetched without asking");
        embeds.allow([SharedString::from(cat)]);
        assert!(embeds.wants(cat, false));
        assert!(matches!(embeds.showing(cat, false), Showing::Waiting));
        embeds.landed(cat.into(), Want::Picture, Ok(png()));
        assert!(!embeds.wants(cat, false), "once is enough");
        assert!(matches!(embeds.showing(cat, false), Showing::Picture(_)));
    }

    #[test]
    fn what_cannot_be_had_says_why() {
        let mut embeds = Embeds::fetching_with(Arc::new(Nowhere));
        embeds.landed(
            "https://a.example/x.png".into(),
            Want::Picture,
            Ok(b"<html>".to_vec()),
        );
        embeds.landed(
            "https://b.example/y.png".into(),
            Want::Picture,
            Err("404".into()),
        );
        let why = |url| match embeds.showing(url, true) {
            Showing::Refused(why) => why.to_string(),
            _ => String::new(),
        };
        assert_eq!(why("https://a.example/x.png"), "not a picture");
        assert_eq!(why("https://b.example/y.png"), "404");
    }

    #[test]
    fn the_oldest_fetched_go_once_too_much_is_held() {
        let mut embeds = Embeds::fetching_with(Arc::new(Nowhere));
        // Each "picture" is as large as a fifth of what may be held.
        let mut big = png();
        big.resize(HELD_MOST / 5, 0);
        for at in 0..7 {
            embeds.landed(
                format!("https://a.example/{at}.png").into(),
                Want::Picture,
                Ok(big.clone()),
            );
        }
        assert!(embeds.held() <= HELD_MOST);
        assert!(
            !embeds.got.contains_key("https://a.example/0.png"),
            "the oldest went"
        );
        assert!(
            embeds.got.contains_key("https://a.example/6.png"),
            "the newest stayed"
        );
    }
}
