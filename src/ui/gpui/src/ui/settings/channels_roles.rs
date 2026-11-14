//! The Channels & roles page, as the web UI's (`ChannelsRolesSettings`):
//! what the user answered when they joined the server on show, as the
//! channels it lets them see and the roles it puts them in, and the ways to
//! answer again: changing the answers, or starting over with none.
//!
//! It shows nothing to edit itself: the answers are to a form the server
//! defines, and changing them is that form asked again (`onboarding.rs`).
//! In the column for a server that asks new members anything.

use gpui::{Context, Div, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{Button, Emphasis, Empty, PageTitle, Size};
use crate::engine::{role_labels, visible_channels};
use crate::theme::Theme;
use crate::words::t;

impl Shell {
    /// The page was turned to: the answers are asked for again, so that
    /// those changed on another device show here without reconnecting.
    pub(super) fn open_channels_roles(&self) {
        if self.engine.onboarding_offered() {
            self.engine.request_onboarding_response();
        }
    }
}

/// The page.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let heading = t!("Channels & Roles");
    if !shell.engine.onboarding_offered() {
        return div().child(PageTitle::new(heading)).child(Empty::new(t!(
            "The connected server does not support the onboarding workflow. It requires a Fancy Mumble server running 0.3.1 or newer."
        )));
    }
    let Some(config) = shell.engine.onboarding_config().filter(|config| config.enabled) else {
        return div()
            .child(PageTitle::new(heading))
            .child(Empty::new(t!("This server does not have onboarding enabled.")));
    };
    let response = shell.panels.settings.onboarding.response.as_ref();
    let channels = visible_channels(&config, response);
    let roles = role_labels(&config, response);
    let lit = &shell.panels.settings.lit;
    let quiet = |words: SharedString| {
        div()
            .text_size(px(11.5))
            .text_color(theme.c.muted)
            .child(words)
    };
    let chips = |names: Vec<SharedString>, accent: bool, tag: &'static str| {
        div()
            .debug_selector(move || tag.to_owned())
            .flex()
            .flex_wrap()
            .gap(px(5.0))
            .children(names.into_iter().map(move |name| chip(name, accent, theme)))
    };
    div()
        .child(PageTitle::new(heading).hint(t!(
            "These come from the answers you gave when you joined. Update them any time to change which channels and roles apply to you."
        )))
        .child(super::heading(lit, t!("Visible channels")))
        .child(if channels.is_empty() {
            quiet(t!("No channels selected yet."))
        } else {
            chips(
                channels
                    .into_iter()
                    .map(|id| format!("#{}", shell.channel_name(id)).into())
                    .collect(),
                false,
                "visible-channels",
            )
        })
        .child(super::heading(lit, t!("Your roles")))
        .child(if roles.is_empty() {
            quiet(t!("No roles assigned."))
        } else {
            chips(roles.into_iter().map(SharedString::from).collect(), true, "your-roles")
        })
        .child(
            div()
                .mt(px(22.0))
                .flex()
                .gap(px(6.0))
                .child(
                    Button::new("onboarding-reset", t!("Reset answers"))
                        .emphasis(Emphasis::Outlined)
                        .size(Size::Compact)
                        .on_click(cx.listener(|shell, _, _, cx| shell.ask_questions(true, cx))),
                )
                .child(
                    Button::new("onboarding-change", t!("Change my answers"))
                        .emphasis(Emphasis::Contained)
                        .size(Size::Compact)
                        .on_click(cx.listener(|shell, _, _, cx| shell.ask_questions(false, cx))),
                ),
        )
}

/// A small chip, as the web UI's: a channel on the card's ground, a role
/// washed in the accent.
fn chip(name: SharedString, accent: bool, theme: &Theme) -> Div {
    div()
        .h(px(24.0))
        .px(px(8.0))
        .flex()
        .items_center()
        .rounded(px(12.0))
        .border_1()
        .text_size(px(13.0))
        .map(|chip| {
            if accent {
                chip.bg(theme.c.accent_soft).border_color(theme.c.accent_line)
            } else {
                chip.bg(theme.c.card2).border_color(gpui::transparent_black())
            }
        })
        .child(name)
}
