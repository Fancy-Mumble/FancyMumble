//! The Channels / ACL page's state: the tree of channels and what narrows
//! it, the channel chosen and its rules as they are being changed, and the
//! fields they are changed in. The web UI's `AclAdmin`.

use std::collections::{BTreeMap, BTreeSet};

use gpui::{AppContext as _, Context, Entity, SharedString, Subscription};

use super::super::Shell;
use super::super::text_input::{InputEvent, TextInput};
use super::acl_model::{Filters, ancestry, has_own_rules};
use crate::engine::{Acl, AclGroup, AclRule, Action, ChannelId, Listing, Registered};
use crate::words::t;

/// The tabs over a channel's rules, in the web UI's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(in crate::ui) enum AclTab {
    #[default]
    Rules,
    Groups,
    Users,
}

impl AclTab {
    pub(super) const ALL: [Self; 3] = [Self::Rules, Self::Groups, Self::Users];
}

/// The fields of the rule open: the group it is for, or the account.
pub(in crate::ui) struct RuleFields {
    pub at: usize,
    pub group: Entity<TextInput>,
    pub account: Entity<TextInput>,
    _watch: Vec<Subscription>,
}

/// The fields of one group: its name, and who to add or keep out.
pub(in crate::ui) struct GroupFields {
    pub name: Entity<TextInput>,
    pub add: Entity<TextInput>,
    pub exclude: Entity<TextInput>,
}

/// Which list of a group a field adds to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::ui) enum Among {
    Added,
    Removed,
}

/// The page's state.
pub(in crate::ui) struct AclPage {
    pub search: Entity<TextInput>,
    pub filters: Filters,
    pub expanded: BTreeSet<ChannelId>,
    pub selected: Option<ChannelId>,
    /// The chosen channel's rules, with the changes not saved yet.
    pub acl: Option<Acl>,
    pub loading: bool,
    pub dirty: bool,
    pub tab: AclTab,
    pub rule: Option<RuleFields>,
    pub groups: Vec<GroupFields>,
    /// Which channels have rules of their own, as each was read.
    pub own_rules: BTreeMap<ChannelId, bool>,
    asked: BTreeSet<ChannelId>,
    /// The registered accounts, to name them by.
    pub accounts: Vec<Registered>,
    _watch: Vec<Subscription>,
}

impl AclPage {
    /// The rule at `at` of the chosen channel, if it is the channel's own.
    fn own_rule_mut(&mut self, at: usize) -> Option<&mut AclRule> {
        self.acl.as_mut()?.rules.get_mut(at).filter(|rule| !rule.inherited)
    }

    /// The group at `at`, if it is the channel's own.
    fn own_group_mut(&mut self, at: usize) -> Option<&mut AclGroup> {
        self.acl.as_mut()?.groups.get_mut(at).filter(|group| !group.from_parent)
    }

    /// What the name of the account `id` is, as far as is known.
    pub(super) fn named(&self, id: u32, online: &[crate::engine::User]) -> SharedString {
        online
            .iter()
            .find(|user| user.account == Some(id))
            .map(|user| user.name.clone())
            .or_else(|| self.accounts.iter().find(|account| account.id == id).map(|account| account.name.clone()))
            .unwrap_or_else(|| t!("User #{{id}}", id = id))
    }

    /// Put away the topmost thing open: the rule open in its card.
    pub(super) fn dismiss(&mut self) -> bool {
        self.rule.take().is_some()
    }
}

impl Shell {
    pub(super) fn acl_page_mut(&mut self) -> Option<&mut AclPage> {
        self.panels.admin_page.as_mut()?.acl.as_mut()
    }

    pub(in crate::ui) fn acl_page(&self) -> Option<&AclPage> {
        self.panels.admin_page.as_ref()?.acl.as_ref()
    }

    /// Make the page, on `channel` if one is named, its branch open.
    pub(super) fn open_acl_page(&mut self, channel: Option<ChannelId>, cx: &mut Context<Self>) {
        let search = cx.new(|cx| TextInput::new(t!("Search channels..."), cx));
        let watch = cx.subscribe(&search, |_, _, _: &InputEvent, cx| cx.notify());
        // The root open, as the web UI opens the tree.
        let mut expanded: BTreeSet<ChannelId> = self
            .snapshot
            .channels
            .iter()
            .filter(|channel| channel.parent.is_none())
            .map(|channel| channel.id)
            .collect();
        if let Some(channel) = channel {
            expanded.extend(ancestry(&self.snapshot.channels, channel));
        }
        if let Some(open) = self.panels.admin_page.as_mut() {
            open.acl = Some(AclPage {
                search,
                filters: Filters::default(),
                expanded,
                selected: None,
                acl: None,
                loading: false,
                dirty: false,
                tab: AclTab::Rules,
                rule: None,
                groups: Vec::new(),
                own_rules: BTreeMap::new(),
                asked: BTreeSet::new(),
                accounts: Vec::new(),
                _watch: vec![watch],
            });
        }
        self.engine.list(Listing::Registered);
        if let Some(channel) = channel {
            self.choose_acl_channel(channel, cx);
        }
    }

