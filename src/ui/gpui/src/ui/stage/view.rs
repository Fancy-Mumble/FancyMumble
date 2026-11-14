//! The stage as it is drawn (`ScreenShareStage.tsx`): the feed in focus
//! large, with its caption over the top and its controls over the foot,
//! the others in a strip down its side, and under it what went wrong. A
//! share of a screen and a camera is two feeds, as the web client's
//! `buildFeeds` makes it: the camera has a tile of its own, and can be shown
//! large in its turn.

use gpui::{AnyElement, Context, Hsla, ParentElement, SharedString, Styled, Window, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::Button;
use super::{large, menu, picker, strip};
use crate::engine::Session;
use crate::share::shares::{Shown, Whose};
use crate::share::tracks::Content;
use crate::theme::{ActiveTheme, Theme};
use crate::words::t;

/// How tall the stage is.
const HEIGHT: f32 = 324.0;
/// What a picture lies on.
pub(super) const WELL: Hsla = Hsla {
    h: 0.61,
    s: 0.41,
    l: 0.034,
    a: 1.0,
};

/// One feed of the stage: a share's screen (or its camera shared alone),
/// or the camera shared beside a screen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Feed {
    pub each: Shown,
    pub camera: bool,
}

impl Feed {
    pub(crate) fn session(&self) -> Session {
        self.each.session
    }
}

impl Shell {
    /// The stage's feeds, in order: each share, and its camera after it.
    pub(crate) fn stage_feeds(&self) -> Vec<Feed> {
        let mut feeds = Vec::new();
        for each in self.shown_shares() {
            let main = each.tracks.main().and_then(|mid| each.tracks.content(mid));
            let camera_beside = main == Some(Content::Screen)
                && each
                    .tracks
                    .tracks
                    .iter()
                    .any(|track| track.content == Content::Camera);
            feeds.push(Feed {
                each: each.clone(),
                camera: false,
            });
            if camera_beside {
                feeds.push(Feed { each, camera: true });
            }
        }
        feeds
    }

    /// The feed shown large: the one picked, else the first.
    pub(crate) fn large_feed(&self, feeds: &[Feed]) -> Option<Feed> {
        let shown: Vec<Shown> = feeds.iter().filter(|feed| !feed.camera).map(|feed| feed.each.clone()).collect();
        let session = self.stage.shares.focused(&shown)?.session;
        let camera = self.stage.large_camera == Some(session);
        feeds
            .iter()
            .find(|feed| feed.session() == session && feed.camera == camera)
            .or_else(|| feeds.iter().find(|feed| feed.session() == session))
            .cloned()
    }
}

/// The stage in the conversation, under its header; nothing while nobody
/// in the channel shares, or while it is over the whole window.
pub(in crate::ui) fn render(shell: &Shell, window: &Window, cx: &mut Context<Shell>) -> Option<AnyElement> {
    let theme = ActiveTheme::get(cx);
    let feeds = shell.stage_feeds();
    let notice = shell.stage.notice.clone().map(|notice| notice_strip(notice, &theme, cx));
    if feeds.is_empty() || shell.stage.expanded {
        return notice;
    }
    Some(
        div()
            .flex_none()
            .flex()
            .flex_col()
            .child(stage_box(shell, &feeds, false, &theme, window, cx))
            .children(notice)
            .into_any_element(),
    )
}

/// What floats over the window: the stage over all of it, the picker, the
/// stage's menu.
pub(in crate::ui) fn overlays(shell: &Shell, window: &Window, cx: &mut Context<Shell>) -> Vec<AnyElement> {
    let theme = ActiveTheme::get(cx);
    let mut over = Vec::new();
    let feeds = shell.stage_feeds();
    if shell.stage.expanded && !feeds.is_empty() {
        over.push(
            div()
                .id("stage-whole")
                .absolute()
                .top_0()
                .left_0()
                .size_full()
                .occlude()
                .bg(theme.c.bg0)
                .px(px(16.0))
                .py(px(14.0))
                .flex()
                .child(stage_box(shell, &feeds, true, &theme, window, cx))
                .into_any_element(),
        );
    }
    if let Some(picker) = shell.stage.picker.as_ref() {
        over.push(picker::render(picker, &theme, cx));
    }
    if let Some(open) = shell.stage.menu
        && let Some(feed) = feeds
            .iter()
            .find(|feed| feed.session() == open.session && feed.camera == open.camera)
    {
        let title = format!("{} · {}", name_of(shell, &feed.each), kind_of(shell, feed));
        over.push(menu::render(shell, open, feed.each.whose, &title, &theme, window, cx));
    }
    over
}

