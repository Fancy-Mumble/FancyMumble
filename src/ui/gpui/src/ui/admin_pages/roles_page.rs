//! The Roles page's state: the root channel's rules, which hold the
//! server's roles as groups, edited in place and saved as one; the role
//! being edited and its tab. The web UI's `RolesAdmin`.
//!
//! A role is a group of the root channel: its members are the group's,
//! what it grants is the one rule of the root that names it, and how it is
//! drawn is what a Fancy server keeps with the group.

use gpui::{AppContext as _, Context, Entity, SharedString, Subscription, Window};

use super::super::Shell;
use super::super::text_input::{InputEvent, TextInput};
use super::ROOT;
use crate::engine::{Acl, AclGroup, AclRule, Action, Listing, Registered};
use crate::words::t;

/// The editor's tabs, in the web UI's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(in crate::ui) enum Tab {
    #[default]
    Display,
    Permissions,
    Members,
}

impl Tab {
    pub(super) const ALL: [Self; 3] = [Self::Display, Self::Permissions, Self::Members];

    pub(super) fn name(self) -> SharedString {
        match self {
            Self::Display => t!("Display"),
            Self::Permissions => t!("Permissions"),
            Self::Members => t!("Members"),
        }
    }
}

/// The styles a role can be drawn in, by what a server calls them; the
/// first is none.
pub(super) const STYLES: [Option<&str>; 4] =
    [None, Some("neon"), Some("gradient"), Some("minimal")];

/// What each style is called where it is chosen.
pub(super) fn style_names() -> Vec<SharedString> {
    vec![
        t!("Default"),
        t!("Neon outline"),
        t!("Gradient banner"),
        t!("Minimal"),
    ]
}

/// The fields of the role being edited.
pub(in crate::ui) struct Form {
    pub name: Entity<TextInput>,
    /// Its colour as CSS writes it.
    pub colour: Entity<TextInput>,
    /// Its icon, as the picture drawn; `None` where it has none.
    pub icon: Option<std::sync::Arc<gpui::Image>>,
    /// The value of each of its metadata's keys, by key.
    pub values: Vec<(SharedString, Entity<TextInput>)>,
    pub new_key: Entity<TextInput>,
    pub new_value: Entity<TextInput>,
    /// Who to add to its members, and to those kept out of it.
    pub add_member: Entity<TextInput>,
    pub add_excluded: Entity<TextInput>,
    _watch: Vec<Subscription>,
}

/// Which list of accounts a field adds to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::ui) enum Among {
    Members,
    Excluded,
}

/// The page's state.
pub(in crate::ui) struct RolesPage {
    /// The root's rules, with the changes not saved yet.
    pub acl: Option<Acl>,
    pub dirty: bool,
    /// Whether a save went out and the rules have not come back yet.
    pub saving: bool,
    pub search: Entity<TextInput>,
    _watch: Subscription,
    /// The role being edited, by name; `None` for the list.
    pub editing: Option<SharedString>,
    pub tab: Tab,
    pub form: Option<Form>,
    /// The registered accounts, to name members by and to add from.
    pub accounts: Vec<Registered>,
}

impl RolesPage {
    /// Back from the editor to the list: what Escape does there. Says
    /// whether it was in the editor.
    pub(super) fn dismiss(&mut self) -> bool {
        self.form = None;
        self.editing.take().is_some()
    }

    /// The roles the list shows: every group of the root but the server's
    /// own, narrowed to those whose name holds `wanted`.
    pub(in crate::ui) fn listed(&self, wanted: &str) -> Vec<&AclGroup> {
        let wanted = wanted.trim().to_lowercase();
        self.acl
            .iter()
            .flat_map(|acl| &acl.groups)
            .filter(|group| !group.name.starts_with('~'))
            .filter(|group| wanted.is_empty() || group.name.to_lowercase().contains(&wanted))
            .collect()
    }

    /// The role being edited.
    pub(in crate::ui) fn role(&self) -> Option<&AclGroup> {
        let name = self.editing.as_ref()?;
        self.acl.as_ref()?.groups.iter().find(|group| group.name == *name)
    }

