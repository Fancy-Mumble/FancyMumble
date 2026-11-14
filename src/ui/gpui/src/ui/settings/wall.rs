//! The picture behind every conversation, on the Personalize page, as the
//! web UI offers it: the window's own ground or one of the last pictures
//! chosen (kept on a shelf, so going back to one is a click), a way to
//! choose another, where its subject is, and how far it is blurred,
//! shown and darkened.
//!
//! The web UI also takes a video; this client has no player for one
//! behind the conversation, so it takes pictures.

use std::sync::Arc;

use gpui::{Context, Div, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{FocusPicker, Reachable, Slider, SliderRow};
use super::super::widgets::{EMPHASIS, icon};
use crate::store::{CHAT_BG_RECENTS_MAX, ChatBackground};
use crate::theme::Theme;
use crate::words::t;

/// How far the picture behind a conversation is washed out until told
/// otherwise: the web UI's opacity of a quarter.
pub(in crate::ui) const WALL_WASH: f32 = 0.75;
/// How far it is darkened until told otherwise, as in the web UI.
pub(in crate::ui) const WALL_DIM: f32 = 0.5;
/// The furthest the picture behind a conversation is blurred, in pixels.
const WALL_BLUR_MOST: u8 = 40;

/// How wide a tile of the shelf is, and how tall its picture.
const TILE: f32 = 104.0;
const TILE_PICTURE: f32 = 64.0;

/// The name a picture is shelved under where nothing is kept on disk.
const UNKEPT: &str = "unkept";

/// The shelf's pictures, read while the Personalize page is open and let
/// go of when it is left.
#[derive(Default)]
pub(in crate::ui) struct Shelf {
    tiles: Vec<(String, Arc<gpui::Image>)>,
}

impl Shell {
    /// Put `picture`, an encoded image, behind every conversation, and on
    /// the shelf; none shows the window's own ground, keeping the shelf.
    /// Kept for the next launch.
    pub(in crate::ui) fn set_wall(&mut self, picture: Option<Vec<u8>>, cx: &mut Context<Self>) {
        let Some(picture) = picture else {
            self.show_shelved(None, cx);
            return;
        };
        let file = match &self.store {
            Some(store) => match store.keep_chat_background(&picture) {
                Ok(file) => file,
                Err(error) => {
                    self.notice = Some(t!(
                        "The picture could not be kept: {{error}}",
                        error = error
                    ));
                    return;
                }
            },
            None => UNKEPT.to_owned(),
        };
        let _ = self.chrome.walls.remember(ChatBackground::new(file));
        self.chrome.wall = crate::picture::picture(picture).map(Arc::new);
        self.wall_changed(cx);
    }

    /// Put `picture` behind every conversation for this run alone.
    pub(crate) fn show_wall(&mut self, picture: Vec<u8>, cx: &mut Context<Self>) {
        self.chrome.wall = crate::picture::picture(picture).map(Arc::new);
        cx.notify();
    }

    /// Show the shelved picture kept as `file`; none, the window's ground.
    fn show_shelved(&mut self, file: Option<&str>, cx: &mut Context<Self>) {
        self.chrome.walls.show(file);
        self.chrome.wall = self.chrome.walls.current().and_then(|current| {
            self.panels
                .settings
                .shelf
                .tiles
                .iter()
                .find(|(file, _)| *file == current.file)
                .map(|(_, picture)| Arc::clone(picture))
                .or_else(|| {
                    let bytes = self.store.as_ref()?.chat_background(&current.file)?;
                    crate::picture::picture(bytes).map(Arc::new)
                })
        });
        self.wall_changed(cx);
    }

    /// Take the picture kept as `file` off the shelf, and its file with it.
    fn forget_wall(&mut self, file: &str, cx: &mut Context<Self>) {
        if self.chrome.walls.forget(file) && self.chrome.walls.shown.is_none() {
            self.chrome.wall = None;
        }
        self.wall_changed(cx);
    }

    /// The shelf changed: let go of the files it no longer names, read it
    /// again for the page, keep it, and draw.
    fn wall_changed(&mut self, cx: &mut Context<Self>) {
        if let Some(store) = &self.store {
            store.prune_chat_backgrounds(&self.chrome.walls);
        }
        if self.panels.settings.open {
            self.read_shelf();
        }
        self.remember_settings(cx);
        cx.notify();
    }

    /// Read the shelf's pictures, for the Personalize page.
    pub(in crate::ui) fn read_shelf(&mut self) {
        let current = self.chrome.walls.shown.clone();
        let tiles = self
            .chrome
            .walls
            .recents
            .iter()
            .filter_map(|entry| {
                let picture = self
                    .store
                    .as_ref()
                    .and_then(|store| store.chat_background(&entry.file))
                    .and_then(crate::picture::picture)
                    .map(Arc::new)
                    .or_else(|| {
                        (current.as_ref() == Some(&entry.file))
                            .then(|| self.chrome.wall.clone())
                            .flatten()
                    })?;
                Some((entry.file.clone(), picture))
            })
            .collect();
        self.panels.settings.shelf = Shelf { tiles };
    }

    /// Let go of the shelf's pictures: the page is not showing them.
    pub(in crate::ui) fn put_shelf_away(&mut self) {
        self.panels.settings.shelf = Shelf::default();
    }

    /// Blur the picture behind a conversation this far along the bar: up
    /// to [`WALL_BLUR_MOST`] pixels.
    fn set_wall_blur(&mut self, along: f32, cx: &mut Context<Self>) {
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a share of a small whole number"
        )]
        let blur = (along.clamp(0.0, 1.0) * f32::from(WALL_BLUR_MOST)).round() as u8;
        self.chrome.wall_blur = blur;
        self.remember_settings(cx);
        cx.notify();
    }

    /// Show this much of the picture: what is not shown is washed out with
    /// the window's colour.
    fn set_wall_opacity(&mut self, opacity: f32, cx: &mut Context<Self>) {
        self.chrome.wall_wash = 1.0 - hundredths(opacity);
        self.remember_settings(cx);
        cx.notify();
    }

    /// Darken the picture this far, from not at all to black.
    fn set_wall_dim(&mut self, dim: f32, cx: &mut Context<Self>) {
        self.chrome.wall_dim = hundredths(dim);
        self.remember_settings(cx);
        cx.notify();
    }

    /// Keep the point `at` of the picture shown in view, wherever the
    /// conversation's room cuts it.
    fn set_wall_focus(&mut self, (x, y): (f32, f32), cx: &mut Context<Self>) {
        self.chrome.walls.focus(x, y);
        self.remember_settings(cx);
        cx.notify();
    }
}

