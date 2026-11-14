//! The servers as tabs in the band across the top, where the user chose to
//! list them there (Personalize, "Server list"): the web UI's
//! `ServerTabStrip`, with the friends beside them and, where the rail is
//! not drawn, the way to add a server.

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::kit::{Avatar, IconButton};
use crate::theme::Theme;
use crate::words::t;

/// What the band carries besides the brand: the friends, a tab for each
/// server, and the plus where the rail with its own is not drawn.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let rail = shell.panels.settings.server_switcher.rail();
    let live = |key: &str| {
        shell
            .snapshot
            .sessions
            .iter()
            .any(|session| session.key.as_ref() == key)
    };
    let sessions: Vec<AnyElement> = shell
        .snapshot
        .sessions
        .iter()
        .map(|session| {
            let showing = session.active && !shell.adding_server;
            let (name, icon) = shell.session_face(session);
            let id = session.id.clone();
            let face = Avatar::new(&name)
                .tile(&session.key)
                .picture(icon.as_ref())
                .size(15.0);
            tab(
                (
                    SharedString::from(format!("tab-{}", session.name)),
                    name,
                    face,
                ),
                showing,
                session.connecting,
                theme,
                cx,
            )
            .on_click(cx.listener(move |shell, _, _, cx| {
                shell.adding_server = false;
                shell.engine.activate_session(&id);
                cx.notify();
            }))
            .into_any_element()
        })
        .collect();
    let saved: Vec<AnyElement> = super::connect::group(&shell.servers)
        .into_iter()
        .filter(|server| !live(&server.key))
        .map(|server| {
            let key = server.key.clone();
            let chosen =
                shell.shows_connect_screen() && shell.selected_server.as_deref() == Some(&key);
            let face = Avatar::new(server.label).tile(&server.key).size(15.0);
            tab(
                (
                    SharedString::from(format!("tab-{}", server.label)),
                    SharedString::from(server.label.to_string()),
                    face,
                ),
                chosen,
                false,
                theme,
                cx,
            )
            .on_click(cx.listener(move |shell, _, _, cx| {
                shell.adding_server = true;
                shell.selected_server = Some(key.clone());
                shell.selected_identity = None;
                shell.engine.refresh_pings();
                cx.notify();
            }))
            .into_any_element()
        })
        .collect();
    div()
        .flex()
        .items_center()
        .gap(px(10.0))
        .min_w_0()
        .child(friends(shell, theme, cx))
        .child(
            div()
                .debug_selector(|| "server-tabs".to_owned())
                .flex()
                .items_center()
                .gap(px(4.0))
                .min_w_0()
                .overflow_hidden()
                .children(sessions)
                .children(saved),
        )
        .when(!rail, |band| {
            band.child(
                IconButton::new("quick-connect", "plus")
                    .size(28.0)
                    .glyph_size(14.0)
                    .tip(t!("Quick connect"))
                    .on_click(cx.listener(|shell, _, _, cx| {
                        shell.adding_server = !shell.adding_server;
                        shell.engine.refresh_pings();
                        cx.notify();
                    })),
            )
        })
}

/// The friends, in the band: the panel that lists them.
fn friends(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let open = shell.panels.friends.open;
    let hover = theme.c.hover;
    let tab = div()
        .id("band-friends")
        .debug_selector(|| "band-friends".to_owned())
        .px(px(11.0))
        .py(px(5.0))
        .rounded(theme.skin.radius_md)
        .text_size(px(12.5))
        .font_weight(gpui::FontWeight::MEDIUM)
        .whitespace_nowrap()
        .cursor_pointer()
        .map(|tab| {
            if open {
                tab.text_color(theme.c.bar_text).bg(theme.c.card2)
            } else {
                tab.text_color(theme.c.bar_dim)
            }
        })
        .hover(move |style| style.bg(hover))
        .on_click(cx.listener(|shell, _, _, cx| {
            shell.panels.friends.open = !shell.panels.friends.open;
            cx.notify();
        }))
        .child(t!("Friends"));
    super::kit::Reachable::new("band-friends", tab)
}

/// One server's tab: its face, its name, an ellipsis while its connection
/// is made, and on the one showing the way off it.
fn tab(
    (id, name, face): (SharedString, SharedString, Avatar),
    active: bool,
    connecting: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> gpui::Stateful<gpui::Div> {
    let hover = theme.c.hover;
    let selector = id.clone();
    let leave = (active && !connecting).then(|| {
        div()
            .id("tab-leave")
            .debug_selector(|| "tab-leave".to_owned())
            .cursor_pointer()
            .text_size(px(11.0))
            .line_height(px(11.0))
            .text_color(theme.c.dim)
            .hover({
                let bad = theme.c.bad;
                move |style| style.text_color(bad)
            })
            .tooltip(super::kit::keyed_tip(
                t!("Disconnect from {{label}}", label = name.clone()),
                None::<&str>,
            ))
            .on_click(cx.listener(|shell, _, window, cx| {
                cx.stop_propagation();
                shell.ask_to_leave(window, cx);
            }))
            .child("\u{2715}")
    });
    div()
        .id(id)
        .debug_selector(move || selector.to_string())
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(9.0))
        .py(px(4.0))
        .max_w(px(190.0))
        .rounded(theme.skin.radius_md)
        .text_size(px(12.5))
        .font_weight(gpui::FontWeight::MEDIUM)
        .cursor_pointer()
        .map(|tab| {
            if active {
                tab.bg(theme.c.card2).text_color(theme.c.text)
            } else {
                tab.text_color(theme.c.muted)
            }
        })
        .hover(move |style| style.bg(hover))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(7.0))
                .min_w_0()
                .child(
                    div()
                        .flex_none()
                        .rounded(theme.skin.radius_sm)
                        .overflow_hidden()
                        .child(face),
                )
                .child(div().min_w_0().truncate().child(name))
                .when(connecting, |tab| {
                    tab.child(
                        div()
                            .text_size(px(10.0))
                            .text_color(theme.c.dim)
                            .child("\u{2026}"),
                    )
                }),
        )
        .children(leave)
}
