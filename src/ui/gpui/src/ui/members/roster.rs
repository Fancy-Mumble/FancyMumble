//! The member list's rows, worked out from who is on, who is registered and
//! the server's roles: the web client's `rosterGroups`.
//!
//! Two questions, one list. The channel on screen comes first, as "who can
//! hear me". Everybody else follows under the server's roles, in the order
//! its operator put them, each person under the first role that names them;
//! then those with an account and no role, then guests. Somebody in the
//! channel on screen is listed there and under their role as well.

use std::collections::{HashMap, HashSet};

use gpui::Hsla;

use crate::engine::{ChannelId, Registered, Role, Session, User};

/// One row of the list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Row {
    /// What the people under it have in common, and how many follow.
    Heading { group: Group, count: usize },
    /// Somebody, and whether they are listed under the channel on screen.
    Member { who: Who, here: bool },
    /// The registered people are still on their way.
    Loading,
}

/// What a heading heads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) enum Group {
    /// The channel on screen.
    Channel,
    /// The role at this place in the server's list.
    Role(usize),
    /// An account, and no role.
    Members,
    /// No account.
    Guests,
}

/// Who a member row is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Who {
    /// Somebody on the server now.
    On(Session),
    /// The registered account at this place in the list of accounts,
    /// whose owner is not on.
    Away(usize),
}

/// The server's roles, and who each files and colours.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct Roles {
    pub list: Vec<Role>,
    /// Each account's place in `list`: the first role that names it.
    filed: HashMap<u32, usize>,
    /// Each account's name colour: that of the first role that names it
    /// and has one, which need not be the role it is filed under.
    colored: HashMap<u32, Hsla>,
}

impl Roles {
    pub(crate) fn new(list: Vec<Role>) -> Self {
        let mut filed = HashMap::new();
        let mut colored = HashMap::new();
        for (at, role) in list.iter().enumerate() {
            for account in &role.members {
                let _ = filed.entry(*account).or_insert(at);
                if let Some(color) = role.color {
                    let _ = colored.entry(*account).or_insert(color);
                }
            }
        }
        Self {
            list,
            filed,
            colored,
        }
    }

    /// Where somebody with `account` is filed.
    pub(crate) fn group_of(&self, account: Option<u32>) -> Group {
        match registered(account) {
            None => Group::Guests,
            Some(account) => self
                .filed
                .get(&account)
                .map_or(Group::Members, |at| Group::Role(*at)),
        }
    }

    /// The colour the name of somebody with `account` is drawn in.
    pub(crate) fn color_of(&self, account: Option<u32>) -> Option<Hsla> {
        self.colored.get(&registered(account)?).copied()
    }
}

/// An account that is one: Mumble says "not registered" with zero too.
fn registered(account: Option<u32>) -> Option<u32> {
    account.filter(|account| *account > 0)
}

/// What the rows are worked out from.
#[derive(Debug)]
pub(crate) struct Roster<'a> {
    /// Everybody on the server now.
    pub users: &'a [User],
    /// The registered accounts to list besides; empty where they are not
    /// wanted or not known.
    pub accounts: &'a [Registered],
    pub roles: &'a Roles,
    /// The channel on screen.
    pub channel: Option<ChannelId>,
    /// What a name must hold to be listed, in lower case; empty for all.
    pub wanted: &'a str,
}

/// Somebody to be listed, with what they are sorted by.
struct Listed {
    who: Who,
    group: Group,
    away: bool,
    name: String,
}

