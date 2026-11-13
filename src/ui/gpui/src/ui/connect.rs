//! What the window shows while it is not on a server: the saved servers down
//! the column, and the selected one's landing page - whether it is up, and
//! who to arrive as.

use gpui::{
    AnyElement, Context, Entity, IntoElement, ParentElement, SharedString, Styled, div,
    linear_color_stop, linear_gradient, prelude::*, px,
};

use super::Shell;
use super::kit::{Avatar, Button, IconButton, Radio, Size, Switch, tint};
use super::text_input::{InputEvent, TextInput};
use super::widgets::{EMPHASIS, display_font, icon, label};
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

    /// Mark every identity saved for the address `key` a favourite, or
    /// none of them: a server is one when any of its identities is.
    pub(super) fn set_favourite(&mut self, key: &str, favorite: bool, cx: &mut Context<Self>) {
        let changed: Vec<SavedServer> = self
            .servers
            .iter()
            .filter(|saved| format!("{}:{}", saved.host, saved.port) == key)
            .filter(|saved| saved.favorite != favorite)
            .cloned()
            .collect();
        for mut saved in changed {
            saved.favorite = favorite;
            self.engine.save_server(saved);
        }
        self.servers = self.engine.saved_servers();
        cx.notify();
    }

    /// Connect as the chosen identity, with whatever password was typed.
    pub(super) fn connect_selected(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.selected_identity().map(|identity| identity.id.clone()) else {
            return;
        };
        let password = self.secrets.password.read(cx).text().to_owned();
        let code = self.secrets.code.read(cx).text().trim().to_owned();
        self.engine
            .connect_with_code(&id, Some(password), Some(code));
        // Typed for this connect; not kept on screen, or anywhere else.
        self.secrets.password.update(cx, |field, _| field.clear());
        self.secrets.code.update(cx, |field, _| field.clear());
        cx.notify();
    }
}

/// One line of a card's title: 12.5px at the web UI's leading.
const LINE: f32 = 19.375;

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
        .px(px(9.0))
        .py(px(10.0))
        .bg(theme.c.panel)
        .border_r_1()
        .border_color(theme.c.line)
        .children(column_head(theme, cx))
        .child(
            div()
                .flex_none()
                .mt(px(5.0))
                .h(px(47.0))
                .flex()
                .items_center()
                .gap(px(8.0))
                .px(px(14.0))
                .rounded(theme.skin.radius_lg)
                .bg(theme.c.input)
                .border_1()
                .border_color(theme.c.line2)
                .text_size(px(12.5))
                .child(icon("search", 12.0, theme.c.dim))
                .child(shell.server_search.clone()),
        )
        .child(
            div()
                .id("servers")
                .mt(px(8.0))
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(3.9))
                .children(rows)
                .child(
                    div()
                        .id("add-server-row")
                        .debug_selector(|| "add-server-row".to_owned())
                        .flex_none()
                        .h(px(38.0))
                        .flex()
                        .items_center()
                        .gap(px(9.0))
                        .px(px(10.0))
                        .rounded(theme.skin.radius_lg)
                        .border_1()
                        .border_dashed()
                        .border_color(theme.c.line2)
                        .cursor_pointer()
                        .text_size(px(11.5))
                        .text_color(theme.c.dim)
                        .on_click(cx.listener(|shell, _, window, cx| {
                            shell.open_editor(None, None, window, cx);
                        }))
                        .child(icon("plus", 14.0, theme.c.dim))
                        .child("Add a server"),
                ),
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

