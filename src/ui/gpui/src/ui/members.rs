//! Who belongs to the server, down the trailing edge of the conversation:
//! the web client's member panel. The people in the channel on screen
//! first, then everybody under the role the server files them under, then
//! those with an account and no role, then guests; with the registered
//! people who are not on as well, dimmed, while the switch says so.
//!
//! The registered people are the server's list of accounts. It is asked for
//! when the panel opens with them shown, and let go of, pictures and all,
//! when it closes or they are switched off: on a server with thousands
//! registered it is not a small answer. Only the rows on screen are drawn,
//! and only their pictures are read.

mod roster;
mod row;

use std::collections::HashMap;
use std::sync::Arc;

use gpui::{
    AnyElement, Context, IntoElement, ListAlignment, ListState, ParentElement, SharedString,
    Styled, Window, div, prelude::*, px,
};

#[cfg(test)]
pub(crate) use roster::Group;
pub(crate) use roster::{Roles, Row, Who};

use super::Shell;
use super::kit::{IconButton, Reachable, TickBox, Tone, icon};
use super::text_input::TextInput;
use crate::engine::{Connection, Conversation, Registered, Role, Session, User};
use crate::store::Settings;
use crate::theme::Theme;
use crate::words::t;

/// The height of a member row.
const ROW: f32 = 36.0;
/// How wide the panel is.
const WIDTH: f32 = 264.0;

/// The server's list of accounts, as far as the panel has it.
#[derive(Debug, Default)]
enum Directory {
    /// Not asked for, or let go of.
    #[default]
    Unasked,
    /// Asked of the server named, and on its way.
    Asked(Option<SharedString>),
    /// What the server named sent.
    Listed(Option<SharedString>, Vec<Registered>),
    /// The server named would not say: only who is on is listed.
    Refused(Option<SharedString>),
}

impl Directory {
    /// The server it was asked of, if it was asked at all.
    fn server(&self) -> Option<Option<&SharedString>> {
        match self {
            Self::Unasked => None,
            Self::Asked(server) | Self::Listed(server, _) | Self::Refused(server) => {
                Some(server.as_ref())
            }
        }
    }

    fn accounts(&self) -> &[Registered] {
        match self {
            Self::Listed(_, accounts) => accounts,
            _ => &[],
        }
    }
}

/// The panel's state, and the server's roles.
pub(super) struct Panel {
    pub open: bool,
    /// Whether the registered people who are not on are listed: kept with
    /// the settings.
    pub show_offline: bool,
    roles: Roles,
    pub rows: Vec<Row>,
    /// Where the rows are scrolled to, and which of them are drawn: only
    /// those in view, and a row more each way.
    list: ListState,
    /// What narrows the list by name; made the first time the panel opens.
    search: Option<gpui::Entity<TextInput>>,
    /// What is typed there, as last read, in lower case.
    wanted: String,
    directory: Directory,
    /// The pictures of the accounts whose rows were drawn, by account:
    /// read when a row first comes into view, let go of with the list.
    faces: HashMap<u32, Option<Arc<gpui::Image>>>,
}

impl Default for Panel {
    fn default() -> Self {
        Self {
            open: false,
            show_offline: true,
            roles: Roles::default(),
            rows: Vec::new(),
            list: ListState::new(0, ListAlignment::Top, px(ROW)),
            search: None,
            wanted: String::new(),
            directory: Directory::default(),
            faces: HashMap::new(),
        }
    }
}

impl Panel {
    /// How wide the channel at the end of a row may grow: under half of it.
    const WHERE_WIDTH: f32 = 110.0;

    /// Closed, with the switch as it was `stored`.
    pub(super) fn remembering(stored: &Settings) -> Self {
        Self {
            show_offline: !stored.hide_offline,
            ..Self::default()
        }
    }

    /// Whether the list of accounts is on its way.
    fn loading(&self) -> bool {
        self.show_offline && matches!(self.directory, Directory::Asked(_))
    }

    /// How many pictures of accounts are held, for the tests.
    #[cfg(test)]
    pub(super) fn faces_held(&self) -> usize {
        self.faces.len()
    }

    /// Scroll the list so that the row `at` is at its top, as a wheel
    /// would, for the tests.
    #[cfg(test)]
    pub(super) fn scroll_to(&self, at: usize) {
        self.list.scroll_to(gpui::ListOffset {
            item_ix: at,
            offset_in_item: px(0.0),
        });
    }

    /// The accounts listed, for the tests.
    #[cfg(test)]
    pub(super) fn accounts(&self) -> &[Registered] {
        self.directory.accounts()
    }
}