    fn role_mut(&mut self) -> Option<&mut AclGroup> {
        let name = self.editing.clone()?;
        let group = self.acl.as_mut()?.groups.iter_mut().find(|group| group.name == name)?;
        // A role a parent channel defines is read here, never changed.
        (!group.from_parent).then_some(group)
    }

    /// Change the role being edited, and note there is something to save.
    fn change(&mut self, change: impl FnOnce(&mut AclGroup)) {
        if let Some(role) = self.role_mut() {
            change(role);
            self.dirty = true;
        }
    }

    /// The one rule of the root that grants what the role grants: for its
    /// group, here, set here. `None` where it has none yet.
    pub(in crate::ui) fn rule(&self) -> Option<&AclRule> {
        let name = self.editing.as_ref()?;
        self.acl.as_ref()?.rules.iter().find(|rule| is_roles(rule, name))
    }

    /// The rules a parent gave the role: shown, not changed.
    pub(super) fn inherited_rules(&self) -> Vec<&AclRule> {
        let Some(name) = self.editing.as_ref() else {
            return Vec::new();
        };
        self.acl
            .iter()
            .flat_map(|acl| &acl.rules)
            .filter(|rule| rule.group.as_ref() == Some(name) && rule.inherited)
            .collect()
    }

    /// The name of the account `id`, or a stand-in where it is not one of
    /// the registered.
    pub(super) fn named(&self, id: u32) -> SharedString {
        self.accounts
            .iter()
            .find(|account| account.id == id)
            .map_or_else(|| t!("User #{{id}}", id = id), |account| account.name.clone())
    }

    /// The account `typed` names, not one of `chosen`: the first whose
    /// name holds it or whose number it is, else the number typed.
    pub(super) fn account_for(&self, typed: &str, chosen: &[u32]) -> Option<u32> {
        let typed = typed.trim();
        let lower = typed.to_lowercase();
        let matched = self.accounts.iter().find(|account| {
            !chosen.contains(&account.id)
                && !lower.is_empty()
                && (account.name.to_lowercase().contains(&lower) || account.id.to_string() == typed)
        });
        matched.map(|account| account.id).or_else(|| typed.parse().ok())
    }
}

/// Whether `rule` is the one that grants what the role `name` grants.
fn is_roles(rule: &AclRule, name: &str) -> bool {
    rule.group.as_ref().is_some_and(|group| group.as_ref() == name)
        && rule.user.is_none()
        && rule.here
        && !rule.inherited
}

/// `rule` granting `bit`, or neither granting nor denying it: turning a
/// permission off clears both, as a deny would also override what the
/// members are granted elsewhere.
pub(super) fn switched(mut rule: AclRule, bit: u32, on: bool) -> AclRule {
    if on {
        rule.grant |= bit;
    } else {
        rule.grant &= !bit;
    }
    rule.deny &= !bit;
    rule
}

/// A name for a new role, not one the root has yet: `Role`, `Role 2`, ...
pub(super) fn new_name(acl: &Acl) -> SharedString {
    let base = t!("Role");
    let taken = |name: &str| acl.groups.iter().any(|group| group.name.as_ref() == name);
    if !taken(&base) {
        return base;
    }
    (2..)
        .map(|n| SharedString::from(format!("{base} {n}")))
        .find(|name| !taken(name))
        .unwrap_or(base)
}

impl Shell {
    pub(super) fn roles_page_mut(&mut self) -> Option<&mut RolesPage> {
        self.panels.admin_page.as_mut()?.roles.as_mut()
    }

    pub(in crate::ui) fn roles_page(&self) -> Option<&RolesPage> {
        self.panels.admin_page.as_ref()?.roles.as_ref()
    }

