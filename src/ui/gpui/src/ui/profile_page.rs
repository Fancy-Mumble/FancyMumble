//! Somebody's full profile: the richer document their profile points to,
//! fetched only when "View full profile" is pressed on their card, drawn
//! large, and let go of when it is closed.
//!
//! Each kind of section is drawn by a function of its own, so the page
//! renderer can take a kind over later without the rest changing. A full
//! picture is fetched only when it is clicked, looked at in the lightbox,
//! and held by nothing here once that closes.

use std::sync::Arc;

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};
use mumble_tauri_lib::engine_api::about::{About, Block, Link, Page, PageRef, Section};

use super::about_view::{self, Drawing};
use super::kit::{Button, Dialog, icon};
use super::widgets::EMPHASIS;
use super::{Shell, about_editor};
use crate::engine::Session;
use crate::profile::Shown;
use crate::theme::Theme;
use crate::words::t;

/// How wide the full profile's sheet is, and the room its sections take.
const WIDTH: f32 = 620.0;
const ROOM: f32 = WIDTH - 44.0;
/// Pictures a row of a gallery.
const ROW: usize = 3;

/// What is open of people's profiles, beyond their cards.
#[derive(Default)]
pub(super) struct Profiles {
    /// Somebody's full profile, while it is open.
    pub full: Option<FullProfile>,
    /// The local user's about being edited, or converted.
    pub editor: Option<about_editor::Editor>,
    /// The full picture of a profile on its way to be looked at large.
    pub opening: Option<SharedString>,
}

/// A full profile, open.
pub(super) struct FullProfile {
    /// Whose it is: their name heads it, as it is now.
    session: Session,
    key: SharedString,
    /// Its sections, ready to draw; `None` while it is on its way, or why
    /// it could not be had.
    page: Option<Result<Vec<Drawn>, SharedString>>,
}

#[cfg(test)]
impl FullProfile {
    /// Whose it is.
    pub(super) const fn session(&self) -> Session {
        self.session
    }

    /// Whether it has arrived.
    pub(super) const fn arrived(&self) -> bool {
        self.page.is_some()
    }
}

/// A section, ready to draw.
enum Drawn {
    Text {
        title: SharedString,
        shown: Arc<Shown>,
    },
    Gallery {
        title: SharedString,
        shown: Arc<Shown>,
    },
    Links {
        title: SharedString,
        links: Vec<Link>,
    },
}

impl Drawn {
    fn of(section: Section) -> Self {
        match section {
            Section::Text { title, blocks } => Self::Text {
                title: title.into(),
                shown: Arc::new(Shown::of(About { blocks })),
            },
            Section::Gallery { title, pictures } => Self::Gallery {
                title: title.into(),
                shown: Arc::new(Shown::of(About {
                    blocks: pictures
                        .chunks(ROW)
                        .map(|row| Block::Pictures {
                            pictures: row.to_vec(),
                        })
                        .collect(),
                })),
            },
            Section::Links { title, links } => Self::Links {
                title: title.into(),
                links,
            },
        }
    }
}

impl Shell {
    /// Open `session`'s full profile, kept where `page` says: fetched now,
    /// and not before.
    pub(super) fn open_full_profile(
        &mut self,
        session: Session,
        page: PageRef,
        cx: &mut Context<Self>,
    ) {
        self.panels.profiles.full = Some(FullProfile {
            session,
            key: page.key.clone().into(),
            page: None,
        });
        self.info = None;
        self.engine.fetch_page(page);
        cx.notify();
    }

    /// A full profile arrived, or could not be had.
    pub(super) fn page_arrived(&mut self, key: &str, page: Result<Arc<Page>, SharedString>) {
        let Some(full) = self
            .panels
            .profiles
            .full
            .as_mut()
            .filter(|full| full.key.as_ref() == key)
        else {
            return;
        };
        full.page = Some(page.map(|page| {
            Arc::unwrap_or_clone(page)
                .sections
                .into_iter()
                .map(Drawn::of)
                .collect()
        }));
    }

    /// Close the full profile, letting go of everything of it.
    pub(super) fn close_full_profile(&mut self, cx: &mut Context<Self>) {
        self.panels.profiles.full = None;
        cx.notify();
    }

