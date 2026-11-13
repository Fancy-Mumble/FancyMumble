//! What the window shows while it is not on a server: the saved servers down
//! the column, and the selected one's landing page - whether it is up, and
//! who to arrive as.

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, linear_color_stop,
    linear_gradient, prelude::*, px,
};

use super::Shell;
use super::kit::{Avatar, Button, Radio, Size, tint};
use super::widgets::{EMPHASIS, icon, label};
use crate::engine::{Connection, SavedServer, ServerPing};
use crate::theme::Theme;

/// Every identity saved for one address.
#[derive(Debug)]
pub(super) struct ServerGroup<'a> {
    /// `host:port`, which is what makes two records the same server.
    pub key: String,
    pub label: &'a SharedString,
    pub host: &'a SharedString,
    pub port: u16,
    pub favorite: bool,
    pub identities: Vec<&'a SavedServer>,
}

/// `servers` grouped by address, in the order each address first appears.
pub(super) fn group(servers: &[SavedServer]) -> Vec<ServerGroup<'_>> {
    let mut groups: Vec<ServerGroup<'_>> = Vec::new();
    for server in servers {
        let key = format!("{}:{}", server.host, server.port);
        if let Some(existing) = groups.iter_mut().find(|group| group.key == key) {
            existing.favorite |= server.favorite;
            existing.identities.push(server);
            continue;
        }
        groups.push(ServerGroup {
            key,
            label: &server.label,
            host: &server.host,
            port: server.port,
            favorite: server.favorite,
            identities: vec![server],
        });
    }
    groups
}

impl Shell {
    /// The saved servers the column lists, narrowed by its search field.
    pub(super) fn listed_servers(&self, cx: &gpui::App) -> Vec<ServerGroup<'_>> {
        let wanted = self.server_search.read(cx).text().trim().to_lowercase();
        group(&self.servers)
            .into_iter()
            .filter(|group| wanted.is_empty() || group.label.to_lowercase().contains(&wanted))
            .collect()
    }

    /// The server whose landing page is showing: the one picked, or the first.
    pub(super) fn selected_server(&self) -> Option<ServerGroup<'_>> {
        let mut groups = group(&self.servers);
        let picked = self
            .selected_server
            .as_ref()
            .and_then(|key| groups.iter().position(|group| group.key == *key))
            .unwrap_or(0);
        (picked < groups.len()).then(|| groups.swap_remove(picked))
    }

    /// The identity that would connect: the one picked if it belongs to the
    /// selected server, or that server's first.
    pub(super) fn selected_identity(&self) -> Option<&SavedServer> {
        let server = self.selected_server()?;
        let picked = self.selected_identity.as_ref().and_then(|id| {
            server
                .identities
                .iter()
                .copied()
                .find(|identity| identity.id == *id)
        });
        picked.or_else(|| server.identities.first().copied())
    }

    /// Connect as the chosen identity, with whatever password was typed.
    pub(super) fn connect_selected(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.selected_identity().map(|identity| identity.id.clone()) else {
            return;
        };
        let password = self.password.read(cx).text().to_owned();
        self.engine.connect(&id, Some(password));
        // Typed for this connect; not kept on screen, or anywhere else.
        self.password.update(cx, |field, _| field.clear());
        cx.notify();
    }
}