    /// Make the page, on `role` if one is named, and ask for the root's
    /// rules and the accounts.
    pub(super) fn open_roles(&mut self, role: Option<SharedString>, cx: &mut Context<Self>) {
        let search = cx.new(|cx| TextInput::new(t!("Search roles..."), cx));
        let watch = cx.subscribe(&search, |_, _, _: &InputEvent, cx| cx.notify());
        if let Some(open) = self.panels.admin_page.as_mut() {
            open.roles = Some(RolesPage {
                acl: None,
                dirty: false,
                saving: false,
                search,
                _watch: watch,
                editing: role,
                tab: Tab::Display,
                form: None,
                accounts: Vec::new(),
            });
        }
        self.engine.request_acl(ROOT);
        self.engine.list(Listing::Registered);
    }

    /// The root's rules arrived: what the server holds, unless changes are
    /// waiting to be saved.
    pub(super) fn roles_take_acl(&mut self, acl: &Acl, cx: &mut Context<Self>) {
        let Some(page) = self.roles_page_mut() else {
            return;
        };
        if page.dirty && !page.saving {
            return;
        }
        page.acl = Some(acl.clone());
        page.dirty = false;
        page.saving = false;
        if page.editing.is_some() {
            self.make_role_form(cx);
        }
    }

    /// Open the editor on the role `name`, on its first tab.
    pub(super) fn edit_role(&mut self, name: SharedString, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(page) = self.roles_page_mut() {
            page.editing = Some(name);
            page.tab = Tab::Display;
        }
        self.make_role_form(cx);
        if let Some(form) = self.roles_page().and_then(|page| page.form.as_ref()) {
            form.name.read(cx).focus(window);
        }
        cx.notify();
    }

    /// Back to the list; changes not saved stay to be saved.
    pub(super) fn leave_role(&mut self, cx: &mut Context<Self>) {
        if let Some(page) = self.roles_page_mut() {
            page.editing = None;
            page.form = None;
        }
        cx.notify();
    }

    pub(super) fn role_tab(&mut self, tab: Tab, cx: &mut Context<Self>) {
        if let Some(page) = self.roles_page_mut() {
            page.tab = tab;
        }
        cx.notify();
    }

    /// A new role with nobody in it, opened in the editor.
    pub(super) fn create_role(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(acl) = self.roles_page_mut().and_then(|page| page.acl.as_mut()) else {
            return;
        };
        let name = new_name(acl);
        acl.groups.push(AclGroup::new(name.clone()));
        if let Some(page) = self.roles_page_mut() {
            page.dirty = true;
        }
        self.edit_role(name, window, cx);
    }

    /// Delete the role being edited, and the rule that granted what it
    /// granted, and save at once.
    pub(super) fn delete_role(&mut self, cx: &mut Context<Self>) {
        let Some(page) = self.roles_page_mut() else {
            return;
        };
        let (Some(name), Some(acl)) = (page.editing.clone(), page.acl.as_mut()) else {
            return;
        };
        acl.groups.retain(|group| group.name != name || group.from_parent);
        acl.rules.retain(|rule| !is_roles(rule, &name));
        page.dirty = true;
        page.editing = None;
        page.form = None;
        self.save_roles_page(cx);
    }

    /// Send the root's rules as they are now, and read them back.
    pub(super) fn save_roles_page(&mut self, cx: &mut Context<Self>) {
        let Some(page) = self.roles_page_mut() else {
            return;
        };
        let Some(acl) = page.acl.clone().filter(|_| page.dirty) else {
            return;
        };
        page.saving = true;
        self.engine.act(Action::SetAcl(acl));
        self.engine.request_acl(ROOT);
        cx.notify();
    }

    /// Give the role a colour, or take it away; the colour's field says it.
    pub(super) fn colour_role(&mut self, colour: Option<SharedString>, cx: &mut Context<Self>) {
        let written = colour.clone().unwrap_or_default();
        if let Some(page) = self.roles_page_mut() {
            page.change(|role| role.look.color = colour);
            if let Some(form) = page.form.as_ref() {
                form.colour.update(cx, |input, _| input.set_text(written.to_string()));
            }
        }
        cx.notify();
    }

    /// The most a role's icon may weigh: what the server takes in a
    /// picture, kept between 16 KiB, so a server that says too little
    /// still takes one, and 1 MiB, so its rules stay small.
    pub(super) fn icon_budget(&self) -> usize {
        self.engine.picture_limit().clamp(16 * 1024, 1024 * 1024)
    }

