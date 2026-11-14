//! Who may do what in a channel: its rules, one at a time.
//!
//! A rule is for a group or for one account, and allows or denies each
//! permission, or says nothing of it. Rules apply in order, a later one
//! over an earlier one; those a channel has from its parent are shown and
//! cannot be changed here.

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, Window, div, prelude::*,
    px,
};

use super::Shell;
use super::acl_people::{chooser, members, named};
use super::kit::{Button, Dialog, Size, Tone};
use super::widgets::{EMPHASIS, icon};
use crate::engine::{Acl, AclGroup, AclRule, Action, ChannelId, Listing};
use crate::rights::Right;
use crate::theme::Theme;

/// The permissions a rule speaks of: Mumble's bit, what it is called here,
/// and whether it means something on the root channel only (those are
/// offered there alone). Every one the server has: a test holds this
/// against the table the engine and the web client are written from.
pub(super) const PERMISSIONS: &[(u32, &str, bool)] = &[
    (0x1, "Write the rules", false),
    (0x2, "Traverse", false),
    (0x4, "Enter", false),
    (0x100_0000, "See it while it is hidden", false),
    (0x8, "Speak", false),
    (0x100, "Whisper", false),
    (0x800, "Listen", false),
    (0x200, "Write messages", false),
    (0x200_0000, "Send voice messages", false),
    (0x1000, "Delete messages", false),
    (0x4000, "Share files", false),
    (0x8000, "Share files with anybody who has the link", false),
    (0x2000, "Be told of messages while away", false),
    (0x10, "Mute and deafen others", false),
    (0x20, "Move others", false),
    (0x40, "Make channels", false),
    (0x400, "Make temporary channels", false),
    (0x80, "Link channels", false),
    (0x1_0000, "Kick", true),
    (0x2_0000, "Ban", true),
    (0x4_0000, "Register others", true),
    (0x8_0000, "Register oneself", true),
    (0x80_0000, "List the registered accounts", true),
    (0x10_0000, "Reset comments and pictures", true),
    (0x20_0000, "Own the keys of encrypted channels", true),
    (0x40_0000, "Manage emotes", true),
];

/// The open panel.
pub(super) struct Panel {
    pub channel: ChannelId,
    /// The channel's name, for the title.
    title: SharedString,
    /// The rules as they stand here; `None` until the server has sent them.
    pub acl: Option<Acl>,
    /// The rule being edited, as its place among them.
    pub selected: Option<usize>,
    /// Whether anything was changed since it was read or saved.
    pub dirty: bool,
    /// Whether it is the root channel, where every permission means
    /// something.
    root: bool,
    /// What the server's accounts are called, where it gave their list:
    /// a member who is not connected has a name by it.
    pub names: std::collections::HashMap<u32, SharedString>,
    /// Whether who a new rule is for is being chosen.
    pub choosing: bool,
}

/// What a rule says of one permission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Says {
    Nothing,
    Allow,
    Deny,
}

/// What `rule` says of the permission `bit`.
pub(super) fn says(rule: &AclRule, bit: u32) -> Says {
    if rule.deny & bit != 0 {
        Says::Deny
    } else if rule.grant & bit != 0 {
        Says::Allow
    } else {
        Says::Nothing
    }
}

/// Have `rule` say the next thing of the permission `bit`: nothing, then
/// allow, then deny, then nothing again.
pub(super) fn cycle(rule: &mut AclRule, bit: u32) {
    let next = match says(rule, bit) {
        Says::Nothing => Says::Allow,
        Says::Allow => Says::Deny,
        Says::Deny => Says::Nothing,
    };
    rule.grant &= !bit;
    rule.deny &= !bit;
    match next {
        Says::Allow => rule.grant |= bit,
        Says::Deny => rule.deny |= bit,
        Says::Nothing => {}
    }
}

/// Who a rule is for, in words; `named` says what an account is called.
fn subject(rule: &AclRule, named: impl FnOnce(u32) -> SharedString) -> SharedString {
    match (&rule.group, rule.user) {
        (Some(group), _) => format!("@{group}").into(),
        (None, Some(user)) => named(user),
        (None, None) => "Nobody".into(),
    }
}

