//! Who is in the conversation on screen, down its trailing edge: the people
//! in the channel, under the role the server files each of them under.
//!
//! A server has no notion of somebody's one role: a user is in every group
//! that names them. A list has to pick one, so it picks the first in the
//! order the server lists its groups, which is the order its operator put
//! them in. Groups are of registered accounts; a guest has no role.

use std::collections::HashMap;
use std::ops::Range;

use gpui::{
    AnyElement, Context, Hsla, IntoElement, ParentElement, SharedString, Styled, Window, div,
    prelude::*, px, uniform_list,
};

use super::Shell;
use super::kit::Avatar;
use super::widgets::EMPHASIS;
use crate::engine::{Conversation, Role, Session, User};
use crate::theme::Theme;

/// The height of every row, a heading or a member: what lets only the
/// rows in view be built.
const ROW: f32 = 34.0;
/// How wide the panel is.
const WIDTH: f32 = 240.0;

/// One row of the panel.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Row {
    /// A role, or "Members" for those with none, and how many follow.
    Heading {
        name: SharedString,
        count: usize,
        color: Option<Hsla>,
    },
    Member(Session),
}

/// The panel's state, and the server's roles.
#[derive(Default)]
pub(super) struct Panel {
    pub open: bool,
    /// The roles as the server lists them.
    roles: Vec<Role>,
    /// Each account's place in `roles`: the first that names it.
    role_of: HashMap<u32, usize>,
    pub rows: Vec<Row>,
}

/// The first role in `roles` that names each account.
pub(super) fn primary(roles: &[Role]) -> HashMap<u32, usize> {
    let mut role_of = HashMap::new();
    for (at, role) in roles.iter().enumerate() {
        for account in &role.members {
            let _ = role_of.entry(*account).or_insert(at);
        }
    }
    role_of
}

/// `users` as the panel lists them: under each role that has somebody, in
/// the server's order, then those with no role; by name within each.
pub(super) fn rows(users: &[&User], roles: &[Role], role_of: &HashMap<u32, usize>) -> Vec<Row> {
    let place = |user: &User| {
        user.account
            .and_then(|account| role_of.get(&account).copied())
    };
    let mut listed: Vec<&User> = users.to_vec();
    // Those with no role last: `None` sorts first, so the key is flipped.
    listed.sort_by_cached_key(|user| (place(user).unwrap_or(usize::MAX), user.name.to_lowercase()));
    let mut rows = Vec::with_capacity(listed.len() + roles.len() + 1);
    let mut from = 0;
    while from < listed.len() {
        let at = place(listed[from]);
        let count = listed[from..]
            .iter()
            .take_while(|user| place(user) == at)
            .count();
        let role = at.and_then(|at| roles.get(at));
        rows.push(Row::Heading {
            name: role.map_or_else(|| "Members".into(), |role| role.name.clone()),
            count,
            color: role.and_then(|role| role.color),
        });
        rows.extend(
            listed[from..from + count]
                .iter()
                .map(|user| Row::Member(user.session)),
        );
        from += count;
    }
    rows
}

impl Shell {
    /// The colour of the role `user` is filed under, if it has one.
    pub(super) fn role_color(&self, user: &User) -> Option<Hsla> {
        let members = &self.panels.members;
        let at = members.role_of.get(&user.account?)?;
        members.roles.get(*at)?.color
    }

    /// The colour for whoever said a message, while they are still here.
    pub(super) fn sender_color(&self, session: Option<Session>) -> Option<Hsla> {
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
        if roles != self.panels.members.roles {
            self.panels.members.role_of = primary(&roles);
            self.panels.members.roles = roles;
        }
        self.list_members();
    }

    /// Work out the panel's rows, for the channel on screen. Nothing while
    /// it is closed: nobody is looking.
    pub(super) fn list_members(&mut self) {
        if !self.panels.members.open {
            return;
        }
        let Some(Conversation::Channel(channel)) = self.open else {
            self.panels.members.rows.clear();
            return;
        };
        let users: Vec<&User> = self.occupants(channel).collect();
        let listed = rows(
            &users,
            &self.panels.members.roles,
            &self.panels.members.role_of,
        );
        self.panels.members.rows = listed;
    }

    pub(super) fn toggle_members(&mut self, cx: &mut Context<Self>) {
        self.panels.members.open = !self.panels.members.open;
        self.list_members();
        cx.notify();
    }

