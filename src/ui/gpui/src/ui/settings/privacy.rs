//! The Privacy page, as the web UI's: whether an encrypted channel's
//! message also goes out plain, what others are told about the user (and,
//! as the same bargain, are told the user), what servers are asked for
//! them, each switch with what it costs said beside it while it is in the
//! position that costs it; and the sites whose links open without being
//! asked about.
//!
//! Left out, because this client has nothing they could change: maps (it
//! draws none and asks no service where anybody is), rich presence (no
//! Discord bridge is built into it), the notepad (it keeps none) and
//! external embeds (the web UI's switch lets watch-together load YouTube's
//! player; this client has no watch-together).

use gpui::{Context, Div, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{Banner, IconButton, Look, Note, PageTitle, SwitchRow, rule};
use crate::theme::Theme;
use crate::words::t;

/// One of the things that can be kept to oneself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::ui) enum Kept {
    Writing,
    Reading,
    Links,
    /// The plain placeholder of an encrypted channel's message.
    DualPath,
    /// Addresses on screen, and the system's notifications.
    Streamer,
}

impl Shell {
    /// `facts` as they may be shown: in streamer mode, an address is
    /// starred out, as the web UI's `maskSensitive` does.
    pub(in crate::ui) fn shown_facts(
        &self,
        facts: &[(SharedString, SharedString)],
    ) -> Vec<(SharedString, SharedString)> {
        facts
            .iter()
            .map(|(name, value)| {
                let masked = self.panels.settings.streamer && name.as_ref() == "Address";
                let value = if masked {
                    SharedString::from("*".repeat(value.chars().count().min(12)))
                } else {
                    value.clone()
                };
                (name.clone(), value)
            })
            .collect()
    }

    /// The devices of an account as they may be shown.
    pub(in crate::ui) fn shown_devices(
        &self,
        devices: &[crate::engine::DeviceFacts],
    ) -> Vec<crate::engine::DeviceFacts> {
        devices
            .iter()
            .map(|device| crate::engine::DeviceFacts {
                facts: self.shown_facts(&device.facts),
                ..device.clone()
            })
            .collect()
    }

    /// Keep something to oneself, or stop.
    fn toggle_kept(&mut self, what: Kept, cx: &mut Context<Self>) {
        let privacy = &mut self.panels.settings.privacy;
        match what {
            Kept::Writing => privacy.hide_writing = !privacy.hide_writing,
            Kept::Reading => privacy.hide_reading = !privacy.hide_reading,
            Kept::Links => privacy.leave_links = !privacy.leave_links,
            Kept::Streamer => {
                let streamer = !self.panels.settings.streamer;
                self.panels.settings.streamer = streamer;
                crate::notify::allow(self.panels.settings.notifications && !streamer);
            }
            Kept::DualPath => {
                let sending = !self.panels.settings.dual_path;
                self.panels.settings.dual_path = sending;
                self.engine.set_dual_path(sending);
            }
        }
        self.remember_settings(cx);
        cx.notify();
    }
}

/// The page.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let privacy = shell.panels.settings.privacy;
    let lit = &shell.panels.settings.lit;
    let switch = |id, title: SharedString, hint: SharedString, on: bool, what: Kept| {
        let lights = lit.lights(&title);
        SwitchRow::new(id, title, on)
            .look(Look::Setting)
            .lit(lights)
            .hint(hint)
            .on_click(cx.listener(move |shell, _, _, cx| shell.toggle_kept(what, cx)))
    };
    let reading = switch(
        "tell-reading",
        t!("Disable read receipts"),
        t!(
            "When enabled, other users will not see that you have read their messages. You will also not see read receipts from others."
        ),
        privacy.hide_reading,
        Kept::Reading,
    );
    let dual = shell.panels.settings.dual_path;
    let dual_path = switch(
        "dual-path",
        t!("Enable dual-path sending"),
        t!(
            "When enabled, encrypted channels also send a plain-text placeholder over the normal message path so legacy clients without E2EE support see \"[Encrypted message]\" instead of nothing. Disable this to keep the ciphertext off the unencrypted path entirely."
        ),
        dual,
        Kept::DualPath,
    )
    .under(
        Banner::new(if dual { Note::Danger } else { Note::Warn })
            .title(if dual {
                t!("E2EE partially bypassed")
            } else {
                t!("Security risk if enabled")
            })
            .child(t!(
                "A plaintext placeholder is sent over the unencrypted message path. Anyone monitoring TCP traffic can see when an encrypted message was sent, even if they cannot read its contents. Only enable this for compatibility with legacy clients that lack E2EE support."
            )),
    );
    let links = switch(
        "look-behind-links",
        t!("Disable link previews"),
        t!(
            "When enabled, the app will not request link metadata from the server. This prevents the server from learning which URLs you share in chat."
        ),
        privacy.leave_links,
        Kept::Links,
    );
    div()
        .child(PageTitle::new(t!("Privacy")))
        .child(dual_path)
        .child(rule(cx))
        .child(if privacy.hide_reading {
            reading
        } else {
            reading.under(
                Banner::new(Note::Warn)
                    .title(t!("Read times are visible to others"))
                    .child(t!(
                        "Other users can see exactly when you opened a message. Enable this toggle to stop broadcasting your read times."
                    )),
            )
        })
        .child(switch(
            "tell-writing",
            t!("Disable typing indicators"),
            t!(
                "When enabled, you will not send typing indicators to others and you will not see when others are typing."
            ),
            privacy.hide_writing,
            Kept::Writing,
        ))
        .child(rule(cx))
        .child(if privacy.leave_links {
            links
        } else {
            links.under(
                Banner::new(Note::Warn)
                    .title(t!("URLs are sent to the server for preview generation"))
                    .child(t!(
                        "Every link you paste in chat is fetched by the server to generate a preview. This lets the server log all URLs you share and may hint at encrypted message content if a URL carries context. Enable this toggle to prevent it."
                    )),
            )
        })
        .child(switch(
            "streamer-mode",
            t!("Streamer mode"),
            t!(
                "Hides identifying information (server host, ports, IP addresses, geolocation) and suppresses native notifications so they cannot leak personal data into a screen recording."
            ),
            shell.panels.settings.streamer,
            Kept::Streamer,
        ))
        .child(rule(cx))
        .child(super::heading(lit, t!("Trusted sites")).hint(t!(
            "A link is asked about before it opens in the browser, and a picture or video from the web before it loads, unless it comes from one of these."
        )))
        .child(trusted_hosts(shell, theme, cx))
}

/// The hosts whose links open without a question, each with the way to
/// stop trusting it.
fn trusted_hosts(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let hosts = &shell.panels.links.trusted;
    if hosts.is_empty() {
        return div()
            .text_size(px(11.5))
            .text_color(theme.c.dim)
            .child(t!("None yet. Trust one from the question a link asks."));
    }
    div()
        .flex()
        .flex_col()
        .gap(px(2.0))
        .children(hosts.iter().enumerate().map(|(at, host)| {
            let distrusted = host.clone();
            div()
                .debug_selector(move || format!("trusted-{at}"))
                .py(px(5.0))
                .flex()
                .items_center()
                .justify_between()
                .text_size(px(12.5))
                .child(SharedString::from(host.clone()))
                .child(
                    IconButton::at("distrust", at, "x")
                        .selector(format!("distrust-{at}"))
                        .size(26.0)
                        .glyph_size(13.0)
                        .tip(t!("Stop trusting this site"))
                        .on_click(cx.listener(move |shell, _, _, cx| {
                            shell.distrust(&distrusted, cx);
                        })),
                )
        }))
}