impl Roster<'_> {
    /// The rows: the channel on screen, then each group that has somebody,
    /// by group; within each, who is on first, then by name.
    pub(crate) fn rows(&self) -> Vec<Row> {
        let (mut here, mut everyone) = self.listed();
        let mut rows = Vec::with_capacity(here.len() + everyone.len() + self.roles.list.len() + 2);
        here.sort_by(|left, right| left.name.cmp(&right.name));
        if !here.is_empty() {
            rows.push(Row::Heading {
                group: Group::Channel,
                count: here.len(),
            });
            rows.extend(here.iter().map(|listed| Row::Member {
                who: listed.who,
                here: true,
            }));
        }
        everyone.sort_by(|left, right| {
            (left.group, left.away, &left.name).cmp(&(right.group, right.away, &right.name))
        });
        for group in everyone.chunk_by(|left, right| left.group == right.group) {
            rows.push(Row::Heading {
                group: group[0].group,
                count: group.len(),
            });
            rows.extend(group.iter().map(|listed| Row::Member {
                who: listed.who,
                here: false,
            }));
        }
        rows
    }

    /// Who is in the channel on screen, and everybody to be listed: those
    /// on whose names hold what is wanted, and the accounts whose owners
    /// are not on.
    fn listed(&self) -> (Vec<Listed>, Vec<Listed>) {
        let name_of = |name: &str| name.to_lowercase();
        let wanted = |name: &str| self.wanted.is_empty() || name.contains(self.wanted);
        let mut here = Vec::new();
        let mut everyone = Vec::new();
        for user in self.users {
            let name = name_of(&user.name);
            if !wanted(&name) {
                continue;
            }
            let on = |group| Listed {
                who: Who::On(user.session),
                group,
                away: false,
                name: name.clone(),
            };
            if Some(user.channel) == self.channel {
                here.push(on(Group::Channel));
            }
            everyone.push(on(self.roles.group_of(user.account)));
        }
        let on: HashSet<u32> = self
            .users
            .iter()
            .filter_map(|user| registered(user.account))
            .collect();
        for (at, account) in self.accounts.iter().enumerate() {
            let name = name_of(&account.name);
            if on.contains(&account.id) || !wanted(&name) {
                continue;
            }
            everyone.push(Listed {
                who: Who::Away(at),
                group: self.roles.group_of(Some(account.id)),
                away: true,
                name,
            });
        }
        (here, everyone)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(session: Session, name: &str, channel: ChannelId, account: Option<u32>) -> User {
        User {
            session,
            name: name.to_owned().into(),
            channel,
            muted: false,
            deafened: false,
            server_muted: false,
            server_deafened: false,
            avatar: None,
            unread: 0,
            priority: false,
            account,
            hash: None,
        }
    }

    fn account(id: u32, name: &str) -> Registered {
        Registered {
            id,
            name: name.to_owned().into(),
            last_seen: None,
            last_channel: None,
            picture: false,
        }
    }

    fn role(name: &str, color: Option<u32>, members: &[u32]) -> Role {
        Role {
            name: name.to_owned().into(),
            color: color.map(|color| gpui::rgb(color).into()),
            members: members.to_vec(),
        }
    }

    fn member(who: Who) -> Row {
        Row::Member { who, here: false }
    }

    fn heading(group: Group, count: usize) -> Row {
        Row::Heading { group, count }
    }

    #[test]
    fn everybody_is_filed_under_the_first_role_that_names_them_and_coloured_by_the_first_with_a_colour()
     {
        let roles = Roles::new(vec![
            role("admins", None, &[7]),
            role("moderators", Some(0xff_0000), &[7, 9]),
        ]);
        assert_eq!(roles.group_of(Some(7)), Group::Role(0));
        assert_eq!(roles.group_of(Some(9)), Group::Role(1));
        assert_eq!(roles.group_of(Some(1)), Group::Members);
        assert_eq!(roles.group_of(Some(0)), Group::Guests, "zero is nobody's");
        assert_eq!(roles.group_of(None), Group::Guests);
        assert!(
            roles.color_of(Some(7)).is_some(),
            "the second role's colour"
        );
        assert!(roles.color_of(Some(1)).is_none());
    }

    #[test]
    fn the_channel_comes_first_then_roles_in_order_then_members_then_guests() {
        let roles = Roles::new(vec![
            role("admins", None, &[7]),
            role("idle", None, &[]),
            role("moderators", None, &[9, 8, 30]),
        ]);
        let users = [
            user(1, "zed", 1, None),
            user(2, "Mia", 1, Some(9)),
            user(3, "amy", 2, Some(7)),
            user(4, "bob", 2, Some(8)),
            user(5, "Al", 2, Some(99)),
        ];
        // Mia is on, so her account is not listed again; Cy and Dee are
        // away.
        let accounts = [account(9, "Mia"), account(30, "Cy"), account(31, "Dee")];
        let rows = Roster {
            users: &users,
            accounts: &accounts,
            roles: &roles,
            channel: Some(1),
            wanted: "",
        }
        .rows();
        let here = |session| Row::Member {
            who: Who::On(session),
            here: true,
        };
        assert_eq!(
            rows,
            [
                heading(Group::Channel, 2),
                here(2),
                here(1),
                heading(Group::Role(0), 1),
                member(Who::On(3)),
                // A role with nobody has no heading; who is on comes first.
                heading(Group::Role(2), 3),
                member(Who::On(4)),
                member(Who::On(2)),
                member(Who::Away(1)),
                heading(Group::Members, 2),
                member(Who::On(5)),
                member(Who::Away(2)),
                heading(Group::Guests, 1),
                member(Who::On(1)),
            ]
        );
    }

    #[test]
    fn what_is_wanted_finds_people_on_and_away_alike() {
        let roles = Roles::default();
        let users = [user(1, "Rin", 1, Some(3)), user(2, "Flora", 1, None)];
        let accounts = [account(40, "Marin"), account(41, "Otto")];
        let rows = Roster {
            users: &users,
            accounts: &accounts,
            roles: &roles,
            channel: None,
            wanted: "rin",
        }
        .rows();
        assert_eq!(
            rows,
            [
                heading(Group::Members, 2),
                member(Who::On(1)),
                member(Who::Away(0)),
            ]
        );
        let none = Roster {
            users: &[],
            accounts: &[],
            roles: &roles,
            channel: Some(1),
            wanted: "",
        };
        assert!(none.rows().is_empty());
    }
}