/// `share`, from 0 to 1, to the hundredth: the web UI's bars move in steps
/// of one per cent.
fn hundredths(share: f32) -> f32 {
    (share.clamp(0.0, 1.0) * 100.0).round() / 100.0
}

/// The group: its heading, the shelf, the way to choose a picture, where
/// its subject is, and the three bars.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let opacity = 1.0 - shell.chrome.wall_wash;
    let (blur, dim) = (shell.chrome.wall_blur, shell.chrome.wall_dim);
    let walls = &shell.chrome.walls;
    let lit = &shell.panels.settings.lit;
    let shown = walls.current().zip(shell.chrome.wall.clone());
    div()
        .child(super::heading(lit, t!("Chat background")).hint(t!(
            "Keeps your last {{max}}, so switching back never means picking the file again.",
            max = CHAT_BG_RECENTS_MAX
        )))
        .child(
            div()
                .flex()
                .flex_wrap()
                .gap(px(10.0))
                .child(default_tile(walls.shown.is_none(), theme, cx))
                .children(shell.panels.settings.shelf.tiles.iter().enumerate().map(
                    |(at, (file, picture))| {
                        let entry = walls.recents.iter().find(|entry| &entry.file == file);
                        let focus = entry.map_or((0.5, 0.5), |entry| (entry.focus_x, entry.focus_y));
                        let active = walls.shown.as_ref() == Some(file);
                        saved_tile((at, file.clone()), picture, focus, active, theme, cx)
                    },
                )),
        )
        .child(choose(theme, cx))
        .when_some(shown, |group, (current, picture)| {
            group
                .child(super::heading(lit, t!("Focus point")).hint(t!(
                    "Click or drag the part that matters. A column narrower or shorter than the picture crops the rest away, and it keeps this point."
                )))
                .child(
                    FocusPicker::new("wall-focus", picture, (current.focus_x, current.focus_y))
                        .on_change(cx.listener(|shell, at: &(f32, f32), _, cx| {
                            shell.set_wall_focus(*at, cx);
                        })),
                )
        })
        .child(
            div()
                .mt(px(14.0))
                .flex()
                .gap(px(24.0))
                .child(SliderRow::new(
                    t!("Blur"),
                    SharedString::from(blur.to_string()),
                    Slider::new("wall-blur", f32::from(blur) / f32::from(WALL_BLUR_MOST))
                        .on_change(cx.listener(|shell, at: &f32, _, cx| {
                            shell.set_wall_blur(*at, cx);
                        })),
                ))
                .child(SliderRow::new(
                    t!("Opacity"),
                    t!("{{value}}%", value = (opacity * 100.0).round()),
                    Slider::new("wall-opacity", opacity).on_change(cx.listener(
                        |shell, at: &f32, _, cx| shell.set_wall_opacity(*at, cx),
                    )),
                ))
                .child(SliderRow::new(
                    t!("Dim"),
                    t!("{{value}}%", value = (dim * 100.0).round()),
                    Slider::new("wall-dim", dim).on_change(cx.listener(
                        |shell, at: &f32, _, cx| shell.set_wall_dim(*at, cx),
                    )),
                )),
        )
}

