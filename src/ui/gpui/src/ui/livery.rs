//! A server's livery on screen: looking after it while a server's page is
//! shown, and the parts of that page it adds - the banner picture, the
//! line under the name, the tags, the greeting, and the mark on the address
//! that says where the livery came from.
//!
//! Nothing is read or asked before a server's page is drawn: the kept copy
//! is read when the page first shows, and the server is asked only when its
//! ping says it has a livery this client does not hold. Both off the view's
//! thread; the page is drawn meanwhile.

use std::sync::Arc;

use gpui::{
    AnyElement, Context, Hsla, IntoElement, ParentElement, SharedString, Styled, div, prelude::*,
    px,
};

use super::Shell;
use super::kit::{Chip, ChipTone};
use crate::livery::{Livery, Pinged, Status, TagTone};
use crate::store::Store;
use crate::theme::Theme;

/// How tall the banner is without a picture, and with one.
pub(super) const BANNER: f32 = 150.0;
pub(super) const BANNER_PICTURE: f32 = 210.0;

impl Shell {
    /// Before the window is drawn: look after the livery of the server whose
    /// page is on screen, and wear the colours of the server the engine is on.
    pub(super) fn livery_before_drawing(&mut self, cx: &mut Context<Self>) {
        if self.shows_connect_screen() && !self.panels.settings.open {
            self.tend_livery(cx);
        }
        self.wear_livery(cx);
    }

    /// Look after the livery of the server whose page is about to be drawn.
    fn tend_livery(&mut self, cx: &mut Context<Self>) {
        let Some((key, host, port)) = self
            .selected_server()
            .map(|server| (server.key, server.host.to_string(), server.port))
        else {
            return;
        };
        if self.livery.look_at(&key) {
            self.read_kept_livery(key.clone(), cx);
        }
        let live = self.engine.live_livery(&key).is_some();
        let ping = self.engine.pinged(&host, port);
        let resolved = self.livery.resolve(live, ping.as_ref());
        if resolved.fetch
            && let Some(Pinged::Up {
                digest: Some(digest),
            }) = &ping
            && self.livery.ask(digest)
        {
            self.engine.probe_livery(&host, port);
        }
        if resolved.forget {
            self.livery.forget();
            self.shelve(key, None, cx);
        }
    }

    /// The livery the page of the server at `key` draws, and where it came
    /// from.
    pub(super) fn page_livery(
        &self,
        key: &str,
        host: &str,
        port: u16,
    ) -> (Option<Arc<Livery>>, Status) {
        let live = self.engine.live_livery(key);
        let ping = self.engine.pinged(host, port);
        let resolved = self.livery.resolve(live.is_some(), ping.as_ref());
        (self.livery.shown(resolved, live), resolved.status)
    }

    /// The livery of the server of a session, while it has one.
    pub(super) fn session_livery(&self, key: &str) -> Option<Arc<Livery>> {
        self.engine.live_livery(key)
    }

    /// What a session's tile shows: its server's own name and icon where
    /// its livery gives them, its saved name and initials where not.
    pub(super) fn session_face(
        &self,
        session: &crate::engine::SessionEntry,
    ) -> (SharedString, Option<Arc<gpui::Image>>) {
        let livery = self.session_livery(&session.key);
        let name = livery
            .as_ref()
            .and_then(|livery| livery.name.clone())
            .unwrap_or_else(|| session.name.clone());
        (name, livery.and_then(|livery| livery.icon.clone()))
    }

    /// Draw in the colours of the server the engine is on, as far as its
    /// livery offers some for the mode in force; in the user's own where
    /// it offers none.
    fn wear_livery(&self, cx: &mut Context<Self>) {
        let base = Arc::clone(&cx.global::<crate::theme::ActiveTheme>().0);
        let dark = base.mode == crate::theme::Mode::Dark;
        let palette = self
            .snapshot
            .sessions
            .iter()
            .find(|session| session.active)
            .and_then(|session| self.engine.live_livery(&session.key))
            .and_then(|livery| livery.palette(dark).copied());
        crate::livery::Dressed::wear(&base, palette, cx);
    }