impl Shell {
    /// Every role that names `user`'s account, in the server's order.
    pub(super) fn roles_of(&self, user: &User) -> impl Iterator<Item = &Role> {
        let account = user.account;
        self.panels
            .members
            .roles
            .list
            .iter()
            .filter(move |role| account.is_some_and(|account| role.members.contains(&account)))
    }

    /// The colour `user`'s name is drawn in: that of the first role that
    /// names them and has one.
    pub(super) fn role_color(&self, user: &User) -> Option<gpui::Hsla> {
        self.panels.members.roles.color_of(user.account)
    }

    /// The colour for whoever said a message, while they are still here.
    pub(super) fn sender_color(&self, session: Option<Session>) -> Option<gpui::Hsla> {
        let session = session?;
        let user = self
            .snapshot
            .users
            .iter()
            .find(|user| user.session == session)?;
        self.role_color(user)
    }

    /// Read the server's roles again, and list the panel afresh if it is
    /// showing. Called with every snapshot: both are a handful of entries.
    pub(super) fn take_roles(&mut self) {
        let roles = self.engine.roles();
        if roles != self.panels.members.roles.list {
            self.panels.members.roles = Roles::new(roles);
        }
        self.list_members();
    }

    /// Work out the panel's rows. Nothing while it is closed: nobody is
    /// looking.
    pub(super) fn list_members(&mut self) {
        if !self.panels.members.open {
            return;
        }
        self.want_directory();
        let members = &self.panels.members;
        let channel = match self.open {
            Some(Conversation::Channel(channel)) => Some(channel),
            _ => None,
        };
        let accounts = if members.show_offline {
            members.directory.accounts()
        } else {
            &[]
        };
        let mut rows = roster::Roster {
            users: &self.snapshot.users,
            accounts,
            roles: &members.roles,
            channel,
            wanted: &members.wanted,
        }
        .rows();
        if members.loading() {
            rows.push(Row::Loading);
        }
        // Measured again, where the reader had scrolled to.
        if rows != members.rows {
            let top = members.list.logical_scroll_top();
            members.list.reset(rows.len());
            members.list.scroll_to(top);
        }
        self.panels.members.rows = rows;
    }

    /// The server the snapshot is of, as the list of accounts is kept for.
    fn active_server(&self) -> Option<SharedString> {
        self.snapshot
            .sessions
            .iter()
            .find(|session| session.active)
            .map(|session| session.id.clone())
    }

    /// Ask for the list of accounts, if the panel shows it and it was not
    /// asked of this server yet.
    fn want_directory(&mut self) {
        let members = &self.panels.members;
        let connected = self.snapshot.connection == Connection::Connected;
        if !members.open || !members.show_offline || !connected {
            return;
        }
        let server = self.active_server();
        if members.directory.server() == Some(server.as_ref()) {
            return;
        }
        self.drop_directory();
        self.panels.members.directory = Directory::Asked(server);
        self.engine.directory();
    }

    /// Let go of the list of accounts and their pictures.
    fn drop_directory(&mut self) {
        let members = &mut self.panels.members;
        if matches!(members.directory, Directory::Unasked) {
            return;
        }
        members.directory = Directory::Unasked;
        members.faces = HashMap::new();
        self.engine.put_directory_away();
    }

    /// The server sent its accounts: to the member list, if it asked, and
    /// to the administrator's panels.
    pub(super) fn take_accounts(&mut self, accounts: Vec<Registered>, cx: &mut Context<Self>) {
        self.take_directory(&accounts);
        self.take_registered(accounts, cx);
    }

    /// The server sent its accounts: list them, if the panel asked.
    fn take_directory(&mut self, accounts: &[Registered]) {
        let members = &mut self.panels.members;
        let server = match &members.directory {
            Directory::Asked(server) | Directory::Listed(server, _) => server.clone(),
            Directory::Unasked | Directory::Refused(_) => return,
        };
        members.directory = Directory::Listed(server, accounts.to_vec());
        members.faces.clear();
        self.list_members();
    }

    /// The server would not list its accounts: who is on is all there is.
    pub(super) fn directory_refused(&mut self) {
        let members = &mut self.panels.members;
        if let Directory::Asked(server) = &members.directory {
            members.directory = Directory::Refused(server.clone());
            self.list_members();
        }
    }

    /// The picture of `account`, read the first time its row is drawn.
    fn face_of(&mut self, account: &Registered) -> Option<Arc<gpui::Image>> {
        if !account.picture {
            return None;
        }
        let engine = &self.engine;
        self.panels
            .members
            .faces
            .entry(account.id)
            .or_insert_with(|| engine.account_picture(account.id))
            .clone()
    }

