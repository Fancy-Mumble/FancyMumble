//! The Ban List page as it is drawn: its title with what can be done to
//! the list, why the last save did not go out, and the list beside the
//! form of the entry chosen.

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::super::Shell;
use super::super::kit::{
    Banner, Button, Card, Emphasis, Field, ListRow, Note, PageTitle, Placeholder, Size, SplitView,
    TextBox, Tone,
};
use super::bans::Bans;
use crate::engine::Ban;
use crate::theme::Theme;
use crate::words::t;

/// How wide the page is at most: a list and a form, not a table.
const WIDEST: f32 = 760.0;

/// The page.
pub(super) fn render(bans: &Bans, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    div()
        .id("admin-bans-page")
        .max_w(px(WIDEST))
        .child(
            PageTitle::new(t!("Ban List"))
                .below(20.0)
                .action(toolbar(bans, cx)),
        )
        .when_some(bans.refusal.clone(), |page, refusal| {
            page.child(
                div()
                    .id("bans-refusal")
                    .debug_selector(|| "bans-refusal".to_owned())
                    .mt(px(-10.0))
                    .mb(px(12.0))
                    .cursor_pointer()
                    .on_click(cx.listener(|shell, _, _, cx| shell.clear_ban_refusal(cx)))
                    .child(Banner::new(Note::Danger).child(t!(
                        "The ban list was not saved, nothing was changed: {{reason}}",
                        reason = refusal
                    ))),
            )
        })
        .child(SplitView::new(
            "bans",
            list(bans, theme, cx),
            detail(bans, cx),
        ))
        .into_any_element()
}

/// Read the list again, add an entry, remove the one chosen, and save
/// once something changed.
fn toolbar(bans: &Bans, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let outlined = |id: &'static str, words: SharedString| {
        Button::new(id, words)
            .emphasis(Emphasis::Outlined)
            .size(Size::Compact)
    };
    let refresh = if bans.loading {
        outlined("bans-refresh", t!("Loading..."))
    } else {
        outlined("bans-refresh", t!("Refresh"))
            .on_click(cx.listener(|shell, _, _, cx| shell.refresh_bans(cx)))
    };
    let remove = Button::new("bans-remove", t!("Remove")).size(Size::Compact);
    // In the muted ink while it can be used, as the web UI's; fainter
    // while nothing is chosen.
    let remove = if bans.selected.is_some() {
        remove
            .tone(Tone::Muted)
            .on_click(cx.listener(|shell, _, _, cx| shell.remove_ban(cx)))
    } else {
        remove.tone(Tone::Dim)
    };
    div()
        .flex()
        .gap(px(6.0))
        .child(refresh)
        .child(
            outlined("bans-add", t!("+ Add Entry"))
                .on_click(cx.listener(|shell, _, window, cx| shell.add_ban(window, cx))),
        )
        .child(remove)
        .when(bans.dirty, |toolbar| {
            toolbar.child(
                Button::new("bans-save", t!("Save Changes"))
                    .emphasis(Emphasis::Contained)
                    .size(Size::Compact)
                    .on_click(cx.listener(|shell, _, _, cx| shell.save_bans(cx))),
            )
        })
}

/// What an entry is called in the list: its name, else its address.
fn title(ban: &Ban) -> SharedString {
    if !ban.name.is_empty() {
        ban.name.clone()
    } else if !ban.address.is_empty() {
        ban.address.clone()
    } else {
        t!("Unknown")
    }
}

/// The line under it: the address with its mask, and why.
fn subtitle(ban: &Ban) -> SharedString {
    let mut about = format!("{}/{}", ban.address, ban.mask);
    if !ban.reason.is_empty() {
        about.push_str(" - ");
        about.push_str(&ban.reason);
    }
    about.into()
}

/// The rows of the list, or what it says while it has none.
fn list(bans: &Bans, theme: &Theme, cx: &mut Context<Shell>) -> Vec<AnyElement> {
    if bans.bans.is_empty() {
        let says = if bans.loading {
            t!("Loading...")
        } else {
            t!("No bans")
        };
        return vec![
            div()
                .p(px(16.0))
                .text_size(px(12.0))
                .text_color(theme.c.muted)
                .child(says)
                .into_any_element(),
        ];
    }
    bans.bans
        .iter()
        .enumerate()
        .map(|(at, ban)| {
            ListRow::new("ban", at, title(ban))
                .subtitle(subtitle(ban))
                .selected(bans.selected == Some(at))
                .on_click(cx.listener(move |shell, _, window, cx| shell.choose_ban(at, window, cx)))
                .into_any_element()
        })
        .collect()
}

/// The form of the entry chosen, or what the detail says while none is.
fn detail(bans: &Bans, _: &mut Context<Shell>) -> AnyElement {
    let Some(form) = bans.form.as_ref() else {
        return Placeholder::new(t!("Select a ban entry to edit")).into_any_element();
    };
    Card::new()
        .flex()
        .flex_col()
        .gap(px(10.0))
        .children(
            form.fields
                .iter()
                .map(|(part, field)| {
                    Field::new(part.label(), TextBox::new(field.clone()).named(part.id()))
                }),
        )
        .into_any_element()
}