/// The column of saved servers.
pub(super) fn server_column(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let selected = shell.selected_server().map(|server| server.key);
    let rows: Vec<AnyElement> = shell
        .listed_servers(cx)
        .iter()
        .map(|server| {
            let current = selected.as_deref() == Some(server.key.as_str());
            server_card(shell, server, current, theme, cx)
        })
        .collect();
    div()
        .flex_none()
        .w(theme.skin.column_width)
        .h_full()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .p(px(10.0))
        .bg(theme.c.panel)
        .border_r_1()
        .border_color(theme.c.line)
        .child(
            div()
                .px(px(5.0))
                .pt(px(6.0))
                .pb(px(4.0))
                .flex()
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(EMPHASIS)
                        .child(label("Servers", theme)),
                )
                .child(link("add-server", "+ Add", theme).on_click(
                    cx.listener(|shell, _, window, cx| shell.open_editor(None, None, window, cx)),
                )),
        )
        .child(
            div()
                .flex_none()
                .h(px(46.0))
                .flex()
                .items_center()
                .gap(px(10.0))
                .px(px(14.0))
                .rounded(theme.skin.radius_lg)
                .bg(theme.c.input)
                .border_1()
                .border_color(theme.c.line2)
                .child(icon("search", 14.0, theme.c.dim))
                .child(shell.server_search.clone()),
        )
        .child(
            div()
                .id("servers")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(6.0))
                .children(rows),
        )
        .child(
            div()
                .flex_none()
                .flex()
                .flex_col()
                .child(
                    Button::new("open-certificates", "Certificates")
                        .start_icon("key-round")
                        .size(Size::Small)
                        .wide()
                        .on_click(cx.listener(|shell, _, _, cx| shell.toggle_certificates(cx))),
                )
                .child(
                    Button::new("themes", "Themes")
                        .start_icon("palette")
                        .size(Size::Small)
                        .wide()
                        .on_click(cx.listener(|shell, _, _, cx| shell.toggle_picker(cx))),
                ),
        )
}

fn server_card(
    shell: &Shell,
    server: &ServerGroup<'_>,
    current: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let ping = shell.engine.ping(server.host, server.port);
    let identities = server.identities.len();
    let presence = ping.as_ref().map_or_else(
        || "offline".to_owned(),
        |ping| format!("{}/{} online", ping.users, ping.max_users),
    );
    let plural = if identities == 1 {
        "identity"
    } else {
        "identities"
    };
    let hover = theme.c.hover;
    let key = server.key.clone();
    let tag = server.key.clone();
    div()
        .id(SharedString::from(server.key.clone()))
        .debug_selector(move || format!("server-{tag}"))
        .flex_none()
        .flex()
        .items_center()
        .gap(px(10.0))
        .p(px(10.0))
        .rounded(theme.skin.radius_lg)
        .border_1()
        .cursor_pointer()
        .map(|card| {
            if current {
                card.bg(theme.c.accent_soft)
                    .border_color(theme.c.accent_line)
            } else {
                card.bg(theme.c.card)
                    .border_color(theme.c.line)
                    .hover(move |style| style.bg(hover))
            }
        })
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.selected_server = Some(key.clone());
            shell.selected_identity = None;
            cx.notify();
        }))
        .child(Avatar::new(server.label).tile(&server.key).size(34.0))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .child(
                    div()
                        .truncate()
                        .when(current, |name| name.font_weight(EMPHASIS))
                        .child(server.label.clone()),
                )
                .child(
                    div()
                        .truncate()
                        .text_size(px(11.0))
                        .text_color(theme.c.dim)
                        .child(format!("{presence} · {identities} {plural}")),
                ),
        )
        .when(server.favorite, |card| {
            card.child(icon("star", 13.0, gpui::rgb(0xe9_b949).into()))
        })
        .into_any_element()
}

/// The selected server's landing page.
pub(super) fn landing(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let Some(server) = shell.selected_server() else {
        return div()
            .flex_1()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(14.0))
            .text_color(theme.c.muted)
            .child("No saved servers yet")
            .child(link("add-first-server", "+ Add a server", theme).on_click(
                cx.listener(|shell, _, window, cx| shell.open_editor(None, None, window, cx)),
            ))
            .into_any_element();
    };
    let address = (server.host.clone(), server.port);
    let ping = shell.engine.ping(server.host, server.port);
    let chosen = shell
        .selected_identity()
        .map(|identity| identity.id.clone());
    div()
        .flex_1()
        .min_w_0()
        .h_full()
        .relative()
        .flex()
        .flex_col()
        .items_center()
        .child(banner(&server, theme))
        .child(
            // The tile sits across the banner's lower edge.
            div()
                .mt(px(-45.0))
                .rounded(theme.skin.radius_lg)
                .border_2()
                .border_color(theme.c.bg0)
                .child(Avatar::new(server.label).tile(&server.key).size(72.0)),
        )
        .child(
            div()
                .mt(px(12.0))
                .text_size(px(22.0))
                .font_weight(EMPHASIS)
                .child(server.label.clone()),
        )
        .child(facts(ping.as_ref(), theme))
        .child(
            div()
                .mt(px(22.0))
                .w(px(556.0))
                .max_w_full()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .text_size(px(11.0))
                                .font_weight(EMPHASIS)
                                .text_color(theme.c.muted)
                                .child("JOIN AS"),
                        )
                        .child(link("new-identity", "+ New identity", theme).on_click(
                            cx.listener(move |shell, _, window, cx| {
                                shell.open_editor(None, Some(&address), window, cx);
                            }),
                        )),
                )
                .children(server.identities.iter().map(|identity| {
                    identity_row(identity, chosen.as_ref() == Some(&identity.id), theme, cx)
                }))
                .child(password_field(shell, theme))
                .child(connect_button(shell, theme, cx))
                .when_some(shell.notice.clone(), |form, notice| {
                    form.child(
                        div()
                            .text_size(px(12.5))
                            .text_color(theme.c.bad)
                            .child(notice),
                    )
                }),
        )
        .child(address_pill(&server, theme))
        .into_any_element()
}