    /// Look at a profile's picture large: `thumb` at once, and the full
    /// picture kept under `key` once it has been fetched, where there is one.
    pub(super) fn look_at_profile_picture(
        &mut self,
        thumb: Option<Arc<gpui::Image>>,
        key: Option<SharedString>,
        cx: &mut Context<Self>,
    ) {
        if let Some(thumb) = thumb {
            self.lightbox = Some(thumb);
        }
        if let Some(key) = key {
            self.panels.profiles.opening = Some(key.clone());
            self.engine.fetch_shared(key);
        }
        cx.notify();
    }

    /// A shared picture arrived: if it is the full picture of a profile
    /// asked to be looked at, it goes to the lightbox and is held nowhere
    /// else. Says whether it was.
    pub(super) fn took_profile_picture(
        &mut self,
        key: &str,
        picture: Option<&Arc<gpui::Image>>,
    ) -> bool {
        if self.panels.profiles.opening.as_ref().map(AsRef::as_ref) != Some(key) {
            return false;
        }
        self.panels.profiles.opening = None;
        if let Some(picture) = picture {
            self.lightbox = Some(Arc::clone(picture));
        }
        true
    }
}

/// The open full profile, if one is.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Option<AnyElement> {
    let full = shell.panels.profiles.full.as_ref()?;
    let viewer = cx.entity().downgrade();
    let drawing = Drawing {
        name: "full-profile",
        room: ROOM,
        ink: theme.c.muted,
        link: theme.c.accent_text,
        line: theme.c.line2,
        theme,
        viewer: &viewer,
    };
    let body: Vec<AnyElement> = match &full.page {
        None => vec![note(t!("Fetching the full profile…"), theme)],
        Some(Err(why)) => vec![note(
            t!("The full profile could not be had: {{why}}", why = why),
            theme,
        )],
        Some(Ok(sections)) => sections
            .iter()
            .map(|section| self::section(section, drawing, cx))
            .collect(),
    };
    Some(
        Dialog::new("full-profile")
            .w(px(WIDTH))
            .max_h(px(720.0))
            .gap(px(14.0))
            .p(px(22.0))
            .scrolls()
            .title(
                shell
                    .snapshot
                    .users
                    .iter()
                    .find(|user| user.session == full.session)
                    .map(|user| user.name.clone())
                    .unwrap_or_default(),
            )
            .on_dismiss(cx.listener(|shell, _, _, cx| shell.close_full_profile(cx)))
            .text_size(px(13.0))
            .children(body)
            .child(
                div().flex().justify_end().child(
                    Button::new("full-profile-close", t!("Close"))
                        .on_click(cx.listener(|shell, _, _, cx| shell.close_full_profile(cx))),
                ),
            )
            .into_any_element(),
    )
}

fn note(says: SharedString, theme: &Theme) -> AnyElement {
    div()
        .debug_selector(|| "full-profile-note".to_owned())
        .text_color(theme.c.muted)
        .child(says)
        .into_any_element()
}

/// One section, under its heading.
fn section(section: &Drawn, drawing: Drawing<'_>, cx: &mut Context<Shell>) -> AnyElement {
    let (title, body): (&SharedString, Vec<AnyElement>) = match section {
        Drawn::Text { title, shown } | Drawn::Gallery { title, shown } => {
            (title, about_view::blocks(shown, drawing, cx))
        }
        Drawn::Links { title, links } => (title, link_rows(links, drawing, cx)),
    };
    div()
        .flex()
        .flex_col()
        .gap(px(6.0))
        .when(!title.is_empty(), |column| {
            column.child(
                div()
                    .text_size(px(11.0))
                    .font_weight(EMPHASIS)
                    .text_color(drawing.theme.c.dim)
                    .child(title.to_uppercase()),
            )
        })
        .children(body)
        .into_any_element()
}

/// A list of links, each asked about before it is opened.
fn link_rows(links: &[Link], drawing: Drawing<'_>, cx: &mut Context<Shell>) -> Vec<AnyElement> {
    links
        .iter()
        .enumerate()
        .map(|(at, link)| {
            let url = SharedString::from(link.url.clone());
            let words = if link.text.is_empty() {
                url.clone()
            } else {
                link.text.clone().into()
            };
            div()
                .id(("full-profile-link", at))
                .debug_selector(move || format!("full-profile-link-{at}"))
                .flex()
                .items_center()
                .gap(px(8.0))
                .cursor_pointer()
                .text_color(drawing.link)
                .child(icon("link-2", 14.0, drawing.link))
                .child(words)
                .on_click(cx.listener(move |shell, _, _, cx| shell.follow_link(url.clone(), cx)))
                .into_any_element()
        })
        .collect()
}
