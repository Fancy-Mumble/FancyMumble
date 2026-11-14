//! The band across the top of the window: the brand, where you are, and
//! the window's own controls, since the window draws its own frame.

use gpui::{
    IntoElement, MouseButton, ParentElement, SharedString, Styled, Window, WindowControlArea, div,
    prelude::*, px,
};

use super::Shell;
use super::frame;
use super::kit::{IconButton, Tone};
use super::widgets::{EMPHASIS, label};
use crate::theme::Theme;

/// The band's height, its hairline included, as the web UI draws it.
const HEIGHT: f32 = 44.0;

pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    window: &Window,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    // The servers as tabs, where they are listed up here; otherwise the
    // one on screen is named in the middle.
    let tabs = shell.panels.settings.server_switcher.tabs();
    // The server on screen, named in the middle of the band.
    let place = shell
        .snapshot
        .sessions
        .iter()
        .find(|session| session.active && !shell.shows_connect_screen())
        .map(|session| {
            shell
                .session_livery(&session.key)
                .and_then(|livery| livery.name.clone())
                .unwrap_or_else(|| session.name.clone())
        });
    div()
        .id("band")
        .debug_selector(|| "band".to_owned())
        .flex_none()
        .h(px(HEIGHT))
        .relative()
        .flex()
        .items_center()
        .justify_between()
        .px(px(14.0))
        .bg(theme.c.bar)
        .border_b_1()
        .border_color(theme.c.line)
        .text_color(theme.c.bar_text)
        .map(handle)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(10.0))
                .child(brand_mark(theme))
                .child(
                    div()
                        .text_size(px(13.0))
                        .font_weight(EMPHASIS)
                        .mr(px(6.0))
                        .child(label("Fancy Mumble", theme)),
                )
                .when(tabs, |brand| brand.child(super::band_tabs::render(shell, theme, cx))),
        )
        .when_some(place.filter(|_| !tabs), |band, place| {
            band.child(centred(&place, theme))
        })
        .child(controls(Tone::Bar, window))
}

/// `area` made a handle of the window's: drag to move, double-click to
/// zoom or restore, as the system's title bar does. A control inside it
/// (a button, a tab, a field) keeps its own presses: the area holds the
/// window only where nothing above it takes a press.
fn handle<E: InteractiveElement + IntoElement + 'static>(area: E) -> E {
    // Windows moves and zooms by itself for what it is told is a caption,
    // and has no other way to be asked; nothing else reads the hint.
    area.window_control_area(WindowControlArea::Drag)
        // A press here is the handle's alone. The shell behind it takes the
        // focus on any press it sees, and Windows will not drag a window by
        // a press something claimed.
        .occlude()
        // Not on Windows as well: its own double-click already zooms or
        // restores, and a second zoom would undo the restore.
        .when(!cfg!(target_os = "windows"), |area| {
            area.on_mouse_down(MouseButton::Left, |event, window, _| {
                if event.click_count == 2 {
                    window.zoom_window();
                } else {
                    window.start_window_move();
                }
            })
        })
}

/// Where a theme that draws no band is held: a strip along the window's top
/// edge over whatever panels reach it, as the web UI lays one (24 pixels,
/// which clears every mark a drawn skin puts up there). The window's corner
/// controls stand above it.
pub(super) fn drag_strip() -> impl IntoElement + use<> {
    handle(
        div()
            .id("drag-strip")
            .debug_selector(|| "drag-strip".to_owned())
            .absolute()
            .top_0()
            .left_0()
            .right_0()
            .h(px(STRIP)),
    )
}

/// How tall the strip a theme with no band is held by is.
const STRIP: f32 = 24.0;

/// `name` in the middle of the band, whatever stands at its two ends.
fn centred(name: &SharedString, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .debug_selector(|| "band-place".to_owned())
                .text_size(px(12.5))
                .font_weight(EMPHASIS)
                .child(label(name, theme)),
        )
}

/// The window's controls on their own, for a theme that draws no band: they
/// float over the window's top trailing corner instead.
pub(super) fn corner_controls(theme: &Theme, window: &Window) -> impl IntoElement + use<> {
    // A tab of the rail's colour hung from the top edge, its leading side
    // leaning, with the product's name on it (the web UI's corner
    // `WindowControls`).
    let tab: Option<crate::theme::Cut> = "polygon(16px 0, 100% 0, 100% 100%, 0 100%)".parse().ok();
    let finish = super::kit::Finish::new(theme.c.rail, None);
    // The tab and its name hold the window too; its buttons take their
    // own presses.
    handle(
        div()
            .id("corner-controls")
            .debug_selector(|| "corner-controls".to_owned()),
    )
        .absolute()
        .top_0()
        .right_0()
        .map(|corner| match tab {
            Some(tab) => super::kit::cut_into(corner, tab, finish, px(0.0)),
            None => corner.bg(theme.c.rail),
        })
        .px(px(14.0))
        .py(px(3.0))
        .flex()
        .items_center()
        .gap(px(12.0))
        .child(
            div()
                .text_size(px(10.0))
                .font_weight(gpui::FontWeight::BOLD)
                .text_color(theme.c.bar_dim)
                .child(super::kit::spaced("FANCY MUMBLE", 0.18 * 10.0)),
        )
        .child(controls(Tone::Bar, window))
}

/// Minimise, maximise and close, where the window draws its own frame. A
/// window the system frames already has those three, and a second set would
/// be a second way to be wrong.
fn controls(tone: Tone, window: &Window) -> impl IntoElement + use<> {
    let control = |id, glyph, side: f32| {
        IconButton::new(id, glyph)
            .size(side)
            .glyph_size(side - 10.0)
            .tone(tone)
    };
    div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .when(frame::draws_controls(window), |controls| {
            controls
                .child(
                    control("minimise", "minus", 23.0)
                        .tip("Minimise")
                        .on_click(|_, window, _| window.minimize_window()),
                )
                .child(
                    control("maximise", "square", 21.0)
                        .tip("Maximise")
                        .on_click(|_, window, _| window.zoom_window()),
                )
                .child(
                    control("close", "x", 23.0)
                        .tip("Close")
                        .on_click(|_, _, cx| cx.quit()),
                )
        })
}

/// The round brand mark at the band's leading edge.
fn brand_mark(theme: &Theme) -> impl IntoElement + use<> {
    div()
        .flex_none()
        .size(px(22.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.accent)
        .flex()
        .items_center()
        .justify_center()
        // The monogram is wider than it is tall: 1391 by 844.
        .child(
            gpui::svg()
                .path("icons/brand.svg")
                .w(px(15.8))
                .h(px(9.6))
                .text_color(theme.c.on_accent),
        )
}