/// What a rule does, in a line: `+Enter +Speak -Write messages`.
fn summary(rule: &AclRule) -> SharedString {
    let mut said = String::new();
    for (bit, name, _) in PERMISSIONS {
        let sign = match says(rule, *bit) {
            Says::Allow => '+',
            Says::Deny => '-',
            Says::Nothing => continue,
        };
        if !said.is_empty() {
            said.push(' ');
        }
        said.push(sign);
        said.push_str(name);
    }
    if said.is_empty() {
        said.push_str("Says nothing yet");
    }
    said.into()
}

impl Shell {
    /// Open the panel on `channel`, asking the server for its rules.
    pub(super) fn open_acl(&mut self, channel: ChannelId, cx: &mut Context<Self>) {
        let known = self
            .snapshot
            .channels
            .iter()
            .find(|known| known.id == channel);
        self.panels.acl = Some(Panel {
            channel,
            title: known.map_or_else(SharedString::default, |known| known.name.clone()),
            acl: None,
            selected: None,
            dirty: false,
            root: known.is_some_and(|known| known.parent.is_none()),
            names: std::collections::HashMap::new(),
            choosing: false,
        });
        self.engine.request_acl(channel);
        // Asked for only where it would be given: a refusal is said aloud.
        if self.root_rights().has(Right::REGISTER) {
            self.engine.list(Listing::Registered);
        }
        cx.notify();
    }

    /// The server sent a channel's rules: show them, if they are the ones
    /// the panel is open on.
    pub(super) fn take_acl(&mut self, acl: Acl) {
        if let Some(panel) = self
            .panels
            .acl
            .as_mut()
            .filter(|panel| panel.channel == acl.channel)
        {
            // The first rule that can be changed, if there is one.
            panel.selected = acl.rules.iter().position(|rule| !rule.inherited);
            panel.acl = Some(acl);
            panel.dirty = false;
        }
    }

    /// Change the rule being edited, and note that there is something to
    /// save.
    fn change_rule(&mut self, change: impl FnOnce(&mut AclRule), cx: &mut Context<Self>) {
        let Some(panel) = self.panels.acl.as_mut() else {
            return;
        };
        if let Some(rule) = panel
            .selected
            .zip(panel.acl.as_mut())
            .and_then(|(at, acl)| acl.rules.get_mut(at))
            .filter(|rule| !rule.inherited)
        {
            change(rule);
            panel.dirty = true;
        }
        cx.notify();
    }

    /// Add a rule for the group `name`, saying nothing yet, and edit it.
    pub(super) fn add_acl_rule(&mut self, name: &str, cx: &mut Context<Self>) {
        let name = name.trim().trim_start_matches('@');
        let Some((panel, acl)) = self
            .panels
            .acl
            .as_mut()
            .and_then(|panel| panel.acl.take().map(|acl| (panel, acl)))
        else {
            return;
        };
        let mut acl = acl;
        if !name.is_empty() {
            acl.rules.push(AclRule {
                here: true,
                subs: true,
                inherited: false,
                user: None,
                group: Some(name.to_owned().into()),
                grant: 0,
                deny: 0,
            });
            panel.selected = Some(acl.rules.len() - 1);
            panel.dirty = true;
        }
        panel.acl = Some(acl);
        cx.notify();
    }

    /// Put the account in the group `name` of the channel being edited, or
    /// take it out; a group with no list yet gets one.
    pub(super) fn set_group_member(
        &mut self,
        name: &SharedString,
        account: u32,
        member: bool,
        cx: &mut Context<Self>,
    ) {
        let Some(panel) = self.panels.acl.as_mut() else {
            return;
        };
        let Some(acl) = panel.acl.as_mut() else {
            return;
        };
        let at = acl
            .groups
            .iter()
            .position(|group| group.name == *name)
            .unwrap_or_else(|| {
                acl.groups.push(AclGroup {
                    name: name.clone(),
                    inherited: Vec::new(),
                    added: Vec::new(),
                    removed: Vec::new(),
                });
                acl.groups.len() - 1
            });
        acl.groups[at].set_member(account, member);
        panel.dirty = true;
        cx.notify();
    }