    fn member_rows(
        &mut self,
        range: Range<usize>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let theme = crate::theme::ActiveTheme::get(cx);
        range
            .filter_map(|at| {
                Some(match self.panels.members.rows.get(at)? {
                    Row::Heading { name, count, color } => {
                        heading(name, *count, *color, &theme).into_any_element()
                    }
                    Row::Member(session) => {
                        let user = self
                            .snapshot
                            .users
                            .iter()
                            .find(|user| user.session == *session)?;
                        self.member(user, &theme, cx).into_any_element()
                    }
                })
            })
            .collect()
    }

    /// One member: their face, ringed while they talk, and their name in
    /// their role's colour. A click on somebody else opens the direct
    /// conversation with them.
    fn member(
        &self,
        user: &User,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let session = user.session;
        let own = self.snapshot.own_session == Some(session);
        let hover = theme.c.hover;
        div()
            .id(("member", session as usize))
            .debug_selector(move || format!("member-{session}"))
            .h(px(ROW))
            .flex()
            .items_center()
            .gap(px(9.0))
            .px(px(10.0))
            .rounded(theme.skin.radius_md)
            .text_size(px(12.5))
            .when(!own, |row| {
                row.cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        shell.open_conversation(Conversation::Direct(session), cx);
                    }))
            })
            .child(
                Avatar::new(&user.name)
                    .picture(user.avatar.as_ref())
                    .size(24.0)
                    .talking(self.talking.contains(&session)),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_color(self.role_color(user).unwrap_or(theme.c.text))
                    .child(user.name.clone()),
            )
    }
}

/// A role's name in its colour, and how many it has here.
fn heading(
    name: &SharedString,
    count: usize,
    color: Option<Hsla>,
    theme: &Theme,
) -> impl IntoElement + use<> {
    div()
        .h(px(ROW))
        .flex()
        .items_end()
        .gap(px(6.0))
        .px(px(10.0))
        .pb(px(6.0))
        .text_size(px(10.5))
        .font_weight(EMPHASIS)
        .text_color(color.unwrap_or(theme.c.dim))
        .child(name.to_uppercase())
        .child(
            div()
                .text_color(theme.c.dim)
                .child(SharedString::from(count.to_string())),
        )
}

/// The panel, down the trailing edge of the conversation.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement {
    div()
        .debug_selector(|| "members".to_owned())
        .flex_none()
        .w(px(WIDTH))
        .h_full()
        .p(px(8.0))
        .bg(theme.c.header)
        .border_l_1()
        .border_color(theme.c.line)
        .child(
            uniform_list(
                "member-rows",
                shell.panels.members.rows.len(),
                cx.processor(Shell::member_rows),
            )
            .size_full(),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(session: Session, name: &str, account: Option<u32>) -> User {
        User {
            session,
            name: name.to_owned().into(),
            channel: 1,
            muted: false,
            deafened: false,
            avatar: None,
            unread: 0,
            priority: false,
            account,
            hash: None,
        }
    }

    fn role(name: &str, members: &[u32]) -> Role {
        Role {
            name: name.to_owned().into(),
            color: None,
            members: members.to_vec(),
        }
    }

    #[test]
    fn everybody_is_filed_under_the_first_role_that_names_them() {
        let roles = [role("admins", &[7]), role("moderators", &[7, 9])];
        let role_of = primary(&roles);
        assert_eq!(
            role_of.get(&7),
            Some(&0),
            "the first, though both name them"
        );
        assert_eq!(role_of.get(&9), Some(&1));
        assert_eq!(role_of.get(&1), None);
    }

    #[test]
    fn roles_come_in_the_servers_order_then_those_without_one() {
        let roles = [
            role("admins", &[7]),
            role("idle", &[]),
            role("moderators", &[9, 8]),
        ];
        let users = [
            user(1, "zed", None),
            user(2, "Mia", Some(9)),
            user(3, "amy", Some(7)),
            user(4, "bob", Some(8)),
            user(5, "Al", Some(99)),
        ];
        let listed: Vec<&User> = users.iter().collect();
        let heading = |name: &str, count| Row::Heading {
            name: name.to_owned().into(),
            count,
            color: None,
        };
        assert_eq!(
            rows(&listed, &roles, &primary(&roles)),
            [
                heading("admins", 1),
                Row::Member(3),
                // A role with nobody here has no heading.
                heading("moderators", 2),
                Row::Member(4),
                Row::Member(2),
                heading("Members", 2),
                Row::Member(5),
                Row::Member(1),
            ]
        );
        assert!(rows(&[], &roles, &primary(&roles)).is_empty());
    }
}
