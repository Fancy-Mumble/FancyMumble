//! What the Channels / ACL page works out from a channel's rules and the
//! tree of channels, apart from how it is drawn: whether a channel has
//! rules of its own, who its rules let in, and which channels the tree
//! shows. The web UI's `channelAclModel` and `AclAdmin`'s tree filters.

use std::collections::{BTreeMap, BTreeSet};

use gpui::SharedString;

use crate::engine::{Acl, Channel, ChannelId, User};

/// The permission to enter a channel, as Mumble numbers it.
pub(super) const ENTER: u32 = 0x4;

/// Whether `acl` says something of its own: it does not take its parent's
/// rules, or has a rule or a group that is the channel's own.
pub(super) fn has_own_rules(acl: &Acl) -> bool {
    !acl.inherit
        || acl.rules.iter().any(|rule| !rule.inherited)
        || acl.groups.iter().any(|group| !group.from_parent)
}

/// Who a channel's rules let in.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct Access {
    /// Accounts let in by a rule of their own; a later deny takes it back.
    pub granted: Vec<u32>,
    /// `@all` lets in: everybody.
    pub everybody: bool,
    /// `@auth` lets in: everybody registered.
    pub registered: bool,
    /// Each group whose rule lets in, with who is in it.
    pub groups: BTreeMap<SharedString, Vec<u32>>,
}

impl Access {
    /// Who `acl` lets in, rule by rule in order.
    pub(super) fn of(acl: &Acl) -> Self {
        let mut access = Self::default();
        let mut granted: Vec<u32> = Vec::new();
        let mut named: BTreeSet<SharedString> = BTreeSet::new();
        for rule in &acl.rules {
            let grants = rule.grant & ENTER != 0;
            let denies = rule.deny & ENTER != 0;
            if let Some(account) = rule.user {
                if denies {
                    granted.retain(|known| *known != account);
                } else if grants && !granted.contains(&account) {
                    granted.push(account);
                }
            } else if let Some(group) = rule.group.as_ref().filter(|_| grants) {
                match group.as_ref() {
                    "all" => access.everybody = true,
                    "auth" => access.registered = true,
                    _ => {
                        let _ = named.insert(group.clone());
                    }
                }
            }
        }
        access.granted = granted;
        for name in named {
            let members = acl
                .groups
                .iter()
                .find(|group| group.name == name)
                .map(crate::engine::AclGroup::members)
                .unwrap_or_default();
            let _ = access.groups.insert(name, members);
        }
        access
    }

    /// Whether nobody in particular is let in: what there is comes from
    /// the parent's rules.
    pub(super) fn nobody(&self) -> bool {
        !self.everybody && !self.registered && self.granted.is_empty() && self.groups.is_empty()
    }
}

/// How the tree of channels is narrowed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(in crate::ui) struct Filters {
    pub friend_chats: bool,
    pub empty: bool,
    pub private_only: bool,
    pub top_level: bool,
    pub own_rules_only: bool,
}

/// One channel of the tree as the page lists it, at its depth.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Line {
    pub id: ChannelId,
    pub name: SharedString,
    pub depth: usize,
    pub private: bool,
    /// Whether it has channels under it, and they are shown.
    pub branches: bool,
    pub open: bool,
}

/// What the tree is drawn from: the channels, who is where, what is
/// chosen and open, and what narrows it.
pub(super) struct Tree<'a> {
    pub channels: &'a [Channel],
    pub users: &'a [User],
    pub selected: Option<ChannelId>,
    pub expanded: &'a BTreeSet<ChannelId>,
    pub filters: Filters,
    /// The channels known to have rules of their own.
    pub own_rules: &'a BTreeMap<ChannelId, bool>,
    pub search: &'a str,
}