    /// Take the rule being edited out.
    fn remove_acl_rule(&mut self, cx: &mut Context<Self>) {
        let Some(panel) = self.panels.acl.as_mut() else {
            return;
        };
        if let Some((at, acl)) = panel.selected.zip(panel.acl.as_mut())
            && acl.rules.get(at).is_some_and(|rule| !rule.inherited)
        {
            drop(acl.rules.remove(at));
            panel.selected = acl.rules.iter().position(|rule| !rule.inherited);
            panel.dirty = true;
        }
        cx.notify();
    }

    /// Send the rules as they stand to the server.
    fn save_acl(&mut self, cx: &mut Context<Self>) {
        if let Some(panel) = self.panels.acl.as_mut()
            && let Some(acl) = panel.acl.clone()
        {
            panel.dirty = false;
            self.engine.act(Action::SetAcl(acl));
        }
        cx.notify();
    }
}

/// One line of the rule list.
fn rule_row(
    shell: &Shell,
    (at, rule): (usize, &AclRule),
    selected: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let hover = theme.c.hover;
    let scope = match (rule.inherited, rule.here, rule.subs) {
        (true, ..) => "from the parent",
        (false, true, true) => "here and below",
        (false, true, false) => "here",
        (false, false, true) => "below",
        (false, false, false) => "nowhere",
    };
    div()
        .id(("acl-rule", at))
        .debug_selector(move || format!("acl-rule-{at}"))
        .flex()
        .flex_col()
        .gap(px(1.0))
        .px(px(10.0))
        .py(px(6.0))
        .rounded(theme.skin.radius_md)
        .when(selected, |row| row.bg(theme.c.accent_soft))
        .when(rule.inherited, |row| row.opacity(0.6))
        .when(!rule.inherited, |row| {
            row.cursor_pointer()
                .hover(move |style| style.bg(hover))
                .on_click(cx.listener(move |shell, _, _, cx| {
                    if let Some(panel) = shell.panels.acl.as_mut() {
                        panel.selected = Some(at);
                        panel.choosing = false;
                    }
                    cx.notify();
                }))
        })
        .child(
            div()
                .flex()
                .gap(px(8.0))
                .child(
                    div()
                        .font_weight(EMPHASIS)
                        .child(subject(rule, |account| named(shell, account))),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme.c.muted)
                        .child(scope),
                ),
        )
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.c.muted)
                .line_clamp(2)
                .child(summary(rule)),
        )
        .into_any_element()
}

/// The editor for the rule being edited: where it applies, and what it
/// says of each permission.
fn rule_editor(rule: &AclRule, root: bool, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let hover = theme.c.hover;
    let scope = |id: &'static str, name: &'static str, on: bool, here: bool| {
        div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .px(px(10.0))
            .py(px(3.0))
            .rounded(theme.skin.radius_pill)
            .border_1()
            .cursor_pointer()
            .text_size(px(12.0))
            .map(|chip| {
                if on {
                    chip.bg(theme.c.accent_soft)
                        .border_color(theme.c.accent_line)
                } else {
                    chip.border_color(theme.c.line2).text_color(theme.c.muted)
                }
            })
            .hover(move |style| style.bg(hover))
            .on_click(cx.listener(move |shell, _, _, cx| {
                shell.change_rule(
                    |rule| {
                        if here {
                            rule.here = !rule.here;
                        } else {
                            rule.subs = !rule.subs;
                        }
                    },
                    cx,
                );
            }))
            .child(name)
    };
    let chips = div()
        .flex()
        .gap(px(6.0))
        .pb(px(6.0))
        .child(scope("acl-here", "Applies here", rule.here, true))
        .child(scope("acl-subs", "Applies below", rule.subs, false));
    let offered = PERMISSIONS
        .iter()
        .filter(|(_, _, root_only)| root || !root_only);
    let permissions = offered.map(|(bit, name, _)| {
        let bit = *bit;
        let (word, ink) = match says(rule, bit) {
            Says::Nothing => ("-", theme.c.dim),
            Says::Allow => ("Allow", theme.c.ok),
            Says::Deny => ("Deny", theme.c.bad),
        };
        div()
            .id(("acl-permission", bit as usize))
            .debug_selector(move || format!("acl-{name}"))
            .h(px(26.0))
            .flex()
            .items_center()
            .px(px(8.0))
            .rounded(theme.skin.radius_sm)
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .on_click(cx.listener(move |shell, _, _, cx| {
                shell.change_rule(|rule| cycle(rule, bit), cx);
            }))
            .child(div().flex_1().min_w_0().truncate().child(*name))
            .child(
                div()
                    .w(px(48.0))
                    .flex()
                    .justify_end()
                    .font_weight(EMPHASIS)
                    .text_color(ink)
                    .child(word),
            )
    });
    div()
        .flex()
        .flex_col()
        .child(chips)
        .children(permissions)
        .into_any_element()
}

