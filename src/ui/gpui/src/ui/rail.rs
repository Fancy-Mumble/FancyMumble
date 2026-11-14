//! The server rail down the window's leading edge: a tile for each server
//! the engine is on, a fainter one for each saved server it is not on, a
//! way to add another, and the way off the one showing.

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::kit::{Avatar, IconButton, Tone, Variant};
use crate::engine::SessionEntry;
use crate::theme::Theme;

/// Every tile, and the buttons that bracket them, are one square.
const TILE: f32 = 40.0;
/// How wide the rail is with the servers' names beside their tiles.
const WIDE: f32 = 220.0;

pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let wide = shell.chrome.rail_wide;
    let tiles: Vec<_> = shell
        .snapshot
        .sessions
        .iter()
        .map(|session| session_tile(shell, session, wide, theme, cx))
        .collect();
    let saved = saved_tiles(shell, wide, theme, cx);
    // A theme may stand the tiles further apart, and below a band of tape.
    let marks = theme.skin.marks;
    let (gap, top) = marks.rail_spacing.unwrap_or((8.0, 10.0));
    div()
        .flex_none()
        .w(if wide {
            px(WIDE)
        } else {
            theme.skin.rail_width
        })
        .h_full()
        .relative()
        .flex()
        .flex_col()
        .when(!wide, Styled::items_center)
        .gap(px(gap))
        .pt(px(top))
        .pb(px(10.0))
        .px(px(7.5))
        .bg(theme.c.rail)
        // A rail drawn against the window needs no hairline beside it.
        .when(!marks.expander_ring, |rail| {
            rail.border_r_1().border_color(theme.c.line)
        })
        .children(super::kit::hazard(theme))
        .child(expander(wide, theme, cx))
        .child(rule(theme))
        .child(
            IconButton::new("friends", "users")
                .size(TILE)
                .glyph_size(22.0)
                .variant(Variant::Tonal)
                .tip("Friends")
                .on_click(cx.listener(|shell, _, _, cx| {
                    shell.panels.friends.open = true;
                    cx.notify();
                })),
        )
        .child(rule(theme))
        // A pixel closer than the rest, as the web UI's list sets them.
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(if marks.rail_spacing.is_some() { gap } else { 7.0 }))
                .children(tiles)
                .children(saved)
                .child(
                    IconButton::new("add-session", "plus")
                        .size(TILE)
                        .glyph_size(15.0)
                        .settle_left()
                        .tone(Tone::Rail)
                        .variant(if shell.adding_server {
                            Variant::Tonal
                        } else {
                            Variant::Dashed
                        })
                        .tip("Add a server")
                        .on_click(cx.listener(|shell, _, _, cx| {
                            shell.adding_server = !shell.adding_server;
                            shell.engine.refresh_pings();
                            cx.notify();
                        })),
                ),
        )
        .child(div().flex_1())
        .children(
            super::kit::rail_wordmark(theme).map(|mark| div().mb(px(4.0)).child(mark)),
        )
        .child(
            IconButton::new("leave", "log-out")
                .size(TILE)
                .glyph_size(15.0)
                .settle_left()
                .tone(Tone::Danger)
                .when(marks.leave_plate, |leave| leave.variant(Variant::Plated))
                .tip("Leave server")
                .on_click(cx.listener(|shell, _, window, cx| shell.ask_to_leave(window, cx))),
        )
}

/// What widens the rail to show the servers' names: an arrow, or the ring
/// a theme may draw in its place.
fn expander(wide: bool, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let widen = cx.listener(|shell, _, _, cx| {
        shell.chrome.rail_wide = !shell.chrome.rail_wide;
        cx.notify();
    });
    if let Some(ring) = super::kit::expander_ring(theme) {
        return div()
            .id("rail-widen")
            .debug_selector(|| "rail-widen".to_owned())
            .flex_none()
            .size(px(TILE))
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .on_click(widen)
            .child(ring)
            .into_any_element();
    }
    IconButton::new(
        "rail-widen",
        if wide {
            "chevron-left"
        } else {
            "chevron-right"
        },
    )
    .size(TILE)
    .glyph_size(15.0)
    .settle_left()
    .tone(Tone::Rail)
    .tip(if wide {
        "Hide the servers' names"
    } else {
        "Show the servers' names"
    })
    .on_click(widen)
    .into_any_element()
}

/// The flash at the rail's edge beside the server on screen, where the
/// theme draws one: measured back across the room that centres the tile.
fn flash(theme: &Theme) -> Option<impl IntoElement + use<>> {
    let width = theme.skin.marks.rail_flash?;
    let edge = (f32::from(theme.skin.rail_width) - TILE) / 2.0;
    Some(
        div()
            .debug_selector(|| "mark-rail-flash".to_owned())
            .absolute()
            .left(px(-edge))
            .top(px(3.0))
            .bottom(px(3.0))
            .w(px(width))
            .bg(theme.c.accent_on_rail),
    )
}

/// The hairline between one group of the rail and the next.
fn rule(theme: &Theme) -> impl IntoElement + use<> {
    div()
        .flex_none()
        .w(px(22.0))
        .h(px(1.0))
        .mx(px(9.0))
        .bg(theme.c.line2)
}

