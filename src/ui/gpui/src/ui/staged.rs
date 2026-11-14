//! What a message is about to carry: the files waiting to go out with it,
//! and how they are to be shared. The web UI's `AttachmentTray`.
//!
//! A file is not sent the moment it is chosen. It waits above the composer,
//! where it can be looked at and taken back, and goes out with whatever is
//! typed as one message. Beside the files stand the things worth deciding
//! before that, folded away under one button because most messages take the
//! defaults: whether a large picture goes up smaller, who can reach the
//! files, and for how long the server keeps them. One answer for all of
//! them: who may see it is a property of the message.
//!
//! The files belong to the conversation they were chosen in. Another
//! conversation opened, they are not shown there and not sent there, and
//! the next file chosen starts afresh, with the defaults.

use std::path::PathBuf;
use std::sync::Arc;

use gpui::{
    Context, Entity, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::kit::{ChipButton, Choice, Choices, IconButton, Paper, Shape, Variant};
use super::text_input::TextInput;
use crate::engine::{Conversation, Lasts, Reach, ShareAs};
use crate::theme::Theme;
use crate::words::t;

/// The side of a waiting picture's square, and its side once the options
/// are unfolded and the room is theirs: the web UI's `TILE_PX` and
/// `TILE_COMPACT_PX`.
const TILE: f32 = 150.0;
const TILE_SMALL: f32 = 54.0;
/// The disc that takes a file back, on a large tile and on a small one.
const CLOSE: f32 = 22.0;
const CLOSE_SMALL: f32 = 17.0;

/// One file waiting to be sent.
#[derive(Debug)]
struct File {
    path: PathBuf,
    name: SharedString,
    size: u64,
    /// A small copy of it, where it is a picture: what the tile shows. The
    /// file itself is not kept.
    picture: Option<Arc<gpui::Image>>,
    /// How large it goes up made smaller, where making it smaller helps.
    smaller: Option<u64>,
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

/// The lifetimes offered, in the web UI's order.
const LASTING: [Lasts; 3] = [Lasts::Always, Lasts::Day, Lasts::Week];

/// The files waiting, and how they are to go.
pub(super) struct Staged {
    files: Vec<File>,
    /// The conversation they were chosen in.
    belongs: Option<Conversation>,
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
    fn new(belongs: Option<Conversation>, cx: &mut Context<Shell>) -> Self {
        Self {
            files: Vec::new(),
            belongs,
            to: To::default(),
            lasts: Lasts::default(),
            full: false,
            unfolded: false,
            password: cx.new(|cx| {
                TextInput::new(t!("Password for the link").to_string(), cx).obscured()
            }),
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

    /// Whether any picture among them goes up smaller made smaller: only
    /// then is there a quality to choose.
    fn shrinks(&self) -> bool {
        self.files.iter().any(|file| file.smaller.is_some())
    }

    /// The pictures' size, as they would go up made smaller or as they are.
    fn picture_bytes(&self, smaller: bool) -> u64 {
        self.files
            .iter()
            .filter(|file| file.picture.is_some())
            .map(|file| match file.smaller {
                Some(small) if smaller => small,
                _ => file.size,
            })
            .sum()
    }

    /// The line under the button that unfolds the options: the quality,
    /// where there is one to choose, and who can see them.
    fn summary(&self, here: &SharedString) -> String {
        let quality = self.shrinks().then(|| {
            if self.full {
                t!("Full quality")
            } else {
                t!("Compressed")
            }
        });
        let to = match self.to {
            To::Here => here.clone(),
            To::Link => t!("Anyone with link"),
            To::Password => t!("Password"),
        };
        quality
            .into_iter()
            .chain([to])
            .map(|said| said.to_string())
            .collect::<Vec<_>>()
            .join(" · ")
    }

    /// Back to how a new message's files go: the web UI's defaults.
    fn reset(&mut self, cx: &mut Context<Shell>) {
        self.files.clear();
        self.to = To::default();
        self.lasts = Lasts::default();
        self.full = false;
        self.unfolded = false;
        self.password.update(cx, |password, cx| {
            password.clear();
            cx.notify();
        });
    }
}

impl Shell {
    /// The files waiting to go out with the next message in the open
    /// conversation, and how.
    fn staged_here(&self) -> Option<&Staged> {
        self.panels
            .staged
            .as_ref()
            .filter(|staged| staged.belongs == self.open && !staged.files.is_empty())
    }

    /// Whether files are waiting to go out with the next message.
    pub(super) fn has_staged(&self) -> bool {
        self.staged_here().is_some()
    }

    /// Put the files at `paths` with what waits to go out with the next
    /// message. They are read off the view's thread: a picture made into a
    /// small copy to look at, and into the copy it would go up as, for its
    /// size; anything else only for its size. No file is kept whole.
    pub(super) fn stage_files(&mut self, paths: Vec<PathBuf>, cx: &mut Context<Self>) {
        let open = self.open;
        let elsewhere = self
            .panels
            .staged
            .as_ref()
            .is_none_or(|staged| staged.belongs != open);
        if elsewhere {
            self.panels.staged = Some(Staged::new(open, cx));
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
                    let bytes = crate::picture::at(&path);
                    let picture = bytes
                        .as_deref()
                        .and_then(|bytes| crate::picture::avatar(bytes).ok())
                        .and_then(crate::picture::picture)
                        .map(Arc::new);
                    let smaller = bytes.as_deref().and_then(|bytes| {
                        let made = crate::picture::outgoing(bytes, true).smaller?;
                        u64::try_from(made.len()).ok().filter(|made| *made < size)
                    });
                    Some(File {
                        path,
                        name: name.into(),
                        size,
                        picture,
                        smaller,
                    })
                })
                .collect::<Vec<_>>()
        });
        cx.spawn(async move |shell, cx| {
            let files = read.await;
            let _ = shell.update(cx, |shell, cx| {
                if let Some(staged) = shell.panels.staged.as_mut()
                    && staged.belongs == open
                {
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

    /// Seal the link with twelve characters nobody has to think up.
    fn generate_password(&mut self, cx: &mut Context<Self>) {
        const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
        let mut bytes = [0_u8; 12];
        if getrandom::fill(&mut bytes).is_err() {
            return;
        }
        let made: String = bytes
            .iter()
            .map(|byte| char::from(ALPHABET[usize::from(*byte) % ALPHABET.len()]))
            .collect();
        if let Some(staged) = self.panels.staged.as_ref() {
            staged.password.update(cx, |password, cx| {
                password.set_text(made);
                cx.notify();
            });
        }
        cx.notify();
    }

    /// Send the waiting files with `text` to the open conversation. Says
    /// whether they went: they stay where a link is to have a password and
    /// has none.
    pub(super) fn send_staged(&mut self, text: String, cx: &mut Context<Self>) -> bool {
        let (Some(conversation), Some(staged)) = (self.open, self.staged_here()) else {
            return false;
        };
        let how = staged.how(cx);
        if how.reach == Reach::Password(String::new()) {
            self.notice = Some(t!("Give the link a password before sending."));
            cx.notify();
            return false;
        }
        let files: Vec<PathBuf> = staged.files.iter().map(|file| file.path.clone()).collect();
        // A server that keeps files takes them all in one message, each
        // with a row above the composer while it goes up. Any other, and a
        // direct conversation, takes pictures in messages of their own, as
        // before.
        if self.snapshot.fancy && matches!(conversation, Conversation::Channel(_)) {
            let sending = staged
                .files
                .iter()
                .map(|file| super::uploads::Sending {
                    path: file.path.clone(),
                    name: file.name.clone(),
                    size: file.size,
                    picture: file.picture.clone(),
                })
                .collect();
            let tracked = self.start_uploads(sending);
            self.engine.share_tracked(conversation, text, tracked, how);
        } else {
            if !text.trim().is_empty() {
                self.engine.send_message(conversation, text);
            }
            self.send_files(files, cx);
        }
        // The next message's files start from the defaults, as the web UI's.
        if let Some(staged) = self.panels.staged.as_mut() {
            staged.reset(cx);
        }
        true
    }

    /// Who "here" is in the open conversation, for the note under its
    /// choice: the channel's name, or nobody's for a direct one.
    fn audience(&self) -> Option<SharedString> {
        match self.open? {
            Conversation::Channel(id) => self
                .snapshot
                .channels
                .iter()
                .find(|channel| channel.id == id)
                .map(|channel| channel.name.clone()),
            Conversation::Direct(_) => None,
        }
    }
}

/// The file's kind, for a tile's badge: what its name ends in, in capitals,
/// at most four letters; `FILE` for a name with no ending.
pub(super) fn extension(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((_, ending)) => ending.to_uppercase().chars().take(4).collect(),
        None => "FILE".to_owned(),
    }
}

/// One waiting file: the picture alone, which is its own label; or for
/// anything else its kind, its name and its size, which are the file. The
/// disc that takes it back sits on its corner.
fn tile(
    (at, file): (usize, &File),
    side: f32,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    use crate::pictures::{Fit, shown};
    let large = side >= TILE;
    let close = if large { CLOSE } else { CLOSE_SMALL };
    let tile = div()
        .debug_selector(move || format!("staged-{at}"))
        .flex_none()
        .relative()
        .h(px(side))
        .rounded(theme.skin.radius_md)
        .overflow_hidden()
        .border(theme.skin.line_width)
        .border_color(theme.c.line);
    let tile = match &file.picture {
        Some(picture) => tile.w(px(side)).child(
            gpui::img(shown(picture, Fit::Tile))
                .size_full()
                .object_fit(gpui::ObjectFit::Cover),
        ),
        None => tile
            .flex()
            .items_center()
            .gap(px(9.0))
            .pl(px(if large { 12.0 } else { 8.0 }))
            // Room for the disc, so a long name never runs under it.
            .pr(px(if large { 38.0 } else { 30.0 }))
            .bg(theme.c.card2)
            .child(
                div()
                    .flex_none()
                    .w(px(if large { 52.0 } else { 34.0 }))
                    .h(px(if large { 60.0 } else { 38.0 }))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(theme.skin.radius_sm)
                    .bg(theme.c.panel)
                    .border(theme.skin.line_width)
                    .border_color(theme.c.line2)
                    .font_family(theme.skin.mono.clone())
                    .text_size(px(if large { 11.0 } else { 8.5 }))
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .text_color(theme.c.muted)
                    .child(extension(&file.name)),
            )
            .child(
                div()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .max_w(px(130.0))
                            .truncate()
                            .text_size(px(11.5))
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .child(file.name.clone()),
                    )
                    .child(
                        div()
                            .mt(px(1.0))
                            .text_size(px(10.0))
                            .text_color(theme.c.dim)
                            .child(super::bytes_in_words(file.size)),
                    ),
            ),
    };
    let name = file.name.clone();
    tile.child(
        div().absolute().top(px(4.0)).right(px(4.0)).child(
            IconButton::at("staged-remove", at, "x")
                .size(close)
                .glyph_size(if large { 11.0 } else { 9.0 })
                .variant(Variant::Glass)
                .corner(super::kit::Corner::Round)
                .tip(t!("Remove {{name}}", name = name))
                .on_click(cx.listener(move |shell, _, _, cx| shell.unstage(at, cx))),
        ),
    )
}

/// One of the things to decide, unfolded: what it is, its chips, and a
/// note at the far end about what the choice taken means.
fn row(
    label: SharedString,
    chips: impl IntoElement,
    note: SharedString,
    first: bool,
    theme: &Theme,
) -> gpui::Div {
    div()
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(4.0))
        .pt(px(if first { 7.0 } else { 6.0 }))
        .pb(px(4.0))
        .when(first, |row| {
            row.mt(px(2.0))
                .border_t(theme.skin.line_width)
                .border_color(theme.c.line)
        })
        .child(
            div()
                .flex_none()
                .text_size(px(11.0))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .text_color(theme.c.muted)
                .child(label),
        )
        .child(div().min_w_0().child(chips))
        .child(
            div()
                .ml_auto()
                .flex_none()
                .text_size(px(10.5))
                .text_color(theme.c.dim)
                .child(note),
        )
}

/// When something kept `secs` from now runs out, as the note says it:
/// `Nov 21, 3:15 PM`.
fn expiry(secs: u64) -> String {
    let at = chrono::Local::now()
        + chrono::Duration::seconds(i64::try_from(secs).unwrap_or(i64::MAX / 2));
    let language = crate::words::spoken();
    let time = crate::formats::time_sample(
        crate::store::Hours::Auto,
        language,
        (chrono::Timelike::hour(&at), chrono::Timelike::minute(&at)),
    );
    format!("{}, {time}", at.format("%b %-d"))
}

/// The options, unfolded: how large pictures go, who can reach what is
/// sent, and for how long it is kept.
fn options(
    staged: &Staged,
    (here, audience): (&SharedString, Option<SharedString>),
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Vec<gpui::AnyElement> {
    let mut rows = Vec::new();
    let shrinks = staged.shrinks();
    if shrinks {
        let quality = Choices::new(
            "share-quality",
            Shape::Chips,
            vec![
                Choice::new(t!("Compressed"))
                    .glyph("minimize")
                    .detail(super::bytes_in_words(staged.picture_bytes(true))),
                Choice::new(t!("Full quality"))
                    .glyph("maximize")
                    .detail(super::bytes_in_words(staged.picture_bytes(false))),
            ],
            usize::from(staged.full),
        )
        .on_choose(cx.listener(|shell, at: &usize, _, cx| {
            let full = *at == 1;
            shell.restage(|staged| staged.full = full, cx);
        }));
        let note = if staged.full {
            t!("Sent exactly as they are")
        } else {
            t!("Photos fit inside 2048 px")
        };
        rows.push(row(t!("Sending as"), quality, note, true, theme).into_any_element());
    }
    let to = To::ALL.iter().position(|to| *to == staged.to).unwrap_or(0);
    let reach = Choices::new(
        "share-to",
        Shape::Chips,
        vec![
            Choice::new(here.clone()).glyph("users"),
            Choice::new(t!("Anyone with link")).glyph("link-2"),
            Choice::new(t!("Password")).glyph("lock"),
        ],
        to,
    )
    .on_choose(cx.listener(|shell, at: &usize, _, cx| {
        if let Some(to) = To::ALL.get(*at).copied() {
            shell.restage(|staged| staged.to = to, cx);
        }
    }));
    let note = match (staged.to, audience) {
        (To::Link, _) => t!("Public URL, no sign-in"),
        (To::Password, _) => t!("Password unlocks the link"),
        (To::Here, Some(channel)) => t!("Members of #{{channel}} only", channel = channel),
        (To::Here, None) => t!("Just the two of you"),
    };
    rows.push(row(t!("Visible to"), reach, note, !shrinks, theme).into_any_element());
    if staged.to == To::Password {
        rows.push(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .px(px(4.0))
                .pt(px(2.0))
                .pb(px(6.0))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .h(px(30.0))
                        .px(px(10.0))
                        .flex()
                        .items_center()
                        .rounded(px(9.0))
                        .bg(theme.c.card2)
                        .border(theme.skin.line_width)
                        .border_color(theme.c.accent_line)
                        .font_family(theme.skin.mono.clone())
                        .text_size(px(12.0))
                        .child(staged.password.clone()),
                )
                .child(
                    super::kit::Button::new("share-generate", t!("Generate"))
                        .size(super::kit::Size::Small)
                        .tone(super::kit::Tone::Accent)
                        .on_click(cx.listener(|shell, _, _, cx| shell.generate_password(cx))),
                )
                .into_any_element(),
        );
    }
    let lasts = LASTING
        .iter()
        .position(|lasts| *lasts == staged.lasts)
        .unwrap_or(2);
    let lasting = Choices::new(
        "share-lasts",
        Shape::Chips,
        vec![
            Choice::new(t!("Never")),
            Choice::new(t!("24 hours")),
            Choice::new(t!("7 days")),
        ],
        lasts,
    )
    .on_choose(cx.listener(|shell, at: &usize, _, cx| {
        if let Some(lasts) = LASTING.get(*at).copied() {
            shell.restage(|staged| staged.lasts = lasts, cx);
        }
    }));
    let note = match staged.lasts {
        Lasts::Always => t!("Never expires"),
        lasts => t!("Expires {{at}}", at = expiry(lasts.secs())),
    };
    rows.push(row(t!("Expires"), lasting, note, false, theme).into_any_element());
    rows
}

/// `content` as one of the composer's trays (what waits to go out, what is
/// going up): on a theme that plates the composer, a plate of its own
/// above the composer's row, filled as a field is; on any other, a strip at
/// the top of the composer, closed by a hairline.
pub(super) fn tray_of(content: gpui::Div, theme: &Theme) -> gpui::AnyElement {
    if theme.skin.marks.composer_plates {
        Paper::control(theme.c.input, theme.c.line2)
            .flex_none()
            .px(px(11.0))
            .py(px(5.0))
            .mb(px(5.0))
            .child(content)
            .into_any_element()
    } else {
        content
            .flex_none()
            .px(px(11.0))
            .py(px(5.0))
            .border_b(theme.skin.line_width)
            .border_color(gpui::Hsla {
                a: theme.c.line2.a * 0.4,
                ..theme.c.line2
            })
            .into_any_element()
    }
}

/// The files waiting above the composer, if any are: the tiles on one line
/// that scrolls sideways, a dashed square that adds another, and at the far
/// end the button that unfolds the options with how they stand under it.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<gpui::AnyElement> {
    let staged = shell.staged_here()?;
    let here = match shell.open {
        Some(Conversation::Direct(_)) => t!("This conversation"),
        _ => t!("This channel"),
    };
    let side = if staged.unfolded { TILE_SMALL } else { TILE };
    let tiles = staged
        .files
        .iter()
        .enumerate()
        .map(|file| tile(file, side, theme, cx).into_any_element())
        .collect::<Vec<_>>();
    let add = IconButton::new("staged-add", "plus")
        .dims(if staged.unfolded { 44.0 } else { 72.0 }, side)
        .glyph_size(14.0)
        .variant(Variant::Dashed)
        .tip(t!("Add another file"))
        .on_click(cx.listener(|shell, _, _, cx| shell.pick_file_to_send(cx)));
    let unfolded = staged.unfolded;
    let summary = staged.summary(&here);
    let content = div()
        .debug_selector(|| "staged".to_owned())
        .flex()
        .flex_col()
        .child(
            div()
                .flex()
                .items_start()
                .gap(px(12.0))
                .px(px(4.0))
                .py(px(6.0))
                .child(
                    div()
                        .id("staged-strip")
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .overflow_x_scroll()
                        .children(tiles)
                        .child(add),
                )
                .child(
                    div()
                        .flex_none()
                        .pt(px(2.0))
                        .flex()
                        .flex_col()
                        .items_end()
                        .gap(px(3.0))
                        .child(
                            ChipButton::new(
                                "staged-options",
                                t!("Options"),
                                if unfolded { "chevron-up" } else { "chevron-down" },
                            )
                            .tip(t!("Sending options"))
                            .on_click(cx.listener(move |shell, _, _, cx| {
                                shell.restage(|staged| staged.unfolded = !unfolded, cx);
                            })),
                        )
                        .child(
                            div()
                                .debug_selector(|| "staged-summary".to_owned())
                                .pr(px(2.0))
                                .whitespace_nowrap()
                                .text_size(px(10.0))
                                .text_color(theme.c.dim)
                                .child(summary),
                        ),
                ),
        )
        .when(unfolded, |tray| {
            tray.children(options(staged, (&here, shell.audience()), theme, cx))
        });
    Some(tray_of(content, theme))
}

#[cfg(test)]
impl Shell {
    /// The line under the options' button, where files wait here.
    pub(super) fn staged_summary(&self) -> Option<String> {
        let here = match self.open {
            Some(Conversation::Direct(_)) => t!("This conversation"),
            _ => t!("This channel"),
        };
        self.staged_here().map(|staged| staged.summary(&here))
    }
}