/// The head of the column: the way to friends, a rule, and the heading
/// over the servers with the way to add one.
fn column_head(theme: &Theme, cx: &mut Context<Shell>) -> [AnyElement; 3] {
    [
        div()
            .id("friends-row")
            .debug_selector(|| "friends-row".to_owned())
            .flex_none()
            .h(px(38.0))
            .flex()
            .items_center()
            .gap(px(9.0))
            .px(px(10.0))
            .rounded(theme.skin.radius_lg)
            .cursor_pointer()
            .hover({
                let hover = theme.c.hover;
                move |style| style.bg(hover)
            })
            .text_size(px(13.0))
            .font_weight(EMPHASIS)
            .text_color(theme.c.muted)
            .on_click(cx.listener(|shell, _, _, cx| {
                shell.panels.friends.open = true;
                cx.notify();
            }))
            .child(icon("users", 16.0, theme.c.muted))
            .child(div().mt(px(2.0)).child(label("Friends", theme)))
            .into_any_element(),
        div()
            .flex_none()
            .h(px(1.0))
            .mt(px(9.0))
            .mx(px(6.0))
            .bg(theme.c.line2)
            .into_any_element(),
        div()
            .flex_none()
            .mt(px(8.0))
            .h(px(36.0))
            .px(px(6.0))
            .flex()
            .items_center()
            .justify_between()
            .child(
                div()
                    .text_size(px(15.0))
                    .font_weight(EMPHASIS)
                    .child(label("Servers", theme)),
            )
            .child(
                link("add-server", "+ Add", theme)
                    .text_size(px(11.0))
                    .on_click(cx.listener(|shell, _, window, cx| {
                        shell.open_editor(None, None, window, cx);
                    })),
            )
            .into_any_element(),
    ]
}

/// A card that is one of a list of choices: washed in the accent when it is
/// the one chosen, a quiet card when it is not.
fn choice_card(chosen: bool, quiet_edge: gpui::Hsla, theme: &Theme) -> gpui::Div {
    let hover = theme.c.hover;
    div()
        .rounded(theme.skin.radius_lg)
        .border_1()
        .cursor_pointer()
        .text_size(px(12.5))
        .line_height(px(LINE))
        .map(|card| {
            if chosen {
                card.bg(theme.c.accent_soft)
                    .border_color(theme.c.accent_line)
            } else {
                card.bg(theme.c.card)
                    .border_color(quiet_edge)
                    .hover(move |style| style.bg(hover))
            }
        })
}