    /// Let the user choose a picture file for the role's icon: the middle
    /// of it, square, small.
    pub(super) fn pick_role_icon(&mut self, cx: &mut Context<Self>) {
        self.pick_picture(cx, crate::picture::role_icon, |shell, icon, cx| {
            shell.icon_role(Some(icon), cx);
        });
    }

    /// Give the role an icon, or take it away. One heavier than the server
    /// takes is said, and not given.
    pub(in crate::ui) fn icon_role(&mut self, icon: Option<Vec<u8>>, cx: &mut Context<Self>) {
        let budget = self.icon_budget();
        if icon.as_ref().is_some_and(|icon| icon.len() > budget) {
            self.notice = Some(t!("Could not process the cropped image."));
            cx.notify();
            return;
        }
        let drawn = icon
            .clone()
            .and_then(crate::picture::picture)
            .map(std::sync::Arc::new);
        if let Some(page) = self.roles_page_mut() {
            page.change(|role| role.look.icon = icon.map(Into::into));
            if let Some(form) = page.form.as_mut() {
                form.icon = drawn;
            }
        }
        cx.notify();
    }

    /// The colour typed in its field, once it is one.
    fn colour_typed(&mut self, typed: &str, cx: &mut Context<Self>) {
        let typed = typed.trim();
        if crate::theme::parse_color(typed).is_none() {
            return;
        }
        let colour = SharedString::from(typed.to_owned());
        if let Some(page) = self.roles_page_mut() {
            page.change(|role| role.look.color = Some(colour));
        }
        cx.notify();
    }

    /// Draw the role in the style at `at` of [`STYLES`].
    pub(super) fn style_role(&mut self, at: usize, cx: &mut Context<Self>) {
        let style = STYLES.get(at).copied().flatten().map(SharedString::new_static);
        if let Some(page) = self.roles_page_mut() {
            page.change(|role| role.look.style = style);
        }
        cx.notify();
    }

    /// Grant the role `bit`, or stop granting it, on its own rule: made
    /// the first time a permission is switched.
    pub(super) fn grant_role(&mut self, bit: u32, on: bool, cx: &mut Context<Self>) {
        let Some(page) = self.roles_page_mut() else {
            return;
        };
        let Some(name) = page.role().filter(|role| !role.from_parent).map(|role| role.name.clone())
        else {
            return;
        };
        let Some(acl) = page.acl.as_mut() else {
            return;
        };
        let at = acl.rules.iter().position(|rule| is_roles(rule, &name));
        let at = at.unwrap_or_else(|| {
            acl.rules.push(AclRule {
                here: true,
                subs: true,
                inherited: false,
                user: None,
                group: Some(name.clone()),
                grant: 0,
                deny: 0,
            });
            acl.rules.len() - 1
        });
        acl.rules[at] = switched(acl.rules[at].clone(), bit, on);
        page.dirty = true;
        cx.notify();
    }

    /// Whether the role takes its parent's members, or whether channels
    /// under the root have it.
    pub(super) fn role_inherits(&mut self, parents: bool, on: bool, cx: &mut Context<Self>) {
        if let Some(page) = self.roles_page_mut() {
            page.change(|role| {
                if parents {
                    role.inherit = on;
                } else {
                    role.inheritable = on;
                }
            });
        }
        cx.notify();
    }

    /// Add the account typed in the field for `among`, if it names one.
    pub(super) fn add_to_role(&mut self, among: Among, cx: &mut Context<Self>) {
        let Some(page) = self.roles_page_mut() else {
            return;
        };
        let Some(form) = page.form.as_ref() else {
            return;
        };
        let field = match among {
            Among::Members => form.add_member.clone(),
            Among::Excluded => form.add_excluded.clone(),
        };
        let typed = field.read(cx).text().to_owned();
        let chosen = page.role().map(|role| match among {
            Among::Members => role.added.clone(),
            Among::Excluded => role.removed.clone(),
        });
        let Some(id) = page.account_for(&typed, &chosen.unwrap_or_default()) else {
            return;
        };
        self.pick_for_role(among, id, cx);
    }