/// The strip across the top of the landing page, in the server's colour,
/// with its name set large and faint.
fn banner(server: &ServerGroup<'_>, theme: &Theme) -> impl IntoElement + use<> {
    let mut tint = tint(&server.key).0;
    tint.a = 0.32;
    let mut ghost = theme.c.text;
    ghost.a = 0.14;
    div()
        .flex_none()
        .w_full()
        .h(px(150.0))
        .bg(linear_gradient(
            180.0,
            linear_color_stop(tint, 0.0),
            linear_color_stop(theme.c.header, 1.0),
        ))
        .flex()
        .items_center()
        .justify_center()
        .overflow_hidden()
        .text_size(px(44.0))
        .font_weight(EMPHASIS)
        .text_color(ghost)
        .child(server.label.clone())
}

/// Whether the server is up, how far away it is, and what it runs.
fn facts(ping: Option<&ServerPing>, theme: &Theme) -> impl IntoElement + use<> {
    let chip = || {
        div()
            .px(px(12.0))
            .py(px(4.0))
            .rounded(theme.skin.radius_pill)
            .bg(theme.c.card2)
            .text_size(px(11.5))
            .text_color(theme.c.muted)
    };
    let row = div().mt(px(10.0)).flex().items_center().gap(px(8.0));
    let Some(ping) = ping else {
        return row.child(chip().child("offline"));
    };
    let mut soft = theme.c.ok;
    soft.a = 0.14;
    let mut edge = theme.c.ok;
    edge.a = 0.5;
    row.child(
        chip()
            .bg(soft)
            .border_1()
            .border_color(edge)
            .text_color(theme.c.ok)
            .flex()
            .items_center()
            .gap(px(7.0))
            .child(div().size(px(5.0)).rounded_full().bg(theme.c.ok))
            .child(format!("{}/{} online", ping.users, ping.max_users)),
    )
    .child(chip().child(format!("{} ms", ping.latency_ms)))
    .child(chip().child(format!("Mumble {}", ping.version)))
}

fn identity_row(
    identity: &SavedServer,
    chosen: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    let id = identity.id.clone();
    let tag = identity.id.clone();
    div()
        .id(identity.id.clone())
        .debug_selector(move || format!("identity-{tag}"))
        .h(px(58.0))
        .flex()
        .items_center()
        .gap(px(12.0))
        .px(px(12.0))
        .rounded(theme.skin.radius_lg)
        .border_1()
        .cursor_pointer()
        .map(|row| {
            if chosen {
                row.bg(theme.c.accent_soft)
                    .border_color(theme.c.accent_line)
            } else {
                row.bg(theme.c.card)
                    .border_color(theme.c.line)
                    .hover(move |style| style.bg(hover))
            }
        })
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.selected_identity = Some(id.clone());
            cx.notify();
        }))
        .child(Avatar::new(&identity.username).size(34.0))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    div()
                        .truncate()
                        .when(chosen, |name| name.font_weight(EMPHASIS))
                        .child(identity.username.clone()),
                )
                .child(
                    div()
                        .truncate()
                        .text_size(px(11.0))
                        .text_color(theme.c.muted)
                        .child(
                            identity
                                .certificate
                                .clone()
                                .unwrap_or_else(|| "no certificate".into()),
                        ),
                ),
        )
        .child({
            let identity = identity.clone();
            let hover = theme.c.hover;
            let tag = identity.id.clone();
            div()
                .id(("edit", 0usize))
                .debug_selector(move || format!("edit-{tag}"))
                .flex_none()
                .size(px(28.0))
                .rounded(theme.skin.radius_sm)
                .flex()
                .items_center()
                .justify_center()
                .hover(move |style| style.bg(hover))
                .on_click(cx.listener(move |shell, _, window, cx| {
                    shell.open_editor(Some(identity.clone()), None, window, cx);
                    // Not also a choice of this identity.
                    cx.stop_propagation();
                }))
                .child(icon("pencil", 13.0, theme.c.muted))
        })
        .child(Radio::new(chosen))
}