/// The groups every server has, whose members are not a list: everybody,
/// whoever is registered, whoever is in the channel, and so on.
const BUILT_IN: &[&str] = &["all", "auth", "in", "out", "sub", "none"];

/// The two columns: the rules, and the editor of the one chosen.
fn columns(
    shell: &Shell,
    panel: &Panel,
    acl: &Acl,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement {
    let editor = match panel.selected.and_then(|at| acl.rules.get(at)) {
        _ if panel.choosing => chooser(shell, acl, theme, cx),
        Some(rule) => {
            // A group with a list of members shows it under its rule.
            let listed = rule
                .group
                .as_ref()
                .filter(|name| !BUILT_IN.contains(&name.as_ref()) && !name.starts_with('~'));
            div()
                .flex()
                .flex_col()
                .when_some(listed, |editor, name| {
                    editor.child(members(shell, name, acl, theme, cx))
                })
                .child(rule_editor(rule, panel.root, theme, cx))
                .into_any_element()
        }
        None => div()
            .p(px(10.0))
            .text_color(theme.c.muted)
            .child("Add a rule, or choose one of this channel's own.")
            .into_any_element(),
    };
    div()
        .flex_1()
        .min_h_0()
        .flex()
        .gap(px(12.0))
        .text_size(px(13.0))
        .child(
            div()
                .id("acl-rules")
                .w(px(250.0))
                .h_full()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(2.0))
                .p(px(4.0))
                .rounded(theme.skin.radius_md)
                .bg(theme.c.card2)
                .children(acl.rules.iter().enumerate().map(|(at, rule)| {
                    let selected = panel.selected == Some(at) && !panel.choosing;
                    rule_row(shell, (at, rule), selected, theme, cx)
                })),
        )
        .child(
            div()
                .id("acl-editor")
                .flex_1()
                .min_w_0()
                .h_full()
                .overflow_y_scroll()
                .child(editor),
        )
}