/// A card's name: heavier on the one chosen.
fn choice_name(name: SharedString, chosen: bool) -> gpui::Div {
    div()
        .truncate()
        .font_weight(if chosen {
            EMPHASIS
        } else {
            gpui::FontWeight::MEDIUM
        })
        .child(name)
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
    let key = server.key.clone();
    let tag = server.key.clone();
    choice_card(current, theme.c.line2, theme)
        .id(SharedString::from(server.key.clone()))
        .debug_selector(move || format!("server-{tag}"))
        .flex_none()
        .flex()
        .items_center()
        .h(px(56.9))
        .gap(px(10.0))
        .px(px(10.0))
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.selected_server = Some(key.clone());
            shell.selected_identity = None;
            cx.notify();
        }))
        .on_mouse_down(gpui::MouseButton::Right, {
            let (key, host, port, favorite) = (
                server.key.clone(),
                server.host.clone(),
                server.port,
                server.favorite,
            );
            cx.listener(move |shell, event: &gpui::MouseDownEvent, _, cx| {
                let items = super::menu::saved_server_items(&key, &host, port, favorite);
                shell.open_menu(event.position, items, cx);
            })
        })
        .child(Avatar::new(server.label).tile(&server.key).size(34.0))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(3.0))
                .child(choice_name(server.label.clone(), current))
                .child(
                    div()
                        .truncate()
                        .text_size(px(10.0))
                        .line_height(px(15.5))
                        .text_color(theme.c.dim)
                        .child(format!("{presence} · {identities} {plural}")),
                ),
        )
        .when(server.favorite, |card| {
            card.child(
                // Hung from the card's corner in the web UI, not set in
                // its row: five pixels into the padding, a little low.
                div()
                    .flex_none()
                    .size(px(23.0))
                    .mr(px(-5.0))
                    .mt(px(7.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(icon("star", 13.0, theme.c.warn)),
            )
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
            // The tile sits across the banner's lower edge, in a frame of
            // the window's own colour.
            div()
                .mt(px(-48.0))
                .p(px(3.0))
                .rounded(theme.skin.radius_xl)
                .bg(theme.c.bg0)
                .shadow(shadow(10.0, 30.0, gpui::hsla(0.0, 0.0, 0.0, 0.3)))
                .child(Avatar::new(server.label).tile(&server.key).size(72.0)),
        )
        .child(
            div()
                .mt(px(9.0))
                .mb(px(1.0))
                .font_family(display_font(theme))
                .text_size(px(23.0))
                .line_height(px(27.6))
                .font_weight(gpui::FontWeight::BOLD)
                .child(server.label.clone()),
        )
        .child(facts(ping.as_ref(), theme))
        .child(
            div()
                .mt(px(19.0))
                .w(px(556.0))
                .max_w_full()
                .flex()
                .flex_col()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .mt(px(-1.0))
                                .text_size(px(10.5))
                                .line_height(px(14.7))
                                .font_weight(EMPHASIS)
                                .text_color(theme.c.dim)
                                .child("JOIN AS"),
                        )
                        .child(link("new-identity", "+ New identity", theme).on_click(
                            cx.listener(move |shell, _, window, cx| {
                                shell.open_editor(None, Some(&address), window, cx);
                            }),
                        )),
                )
                .child(div().mt(px(8.0)).flex().flex_col().gap(px(7.0)).children(
                    server.identities.iter().map(|identity| {
                        identity_row(identity, chosen.as_ref() == Some(&identity.id), theme, cx)
                    }),
                ))
                // Asked for once a server has turned the user away: most
                // servers have none.
                .when(shell.notice.is_some(), |form| {
                    form.child(password_field(shell, theme))
                        .child(code_field(shell, theme))
                })
                .child(connect_row(shell, theme, cx))
                .when_some(shell.notice.clone(), |form, notice| {
                    form.child(
                        div()
                            .mt(px(8.0))
                            .text_size(px(12.5))
                            .text_color(theme.c.bad)
                            .child(notice),
                    )
                }),
        )
        .child(address_pill(&server))
        .into_any_element()
}

/// A shadow straight down, as CSS writes one.
fn shadow(drop: f32, blur: f32, color: gpui::Hsla) -> Vec<gpui::BoxShadow> {
    crate::theme::Shadow { drop, blur, color }.cast()
}

/// The strip across the top of the landing page, in the server's colours,
/// fading into the window, with its name set large and faint.
fn banner(server: &ServerGroup<'_>, theme: &Theme) -> impl IntoElement + use<> {
    let (from, to) = tint(&server.key);
    let faint = |color: gpui::Hsla| gpui::Hsla { a: 0.35, ..color };
    let clear = gpui::Hsla {
        a: 0.0,
        ..theme.c.bg0
    };
    div()
        .flex_none()
        .w_full()
        .h(px(150.0))
        .relative()
        .bg(linear_gradient(
            120.0,
            linear_color_stop(faint(from), 0.0),
            linear_color_stop(faint(to), 1.0),
        ))
        .overflow_hidden()
        .child(
            div()
                .absolute()
                .top(px(40.9))
                .left_0()
                .w_full()
                .flex()
                .justify_center()
                .font_family(display_font(theme))
                .text_size(px(44.0))
                .line_height(px(68.2))
                .font_weight(gpui::FontWeight::BOLD)
                .text_color(gpui::hsla(0.0, 0.0, 1.0, 0.25))
                .child(server.label.clone()),
        )
        // The lower three fifths fade into the window.
        .child(
            div()
                .absolute()
                .top(px(60.0))
                .left_0()
                .w_full()
                .h(px(90.0))
                .bg(linear_gradient(
                    180.0,
                    linear_color_stop(clear, 0.0),
                    linear_color_stop(theme.c.bg0, 1.0),
                )),
        )
}