/// The server's password, for the servers that have one.
fn password_field(shell: &Shell, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .mt(px(2.0))
        .h(px(38.0))
        .flex()
        .items_center()
        .px(px(12.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.input)
        .border_1()
        .border_color(theme.c.line)
        .text_size(px(13.0))
        .child(shell.password.clone())
}

/// A text link: "+ Add", "+ New identity".
fn link(id: &'static str, text: &'static str, theme: &Theme) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .debug_selector(move || id.to_owned())
        .cursor_pointer()
        .text_size(px(11.5))
        .text_color(theme.c.accent_text)
        .hover(|style| style.opacity(0.8))
        .child(text)
}

/// A radio mark: a ring, filled when it is the chosen one.
fn connect_button(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let connecting = shell.snapshot.connection == Connection::Connecting;
    let text = if connecting {
        "Connecting…".to_owned()
    } else {
        let name = shell
            .selected_identity()
            .map_or_else(SharedString::default, |identity| identity.username.clone());
        format!("Connect as {name}")
    };
    div()
        .id("connect")
        .debug_selector(|| "connect".to_owned())
        .mt(px(4.0))
        .h(px(42.0))
        .flex()
        .items_center()
        .justify_center()
        .rounded(theme.skin.radius_lg)
        .bg(theme.c.accent)
        .text_color(theme.c.on_accent)
        .font_weight(EMPHASIS)
        .map(|button| {
            if connecting {
                // Under way: a second press would start a second attempt.
                button.opacity(0.6)
            } else {
                button
                    .cursor_pointer()
                    .hover(|style| style.opacity(0.92))
                    .on_click(cx.listener(|shell, _, _, cx| shell.connect_selected(cx)))
            }
        })
        .child(label(&text, theme))
}

/// The server's address, floating over the banner's trailing corner.
fn address_pill(server: &ServerGroup<'_>, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .absolute()
        .top(px(14.0))
        .right(px(18.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(12.0))
        .py(px(3.0))
        .rounded(theme.skin.radius_pill)
        .bg(super::widgets::opaque(theme.c.card, theme.c.bg0))
        .border_1()
        .border_color(theme.c.line2)
        .text_size(px(11.0))
        .text_color(theme.c.muted)
        .child(div().size(px(5.0)).rounded_full().bg(theme.c.muted))
        .child(format!("mumble://{}:{}", server.host, server.port))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(id: &str, host: &str, port: u16, favorite: bool) -> SavedServer {
        SavedServer {
            id: id.to_owned().into(),
            label: host.to_owned().into(),
            host: host.to_owned().into(),
            port,
            username: "Alex".into(),
            certificate: None,
            favorite,
        }
    }

    #[test]
    fn identities_of_one_address_are_one_server() {
        let servers = [
            saved("a", "one.example", 64738, false),
            saved("b", "two.example", 64738, false),
            saved("c", "one.example", 64738, true),
            saved("d", "one.example", 1234, false),
        ];
        let groups = group(&servers);
        let keys: Vec<_> = groups.iter().map(|group| group.key.as_str()).collect();
        assert_eq!(
            keys,
            ["one.example:64738", "two.example:64738", "one.example:1234"]
        );
        assert_eq!(groups[0].identities.len(), 2);
        assert!(
            groups[0].favorite,
            "a favourite identity makes the server one"
        );
        assert!(!groups[2].favorite, "another port is another server");
    }
}