    /// What was typed to find a member changed: list them again.
    fn narrow_members(&mut self, cx: &mut Context<Self>) {
        let typed = self
            .panels
            .members
            .search
            .as_ref()
            .map(|search| search.read(cx).text().trim().to_lowercase());
        self.panels.members.wanted = typed.unwrap_or_default();
        self.list_members();
        cx.notify();
    }

    pub(super) fn toggle_members(&mut self, cx: &mut Context<Self>) {
        self.panels.members.open = !self.panels.members.open;
        if self.panels.members.search.is_none() {
            let search = cx.new(|cx| TextInput::new(t!("Find a member"), cx));
            cx.observe(&search, |shell, _, cx| shell.narrow_members(cx))
                .detach();
            self.panels.members.search = Some(search);
        }
        if self.panels.members.open {
            self.list_members();
        } else {
            self.drop_directory();
            self.panels.members.rows = Vec::new();
            self.panels.members.list.reset(0);
        }
        cx.notify();
    }

    /// Show the registered people who are not on, or stop; kept.
    fn show_offline(&mut self, show: bool, cx: &mut Context<Self>) {
        self.panels.members.show_offline = show;
        if !show {
            self.drop_directory();
        }
        self.list_members();
        self.remember_settings(cx);
        cx.notify();
    }

    /// The row at `at`, drawn as it comes into view.
    fn member_row(&mut self, at: usize, _: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let theme = crate::theme::ActiveTheme::get(cx);
        let drawn = match self.panels.members.rows.get(at).copied() {
            Some(Row::Heading { group, count }) => Some(row::heading(
                group,
                count,
                at == 0,
                &self.panels.members.roles,
                &theme,
            )),
            Some(Row::Loading) => Some(row::loading(&theme)),
            Some(Row::Member {
                who: Who::On(session),
                here,
            }) => {
                let users = &self.snapshot.users;
                let user = users.iter().find(|user| user.session == session).cloned();
                user.map(|user| self.member_on(&user, here, &theme, cx))
            }
            Some(Row::Member {
                who: Who::Away(at), ..
            }) => {
                let account = self.panels.members.directory.accounts().get(at).cloned();
                account.map(|account| {
                    let face = self.face_of(&account);
                    row::away(&account, face.as_ref(), &self.panels.members.roles, &theme)
                })
            }
            None => None,
        };
        // A row that went while it was being drawn is drawn as nothing.
        drawn.unwrap_or_else(|| div().into_any_element())
    }
}

/// The panel's head: its name, and the way to close it.
fn head(theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    div()
        .flex_none()
        .flex()
        .items_center()
        .px(px(14.0))
        .pt(px(14.0))
        .pb(px(8.0))
        .child(
            div()
                .text_size(px(15.0))
                .line_height(px(23.0))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .text_color(theme.c.text)
                .child(t!("Members")),
        )
        .child(
            div().ml_auto().child(
                IconButton::new("members-close", "x")
                    .size(23.0)
                    .glyph_size(13.0)
                    .tone(Tone::Muted)
                    .tip(t!("Close members"))
                    .on_click(cx.listener(|shell, _, _, cx| shell.toggle_members(cx))),
            ),
        )
}

/// The switch that brings in the registered people who are not on.
fn offline_switch(on: bool, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    let control = div()
        .id("members-offline")
        .debug_selector(|| "members-offline".to_owned())
        .flex_none()
        .mx(px(12.0))
        .mb(px(8.0))
        .h(px(28.0))
        .px(px(8.0))
        .flex()
        .items_center()
        .gap(px(7.0))
        .rounded(theme.skin.radius_md)
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .text_size(px(11.5))
        .text_color(theme.c.muted)
        .on_click(cx.listener(move |shell, _, _, cx| shell.show_offline(!on, cx)))
        .child(TickBox::new(on))
        .child(t!("Show offline members"));
    Reachable::new("members-offline", control).corner(theme.skin.radius_md)
}

/// The panel, down the trailing edge of the conversation.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement {
    let members = &shell.panels.members;
    div()
        .debug_selector(|| "members".to_owned())
        .flex_none()
        .w(px(WIDTH))
        .h_full()
        .bg(theme.c.panel)
        .border_l_1()
        .border_color(theme.c.line)
        .flex()
        .flex_col()
        .child(head(theme, cx))
        .children(members.search.clone().map(|search| {
            div().flex_none().px(px(12.0)).pb(px(6.0)).child(
                div()
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
                    .child(search),
            )
        }))
        .child(offline_switch(members.show_offline, theme, cx))
        .child(div().flex_none().h(px(1.0)).bg(theme.c.line))
        .child(
            gpui::list(members.list.clone(), cx.processor(Shell::member_row))
                .flex_1()
                .min_h_0()
                .px(px(8.0))
                .py(px(4.0)),
        )
}