    /// Show the Channels / ACL page on `channel`, its branch open: what the
    /// channel's "Permissions" opens.
    pub(in crate::ui) fn open_acl(&mut self, channel: ChannelId, cx: &mut Context<Self>) {
        self.open_admin_page(super::AdminPage::Acl, cx);
        let line = ancestry(&self.snapshot.channels, channel);
        if let Some(page) = self.acl_page_mut() {
            page.expanded.extend(line);
        } else {
            return;
        }
        self.choose_acl_channel(channel, cx);
    }

    /// The menu of a channel of the tree, at `at`: deleting it, where it
    /// may be.
    pub(super) fn open_acl_channel_menu(
        &mut self,
        channel: ChannelId,
        at: gpui::Point<gpui::Pixels>,
        cx: &mut Context<Self>,
    ) {
        let deletable = self.snapshot.channels.iter().any(|known| {
            known.id == channel
                && known.parent.is_some()
                && known.rights.may(crate::rights::Right::WRITE)
        });
        if !deletable {
            return;
        }
        let items = vec![
            super::super::menu::Item::new(
                &t!("Delete channel"),
                super::super::menu::Command::Ask(super::super::menu::Question::DeleteChannel(channel)),
            )
            .selector("menu-acl-delete")
            .danger(),
        ];
        self.open_menu(at, items, cx);
    }

    /// Choose `channel`, and ask for its rules.
    pub(super) fn choose_acl_channel(&mut self, channel: ChannelId, cx: &mut Context<Self>) {
        let Some(page) = self.acl_page_mut() else {
            return;
        };
        page.selected = Some(channel);
        page.acl = None;
        page.loading = true;
        page.dirty = false;
        page.rule = None;
        page.groups = Vec::new();
        self.engine.request_acl(channel);
        cx.notify();
    }

    /// Open a branch of the tree, or close it.
    pub(super) fn toggle_acl_branch(&mut self, channel: ChannelId, cx: &mut Context<Self>) {
        if let Some(page) = self.acl_page_mut()
            && !page.expanded.remove(&channel)
        {
            let _ = page.expanded.insert(channel);
        }
        cx.notify();
    }

    /// Change what narrows the tree; for channels with rules of their own,
    /// every channel's rules are asked for, once each.
    pub(super) fn set_acl_filters(&mut self, change: impl FnOnce(&mut Filters), cx: &mut Context<Self>) {
        let channels: Vec<ChannelId> = self.snapshot.channels.iter().map(|channel| channel.id).collect();
        let Some(page) = self.acl_page_mut() else {
            return;
        };
        change(&mut page.filters);
        let ask: Vec<ChannelId> = if page.filters.own_rules_only {
            channels.into_iter().filter(|id| page.asked.insert(*id)).collect()
        } else {
            Vec::new()
        };
        for channel in ask {
            self.engine.request_acl(channel);
        }
        cx.notify();
    }

    /// A channel's rules arrived: what they say of rules of its own, and,
    /// for the channel chosen, the rules themselves, unless changes wait.
    pub(super) fn acl_page_take(&mut self, acl: &Acl, cx: &mut Context<Self>) {
        let Some(page) = self.acl_page_mut() else {
            return;
        };
        let _ = page.own_rules.insert(acl.channel, has_own_rules(acl));
        if page.selected != Some(acl.channel) || (page.dirty && page.acl.is_some()) {
            return;
        }
        page.acl = Some(acl.clone());
        page.loading = false;
        page.dirty = false;
        page.rule = None;
        self.make_group_fields(cx);
        cx.notify();
    }

    /// The server sent its accounts: the names rules and groups show.
    pub(super) fn acl_page_take_accounts(&mut self, accounts: &[Registered]) {
        if let Some(page) = self.acl_page_mut() {
            page.accounts = accounts.to_vec();
        }
    }

