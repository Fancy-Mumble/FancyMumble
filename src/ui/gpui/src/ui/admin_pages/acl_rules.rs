//! The ACL Rules tab: each rule of the channel as a card, opened to say
//! where it applies, who it is for, and what it allows and denies. The web
//! UI's `AclRules`.

use gpui::{
    AnyElement, Context, ElementId, IntoElement, ParentElement, SharedString, Styled, div,
    prelude::*, px,
};

use super::super::Shell;
use super::super::kit::{
    Button, Card, Emphasis, Empty, IconButton, Reachable, Size, TextBox, TickBox, icon, spaced,
};
use super::acl_page::AclPage;
use crate::engine::{Acl, AclRule};
use crate::theme::Theme;
use crate::words::t;

/// The server's permissions as the web UI's grid lists them: Mumble's bit,
/// what it is called there, and whether it means something at the root
/// only (offered there alone).
pub(super) const PERMISSIONS: [(u32, &str, bool); 26] = [
    (0x1, "Write", false),
    (0x2, "Traverse", false),
    (0x4, "Enter", false),
    (0x8, "Speak", false),
    (0x10, "Mute/Deafen", false),
    (0x20, "Move", false),
    (0x40, "Make Channel", false),
    (0x80, "Link Channel", false),
    (0x100, "Whisper", false),
    (0x200, "Text Message", false),
    (0x400, "Make Temp Channel", false),
    (0x800, "Listen", false),
    (0x1000, "Delete Message", false),
    (0x2000, "Subscribe Push", false),
    (0x4000, "Share Files", false),
    (0x8000, "Share Files (Public)", false),
    (0x1_0000, "Kick", true),
    (0x2_0000, "Ban", true),
    (0x4_0000, "Register", true),
    (0x8_0000, "Self-Register", true),
    (0x10_0000, "Reset User Content", true),
    (0x20_0000, "Key Owner", true),
    (0x40_0000, "Manage Emotes", true),
    (0x80_0000, "List Registered Users", true),
    (0x100_0000, "See Hidden Channel", false),
    (0x200_0000, "Send Voice Message", false),
];

/// Who a rule is for, as its card's head says it.
fn subject(rule: &AclRule) -> SharedString {
    match (&rule.group, rule.user) {
        (Some(group), _) => format!("@{group}").into(),
        (None, Some(user)) => t!("User #{{id}}", id = user),
        (None, None) => t!("Unknown"),
    }
}

/// The tab.
pub(super) fn render(page: &AclPage, acl: &Acl, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let root = acl.channel == 0;
    let head = div()
        .mb(px(10.0))
        .flex()
        .items_center()
        .justify_between()
        .child(
            div()
                .text_size(px(12.5))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .child(t!("ACL Rules")),
        )
        .child(
            Button::new("acl-add-rule", t!("+ Add Rule"))
                .emphasis(Emphasis::Outlined)
                .size(Size::Compact)
                .on_click(cx.listener(|shell, _, _, cx| shell.add_acl_page_rule(cx))),
        );
    let body = if acl.rules.is_empty() {
        Empty::new(t!("No ACL rules defined")).into_any_element()
    } else {
        div()
            .flex()
            .flex_col()
            .gap(px(6.0))
            .children(acl.rules.iter().enumerate().map(|(at, rule)| card(page, at, rule, root, theme, cx)))
            .into_any_element()
    };
    div().child(head).child(body).into_any_element()
}

