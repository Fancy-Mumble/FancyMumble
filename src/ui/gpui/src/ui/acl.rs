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
use super::kit::{Button, Dialog, Size, Tone};
use super::widgets::{EMPHASIS, icon};
use crate::engine::{Acl, AclGroup, AclRule, Action, ChannelId};
use crate::theme::Theme;

/// The permissions a rule speaks of, as Mumble's bits, with what each is
/// called. The last five mean something on the root channel only.
pub(super) const PERMISSIONS: &[(u32, &str)] = &[
    (0x1, "Write the rules"),
    (0x2, "Traverse"),
    (0x4, "Enter"),
    (0x8, "Speak"),
    (0x100, "Whisper"),
    (0x200, "Write messages"),
    (0x800, "Listen"),
    (0x10, "Mute and deafen others"),
    (0x20, "Move others"),
    (0x40, "Make channels"),
    (0x400, "Make temporary channels"),
    (0x80, "Link channels"),
    (0x1_0000, "Kick"),
    (0x2_0000, "Ban"),
    (0x4_0000, "Register others"),
    (0x8_0000, "Register oneself"),
    (0x10_0000, "Reset comments and pictures"),
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

/// Who a rule is for, in words.
fn subject(rule: &AclRule) -> SharedString {
    match (&rule.group, rule.user) {
        (Some(group), _) => format!("@{group}").into(),
        (None, Some(user)) => format!("Account {user}").into(),
        (None, None) => "Nobody".into(),
    }
}

/// What a rule does, in a line: `+Enter +Speak -Write messages`.
fn summary(rule: &AclRule) -> SharedString {
    let mut said = String::new();
    for (bit, name) in PERMISSIONS {
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
        let title = self
            .snapshot
            .channels
            .iter()
            .find(|known| known.id == channel)
            .map_or_else(SharedString::default, |known| known.name.clone());
        self.panels.acl = Some(Panel {
            channel,
            title,
            acl: None,
            selected: None,
            dirty: false,
        });
        self.engine.request_acl(channel);
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
    fn set_group_member(
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
    at: usize,
    rule: &AclRule,
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
                    }
                    cx.notify();
                }))
        })
        .child(
            div()
                .flex()
                .gap(px(8.0))
                .child(div().font_weight(EMPHASIS).child(subject(rule)))
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
fn rule_editor(rule: &AclRule, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
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
    let permissions = PERMISSIONS.iter().map(|(bit, name)| {
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

/// Who is in the group a rule names, and who of those here could be: a
/// click takes a member out, or puts somebody in.
///
/// Members are registered accounts. One who is not connected has no name
/// here, only the account's number.
fn members(
    shell: &Shell,
    name: &SharedString,
    acl: &Acl,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let accounts = acl
        .groups
        .iter()
        .find(|group| group.name == *name)
        .map(AclGroup::members)
        .unwrap_or_default();
    let named = |account: u32| {
        shell
            .snapshot
            .users
            .iter()
            .find(|user| user.account == Some(account))
            .map_or_else(
                || SharedString::from(format!("account {account}")),
                |user| user.name.clone(),
            )
    };
    let hover = theme.c.hover;
    let chip = |account: u32, member: bool| {
        let group = name.clone();
        div()
            .id(("acl-member", account as usize))
            .debug_selector(move || format!("acl-member-{account}"))
            .flex()
            .items_center()
            .gap(px(5.0))
            .px(px(9.0))
            .py(px(3.0))
            .rounded(theme.skin.radius_pill)
            .border_1()
            .cursor_pointer()
            .text_size(px(12.0))
            .map(|chip| {
                if member {
                    chip.bg(theme.c.accent_soft)
                        .border_color(theme.c.accent_line)
                } else {
                    chip.border_color(theme.c.line2).text_color(theme.c.muted)
                }
            })
            .hover(move |style| style.bg(hover))
            .on_click(cx.listener(move |shell, _, _, cx| {
                shell.set_group_member(&group, account, !member, cx);
            }))
            .child(icon(if member { "x" } else { "plus" }, 10.0, theme.c.muted))
            .child(named(account))
    };
    // Whoever is here, is registered, and is not in it yet.
    let mut candidates: Vec<u32> = shell
        .snapshot
        .users
        .iter()
        .filter_map(|user| user.account)
        .filter(|account| !accounts.contains(account))
        .collect();
    candidates.sort_unstable();
    candidates.dedup();
    div()
        .pb(px(12.0))
        .flex()
        .flex_col()
        .gap(px(6.0))
        .child(
            div()
                .text_size(px(11.0))
                .font_weight(EMPHASIS)
                .text_color(theme.c.muted)
                .child(format!("MEMBERS OF @{name}")),
        )
        .child(
            div()
                .flex()
                .flex_wrap()
                .gap(px(6.0))
                .children(accounts.iter().map(|account| chip(*account, true)))
                .children(candidates.into_iter().map(|account| chip(account, false))),
        )
        .into_any_element()
}

/// The two columns: the rules, and the editor of the one chosen.
fn columns(
    shell: &Shell,
    panel: &Panel,
    acl: &Acl,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement {
    let editor = match panel.selected.and_then(|at| acl.rules.get(at)) {
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
                .child(rule_editor(rule, theme, cx))
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
                .children(
                    acl.rules.iter().enumerate().map(|(at, rule)| {
                        rule_row(at, rule, panel.selected == Some(at), theme, cx)
                    }),
                ),
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
    let channel = panel.channel;
    div()
        .flex()
        .items_center()
        .gap(px(4.0))
        .text_size(px(13.0))
        .child(
            Button::new("acl-add", "Add a rule for a group…")
                .tone(Tone::Accent)
                .size(Size::Small)
                .on_click(cx.listener(move |shell, _, window: &mut Window, cx| {
                    shell.ask_for_acl_group(channel, window, cx);
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
        assert_eq!(subject(&rule).as_ref(), "@all");
        assert_eq!(summary(&rule).as_ref(), "Says nothing yet");
        rule.grant = 0x4 | 0x8;
        rule.deny = 0x200;
        assert_eq!(summary(&rule).as_ref(), "+Enter +Speak -Write messages");
        rule.group = None;
        rule.user = Some(7);
        assert_eq!(subject(&rule).as_ref(), "Account 7");
    }

    #[test]
    fn every_permission_has_a_bit_of_its_own() {
        let mut seen = 0_u32;
        for (bit, _) in PERMISSIONS {
            assert_eq!(bit.count_ones(), 1);
            assert_eq!(seen & bit, 0, "said twice");
            seen |= bit;
        }
    }
}