    /// Add `id` to the role's members, or to those kept out of it.
    pub(super) fn pick_for_role(&mut self, among: Among, id: u32, cx: &mut Context<Self>) {
        let Some(page) = self.roles_page_mut() else {
            return;
        };
        let field = page.form.as_ref().map(|form| match among {
            Among::Members => form.add_member.clone(),
            Among::Excluded => form.add_excluded.clone(),
        });
        page.change(|role| {
            let list = match among {
                Among::Members => &mut role.added,
                Among::Excluded => &mut role.removed,
            };
            if !list.contains(&id) {
                list.push(id);
            }
        });
        if let Some(field) = field {
            field.update(cx, |input, _| input.clear());
        }
        cx.notify();
    }

    /// Take `id` out of the role's members, or out of those kept out.
    pub(super) fn take_from_role(&mut self, among: Among, id: u32, cx: &mut Context<Self>) {
        if let Some(page) = self.roles_page_mut() {
            page.change(|role| match among {
                Among::Members => role.added.retain(|added| *added != id),
                Among::Excluded => role.removed.retain(|removed| *removed != id),
            });
        }
        cx.notify();
    }

    /// Set the metadata `key` of the role to `value`, or take it away.
    pub(super) fn role_metadata(
        &mut self,
        key: SharedString,
        value: Option<SharedString>,
        cx: &mut Context<Self>,
    ) {
        let rebuild = value.is_none();
        if let Some(page) = self.roles_page_mut() {
            page.change(|role| {
                match value {
                    Some(value) => {
                        let _ = role.look.metadata.insert(key, value);
                    }
                    None => {
                        let _ = role.look.metadata.remove(&key);
                    }
                }
            });
        }
        if rebuild {
            self.make_role_form(cx);
        }
        cx.notify();
    }

    /// Add the key and value typed in the last row of the metadata.
    pub(super) fn add_role_metadata(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(form) = self.roles_page().and_then(|page| page.form.as_ref()) else {
            return;
        };
        let key = form.new_key.read(cx).text().trim().to_owned();
        if key.is_empty() {
            return;
        }
        let value = form.new_value.read(cx).text().to_owned();
        self.role_metadata(key.into(), Some(value.into()), cx);
        self.make_role_form(cx);
        if let Some(form) = self.roles_page().and_then(|page| page.form.as_ref()) {
            form.new_key.read(cx).focus(window);
        }
    }

