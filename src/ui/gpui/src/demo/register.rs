//! What the demo server's administrator changed in its register: accounts
//! renamed or taken away, and the root channel's rules once they were
//! written, which are the server's roles. Laid over the register as the
//! seed has it, so the lists the administration asks for again show what
//! was done.

use std::collections::{HashMap, HashSet};

use gpui::SharedString;

use crate::engine::{Acl, AclGroup, Action, Registered, Role};

/// The root channel: where a server keeps its roles, as groups.
const ROOT: u32 = 0;

/// The changes, none to begin with.
#[derive(Debug, Default)]
pub(crate) struct Register {
    renamed: HashMap<u32, SharedString>,
    gone: HashSet<u32>,
    /// Each channel's rules as they were last written; a channel not here
    /// has them as the seed does. The root's are the server's roles.
    written: HashMap<u32, Acl>,
}

impl Register {
    /// Take in what `action` changes here.
    pub(crate) fn apply(&mut self, action: &Action) {
        match action {
            Action::RenameRegistered { id, name } => {
                let _ = self.renamed.insert(*id, name.clone().into());
            }
            Action::Unregister { id } => {
                let _ = self.gone.insert(*id);
            }
            Action::SetAcl(acl) => {
                let _ = self.written.insert(acl.channel, acl.clone());
            }
            _ => {}
        }
    }

    /// `accounts` as they are after the changes.
    pub(crate) fn over(&self, accounts: Vec<Registered>) -> Vec<Registered> {
        accounts
            .into_iter()
            .filter(|account| !self.gone.contains(&account.id))
            .map(|account| match self.renamed.get(&account.id) {
                Some(name) => Registered {
                    name: name.clone(),
                    ..account
                },
                None => account,
            })
            .collect()
    }

    /// The roles as they were last written, or `seeded` if they never were.
    pub(crate) fn roles(&self, seeded: Vec<Role>) -> Vec<Role> {
        self.written.get(&ROOT).map_or(seeded, roles_of)
    }

    /// The rules of `channel` as they were last written, if they were.
    pub(crate) fn rules(&self, channel: u32) -> Option<&Acl> {
        self.written.get(&channel)
    }
}

/// The root channel's groups, one for each role, with its members added
/// and in its colour.
pub(crate) fn groups(roles: &[Role]) -> Vec<AclGroup> {
    roles
        .iter()
        .map(|role| {
            let mut group = AclGroup::new(role.name.clone());
            group.added.clone_from(&role.members);
            group.look.color = role.color.map(hex);
            group
        })
        .collect()
}

/// `colour` as a server writes it, `#rrggbb`.
fn hex(colour: gpui::Hsla) -> SharedString {
    crate::ui::hex(colour).into()
}

/// The roles `acl`'s groups make, as a server reads them: not its own
/// groups, whose names start with a tilde.
fn roles_of(acl: &Acl) -> Vec<Role> {
    acl.groups
        .iter()
        .filter(|group| !group.name.starts_with('~'))
        .map(|group| Role {
            name: group.name.clone(),
            color: group
                .look
                .color
                .as_ref()
                .and_then(|color| crate::theme::parse_color(color))
                .map(Into::into),
            members: group.members(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(id: u32, name: &str) -> Registered {
        Registered {
            id,
            name: name.to_owned().into(),
            last_seen: None,
            last_channel: None,
            picture: false,
        }
    }

    #[test]
    fn what_was_renamed_or_taken_away_shows_in_the_register() {
        let mut register = Register::default();
        register.apply(
            &Action::RenameRegistered {
                id: 1,
                name: "Ada".to_owned(),
            },
        );
        register.apply(&Action::Unregister { id: 2 });
        let after = register.over(vec![account(1, "A"), account(2, "B"), account(3, "C")]);
        let names: Vec<_> = after
            .iter()
            .map(|account| account.name.to_string())
            .collect();
        assert_eq!(names, ["Ada", "C"]);
    }

    #[test]
    fn the_root_groups_written_are_the_roles_in_their_colours() {
        let seeded = vec![Role {
            name: "moderators".into(),
            color: Some(gpui::rgb(0xe0_9a4b).into()),
            members: vec![103],
        }];
        let mut register = Register::default();
        let mut moderators = groups(&seeded).remove(0);
        moderators.added.push(105);
        let acl = Acl {
            channel: ROOT,
            inherit: true,
            groups: vec![moderators],
            rules: Vec::new(),
        };
        register.apply(&Action::SetAcl(acl));
        let roles = register.roles(seeded.clone());
        assert_eq!(roles[0].members, [103, 105]);
        let colour = |role: &Role| role.color.map(hex);
        assert_eq!(colour(&roles[0]), colour(&seeded[0]), "in its colour");
    }
}