/// Whether the server is up, how far away it is, and what it runs.
fn facts(ping: Option<&ServerPing>, theme: &Theme) -> impl IntoElement + use<> {
    let chip = || {
        div()
            .h(px(27.0))
            .px(px(11.0))
            .flex()
            .items_center()
            .rounded(theme.skin.radius_lg)
            .bg(theme.c.card2)
            .border_1()
            .border_color(gpui::transparent_black())
            .text_size(px(11.0))
            .font_weight(gpui::FontWeight::MEDIUM)
            .text_color(theme.c.muted)
    };
    let row = div().mt(px(12.0)).flex().items_center().gap(px(8.0));
    let Some(ping) = ping else {
        return row.child(chip().child("offline"));
    };
    let wash = |alpha: f32| gpui::Hsla {
        a: alpha,
        ..theme.c.ok
    };
    row.child(
        chip()
            .bg(wash(0.14))
            .border_color(wash(0.333))
            .text_color(theme.c.ok)
            .gap(px(8.0))
            .child(div().size(px(6.0)).rounded_full().bg(theme.c.ok))
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
    let id = identity.id.clone();
    let tag = identity.id.clone();
    let edit_tag = identity.id.clone();
    let edited = identity.clone();
    choice_card(chosen, theme.c.line, theme)
        .id(identity.id.clone())
        .debug_selector(move || format!("identity-{tag}"))
        .h(px(57.6))
        .flex()
        .items_center()
        .gap(px(11.0))
        .pl(px(8.0))
        .pr(px(12.0))
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.selected_identity = Some(id.clone());
            cx.notify();
        }))
        // The grip the web UI reorders identities by; here it only marks
        // the row.
        .child(
            div()
                .flex_none()
                .w(px(16.0))
                .flex()
                .justify_center()
                .opacity(0.75)
                .child(icon("grip-vertical", 14.0, theme.c.dim)),
        )
        .child(Avatar::new(&identity.username).size(34.0))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(choice_name(identity.username.clone(), chosen))
                .child(
                    div()
                        .truncate()
                        .mt(px(1.0))
                        .mb(px(-1.0))
                        .text_size(px(10.5))
                        .line_height(px(16.275))
                        .text_color(theme.c.muted)
                        .child(
                            identity
                                .certificate
                                .clone()
                                .unwrap_or_else(|| "no certificate".into()),
                        ),
                ),
        )
        .child(
            IconButton::new("edit", "pencil")
                .selector(format!("edit-{edit_tag}"))
                .size(27.0)
                .glyph_size(13.0)
                .on_click(cx.listener(move |shell, _, window, cx| {
                    shell.open_editor(Some(edited.clone()), None, window, cx);
                    // Not also a choice of this identity.
                    cx.stop_propagation();
                })),
        )
        .child(Radio::new(chosen))
}