/// A tile of the shelf: what it shows, and its name under it, in the
/// heading weight while it is the one behind the conversation.
fn tile(
    id: SharedString,
    shows: Div,
    name: SharedString,
    active: bool,
    theme: &Theme,
) -> gpui::Stateful<Div> {
    let selector = id.clone();
    div()
        .id(id)
        .debug_selector(move || selector.to_string())
        .w(px(TILE))
        .cursor_pointer()
        .child(shows.h(px(TILE_PICTURE)).rounded(theme.skin.radius_md))
        .child(
            div()
                .mt(px(6.0))
                .flex()
                .justify_center()
                .text_size(px(11.5))
                .map(|label| {
                    if active {
                        label.font_weight(EMPHASIS).text_color(theme.c.text)
                    } else {
                        label.text_color(theme.c.muted)
                    }
                })
                .child(name),
        )
}

/// No picture: the window's own ground.
fn default_tile(active: bool, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let shows = div()
        .flex()
        .items_center()
        .justify_center()
        .border_1()
        .border_dashed()
        .border_color(theme.c.line2)
        .text_size(px(16.0))
        .text_color(theme.c.dim)
        .child("\u{2205}");
    let tile = tile("wall-default".into(), shows, t!("Default"), active, theme)
        .on_click(cx.listener(|shell, _, _, cx| shell.set_wall(None, cx)));
    Reachable::new("wall-default", tile)
}

/// A picture on the shelf, drawn small through the pictures' own copies
/// and cut around its subject, with the way to take it off the shelf. The
/// one behind the conversation is ringed in the accent.
fn saved_tile(
    (at, file): (usize, String),
    picture: &Arc<gpui::Image>,
    (x, y): (f32, f32),
    active: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let shows = div()
        .relative()
        .overflow_hidden()
        .map(|shows| {
            if active {
                shows.shadow(vec![gpui::BoxShadow {
                    color: theme.c.accent,
                    offset: gpui::point(px(0.0), px(0.0)),
                    blur_radius: px(0.0),
                    spread_radius: px(2.0),
                }])
            } else {
                shows.border_1().border_color(theme.c.line)
            }
        })
        .child(
            super::super::kit::Wall::new(Arc::clone(picture))
                .focus(x, y)
                .tile(),
        );
    let (id, remove): (SharedString, SharedString) = if active {
        ("wall-current".into(), "wall-remove".into())
    } else {
        (
            format!("wall-saved-{at}").into(),
            format!("wall-remove-{at}").into(),
        )
    };
    let name = if active { t!("Current") } else { t!("Saved") };
    let chosen = file.clone();
    let tile = tile(id.clone(), shows, name, active, theme)
        .on_click(cx.listener(move |shell, _, _, cx| shell.show_shelved(Some(&chosen), cx)));
    let selector = remove.clone();
    let forget = div()
        .id(remove.clone())
        .debug_selector(move || selector.to_string())
        .absolute()
        .top(px(5.0))
        .right(px(5.0))
        .size(px(18.0))
        .rounded_full()
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .bg(gpui::hsla(0.0, 0.0, 0.0, 0.55))
        .opacity(0.7)
        .hover(|style| style.opacity(1.0).bg(gpui::hsla(0.0, 0.0, 0.0, 0.75)))
        .tooltip(super::super::kit::keyed_tip(
            t!("Remove this background"),
            None::<&str>,
        ))
        .on_click(cx.listener(move |shell, _, _, cx| {
            cx.stop_propagation();
            shell.forget_wall(&file, cx);
        }))
        .child(icon("x", 10.0, theme.c.text));
    div()
        .relative()
        .child(Reachable::new(id, tile))
        .child(Reachable::new(remove, forget).corner(px(9.0)))
}

/// The way to choose a picture, drawn as a dashed box of its own.
fn choose(theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let accent_line = theme.c.accent_line;
    let button = div()
        .id("wall-choose")
        .debug_selector(|| "wall-choose".to_owned())
        .mt(px(10.0))
        .flex()
        .items_center()
        .gap(px(9.0))
        .px(px(12.0))
        .py(px(9.0))
        .rounded(theme.skin.radius_md)
        .border_1()
        .border_dashed()
        .border_color(theme.c.line2)
        .text_size(px(11.0))
        .text_color(theme.c.dim)
        .cursor_pointer()
        .hover(move |style| style.border_color(accent_line))
        .on_click(cx.listener(|shell, _, _, cx| shell.pick_wall(cx)))
        .child(t!("Choose a picture — shown behind chat"));
    div().flex().child(Reachable::new("wall-choose", button))
}
