//! Which of the server's roles an account holds, chosen in a dialog over
//! the Users page: the web UI's `RoleManagerDialog`.
//!
//! A role is a group of the root channel. Only the groups whose membership
//! changed are written back, over the rules as they were read, so what
//! somebody else changed meanwhile in another group stays as they left it.
//! A membership that comes from a parent channel cannot be taken away here,
//! so it is shown and cannot be ticked off.

use std::collections::BTreeSet;

use gpui::{Context, SharedString};

use super::super::Shell;
use super::ROOT;
use crate::engine::{Acl, Action};

/// One role as the dialog lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Line {
    pub name: SharedString,
    /// Held now, as ticked.
    pub ticked: bool,
    /// Held only by way of a parent channel: it cannot be ticked off here.
    pub inherited_only: bool,
}

/// The dialog's state.
#[derive(Debug, Clone)]
pub(in crate::ui) struct Managing {
    pub id: u32,
    pub name: SharedString,
    /// The roles the account was added to, as the rules were read; `None`
    /// until they have been.
    initial: Option<BTreeSet<SharedString>>,
    /// The roles ticked now.
    chosen: BTreeSet<SharedString>,
}

impl Managing {
    fn new(id: u32, name: SharedString, roots: Option<&Acl>) -> Self {
        let mut managing = Self {
            id,
            name,
            initial: None,
            chosen: BTreeSet::new(),
        };
        if let Some(acl) = roots {
            managing.seed(acl);
        }
        managing
    }

    /// Start from `acl`, the root's rules as just read.
    pub(super) fn seed(&mut self, acl: &Acl) {
        let added: BTreeSet<SharedString> = acl
            .groups
            .iter()
            .filter(|group| group.added.contains(&self.id))
            .map(|group| group.name.clone())
            .collect();
        self.chosen.clone_from(&added);
        self.initial = Some(added);
    }

    /// Whether the rules have been read.
    pub(super) fn loaded(&self) -> bool {
        self.initial.is_some()
    }

    /// The roles of `acl` to choose from, by name: not the server's own
    /// groups, whose names start with a tilde.
    pub(super) fn lines(&self, acl: Option<&Acl>) -> Vec<Line> {
        let mut lines: Vec<Line> = acl
            .map(|acl| acl.groups.as_slice())
            .unwrap_or_default()
            .iter()
            .filter(|group| !group.name.starts_with('~'))
            .map(|group| {
                let added = group.added.contains(&self.id);
                let inherited = group.inherited.contains(&self.id);
                Line {
                    name: group.name.clone(),
                    ticked: self.chosen.contains(&group.name),
                    inherited_only: inherited && !added,
                }
            })
            .collect();
        lines.sort_by(|one, other| one.name.cmp(&other.name));
        lines
    }

    /// Whether what is ticked differs from what was read.
    pub(super) fn dirty(&self) -> bool {
        self.initial
            .as_ref()
            .is_some_and(|initial| *initial != self.chosen)
    }

    /// Tick `role`, or untick it.
    fn toggle(&mut self, role: &SharedString) {
        if !self.chosen.remove(role) {
            let _ = self.chosen.insert(role.clone());
        }
    }

    /// `acl` with the account added to the roles ticked and taken out of
    /// those unticked; only the groups that change are touched.
    fn patched(&self, mut acl: Acl) -> Acl {
        for group in &mut acl.groups {
            let member = self.chosen.contains(&group.name);
            if member == group.added.contains(&self.id) {
                continue;
            }
            if member {
                group.added.push(self.id);
                // Added lifts a removal too, or the two lists disagree and
                // the server keeps them out.
                group.removed.retain(|removed| *removed != self.id);
            } else {
                group.added.retain(|added| *added != self.id);
            }
        }
        acl
    }
}