    /// The server at `key` answered being asked for its livery.
    pub(super) fn livery_probed(
        &mut self,
        key: &str,
        livery: Option<Arc<Livery>>,
        cx: &mut Context<Self>,
    ) {
        if let Some(livery) = self.livery.answered(key, livery) {
            self.shelve(key.to_owned(), Some(livery), cx);
        }
    }

    /// A server the engine is on said what it looks like: kept, as the web
    /// client keeps it, so its page shows it before anything is asked next
    /// time.
    pub(super) fn liveries_changed(&mut self, cx: &mut Context<Self>) {
        let keys: Vec<String> = self
            .snapshot
            .sessions
            .iter()
            .map(|session| session.key.to_string())
            .collect();
        for key in keys {
            if let Some(livery) = self.engine.live_livery(&key) {
                self.shelve(key, Some(livery), cx);
            }
        }
    }

    /// Read the copy kept for `key`, off the view's thread.
    fn read_kept_livery(&mut self, key: String, cx: &mut Context<Self>) {
        let Some(shelf) = self.store.as_ref().map(Store::liveries) else {
            return;
        };
        self.livery.reading_kept();
        let read = cx.background_executor().spawn({
            let key = key.clone();
            async move { shelf.read(&key) }
        });
        cx.spawn(async move |shell, cx| {
            let kept = read.await;
            let _ = shell.update(cx, |shell, cx| {
                shell.livery.kept_read(&key, kept);
                cx.notify();
            });
        })
        .detach();
    }

    /// Keep `livery` for `key` on disk, or forget what is kept: off the
    /// view's thread.
    fn shelve(&self, key: String, livery: Option<Arc<Livery>>, cx: &mut Context<Self>) {
        let Some(shelf) = self.store.as_ref().map(Store::liveries) else {
            return;
        };
        cx.background_executor()
            .spawn(async move {
                let written = match livery {
                    Some(livery) => shelf.put(&key, &livery),
                    None => shelf.forget(&key),
                };
                if let Err(error) = written {
                    tracing::debug!(%error, "the livery of {key} was not kept");
                }
            })
            .detach();
    }
}

/// The banner's picture, cut around the point its server named, filling the
/// banner.
pub(super) fn banner_picture(livery: &Livery) -> Option<impl IntoElement + use<>> {
    let picture = livery.banner.as_ref()?;
    let (x, y) = livery.focus;
    Some(
        gpui::img(crate::pictures::shown(
            picture,
            crate::pictures::Fit::Livery(x, y),
        ))
        .debug_selector(|| "livery-banner".to_owned())
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .object_fit(gpui::ObjectFit::Cover),
    )
}

/// The head of the sheet about the server on screen, where its livery gives
/// it one: its banner, its icon over the banner's edge, its name, and its
/// address where the name is not that.
pub(super) fn server_head(
    shell: &Shell,
    subject: crate::engine::Subject,
    theme: &Theme,
) -> Option<AnyElement> {
    if subject != crate::engine::Subject::Server {
        return None;
    }
    let session = shell
        .snapshot
        .sessions
        .iter()
        .find(|session| session.active)?;
    let livery = shell.session_livery(&session.key)?;
    if livery.banner.is_none() && livery.icon.is_none() && livery.name.is_none() {
        return None;
    }
    let name = livery.name.clone().unwrap_or_else(|| session.name.clone());
    let (from, to) = super::kit::tint(&session.key);
    let clear = Hsla {
        a: 0.0,
        ..theme.c.bg0
    };
    Some(
        div()
            .debug_selector(|| "livery-sheet-head".to_owned())
            .flex()
            .flex_col()
            .child(
                div()
                    .relative()
                    .h(px(96.0))
                    .rounded(theme.skin.radius_lg)
                    .overflow_hidden()
                    .bg(gpui::linear_gradient(
                        120.0,
                        gpui::linear_color_stop(Hsla { a: 0.35, ..from }, 0.0),
                        gpui::linear_color_stop(Hsla { a: 0.35, ..to }, 1.0),
                    ))
                    .children(banner_picture(&livery))
                    .child(
                        div()
                            .absolute()
                            .top(px(38.0))
                            .left_0()
                            .w_full()
                            .h(px(58.0))
                            .bg(gpui::linear_gradient(
                                180.0,
                                gpui::linear_color_stop(clear, 0.0),
                                gpui::linear_color_stop(theme.c.bg0, 1.0),
                            )),
                    ),
            )
            .child(
                div()
                    .mt(px(-26.0))
                    .px(px(12.0))
                    .flex()
                    .items_end()
                    .gap(px(12.0))
                    .child(
                        div()
                            .flex_none()
                            .p(px(3.0))
                            .rounded(theme.skin.radius_lg)
                            .bg(theme.c.bg0)
                            .child(
                                super::kit::Avatar::new(&name)
                                    .tile(&session.key)
                                    .picture(livery.icon.as_ref())
                                    .size(56.0),
                            ),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .pb(px(2.0))
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(18.0))
                                    .line_height(px(21.6))
                                    .font_weight(gpui::FontWeight::BOLD)
                                    .child(name.clone()),
                            )
                            .when(name != session.name, |names| {
                                names.child(
                                    div()
                                        .truncate()
                                        .text_size(px(12.0))
                                        .text_color(theme.c.dim)
                                        .child(session.name.clone()),
                                )
                            }),
                    ),
            )
            .into_any_element(),
    )
}