impl Tree<'_> {
    /// Whether a channel is a friend chat or a notepad: a private room
    /// named as one.
    fn friend_chat(channel: &Channel) -> bool {
        channel.private && channel.name.starts_with("__dm:")
    }

    /// Whether `channel` passes the filters that judge it alone.
    fn passes(&self, channel: &Channel) -> bool {
        let filters = self.filters;
        !(filters.friend_chats && Self::friend_chat(channel))
            && !(filters.private_only && !channel.private && channel.parent.is_some())
            && !(filters.own_rules_only
                && channel.parent.is_some()
                && self.own_rules.get(&channel.id) != Some(&true))
    }

    /// The channels under `parent`, in their order.
    fn children(&self, parent: ChannelId) -> Vec<&Channel> {
        let mut under: Vec<&Channel> = self
            .channels
            .iter()
            .filter(|channel| channel.parent == Some(parent) && self.passes(channel))
            .collect();
        under.sort_by(|one, other| {
            one.position
                .cmp(&other.position)
                .then_with(|| one.name.to_lowercase().cmp(&other.name.to_lowercase()))
        });
        under
    }

    /// Whether anybody is in `channel` or anywhere under it.
    fn peopled(&self, channel: ChannelId) -> bool {
        self.users.iter().any(|user| user.channel == channel)
            || self.children(channel).iter().any(|child| self.peopled(child.id))
    }

    /// Whether `channel` or one under it is called what is searched for.
    fn found(&self, channel: &Channel, wanted: &str) -> bool {
        channel.name.to_lowercase().contains(wanted)
            || self.children(channel.id).iter().any(|child| self.found(child, wanted))
    }

    /// The lines of the tree, top to bottom: open branches show what is
    /// under them; a search shows every branch with a match in it.
    pub(super) fn lines(&self) -> Vec<Line> {
        let wanted = self.search.trim().to_lowercase();
        let mut lines = Vec::new();
        let roots: Vec<&Channel> = self.channels.iter().filter(|channel| channel.parent.is_none()).collect();
        for root in roots {
            self.walk(root, 0, &wanted, &mut lines);
        }
        lines
    }

    fn walk(&self, channel: &Channel, depth: usize, wanted: &str, lines: &mut Vec<Line>) {
        if !wanted.is_empty() && !self.found(channel, wanted) {
            return;
        }
        let shown = !self.filters.empty
            || depth == 0
            || Some(channel.id) == self.selected
            || self.peopled(channel.id);
        if !shown {
            return;
        }
        // Top-level only: the root and what is directly under it.
        let children = if self.filters.top_level && depth >= 1 {
            Vec::new()
        } else {
            self.children(channel.id)
        };
        let open = !wanted.is_empty() || self.expanded.contains(&channel.id);
        lines.push(Line {
            id: channel.id,
            name: channel.name.clone(),
            depth,
            private: channel.private,
            branches: !children.is_empty(),
            open,
        });
        if open {
            for child in children {
                self.walk(child, depth + 1, wanted, lines);
            }
        }
    }
}

/// The channels from the root down to `channel`: what to open for it to
/// be seen.
pub(super) fn ancestry(channels: &[Channel], channel: ChannelId) -> Vec<ChannelId> {
    let mut line = Vec::new();
    let mut at = Some(channel);
    // A guard against a parent loop in a server's data.
    for _ in 0..256 {
        let Some(id) = at else { break };
        line.push(id);
        at = channels.iter().find(|known| known.id == id).and_then(|known| known.parent);
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{AclGroup, AclRule};

    fn rule(user: Option<u32>, group: Option<&str>, grant: u32, deny: u32) -> AclRule {
        AclRule {
            here: true,
            subs: true,
            inherited: false,
            user,
            group: group.map(|group| group.to_owned().into()),
            grant,
            deny,
        }
    }

    #[test]
    fn who_is_let_in_is_read_rule_by_rule() {
        let mut keepers = AclGroup::new("keepers");
        keepers.added = vec![7, 8];
        keepers.removed = vec![8];
        let acl = Acl {
            channel: 3,
            inherit: true,
            groups: vec![keepers],
            rules: vec![
                rule(Some(5), None, ENTER, 0),
                rule(Some(6), None, ENTER, 0),
                rule(Some(6), None, 0, ENTER),
                rule(None, Some("auth"), ENTER, 0),
                rule(None, Some("keepers"), ENTER, 0),
            ],
        };
        let access = Access::of(&acl);
        assert_eq!(access.granted, [5], "a later deny takes a grant back");
        assert!(access.registered && !access.everybody);
        assert_eq!(access.groups.get("keepers").cloned(), Some(vec![7]));
        assert!(!access.nobody());
    }

    #[test]
    fn rules_of_its_own_are_told_from_the_parents() {
        let mut acl = Acl {
            channel: 3,
            inherit: true,
            groups: Vec::new(),
            rules: vec![AclRule {
                inherited: true,
                ..rule(None, Some("all"), ENTER, 0)
            }],
        };
        assert!(!has_own_rules(&acl));
        acl.inherit = false;
        assert!(has_own_rules(&acl));
    }
}