impl Shell {
    /// Open the dialog on the account `id`, asking for the root's rules
    /// again: the dialog opens before they come.
    pub(super) fn manage_roles(&mut self, id: u32, cx: &mut Context<Self>) {
        let Some(users) = self.users_page_mut() else {
            return;
        };
        let Some(name) = users.account(id).map(|account| account.name.clone()) else {
            return;
        };
        users.managing = Some(Managing::new(id, name, users.roots.as_ref()));
        self.engine.request_acl(ROOT);
        cx.notify();
    }

    /// Tick a role in the dialog, or untick it.
    pub(super) fn toggle_role(&mut self, role: &SharedString, cx: &mut Context<Self>) {
        if let Some(managing) = self
            .users_page_mut()
            .and_then(|users| users.managing.as_mut())
        {
            managing.toggle(role);
        }
        cx.notify();
    }

    /// Put the dialog away without saving.
    pub(super) fn close_roles(&mut self, cx: &mut Context<Self>) {
        if let Some(users) = self.users_page_mut() {
            users.managing = None;
        }
        cx.notify();
    }

    /// Write the roles ticked to the root's rules, and put the dialog away.
    /// Nothing changed is nothing sent.
    pub(super) fn save_roles(&mut self, cx: &mut Context<Self>) {
        let Some(users) = self.users_page_mut() else {
            return;
        };
        let (Some(managing), Some(roots)) = (users.managing.as_ref(), users.roots.as_ref()) else {
            return;
        };
        if !managing.dirty() {
            return;
        }
        let patched = managing.patched(roots.clone());
        users.roots = Some(patched.clone());
        users.managing = None;
        self.engine.act(Action::SetAcl(patched));
        // What the server made of it is what the chips show.
        self.engine.request_acl(ROOT);
        let theme = crate::theme::ActiveTheme::get(cx);
        self.refilter_users(&theme, cx);
        cx.notify();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::AclGroup;

    fn group(name: &str, inherited: &[u32], added: &[u32], removed: &[u32]) -> AclGroup {
        AclGroup {
            inherited: inherited.to_vec(),
            added: added.to_vec(),
            removed: removed.to_vec(),
            ..AclGroup::new(name.to_owned())
        }
    }

    fn roots() -> Acl {
        Acl {
            channel: ROOT,
            inherit: true,
            groups: vec![
                group("wardens", &[], &[7], &[]),
                group("~sub_0", &[], &[7], &[]),
                group("elders", &[7], &[], &[]),
                group("artists", &[], &[], &[7]),
            ],
            rules: Vec::new(),
        }
    }

    #[test]
    fn the_roles_are_listed_by_name_without_the_servers_own() {
        let managing = Managing::new(7, "Ada".into(), Some(&roots()));
        let lines = managing.lines(Some(&roots()));
        let names: Vec<_> = lines.iter().map(|line| line.name.to_string()).collect();
        assert_eq!(names, ["artists", "elders", "wardens"]);
        assert!(lines[1].inherited_only, "held by way of the parent");
        assert!(lines[2].ticked && !lines[0].ticked);
        assert!(!managing.dirty());
    }

    #[test]
    fn only_the_groups_that_change_are_written_and_adding_lifts_a_removal() {
        let mut managing = Managing::new(7, "Ada".into(), Some(&roots()));
        managing.toggle(&"artists".into());
        managing.toggle(&"wardens".into());
        assert!(managing.dirty());
        let written = managing.patched(roots());
        assert_eq!(written.groups[0].added, Vec::<u32>::new(), "taken out");
        assert_eq!(
            written.groups[1],
            roots().groups[1],
            "the server's own untouched"
        );
        assert_eq!(written.groups[2], roots().groups[2], "unchanged");
        assert_eq!(written.groups[3].added, [7]);
        assert!(written.groups[3].removed.is_empty(), "the removal lifted");
    }

    #[test]
    fn nothing_is_dirty_before_the_rules_are_read() {
        let mut managing = Managing::new(7, "Ada".into(), None);
        assert!(!managing.loaded());
        managing.toggle(&"wardens".into());
        assert!(!managing.dirty());
        managing.seed(&roots());
        assert!(managing.loaded());
        assert!(!managing.dirty(), "started again from what was read");
    }
}