/// One rule's card: its head, and when open, all of it.
fn card(page: &AclPage, at: usize, rule: &AclRule, root: bool, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let open = page.rule.as_ref().filter(|fields| fields.at == at);
    let id = SharedString::from(format!("acl-rule-{at}"));
    let selector = id.clone();
    let head = div()
        .id(ElementId::Name(id.clone()))
        .debug_selector(move || selector.to_string())
        .px(px(12.0))
        .py(px(9.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .cursor_pointer()
        .on_click(cx.listener(move |shell, _, _, cx| shell.open_acl_rule(at, cx)))
        .child(icon(if open.is_some() { "chevron-down" } else { "chevron-right" }, 11.0, theme.c.muted))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .text_size(px(12.5))
                .font_weight(gpui::FontWeight::MEDIUM)
                .child(subject(rule)),
        )
        .map(|head| {
            if rule.inherited {
                head.child(div().text_size(px(10.5)).text_color(theme.c.dim).child(t!("Inherited")))
            } else {
                head.child(
                    IconButton::at("acl-rule-remove", at, "x")
                        .size(24.0)
                        .glyph_size(12.0)
                        .on_click(cx.listener(move |shell, _, _, cx| shell.remove_acl_page_rule(at, cx))),
                )
            }
        });
    Card::new()
        .p(px(0.0))
        .overflow_hidden()
        .child(Reachable::new(ElementId::Name(id), head))
        .when_some(open, |card, fields| {
            card.child(opened(at, rule, root, fields, theme, cx))
        })
        .into_any_element()
}

/// A tick box and what it means, a place for the keyboard where it can be
/// changed.
fn tick(id: SharedString, says: SharedString, on: bool, locked: bool, flip: impl Fn(&mut Shell, &mut Context<Shell>) + 'static, cx: &mut Context<Shell>) -> AnyElement {
    let selector = id.clone();
    let row = div()
        .id(ElementId::Name(id.clone()))
        .debug_selector(move || selector.to_string())
        .flex()
        .items_center()
        .gap(px(6.0))
        .text_size(px(11.5))
        .when(locked, |row| row.opacity(0.5))
        .when(!locked, |row| {
            row.cursor_pointer()
                .on_click(cx.listener(move |shell, _, _, cx| flip(shell, cx)))
        })
        .child(TickBox::new(on))
        .child(says);
    Reachable::new(ElementId::Name(id), row).into_any_element()
}

/// The open rule: where it applies, who it is for, and its grid.
fn opened(
    at: usize,
    rule: &AclRule,
    root: bool,
    fields: &super::acl_page::RuleFields,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let locked = rule.inherited;
    let (here, subs) = (rule.here, rule.subs);
    let wheres = div()
        .mb(px(10.0))
        .flex()
        .flex_wrap()
        .gap(px(16.0))
        .child(tick(
            "acl-here".into(),
            t!("Apply here"),
            here,
            locked,
            move |shell, cx| shell.change_acl_rule(at, |rule| rule.here = !here, cx),
            cx,
        ))
        .child(tick(
            "acl-subs".into(),
            t!("Apply to sub-channels"),
            subs,
            locked,
            move |shell, cx| shell.change_acl_rule(at, |rule| rule.subs = !subs, cx),
            cx,
        ));
    let whom = (!locked).then(|| {
        div()
            .mb(px(12.0))
            .flex()
            .gap(px(10.0))
            .child(labelled(t!("Group"), TextBox::new(fields.group.clone()).named("acl-rule-group"), theme))
            .child(labelled(t!("User ID"), TextBox::new(fields.account.clone()).named("acl-rule-user"), theme))
    });
    div()
        .px(px(12.0))
        .pb(px(12.0))
        .pt(px(10.0))
        .border_t_1()
        .border_color(theme.c.line)
        .child(wheres)
        .children(whom)
        .child(grid(at, rule, root, theme, cx))
}

/// A field with what it is over it, as small as the web UI's outlined
/// label.
fn labelled(label: SharedString, field: TextBox, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .flex_1()
        .child(div().mb(px(4.0)).text_size(px(11.0)).text_color(theme.c.muted).child(label))
        .child(field)
}

/// Each permission, and whether the rule allows it and whether it denies
/// it.
fn grid(at: usize, rule: &AclRule, root: bool, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let head = |words: SharedString, centred: bool| {
        div()
            .pb(px(5.0))
            .mb(px(3.0))
            .border_b_1()
            .border_color(theme.c.line)
            .when(centred, |cell| cell.flex().justify_center())
            .child(
                spaced(&words.to_uppercase(), 0.7)
                    .text_size(px(10.0))
                    .font_weight(gpui::FontWeight::SEMIBOLD)
                    .text_color(theme.c.dim),
            )
    };
    let locked = rule.inherited;
    let rows = PERMISSIONS
        .iter()
        .filter(|(_, _, root_only)| root || !root_only)
        .map(|&(bit, name, _)| {
            let allowed = rule.grant & bit != 0;
            let denied = rule.deny & bit != 0;
            let cell = |kind: &str, on: bool, deny: bool, cx: &mut Context<Shell>| {
                let id = SharedString::from(format!("acl-{kind}-{bit:x}"));
                let selector = id.clone();
                let tick = div()
                    .id(ElementId::Name(id.clone()))
                    .debug_selector(move || selector.to_string())
                    .w(px(56.0))
                    .py(px(2.0))
                    .flex()
                    .justify_center()
                    .when(!locked, |tick| {
                        tick.cursor_pointer().on_click(cx.listener(move |shell, _, _, cx| {
                            shell.flip_acl_bit(at, bit, deny, cx);
                        }))
                    })
                    .when(locked, |tick| tick.opacity(0.5))
                    .child(TickBox::new(on));
                Reachable::new(ElementId::Name(id), tick)
            };
            div()
                .flex()
                .items_center()
                .text_size(px(11.5))
                .child(div().flex_1().min_w_0().truncate().child(SharedString::new_static(name)))
                .child(cell("allow", allowed, false, cx))
                .child(cell("deny", denied, true, cx))
        })
        .collect::<Vec<_>>();
    div()
        .child(
            div()
                .flex()
                .child(div().flex_1().child(head(t!("Permission"), false)))
                .child(div().w(px(56.0)).child(head(t!("Allow"), true)))
                .child(div().w(px(56.0)).child(head(t!("Deny"), true))),
        )
        .children(rows)
}
