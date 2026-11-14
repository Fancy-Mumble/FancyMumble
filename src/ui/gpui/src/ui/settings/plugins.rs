//! The Plugins page, as the web UI's (`PluginsSettings`): the Signal bridge
//! this client loads for channels sealed the Signal way, and the plugins
//! the server on show says it runs, each with what it says of itself and
//! what it would ask a client to let it do. In the column where the server
//! runs any, as the web UI's `hasPlugins`.
//!
//! Left out: trusting a plugin (allow, revoke, ask again) and the settings
//! panels a trusted one fills. Both belong to the web client's plugin
//! runtime, which runs a plugin's commands, cards and dialogs; this client
//! has none, so a trust given here would let nothing in. Installing the
//! bridge is left out as the web UI leaves it out of a build that cannot
//! download it: this one has no signing key to check a download against.

use gpui::{Context, Div, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{Card, Empty, PageTitle, icon};
use super::super::widgets::EMPHASIS;
use crate::engine::{ServerPlugin, SignalBridge};
use crate::theme::Theme;
use crate::words::t;

/// The plugins the web client marks as its own makers'.
const OFFICIAL: [&str; 2] = ["fancy-live-doc", "fancy-file-server"];

/// What the page shows: the server's plugins, and where the bridge stands.
#[derive(Debug, Default)]
pub(in crate::ui) struct Plugins {
    pub listed: Vec<ServerPlugin>,
    pub bridge: Option<SignalBridge>,
}

impl Shell {
    /// Read the server's plugins again: the column lists the page only
    /// where there are any.
    pub(in crate::ui) fn read_plugins(&mut self) {
        self.panels.settings.plugins.listed = self.engine.server_plugins();
    }

    /// The page was turned to: where the bridge stands is looked up now.
    pub(super) fn open_plugins(&mut self) {
        self.read_plugins();
        self.panels.settings.plugins.bridge = self.engine.signal_bridge();
    }
}

/// The page.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let _ = cx;
    let plugins = &shell.panels.settings.plugins;
    div()
        .child(PageTitle::new(t!("Plugins")))
        .children(plugins.bridge.map(|bridge| bridge_card(bridge, theme)))
        .child(if plugins.listed.is_empty() {
            div().child(Empty::new(t!("No plugins are loaded on the connected server.")))
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(10.0))
                .children(plugins.listed.iter().enumerate().map(|(at, plugin)| card(plugin, at, theme)))
        })
}

/// The Signal bridge: whether it is there, and where it came from.
fn bridge_card(bridge: SignalBridge, theme: &Theme) -> Div {
    let hint = match (bridge.installed, bridge.addon) {
        (true, true) => t!("Installed (version {{version}}).", version = bridge.version),
        (true, false) => t!("Included with this installation."),
        (false, _) => t!("Not available for this build. Install it with your package manager."),
    };
    div().mb(px(10.0)).debug_selector(|| "signal-bridge".to_owned()).child(
        Card::new()
            .child(
                div()
                    .text_size(px(13.0))
                    .font_weight(EMPHASIS)
                    .child(SharedString::from(format!(
                        "{} v{}",
                        t!("Signal Protocol add-on"),
                        bridge.version
                    ))),
            )
            .child(
                div()
                    .mt(px(2.0))
                    .text_size(px(11.5))
                    .text_color(theme.c.muted)
                    .child(hint),
            ),
    )
}

/// One plugin: its name, version and whether it is the client makers' own,
/// what it does, and what it would ask to do.
fn card(plugin: &ServerPlugin, at: usize, theme: &Theme) -> Div {
    let official = OFFICIAL.contains(&plugin.name.as_str());
    let head = div()
        .flex()
        .flex_wrap()
        .items_center()
        .gap(px(7.0))
        .child(
            div()
                .text_size(px(13.0))
                .font_weight(EMPHASIS)
                .child(SharedString::from(plugin.name.clone())),
        )
        .child(
            div()
                .text_size(px(11.0))
                .text_color(theme.c.dim)
                .child(SharedString::from(format!("v{}", plugin.version))),
        )
        .when(official, |head| head.child(badge(theme)));
    div()
        .debug_selector(move || format!("plugin-{at}"))
        .child(
            Card::new()
                .child(head)
                .children(plugin.description.clone().map(|description| {
                    div()
                        .mt(px(4.0))
                        .text_size(px(11.5))
                        .text_color(theme.c.muted)
                        .child(description)
                }))
                .when(!plugin.capabilities.is_empty(), |card| {
                    card.child(
                        div().mt(px(10.0)).flex().flex_wrap().gap(px(5.0)).children(
                            plugin.capabilities.iter().map(|capability| {
                                div()
                                    .h(px(24.0))
                                    .px(px(8.0))
                                    .flex()
                                    .items_center()
                                    .rounded(px(12.0))
                                    .bg(theme.c.card2)
                                    .text_size(px(13.0))
                                    .child(SharedString::from(capability.clone()))
                            }),
                        ),
                    )
                }),
        )
}

/// The mark of a plugin by the client's own makers.
fn badge(theme: &Theme) -> Div {
    div()
        .flex_none()
        .flex()
        .items_center()
        .gap(px(3.0))
        .px(px(6.0))
        .py(px(2.0))
        .rounded(theme.skin.radius_sm)
        .bg(theme.c.accent_soft)
        .border_1()
        .border_color(theme.c.accent_line)
        .text_size(px(10.0))
        .font_weight(EMPHASIS)
        .text_color(theme.c.accent)
        .child(icon("shield-check", 11.0, theme.c.accent))
        .child(super::super::kit::spaced(&t!("Official").to_uppercase(), 0.4))
}
