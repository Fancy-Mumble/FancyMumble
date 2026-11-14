//! What a message is about to carry: the files waiting to go out with it,
//! and how they are to be shared.
//!
//! A file is not sent the moment it is chosen. It waits above the composer,
//! where it can be looked at and taken back, and goes out with whatever is
//! typed as one message. Beside the files stand the things worth deciding
//! before that: who can reach them, for how long the server keeps them, and
//! whether a large picture goes up as it is. One answer for all of them:
//! who may see it is a property of the message.

use std::path::PathBuf;
use std::sync::Arc;

use gpui::{
    Context, Entity, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::kit::{Button, IconButton, Segmented};
use super::text_input::TextInput;
use super::widgets::icon;
use crate::engine::{Conversation, Lasts, Reach, ShareAs};
use crate::theme::Theme;

/// The side of a waiting file's tile, and its side once the options are
/// unfolded and the room is theirs.
const TILE: f32 = 96.0;
const TILE_SMALL: f32 = 54.0;

/// One file waiting to be sent.
#[derive(Debug)]
struct File {
    path: PathBuf,
    name: SharedString,
    size: u64,
    /// It, where it is a picture small enough to be looked at here.
    picture: Option<Arc<gpui::Image>>,
}

/// Who is to reach what is sent, as the three choices offered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum To {
    #[default]
    Here,
    Link,
    Password,
}

impl To {
    const ALL: [Self; 3] = [Self::Here, Self::Link, Self::Password];
}

/// The files waiting, and how they are to go.
pub(super) struct Staged {
    files: Vec<File>,
    to: To,
    lasts: Lasts,
    /// Whether large pictures go up as they are.
    full: bool,
    /// Whether the options are unfolded.
    unfolded: bool,
    /// What a link is sealed with, where it is to be.
    password: Entity<TextInput>,
}

impl std::fmt::Debug for Staged {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Staged")
            .field("files", &self.files)
            .field("to", &self.to)
            .finish_non_exhaustive()
    }
}

impl Staged {
    fn new(cx: &mut Context<Shell>) -> Self {
        Self {
            files: Vec::new(),
            to: To::default(),
            lasts: Lasts::default(),
            full: false,
            unfolded: false,
            password: cx.new(|cx| TextInput::new("Password for the link", cx).obscured()),
        }
    }

    /// How they are to be shared, with the password as it stands.
    fn how(&self, cx: &gpui::App) -> ShareAs {
        ShareAs {
            reach: match self.to {
                To::Here => Reach::Here,
                To::Link => Reach::Link,
                To::Password => Reach::Password(self.password.read(cx).text().to_owned()),
            },
            lasts: self.lasts,
            full: self.full,
        }
    }

    /// What the button that unfolds the options says: how they stand.
    fn summary(&self, here: &str) -> String {
        let to = match self.to {
            To::Here => here,
            To::Link => "Anyone with the link",
            To::Password => "Password",
        };
        let kept = match self.lasts {
            Lasts::Day => "24 hours",
            Lasts::Week => "7 days",
            Lasts::Always => "kept",
        };
        let pictures = self.files.iter().any(|file| file.picture.is_some());
        match (pictures, self.full) {
            (true, true) => format!("Full quality · {to} · {kept}"),
            (true, false) => format!("Smaller · {to} · {kept}"),
            (false, _) => format!("{to} · {kept}"),
        }
    }
}

impl Shell {
    /// Whether files are waiting to go out with the next message.
    pub(super) fn has_staged(&self) -> bool {
        self.panels
            .staged
            .as_ref()
            .is_some_and(|staged| !staged.files.is_empty())
    }

    /// Put the files at `paths` with what waits to go out with the next
    /// message. They are read off the view's thread: a picture to be
    /// looked at, anything else only for its size.
    pub(super) fn stage_files(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        if self.panels.staged.is_none() {
            self.panels.staged = Some(Staged::new(cx));
        }
        let read = cx.background_executor().spawn(async move {
            paths
                .into_iter()
                .filter_map(|path| {
                    let size = std::fs::metadata(&path)
                        .ok()
                        .filter(std::fs::Metadata::is_file)?
                        .len();
                    let name = path.file_name()?.to_string_lossy().into_owned();
                    let picture = crate::picture::at(&path)
                        .and_then(crate::picture::picture)
                        .map(Arc::new);
                    Some(File {
                        path,
                        name: name.into(),
                        size,
                        picture,
                    })
                })
                .collect::<Vec<_>>()
        });
        cx.spawn(async move |shell, cx| {
            let files = read.await;
            let _ = shell.update(cx, |shell, cx| {
                if let Some(staged) = shell.panels.staged.as_mut() {
                    staged.files.extend(files);
                }
                cx.notify();
            });
        })
        .detach();
    }