    /// Change the chosen channel's rules, and note there is something to
    /// save.
    fn change_acl(&mut self, change: impl FnOnce(&mut AclPage) -> bool, cx: &mut Context<Self>) {
        if let Some(page) = self.acl_page_mut()
            && page.acl.is_some()
            && change(page)
        {
            page.dirty = true;
        }
        cx.notify();
    }

    pub(super) fn acl_tab(&mut self, tab: AclTab, cx: &mut Context<Self>) {
        if let Some(page) = self.acl_page_mut() {
            page.tab = tab;
        }
        cx.notify();
    }

    /// Whether the channel takes its parent's rules.
    pub(super) fn acl_inherit(&mut self, cx: &mut Context<Self>) {
        self.change_acl(
            |page| {
                page.acl.as_mut().is_some_and(|acl| {
                    acl.inherit = !acl.inherit;
                    true
                })
            },
            cx,
        );
    }

    /// Send the chosen channel's rules as they are now, and read them back.
    pub(super) fn save_acl_page(&mut self, cx: &mut Context<Self>) {
        let Some(page) = self.acl_page_mut() else {
            return;
        };
        let Some(acl) = page.acl.clone().filter(|_| page.dirty) else {
            return;
        };
        page.dirty = false;
        let channel = acl.channel;
        self.engine.act(Action::SetAcl(acl));
        self.engine.request_acl(channel);
        cx.notify();
    }

    /// A new rule for everybody, granting and denying nothing yet.
    pub(super) fn add_acl_page_rule(&mut self, cx: &mut Context<Self>) {
        self.change_acl(
            |page| {
                page.acl.as_mut().is_some_and(|acl| {
                    acl.rules.push(AclRule {
                        here: true,
                        subs: true,
                        inherited: false,
                        user: None,
                        group: Some("all".into()),
                        grant: 0,
                        deny: 0,
                    });
                    true
                })
            },
            cx,
        );
    }

    /// Take the rule at `at` out.
    pub(super) fn remove_acl_page_rule(&mut self, at: usize, cx: &mut Context<Self>) {
        self.change_acl(
            |page| {
                let own = page.own_rule_mut(at).is_some();
                if own && let Some(acl) = page.acl.as_mut() {
                    drop(acl.rules.remove(at));
                    page.rule = None;
                }
                own
            },
            cx,
        );
    }

    /// Change the rule at `at`.
    pub(super) fn change_acl_rule(&mut self, at: usize, change: impl FnOnce(&mut AclRule), cx: &mut Context<Self>) {
        self.change_acl(
            |page| {
                page.own_rule_mut(at).map(change).is_some()
            },
            cx,
        );
    }