/// The server's password, for the servers that have one.
fn password_field(shell: &Shell, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .mt(px(10.0))
        .h(px(38.0))
        .flex()
        .items_center()
        .px(px(12.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.input)
        .border_1()
        .border_color(theme.c.line)
        .text_size(px(13.0))
        .child(shell.secrets.password.clone())
}

/// The one-time code, for an account that signs in with a second factor.
fn code_field(shell: &Shell, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .mt(px(6.0))
        .h(px(38.0))
        .flex()
        .items_center()
        .px(px(12.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.input)
        .border_1()
        .border_color(theme.c.line)
        .text_size(px(13.0))
        .child(shell.secrets.code.clone())
}

/// What is typed to get onto a server and kept nowhere: its password, and
/// the code of a second factor.
pub(super) struct Secrets {
    pub password: Entity<TextInput>,
    pub code: Entity<TextInput>,
}

impl Secrets {
    /// With the password's field already made, since Enter in it connects.
    pub(super) fn new(password: Entity<TextInput>, cx: &mut Context<Shell>) -> Self {
        let code = cx.new(|cx| TextInput::new("Two-factor code, if the account has one", cx));
        cx.subscribe(&code, |shell, _, event, cx| {
            if matches!(event, InputEvent::Submitted(_)) {
                shell.connect_selected(cx);
            }
        })
        .detach();
        Self { password, code }
    }
}

/// A text link: "+ Add", "+ New identity".
fn link(id: &'static str, text: &'static str, theme: &Theme) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .debug_selector(move || id.to_owned())
        .cursor_pointer()
        .text_size(px(11.5))
        .line_height(px(17.825))
        .font_weight(gpui::FontWeight::MEDIUM)
        .text_color(theme.c.accent_text)
        .hover(|style| style.opacity(0.8))
        .child(text)
}

/// The way onto the server, and whether to take it at every launch.
fn connect_row(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let connecting = shell.snapshot.connection == Connection::Connecting;
    let picked = shell
        .selected_identity()
        .map(|identity| identity.id.clone());
    let text = if connecting {
        "Connecting…".to_owned()
    } else {
        let name = shell
            .selected_identity()
            .map_or_else(SharedString::default, |identity| identity.username.clone());
        format!("Connect as {name}")
    };
    let automatic = picked.is_some() && shell.chrome.auto_connect == picked;
    div()
        .mt(px(19.0))
        .flex()
        .items_center()
        .gap(px(12.0))
        .child(
            div()
                .id("connect")
                .debug_selector(|| "connect".to_owned())
                .flex_1()
                .h(px(42.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded(theme.skin.radius_lg)
                .bg(theme.c.accent)
                .shadow(shadow(
                    4.0,
                    14.0,
                    gpui::Hsla {
                        a: 0.4,
                        ..theme.c.accent
                    },
                ))
                .text_size(px(13.0))
                .text_color(theme.c.on_accent)
                .font_weight(EMPHASIS)
                .map(|button| {
                    if connecting {
                        // Under way: a second press would start a second
                        // attempt.
                        button.opacity(0.6)
                    } else {
                        button
                            .cursor_pointer()
                            .hover(|style| style.opacity(0.92))
                            .on_click(cx.listener(|shell, _, _, cx| shell.connect_selected(cx)))
                    }
                })
                .child(label(&text, theme)),
        )
        .child(
            div()
                .id("auto-connect")
                .debug_selector(|| "auto-connect".to_owned())
                .flex_none()
                .flex()
                .items_center()
                .gap(px(8.0))
                .cursor_pointer()
                .text_size(px(11.5))
                .text_color(theme.c.muted)
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.chrome.auto_connect = if automatic { None } else { picked.clone() };
                    shell.remember_settings(cx);
                    cx.notify();
                }))
                .child(Switch::new(automatic))
                .child("Auto-connect"),
        )
}

/// The server's address, floating over the banner's trailing corner.
fn address_pill(server: &ServerGroup<'_>) -> impl IntoElement + use<> {
    let white = |alpha: f32| gpui::hsla(0.0, 0.0, 1.0, alpha);
    div()
        .absolute()
        .top(px(14.0))
        .right(px(18.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .pl(px(11.0))
        .pr(px(9.0))
        .py(px(3.0))
        .rounded_full()
        .bg(gpui::Hsla::from(gpui::Rgba {
            r: 10.0 / 255.0,
            g: 14.0 / 255.0,
            b: 24.0 / 255.0,
            a: 0.66,
        }))
        .border_1()
        .border_color(white(0.16))
        .text_size(px(10.0))
        .line_height(px(15.5))
        .text_color(white(0.94))
        .child(div().size(px(6.0)).rounded_full().bg(gpui::rgb(0xb9_c6e2)))
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