/// The saved servers nobody is on, each a click away from its way in.
fn saved_tiles(
    shell: &Shell,
    wide: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Vec<AnyElement> {
    let live = |key: &str| {
        shell
            .snapshot
            .sessions
            .iter()
            .any(|session| session.key.as_ref() == key)
    };
    super::connect::group(&shell.servers)
        .into_iter()
        .filter(|server| !live(&server.key))
        .map(|server| saved_tile(shell, &server, wide, theme, cx))
        .collect()
}

/// A saved server the engine is not on: its tile, fainter and with no pip,
/// and its name on a rail wide enough for names. A click shows the way
/// onto it; a right click, what a saved server's card offers.
fn saved_tile(
    shell: &Shell,
    server: &super::connect::ServerGroup<'_>,
    wide: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let key = server.key.clone();
    let tag = server.label.clone();
    let hover = theme.c.hover;
    // The one whose way in is on screen is drawn as itself.
    let chosen = shell.shows_connect_screen() && shell.selected_server.as_deref() == Some(&key);
    div()
        .id(SharedString::from(format!("saved-{key}")))
        .debug_selector(move || format!("saved-{tag}"))
        .flex_none()
        .flex()
        .items_center()
        .gap(px(10.0))
        .rounded(theme.skin.radius_rail)
        .cursor_pointer()
        .when(!chosen, |row| row.opacity(0.5))
        .hover(move |style| style.opacity(1.0))
        .when(wide, |row| row.hover(move |style| style.bg(hover)))
        .tooltip(super::kit::keyed_tip(
            format!("{}: not connected", server.label),
            None::<&str>,
        ))
        .on_click(cx.listener({
            let key = key.clone();
            move |shell, _, _, cx| {
                shell.adding_server = true;
                shell.selected_server = Some(key.clone());
                shell.selected_identity = None;
                shell.engine.refresh_pings();
                cx.notify();
            }
        }))
        .on_mouse_down(gpui::MouseButton::Right, {
            let (host, port, favorite) = (server.host.clone(), server.port, server.favorite);
            cx.listener(move |shell, event: &gpui::MouseDownEvent, _, cx| {
                let items = super::menu::saved_server_items(&key, &host, port, favorite);
                shell.open_menu(event.position, items, cx);
            })
        })
        .child(
            div()
                .flex_none()
                .size(px(TILE))
                .child(Avatar::new(server.label).tile(&server.key).size(TILE)),
        )
        .when(wide, |row| {
            row.child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_size(px(12.5))
                    .text_color(theme.c.muted)
                    .child(server.label.clone()),
            )
        })
        .into_any_element()
}

/// One server the engine is on: its tile, ringed while it is the one on
/// screen, with the pip that says the link is up; and its name, on a rail
/// wide enough for names.
fn session_tile(
    shell: &Shell,
    session: &SessionEntry,
    wide: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    // The active tile is marked only while its server is showing: with the
    // connect screen up, none of them is "where you are".
    let showing = session.active && !shell.adding_server;
    let id = session.id.clone();
    let tag = session.name.clone();
    let (name, icon) = shell.session_face(session);
    let hover = theme.c.hover;
    div()
        .id(SharedString::from(format!("session-{}", session.id)))
        .debug_selector(move || format!("session-{tag}"))
        .flex_none()
        .flex()
        .items_center()
        .gap(px(10.0))
        .rounded(theme.skin.radius_rail)
        .cursor_pointer()
        .when(wide, |row| row.hover(move |style| style.bg(hover)))
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.adding_server = false;
            shell.engine.activate_session(&id);
            cx.notify();
        }))
        .on_mouse_down(gpui::MouseButton::Right, {
            let (id, key) = (session.id.clone(), session.key.clone());
            cx.listener(move |shell, event: &gpui::MouseDownEvent, _, cx| {
                // A favourite if any way onto it is one.
                let favorite = shell
                    .servers
                    .iter()
                    .filter(|server| format!("{}:{}", server.host, server.port) == key.as_ref())
                    .map(|server| server.favorite)
                    .reduce(|any, favorite| any || favorite);
                let items = super::menu::session_items(
                    &id,
                    showing.then(|| shell.root_rights()),
                    favorite.map(|favorite| (&key, favorite)),
                );
                shell.open_menu(event.position, items, cx);
            })
        })
        .child(
            div()
                .relative()
                .flex_none()
                .size(px(TILE))
                .child(Avatar::new(&name).tile(&session.key).picture(icon.as_ref()).size(TILE))
                // The ring: two pixels of accent, two pixels clear of the tile.
                .when(showing, |tile| {
                    tile.child(
                        div()
                            .absolute()
                            .top(px(-4.0))
                            .left(px(-4.0))
                            .size(px(TILE + 8.0))
                            .rounded(theme.skin.radius_rail + px(4.0))
                            .border_2()
                            .border_color(theme.c.accent),
                    )
                })
                .when(showing && !wide, |tile| tile.children(flash(theme)))
                // The pip: a hole punched through the tile's corner, lit.
                .child(
                    div()
                        .absolute()
                        .right(px(-3.0))
                        .bottom(px(-3.0))
                        .size(px(13.0))
                        .rounded_full()
                        .bg(theme.c.bg0)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .size(px(8.0))
                                .rounded_full()
                                .bg(if session.connecting {
                                    theme.c.warn
                                } else {
                                    theme.c.ok
                                }),
                        ),
                ),
        )
        .when(wide, |row| {
            row.child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_size(px(12.5))
                    .text_color(if showing { theme.c.text } else { theme.c.muted })
                    .child(name),
            )
        })
        .into_any_element()
}