/// The line under the server's name.
pub(super) fn tagline(text: &SharedString, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .debug_selector(|| "livery-tagline".to_owned())
        .mt(px(3.0))
        .max_w(px(556.0))
        .text_center()
        .text_size(px(12.0))
        .line_height(px(18.0))
        .text_color(theme.c.muted)
        .child(text.clone())
}

/// The chips a server gives itself; a chip that leads somewhere is followed
/// as any link is.
pub(super) fn tags(livery: &Livery, cx: &mut Context<Shell>) -> Vec<AnyElement> {
    livery
        .tags
        .iter()
        .enumerate()
        .map(|(at, tag)| {
            let tone = match tag.tone {
                TagTone::Neutral => ChipTone::Neutral,
                TagTone::Ok => ChipTone::Ok,
                TagTone::Warn => ChipTone::Warn,
                TagTone::Bad => ChipTone::Bad,
                TagTone::Accent => ChipTone::Accent,
            };
            let chip = Chip::new(tone).child(tag.label.clone());
            match tag.href.clone() {
                Some(href) => chip
                    .on_click(
                        format!("livery-tag-{at}"),
                        cx.listener(move |shell, _, _, cx| shell.follow_link(href.clone(), cx)),
                    )
                    .into_any_element(),
                None => chip.into_any_element(),
            }
        })
        .collect()
}

/// The server's greeting: plain text, drawn as plain text.
pub(super) fn greeting(text: &SharedString, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .debug_selector(|| "livery-greeting".to_owned())
        .mt(px(16.0))
        .w(px(556.0))
        .max_w_full()
        .px(px(14.0))
        .py(px(11.0))
        .rounded(theme.skin.radius_lg)
        .bg(theme.c.card)
        .border_1()
        .border_color(theme.c.line2)
        .text_size(px(12.0))
        .line_height(px(18.6))
        .text_color(theme.c.muted)
        .child(text.clone())
}

/// The mark on the address that says where the page's livery came from.
///
/// Its colours are fixed, not the theme's: it sits on the address chip's
/// dark ground over whatever picture the server chose. A mark for something
/// still on its way is drawn faint rather than pulsing: this view draws
/// nothing while nothing changes.
pub(super) fn status_mark(status: Status) -> impl IntoElement + use<> {
    use crate::livery::StatusTone as Tone;
    let rgb = match status.tone() {
        Tone::Ok => 0x3c_d88e,
        Tone::Bad => 0xf5_7e7e,
        Tone::Muted => 0xb9_c6e2,
    };
    let colour = Hsla::from(gpui::rgb(rgb));
    div()
        .debug_selector(move || format!("livery-status-{}", status.name()))
        .flex_none()
        .size(px(6.0))
        .rounded_full()
        .bg(colour)
        .when(status.busy(), |mark| mark.opacity(0.55))
        // A halo on what the user might want to act on, none at rest.
        .when(status.tone() != Tone::Muted, |mark| {
            mark.shadow(vec![gpui::BoxShadow {
                color: Hsla { a: 0.24, ..colour },
                offset: gpui::point(px(0.0), px(0.0)),
                blur_radius: px(0.0),
                spread_radius: px(2.0),
            }])
        })
}