/// Who a share is by, as the stage names them.
pub(super) fn name_of(shell: &Shell, each: &Shown) -> SharedString {
    match each.whose {
        Whose::Mine => t!("You"),
        Whose::MineElsewhere => t!("You, on another device"),
        Whose::Theirs => shell
            .snapshot
            .users
            .iter()
            .find(|user| user.session == each.session)
            .map_or_else(|| t!("Someone"), |user| user.name.clone()),
    }
}

/// What a feed shows, in a word.
pub(super) fn kind_of(shell: &Shell, feed: &Feed) -> &'static str {
    let each = &feed.each;
    let main = each.tracks.main().and_then(|mid| each.tracks.content(mid));
    if feed.camera || main == Some(Content::Camera) {
        return "camera";
    }
    let window = each.whose == Whose::Mine
        && shell.stage.shares.own().is_some_and(|own| {
            own.sources
                .first()
                .is_some_and(|source| source.kind == crate::share::SourceKind::Window)
        });
    if window { "window" } else { "screen" }
}

/// The stage: the feed in focus, and the strip of the others.
fn stage_box(
    shell: &Shell,
    feeds: &[Feed],
    whole: bool,
    theme: &Theme,
    window: &Window,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let focused = shell.large_feed(feeds);
    let rail = feeds.len() > 1;
    div()
        .id("stage")
        .debug_selector(|| "stage".to_owned())
        .flex()
        .gap(px(6.0))
        .p(px(6.0))
        .rounded(theme.skin.radius_lg)
        .border_1()
        .border_color(theme.c.line2)
        .bg(theme.c.panel)
        .map(|stage| {
            if whole {
                stage.flex_1().size_full()
            } else {
                stage.mx(px(20.0)).mt(px(12.0)).h(px(HEIGHT))
            }
        })
        .children(focused.as_ref().map(|feed| large::large(shell, feed, theme, window, cx)))
        .when(rail, |stage| stage.child(strip::strip(shell, feeds, focused.as_ref(), theme, cx)))
        .into_any_element()
}

/// What went wrong, under the stage, until dismissed.
fn notice_strip(notice: SharedString, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    div()
        .debug_selector(|| "stage-notice".to_owned())
        .mx(px(20.0))
        .mt(px(6.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .text_size(px(12.0))
        .text_color(theme.c.bad)
        .child(div().flex_1().min_w_0().child(notice))
        .child(
            Button::new("stage-notice-dismiss", t!("Dismiss")).on_click(cx.listener(|shell, _, _, cx| {
                shell.stage.notice = None;
                cx.notify();
            })),
        )
        .into_any_element()
}

impl Shell {
    /// Put the frame of the feed shown large on the clipboard, as it is
    /// drawn.
    pub(super) fn copy_frame(&mut self, cx: &mut Context<Self>) {
        let frame = self.large_track().and_then(|track| track.screen.borrow().frame());
        let png = frame.and_then(|(mut rgba, (width, height))| {
            for pixel in rgba.as_chunks_mut::<4>().0 {
                pixel.swap(0, 2);
            }
            let frame = image::RgbaImage::from_raw(width, height, rgba)?;
            let mut png = Vec::new();
            frame
                .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
                .ok()?;
            Some(png)
        });
        let Some(png) = png else {
            self.toast(t!("Could not capture that frame"), super::super::toasts::Kind::Told, cx);
            return;
        };
        cx.write_to_clipboard(gpui::ClipboardItem::new_image(&gpui::Image::from_bytes(
            gpui::ImageFormat::Png,
            png,
        )));
        self.toast(t!("Frame copied to the clipboard"), super::super::toasts::Kind::Done, cx);
    }

    /// The track of the feed shown large.
    pub(in crate::ui) fn large_track(&self) -> Option<&super::Track> {
        let feed = self.large_feed(&self.stage_feeds())?;
        let watched = self.stage.feeds.get(&feed.session())?;
        watched.track(feed.camera).or_else(|| Some(watched.main()))
    }

    /// Escape: the stage's menu, its picker or its whole window go first.
    /// Says whether one went.
    pub(in crate::ui) fn dismiss_stage(&mut self, cx: &mut Context<Self>) -> bool {
        let stage = &mut self.stage;
        let went = stage.menu.take().is_some() || stage.picker.take().is_some() || std::mem::take(&mut stage.expanded);
        if went {
            cx.notify();
        }
        went
    }
}
