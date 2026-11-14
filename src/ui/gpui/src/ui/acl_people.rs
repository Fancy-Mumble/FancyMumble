//! The people of a channel's rules: what an account is called, who is in a
//! group, and who a rule for one person can be for.

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::widgets::{EMPHASIS, icon};
use crate::engine::{Acl, AclGroup, AclRule};
use crate::theme::Theme;

/// The most people offered at once for a rule of their own: a server may
/// have registered thousands.
const OFFERED: usize = 40;

/// What the account is called: by whoever is connected as it, else by the
/// server's list of accounts where that could be had, else by its number.
pub(super) fn named(shell: &Shell, account: u32) -> SharedString {
    let here = shell
        .snapshot
        .users
        .iter()
        .find(|user| user.account == Some(account))
        .map(|user| user.name.clone());
    let listed = || {
        let panel = shell.panels.acl.as_ref()?;
        panel.names.get(&account).cloned()
    };
    here.or_else(listed)
        .unwrap_or_else(|| format!("account {account}").into())
}

/// Who a rule for one person can be for, with what each is called: whoever
/// is here and registered first, then the accounts the server listed; by
/// name within each, and nobody the channel already has a rule for.
pub(super) fn offered(shell: &Shell, acl: &Acl) -> Vec<(u32, SharedString)> {
    let taken = |account: u32| {
        acl.rules
            .iter()
            .any(|rule| !rule.inherited && rule.user == Some(account))
    };
    let by_name = |people: &mut Vec<(u32, SharedString)>| {
        people.sort_by_key(|(account, name)| (name.to_lowercase(), *account));
        people.dedup_by_key(|(account, _)| *account);
    };
    let mut here: Vec<(u32, SharedString)> = shell
        .snapshot
        .users
        .iter()
        .filter_map(|user| Some((user.account?, user.name.clone())))
        .filter(|(account, _)| !taken(*account))
        .collect();
    by_name(&mut here);
    let mut away: Vec<(u32, SharedString)> = shell
        .panels
        .acl
        .iter()
        .flat_map(|panel| panel.names.iter())
        .map(|(account, name)| (*account, name.clone()))
        .filter(|(account, _)| !taken(*account) && !here.iter().any(|(on, _)| on == account))
        .collect();
    by_name(&mut away);
    here.extend(away);
    here.truncate(OFFERED);
    here
}

impl Shell {
    /// Offer the people a rule can be for, or put the offer away.
    pub(super) fn choose_acl_person(&mut self, choosing: bool, cx: &mut Context<Self>) {
        if let Some(panel) = self.panels.acl.as_mut() {
            panel.choosing = choosing;
        }
        cx.notify();
    }

    /// Add a rule for the one account, saying nothing yet, and edit it.
    fn add_acl_rule_for(&mut self, account: u32, cx: &mut Context<Self>) {
        let Some(panel) = self.panels.acl.as_mut() else {
            return;
        };
        panel.choosing = false;
        if let Some(acl) = panel.acl.as_mut() {
            acl.rules.push(AclRule {
                here: true,
                subs: true,
                inherited: false,
                user: Some(account),
                group: None,
                grant: 0,
                deny: 0,
            });
            panel.selected = Some(acl.rules.len() - 1);
            panel.dirty = true;
        }
        cx.notify();
    }
}

/// The people a rule can be for, to choose one of.
pub(super) fn chooser(
    shell: &Shell,
    acl: &Acl,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let hover = theme.c.hover;
    let people = offered(shell, acl);
    let nobody = people.is_empty();
    let chips = people.into_iter().map(|(account, name)| {
        div()
            .id(("acl-person", account as usize))
            .debug_selector(move || format!("acl-person-{account}"))
            .px(px(9.0))
            .py(px(3.0))
            .rounded(theme.skin.radius_pill)
            .border_1()
            .border_color(theme.c.line2)
            .cursor_pointer()
            .text_size(px(12.0))
            .hover(move |style| style.bg(hover))
            .on_click(cx.listener(move |shell, _, _, cx| shell.add_acl_rule_for(account, cx)))
            .child(name)
    });
    div()
        .p(px(4.0))
        .flex()
        .flex_col()
        .gap(px(8.0))
        .child(
            div()
                .text_size(px(11.0))
                .font_weight(EMPHASIS)
                .text_color(theme.c.muted)
                .child("A RULE FOR WHOM?"),
        )
        .child(div().flex().flex_wrap().gap(px(6.0)).children(chips))
        .when(nobody, |chooser| {
            chooser.child(
                div()
                    .text_color(theme.c.muted)
                    .child("Nobody registered is here, and the server gave no list of accounts."),
            )
        })
        .into_any_element()
}

/// Who is in the group a rule names, and who of those here could be: a
/// click takes a member out, or puts somebody in.
///
/// Members are registered accounts; see [`named`] for what each is called.
pub(super) fn members(
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
            .child(named(shell, account))
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