/// The panel, over a veil.
pub(super) fn render(
    shell: &Shell,
    panel: &Panel,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement {
    let body = match &panel.acl {
        None => div()
            .flex_1()
            .p(px(10.0))
            .text_color(theme.c.muted)
            .child("Asking the server…")
            .into_any_element(),
        Some(acl) => columns(shell, panel, acl, theme, cx).into_any_element(),
    };
    let inherit = panel.acl.as_ref().is_some_and(|acl| acl.inherit);
    Dialog::new("acl")
        .w(px(640.0))
        .h(px(580.0))
        .gap(px(12.0))
        .p(px(22.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .child(icon("key-round", 15.0, theme.c.muted))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_size(px(16.0))
                        .font_weight(EMPHASIS)
                        .child(SharedString::from(format!(
                            "Permissions in {}",
                            panel.title
                        ))),
                )
                .child(
                    Button::new(
                        "acl-inherit",
                        if inherit {
                            "Takes the parent's rules"
                        } else {
                            "Ignores the parent's rules"
                        },
                    )
                    .tone(Tone::Accent)
                    .size(Size::Small)
                    .on_click(cx.listener(|shell, _, _, cx| {
                        if let Some(panel) = shell.panels.acl.as_mut()
                            && let Some(acl) = panel.acl.as_mut()
                        {
                            acl.inherit = !acl.inherit;
                            panel.dirty = true;
                        }
                        cx.notify();
                    })),
                ),
        )
        .child(body)
        .child(foot(panel, cx))
}

/// The buttons under the two columns.
fn foot(panel: &Panel, cx: &mut Context<Shell>) -> impl IntoElement {
    let (channel, choosing) = (panel.channel, panel.choosing);
    div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .text_size(px(13.0))
        .child(
            Button::new("acl-add", "Rule for a group…")
                .tone(Tone::Accent)
                .size(Size::Small)
                .on_click(cx.listener(move |shell, _, window: &mut Window, cx| {
                    shell.ask_for_acl_group(channel, window, cx);
                })),
        )
        .child(
            Button::new("acl-add-person", "Rule for a person…")
                .tone(Tone::Accent)
                .size(Size::Small)
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.choose_acl_person(!choosing, cx);
                })),
        )
        .child(
            Button::new("acl-remove", "Remove this rule")
                .tone(Tone::Danger)
                .size(Size::Small)
                .on_click(cx.listener(|shell, _, _, cx| shell.remove_acl_rule(cx))),
        )
        .child(div().flex_1())
        .child(
            Button::new("acl-close", "Close")
                .size(Size::Small)
                .on_click(cx.listener(|shell, _, _, cx| {
                    shell.panels.acl = None;
                    cx.notify();
                })),
        )
        .child(
            Button::new("acl-save", "Save")
                .tone(if panel.dirty { Tone::Accent } else { Tone::Dim })
                .size(Size::Small)
                .on_click(cx.listener(|shell, _, _, cx| shell.save_acl(cx))),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule() -> AclRule {
        AclRule {
            here: true,
            subs: true,
            inherited: false,
            user: None,
            group: Some("all".into()),
            grant: 0,
            deny: 0,
        }
    }

    #[test]
    fn a_click_on_a_permission_goes_from_nothing_to_allow_to_deny_and_back() {
        let mut rule = rule();
        assert_eq!(says(&rule, 0x4), Says::Nothing);
        cycle(&mut rule, 0x4);
        assert_eq!((rule.grant, rule.deny), (0x4, 0));
        cycle(&mut rule, 0x4);
        assert_eq!((rule.grant, rule.deny), (0, 0x4));
        cycle(&mut rule, 0x4);
        assert_eq!((rule.grant, rule.deny), (0, 0));
        // One permission's turn leaves the others be.
        rule.grant = 0x8;
        cycle(&mut rule, 0x4);
        assert_eq!((rule.grant, rule.deny), (0x8 | 0x4, 0));
    }

    #[test]
    fn a_rule_is_said_in_a_line() {
        let mut rule = rule();
        let named = |account: u32| SharedString::from(format!("account {account}"));
        assert_eq!(subject(&rule, named).as_ref(), "@all");
        assert_eq!(summary(&rule).as_ref(), "Says nothing yet");
        rule.grant = 0x4 | 0x8;
        rule.deny = 0x200;
        assert_eq!(summary(&rule).as_ref(), "+Enter +Speak -Write messages");
        rule.group = None;
        rule.user = Some(7);
        assert_eq!(subject(&rule, named).as_ref(), "account 7");
        assert_eq!(subject(&rule, |_| "Rin".into()).as_ref(), "Rin");
    }

    #[test]
    fn every_permission_has_a_bit_of_its_own() {
        let mut seen = 0_u32;
        for (bit, _, _) in PERMISSIONS {
            assert_eq!(bit.count_ones(), 1);
            assert_eq!(seen & bit, 0, "said twice");
            seen |= bit;
        }
    }

    /// The table the engine and the web client are written from: nothing
    /// in it is missing here, nothing here is not in it, and the two agree
    /// on what belongs to the root.
    #[test]
    fn the_permissions_are_the_ones_the_server_has() {
        let theirs = fancy_utils::permissions::ENTRIES;
        assert_eq!(PERMISSIONS.len(), theirs.len());
        for entry in theirs {
            let ours = PERMISSIONS.iter().find(|(bit, _, _)| *bit == entry.bit);
            let Some((_, name, root_only)) = ours else {
                panic!("{} is not offered", entry.label);
            };
            assert_eq!(*root_only, entry.root_only, "{name}");
        }
    }
}