    /// Have `files` wait above the composer, as if they had been chosen.
    pub(crate) fn stage_for_inspection(&mut self, mut files: Vec<PathBuf>, cx: &mut Context<Self>) {
        files.sort();
        self.stage_files(files, cx);
    }

    /// Take back the waiting file at `at`.
    fn unstage(&mut self, at: usize, cx: &mut Context<Self>) {
        if let Some(staged) = self.panels.staged.as_mut()
            && at < staged.files.len()
        {
            let _ = staged.files.remove(at);
        }
        cx.notify();
    }

    /// Change how the waiting files are to go.
    fn restage(&mut self, change: impl FnOnce(&mut Staged), cx: &mut Context<Self>) {
        if let Some(staged) = self.panels.staged.as_mut() {
            change(staged);
        }
        cx.notify();
    }

    /// Send the waiting files with `text` to the open conversation. Says
    /// whether they went: they stay where a link is to have a password and
    /// has none.
    pub(super) fn send_staged(&mut self, text: String, cx: &mut Context<Self>) -> bool {
        let (Some(conversation), Some(staged)) = (self.open, self.panels.staged.as_ref()) else {
            return false;
        };
        let how = staged.how(cx);
        if how.reach == Reach::Password(String::new()) {
            self.notice = Some("Give the link a password before sending.".into());
            cx.notify();
            return false;
        }
        let files: Vec<PathBuf> = staged.files.iter().map(|file| file.path.clone()).collect();
        // A server that keeps files takes them all in one message. Any
        // other, and a direct conversation, takes pictures in messages of
        // their own, as before.
        if self.snapshot.fancy && matches!(conversation, Conversation::Channel(_)) {
            self.engine.share(conversation, text, files, how);
        } else {
            if !text.trim().is_empty() {
                self.engine.send_message(conversation, text);
            }
            self.send_files(files, cx);
        }
        if let Some(staged) = self.panels.staged.as_mut() {
            staged.files.clear();
            staged.unfolded = false;
            staged.password.update(cx, |password, cx| {
                password.clear();
                cx.notify();
            });
        }
        true
    }
}

/// One waiting file: the picture, or what it is called and how large it
/// is, with the way to take it back in its corner.
fn tile(
    (at, file): (usize, &File),
    side: f32,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    use crate::pictures::{Fit, shown};
    let face = match &file.picture {
        Some(picture) => gpui::img(shown(picture, Fit::Face))
            .size_full()
            .rounded(theme.skin.radius_md)
            .into_any_element(),
        None => div()
            .size_full()
            .p(px(6.0))
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(3.0))
            .text_size(px(10.0))
            .text_color(theme.c.muted)
            .child(icon("file", 16.0, theme.c.muted))
            .when(side > TILE_SMALL, |face| {
                face.child(div().w_full().truncate().child(file.name.clone()))
                    .child(SharedString::from(super::size_in_words(file.size)))
            })
            .into_any_element(),
    };
    div()
        .debug_selector(move || format!("staged-{at}"))
        .flex_none()
        .relative()
        .size(px(side))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.card2)
        .border_1()
        .border_color(theme.c.line2)
        .child(face)
        .child(
            div().absolute().top(px(2.0)).right(px(2.0)).child(
                // Filled: it has to be seen on any picture.
                IconButton::at("staged-remove", at, "x")
                    .size(18.0)
                    .glyph_size(11.0)
                    .variant(super::kit::Variant::Filled)
                    .corner(super::kit::Corner::Pill)
                    .tip("Take it back")
                    .on_click(cx.listener(move |shell, _, _, cx| shell.unstage(at, cx))),
            ),
        )
}

/// One of the things to decide, said before its choices.
fn row(says: &'static str, choices: impl IntoElement, theme: &Theme) -> gpui::Div {
    div()
        .flex()
        .items_center()
        .gap(px(10.0))
        .child(
            div()
                .flex_none()
                .w(px(96.0))
                .text_size(px(12.0))
                .text_color(theme.c.muted)
                .child(says),
        )
        .child(choices)
}