    /// Open the rule at `at` in its card, with its fields; or close it.
    pub(super) fn open_acl_rule(&mut self, at: usize, cx: &mut Context<Self>) {
        let Some(page) = self.acl_page() else {
            return;
        };
        if page.rule.as_ref().is_some_and(|open| open.at == at) {
            if let Some(page) = self.acl_page_mut() {
                page.rule = None;
            }
            cx.notify();
            return;
        }
        let Some(rule) = page.acl.as_ref().and_then(|acl| acl.rules.get(at)).cloned() else {
            return;
        };
        let field = |text: String, cx: &mut Context<Self>| {
            cx.new(|cx| {
                let mut input = TextInput::new(SharedString::default(), cx);
                input.set_text(text);
                input
            })
        };
        let group = field(rule.group.as_ref().map(ToString::to_string).unwrap_or_default(), cx);
        let account = field(rule.user.map(|user| user.to_string()).unwrap_or_default(), cx);
        // A rule is for a group or for one account, never both: filling one
        // clears the other.
        let watch = vec![
            cx.subscribe(&group, move |shell, field, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Changed) {
                    let typed = field.read(cx).text().trim().to_owned();
                    shell.change_acl_rule(at, |rule| {
                        rule.group = Some(typed).filter(|typed| !typed.is_empty()).map(Into::into);
                        rule.user = None;
                    }, cx);
                }
            }),
            cx.subscribe(&account, move |shell, field, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Changed) {
                    let typed = field.read(cx).text().trim().parse::<u32>().ok();
                    shell.change_acl_rule(at, |rule| {
                        rule.user = typed;
                        rule.group = None;
                    }, cx);
                }
            }),
        ];
        if let Some(page) = self.acl_page_mut() {
            page.rule = Some(RuleFields {
                at,
                group,
                account,
                _watch: watch,
            });
        }
        cx.notify();
    }

    /// A new group of the channel's own, with nobody in it.
    pub(super) fn add_acl_group(&mut self, cx: &mut Context<Self>) {
        self.change_acl(
            |page| {
                page.acl.as_mut().is_some_and(|acl| {
                    acl.groups.push(AclGroup::new("new_group"));
                    true
                })
            },
            cx,
        );
        self.make_group_fields(cx);
    }

    /// Take the group at `at` out.
    pub(super) fn remove_acl_group(&mut self, at: usize, cx: &mut Context<Self>) {
        self.change_acl(
            |page| {
                let own = page.own_group_mut(at).is_some();
                if own && let Some(acl) = page.acl.as_mut() {
                    drop(acl.groups.remove(at));
                }
                own
            },
            cx,
        );
        self.make_group_fields(cx);
    }

    /// Change the group at `at`.
    pub(super) fn change_acl_group(&mut self, at: usize, change: impl FnOnce(&mut AclGroup), cx: &mut Context<Self>) {
        self.change_acl(|page| page.own_group_mut(at).map(change).is_some(), cx);
    }

    /// Add the account typed in the group's field for `among`: a number,
    /// or the name of somebody here who is registered.
    pub(super) fn add_to_acl_group(&mut self, at: usize, among: Among, cx: &mut Context<Self>) {
        let Some(fields) = self.acl_page().and_then(|page| page.groups.get(at)) else {
            return;
        };
        let field = match among {
            Among::Added => fields.add.clone(),
            Among::Removed => fields.exclude.clone(),
        };
        let typed = field.read(cx).text().trim().to_owned();
        let named = self
            .snapshot
            .users
            .iter()
            .find(|user| user.name.eq_ignore_ascii_case(&typed))
            .and_then(|user| user.account);
        let Some(id) = typed.parse::<u32>().ok().or(named) else {
            return;
        };
        self.change_acl_group(
            at,
            |group| {
                let list = match among {
                    Among::Added => &mut group.added,
                    Among::Removed => &mut group.removed,
                };
                if !list.contains(&id) {
                    list.push(id);
                }
            },
            cx,
        );
        field.update(cx, |input, _| input.clear());
    }

    /// Enter in a group's field adds who it names.
    fn on_group_entry(&mut self, at: usize, among: Among, event: &InputEvent, cx: &mut Context<Self>) {
        if matches!(event, InputEvent::Submitted(_)) {
            self.add_to_acl_group(at, among, cx);
        }
    }

    /// Allow `bit` in the rule at `at`, or deny it; or stop.
    pub(super) fn flip_acl_bit(&mut self, at: usize, bit: u32, deny: bool, cx: &mut Context<Self>) {
        self.change_acl_rule(
            at,
            |rule| {
                if deny {
                    rule.deny ^= bit;
                } else {
                    rule.grant ^= bit;
                }
            },
            cx,
        );
    }

    /// Make the fields of the chosen channel's groups, filled from them.
    fn make_group_fields(&mut self, cx: &mut Context<Self>) {
        let Some(groups) = self.acl_page().and_then(|page| page.acl.as_ref()).map(|acl| acl.groups.clone()) else {
            return;
        };
        let mut watch = Vec::new();
        let fields = groups
            .iter()
            .enumerate()
            .map(|(at, group)| {
                let made = |placeholder: SharedString, text: &str, cx: &mut Context<Self>| {
                    let text = text.to_owned();
                    cx.new(|cx| {
                        let mut input = TextInput::new(placeholder, cx);
                        input.set_text(text);
                        input
                    })
                };
                let name = made(SharedString::default(), &group.name, cx);
                let add = made(t!("User ID or name"), "", cx);
                let exclude = made(t!("User ID or name"), "", cx);
                watch.push(cx.subscribe(&name, move |shell, field, event: &InputEvent, cx| {
                    if matches!(event, InputEvent::Changed) {
                        let typed = field.read(cx).text().to_owned();
                        shell.change_acl_group(at, |group| group.name = typed.into(), cx);
                    }
                }));
                for (input, among) in [(&add, Among::Added), (&exclude, Among::Removed)] {
                    watch.push(cx.subscribe(input, move |shell, _, event: &InputEvent, cx| {
                        shell.on_group_entry(at, among, event, cx);
                    }));
                }
                GroupFields { name, add, exclude }
            })
            .collect();
        if let Some(page) = self.acl_page_mut() {
            page.groups = fields;
            page._watch.truncate(1);
            page._watch.extend(watch);
        }
    }
}