    /// Make the fields of the role being edited, filled from it.
    fn make_role_form(&mut self, cx: &mut Context<Self>) {
        let Some(role) = self.roles_page().and_then(RolesPage::role).cloned() else {
            if let Some(page) = self.roles_page_mut() {
                page.form = None;
            }
            return;
        };
        let mut watch = Vec::new();
        let field = |placeholder: SharedString, text: &str, cx: &mut Context<Self>| {
            let text = text.to_owned();
            cx.new(|cx| {
                let mut input = TextInput::new(placeholder, cx);
                input.set_text(text);
                input
            })
        };
        let name = field(SharedString::default(), &role.name, cx);
        watch.push(cx.subscribe(&name, |shell, field, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Changed) {
                let typed = field.read(cx).text().to_owned();
                shell.rename_role(typed.into(), cx);
            }
        }));
        let values: Vec<_> = role
            .look
            .metadata
            .iter()
            .map(|(key, value)| {
                let input = field(SharedString::default(), value, cx);
                let key = key.clone();
                let changed = key.clone();
                watch.push(cx.subscribe(&input, move |shell, field, event: &InputEvent, cx| {
                    if matches!(event, InputEvent::Changed) {
                        let value = field.read(cx).text().to_owned();
                        shell.role_metadata(changed.clone(), Some(value.into()), cx);
                    }
                }));
                (key, input)
            })
            .collect();
        let written = role.look.color.clone().unwrap_or_default();
        let colour = field(SharedString::new_static("#rrggbb"), &written, cx);
        watch.push(cx.subscribe(&colour, |shell, field, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Changed) {
                let typed = field.read(cx).text().to_owned();
                shell.colour_typed(&typed, cx);
            }
        }));
        let new_key = field(t!("key"), "", cx);
        let new_value = field(t!("value"), "", cx);
        let add_member = field(t!("Add user by name or ID"), "", cx);
        let add_excluded = field(t!("Add user by name or ID"), "", cx);
        for (input, among) in [(&add_member, Among::Members), (&add_excluded, Among::Excluded)] {
            watch.push(cx.subscribe(input, move |shell, _, event: &InputEvent, cx| match event {
                InputEvent::Submitted(_) => shell.add_to_role(among, cx),
                // The suggestions follow what is typed.
                InputEvent::Changed => cx.notify(),
                _ => {}
            }));
        }
        if let Some(page) = self.roles_page_mut() {
            page.form = Some(Form {
                name,
                colour,
                icon: role
                    .look
                    .icon
                    .as_ref()
                    .and_then(|bytes| crate::picture::picture(bytes.to_vec()))
                    .map(std::sync::Arc::new),
                values,
                new_key,
                new_value,
                add_member,
                add_excluded,
                _watch: watch,
            });
        }
    }

    /// Call the role being edited `name`, and the rules that name it too.
    /// An empty name, or one another group has, is not taken.
    fn rename_role(&mut self, name: SharedString, cx: &mut Context<Self>) {
        let Some(page) = self.roles_page_mut() else {
            return;
        };
        let (Some(old), Some(acl)) = (page.editing.clone(), page.acl.as_ref()) else {
            return;
        };
        let taken = acl.groups.iter().any(|group| group.name == name);
        if name.trim().is_empty() || taken || page.role_mut().is_none() {
            return;
        }
        if let Some(acl) = page.acl.as_mut() {
            for group in acl.groups.iter_mut().filter(|group| group.name == old) {
                group.name = name.clone();
            }
            for rule in acl.rules.iter_mut().filter(|rule| rule.group.as_ref() == Some(&old) && !rule.inherited) {
                rule.group = Some(name.clone());
            }
        }
        page.editing = Some(name);
        page.dirty = true;
        cx.notify();
    }

    /// The server sent its accounts: the names members are shown by.
    pub(super) fn roles_take_accounts(&mut self, accounts: &[Registered]) {
        if let Some(page) = self.roles_page_mut() {
            page.accounts = accounts.to_vec();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(group: &str, grant: u32, deny: u32) -> AclRule {
        AclRule {
            here: true,
            subs: true,
            inherited: false,
            user: None,
            group: Some(group.to_owned().into()),
            grant,
            deny,
        }
    }

    #[test]
    fn a_permission_switched_off_is_neither_granted_nor_denied() {
        let on = switched(rule("wardens", 0, 0x4), 0x4, true);
        assert_eq!((on.grant, on.deny), (0x4, 0));
        let off = switched(rule("wardens", 0x6, 0x4), 0x4, false);
        assert_eq!((off.grant, off.deny), (0x2, 0));
    }

    #[test]
    fn a_new_role_is_named_apart_from_those_there_are() {
        let mut acl = Acl {
            channel: 0,
            inherit: true,
            groups: Vec::new(),
            rules: Vec::new(),
        };
        assert_eq!(new_name(&acl).as_ref(), "Role");
        acl.groups.push(AclGroup::new("Role"));
        acl.groups.push(AclGroup::new("Role 2"));
        assert_eq!(new_name(&acl).as_ref(), "Role 3");
    }

    #[test]
    fn only_the_roles_own_rule_grants_for_it() {
        assert!(is_roles(&rule("wardens", 1, 0), "wardens"));
        let inherited = AclRule {
            inherited: true,
            ..rule("wardens", 1, 0)
        };
        assert!(!is_roles(&inherited, "wardens"));
        assert!(!is_roles(&rule("elders", 1, 0), "wardens"));
    }
}