/// The options, unfolded: how large pictures go, who can reach what is
/// sent, and for how long it is kept.
fn options(
    staged: &Staged,
    here: &'static str,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> gpui::Div {
    let pictures = staged.files.iter().any(|file| file.picture.is_some());
    let to = To::ALL.iter().position(|to| *to == staged.to).unwrap_or(0);
    let lasts = Lasts::ALL
        .iter()
        .position(|lasts| *lasts == staged.lasts)
        .unwrap_or(1);
    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .when(pictures, |rows| {
            rows.child(row(
                "Pictures",
                Segmented::new(
                    "share-quality",
                    ["Smaller", "Full quality"],
                    usize::from(staged.full),
                )
                .on_choose(cx.listener(|shell, at: &usize, _, cx| {
                    let full = *at == 1;
                    shell.restage(|staged| staged.full = full, cx);
                })),
                theme,
            ))
        })
        .child(row(
            "Who can see it",
            Segmented::new("share-to", [here, "Anyone with the link", "Password"], to).on_choose(
                cx.listener(|shell, at: &usize, _, cx| {
                    if let Some(to) = To::ALL.get(*at).copied() {
                        shell.restage(|staged| staged.to = to, cx);
                    }
                }),
            ),
            theme,
        ))
        .when(staged.to == To::Password, |rows| {
            rows.child(row(
                "",
                div()
                    .w(px(260.0))
                    .h(px(30.0))
                    .px(px(10.0))
                    .flex()
                    .items_center()
                    .rounded(theme.skin.radius_sm)
                    .bg(theme.c.input)
                    .border_1()
                    .border_color(theme.c.line2)
                    .text_size(px(13.0))
                    .child(staged.password.clone()),
                theme,
            ))
        })
        .child(row(
            "Kept for",
            Segmented::new("share-lasts", ["24 hours", "7 days", "Always"], lasts).on_choose(
                cx.listener(|shell, at: &usize, _, cx| {
                    if let Some(lasts) = Lasts::ALL.get(*at).copied() {
                        shell.restage(|staged| staged.lasts = lasts, cx);
                    }
                }),
            ),
            theme,
        ))
}

/// The files waiting above the composer, if any are: each on a tile, a
/// tile that adds another, and the options folded under one button.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<impl IntoElement + use<>> {
    let staged = shell
        .panels
        .staged
        .as_ref()
        .filter(|staged| !staged.files.is_empty())?;
    let here = match shell.open {
        Some(Conversation::Direct(_)) => "This conversation",
        _ => "This channel",
    };
    let side = if staged.unfolded { TILE_SMALL } else { TILE };
    let tiles = staged
        .files
        .iter()
        .enumerate()
        .map(|file| tile(file, side, theme, cx).into_any_element())
        .collect::<Vec<_>>();
    let hover = theme.c.accent_line;
    let add = div()
        .id("staged-add")
        .debug_selector(|| "staged-add".to_owned())
        .flex_none()
        .w(px(if staged.unfolded { 44.0 } else { 64.0 }))
        .h(px(side))
        .flex()
        .items_center()
        .justify_center()
        .rounded(theme.skin.radius_md)
        .border_1()
        .border_dashed()
        .border_color(theme.c.line2)
        .cursor_pointer()
        .hover(move |style| style.border_color(hover))
        .on_click(cx.listener(|shell, _, _, cx| shell.pick_file_to_send(cx)))
        .child(icon("plus", 14.0, theme.c.dim));
    let unfolded = staged.unfolded;
    Some(
        div()
            .debug_selector(|| "staged".to_owned())
            .p(px(8.0))
            .flex()
            .flex_col()
            .gap(px(10.0))
            .rounded(theme.skin.radius_md)
            .bg(theme.c.card)
            .border_1()
            .border_color(theme.c.line2)
            .child(
                div()
                    .flex()
                    .items_start()
                    .gap(px(8.0))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .items_center()
                            .gap(px(8.0))
                            .overflow_hidden()
                            .children(tiles)
                            .child(add),
                    )
                    .child(
                        Button::new("staged-options", staged.summary(here)).on_click(cx.listener(
                            move |shell, _, _, cx| {
                                shell.restage(|staged| staged.unfolded = !unfolded, cx);
                            },
                        )),
                    ),
            )
            .when(staged.unfolded, |tray| {
                tray.child(options(staged, here, theme, cx))
            }),
    )
}
