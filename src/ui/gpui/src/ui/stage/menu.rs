//! The stage's menu (`StageMenu.tsx`): how the share is laid in, copying
//! its frame, drawing, the whole window, the statistics, and for one's own
//! share its quality, its source and stopping it.

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, Pixels, Point, SharedString, Styled, Window,
    div, prelude::*, px,
};

use super::super::Shell;
use super::super::kit::{Hold, MenuItem, Sheet, icon};
use crate::engine::Session;
use crate::share::shares::Whose;
use crate::share::{Fit, Quality};
use crate::theme::Theme;
use crate::words::t;

/// The menu, open for one share at a place in the window.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct StageMenu {
    pub session: Session,
    /// Open for the camera beside the share's screen.
    pub camera: bool,
    pub at: Point<Pixels>,
}

const WIDTH: f32 = 232.0;
const ROW: f32 = 30.0;

/// What the menu offers for the share it is open for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Entry {
    Lay(Fit),
    Copy,
    Draw,
    Whole,
    Stats,
    PopOut,
    Overlay,
    Quality,
    Source,
    Stop,
}

/// The entries, in the web client's order.
fn entries(whose: Whose) -> Vec<Entry> {
    let mut entries: Vec<Entry> = Fit::ALL.into_iter().map(Entry::Lay).collect();
    entries.extend([Entry::Copy, Entry::Draw, Entry::Whole, Entry::Stats]);
    // As the web client: one's own share is not popped out.
    if whose != Whose::Mine {
        entries.push(Entry::PopOut);
    }
    if whose == Whose::Mine {
        entries.extend([Entry::Overlay, Entry::Quality, Entry::Source, Entry::Stop]);
    }
    entries
}

/// The name of a quality, as the menu shows it: the preset's, or Custom.
pub(super) fn quality_name(quality: Quality) -> SharedString {
    match quality {
        Quality::SD => "SD".into(),
        Quality::HD => "HD".into(),
        Quality::SOURCE => "SOURCE".into(),
        _ => t!("Custom"),
    }
}

/// The menu, where it was opened, kept inside the window.
pub(super) fn render(
    shell: &Shell,
    menu: StageMenu,
    whose: Whose,
    title: &str,
    theme: &Theme,
    window: &Window,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let entries = entries(whose);
    let viewport = window.viewport_size();
    let height = px(entries.len() as f32 * ROW + 60.0);
    let left = menu.at.x.min(viewport.width - px(WIDTH + 8.0)).max(px(4.0));
    let top = menu.at.y.min(viewport.height - height - px(8.0)).max(px(4.0));
    let rows: Vec<AnyElement> = entries
        .into_iter()
        .enumerate()
        .map(|(at, entry)| row(shell, entry, at, theme, cx))
        .collect();
    div()
        .id("stage-menu-backdrop")
        .debug_selector(|| "stage-menu-backdrop".to_owned())
        .absolute()
        .size_full()
        .top_0()
        .left_0()
        .occlude()
        .on_mouse_down(
            gpui::MouseButton::Left,
            cx.listener(|shell, _, _, cx| {
                shell.stage.menu = None;
                cx.notify();
            }),
        )
        .child(
            Sheet::new("stage-menu")
                .holds(Hold::Arrows)
                .absolute()
                .left(left)
                .top(top)
                .w(px(WIDTH))
                .flex()
                .flex_col()
                .p(px(5.0))
                .child(
                    div()
                        .px(px(10.0))
                        .py(px(6.0))
                        .text_size(px(10.5))
                        .text_color(theme.c.muted)
                        .child(title.to_uppercase()),
                )
                .children(rows),
        )
        .into_any_element()
}

/// One entry of the menu.
fn row(shell: &Shell, entry: Entry, at: usize, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let stage = &shell.stage;
    let drawing = shell
        .snapshot
        .current_channel
        .is_some_and(|channel| stage.drawing.contains(&channel));
    let on_off = |on: bool| if on { t!("On") } else { t!("Off") };
    let (glyph, says, ticked): (&'static str, SharedString, bool) = match entry {
        Entry::Lay(fit) => ("maximize", fit.name(), stage.shares.fit == fit),
        Entry::Copy => ("camera", t!("Copy this frame"), false),
        Entry::Draw if drawing => ("pencil", t!("Stop drawing"), false),
        Entry::Draw => ("pencil", t!("Draw on screen"), false),
        Entry::Whole if stage.expanded => ("minimize", t!("Exit fullscreen"), false),
        Entry::Whole => ("maximize", t!("Fullscreen"), false),
        Entry::Stats => (
            "chart-column",
            format!("{} · {}", t!("Stats for Nerds"), on_off(stage.stats_open)).into(),
            false,
        ),
        Entry::PopOut => ("picture-in-picture-2", t!("Pop out to window"), false),
        Entry::Overlay => ("pencil", t!("Show desktop overlay"), shell.overlay_open()),
        Entry::Quality => {
            let quality = stage.shares.own().map(|own| own.settings.quality).unwrap_or(Quality::HD);
            ("settings-2", format!("{} · {}", t!("Stream Quality"), quality_name(quality)).into(), false)
        }
        Entry::Source => ("screen-share", t!("Change source"), false),
        Entry::Stop => ("x", t!("Stop sharing"), false),
    };
    MenuItem::new(("stage-menu-item", at), says)
        .selector(format!("stage-menu-{at}"))
        .lead(icon(glyph, 13.0, theme.c.muted))
        .ticked(ticked)
        .danger(entry == Entry::Stop)
        .on_click(cx.listener(move |shell, _, window, cx| {
            shell.stage.menu = None;
            shell.take_stage_entry(entry, window, cx);
        }))
        .into_any_element()
}

impl Shell {
    /// Do what a menu entry says.
    fn take_stage_entry(&mut self, entry: Entry, window: &mut Window, cx: &mut Context<Self>) {
        match entry {
            Entry::Lay(fit) => self.lay_large(fit),
            Entry::Copy => self.copy_frame(cx),
            Entry::Draw => self.toggle_drawing(cx),
            Entry::Whole => self.toggle_whole_window(window, cx),
            Entry::Stats => self.stage.stats_open = !self.stage.stats_open,
            Entry::PopOut => self.pop_out(cx),
            Entry::Overlay => self.toggle_overlay(cx),
            Entry::Quality | Entry::Source => self.open_share_picker(cx),
            Entry::Stop => self.stop_share(cx),
        }
        cx.notify();
    }

    /// Open the stage's menu for `session`'s share at `at`.
    pub(super) fn open_stage_menu(&mut self, session: Session, camera: bool, at: Point<Pixels>, cx: &mut Context<Self>) {
        self.show_large(session, camera);
        self.stage.menu = Some(StageMenu { session, camera, at });
        cx.notify();
    }

    /// The stage over the whole window, or back. F11 puts the window over
    /// the whole screen, as it does for everything else.
    pub(super) fn toggle_whole_window(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        self.stage.expanded = !self.stage.expanded;
        cx.notify();
    }
}
