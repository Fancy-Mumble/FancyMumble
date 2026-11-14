//! Leaving for the web: a link in a message is asked about before it is
//! handed to the browser, unless its host has been trusted.
//!
//! A message can print one address and lead to another, and a shortened
//! one prints less than it leads to. The question shows where the link
//! really goes, in full.

use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::Shell;
use super::kit::{Button, Dialog, Emphasis, SwitchRow};
use crate::theme::Theme;

/// A link waiting to be let through.
#[derive(Debug, Clone)]
pub(super) struct Asking {
    /// Where it leads, in full.
    url: SharedString,
    /// The host it is on, if it has one that can be trusted from now on.
    host: Option<String>,
    /// Whether that host is to be trusted from now on.
    trust: bool,
}

/// The links let through without asking, and the one being asked about.
#[derive(Debug, Default)]
pub(super) struct Guard {
    /// Hosts whose links open without a question, in lower case.
    pub(super) trusted: Vec<String>,
    asking: Option<Asking>,
}

impl Guard {
    /// Starting with the hosts trusted before.
    pub(super) fn trusting(hosts: Vec<String>) -> Self {
        Self {
            trusted: hosts,
            asking: None,
        }
    }

    /// The address being asked about.
    #[cfg(test)]
    pub(super) fn asked(&self) -> Option<&str> {
        self.asking.as_ref().map(|asking| asking.url.as_ref())
    }
}

/// The host of the web address `url`, in lower case: what trust is given
/// to. Who it signs in as and its port are no part of that.
pub(super) fn host_of(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    // What comes before an `@` is a name to sign in with, and is how an
    // address is made to look like another: `https://bank.example@evil.example`.
    let host = authority.rsplit('@').next()?;
    let host = host.split(':').next()?.to_ascii_lowercase();
    (!host.is_empty()).then_some(host)
}

impl Shell {
    /// A link was clicked: open it if its host is trusted, else ask first.
    pub(super) fn follow_link(&mut self, url: SharedString, cx: &mut Context<Self>) {
        let host = host_of(&url);
        let guard = &mut self.panels.links;
        let trusted = host
            .as_ref()
            .is_some_and(|host| guard.trusted.contains(host));
        if trusted {
            cx.open_url(&url);
            return;
        }
        guard.asking = Some(Asking {
            url,
            host,
            trust: false,
        });
        cx.notify();
    }

    /// Open the link asked about, trusting its host from now on if that
    /// was asked for.
    fn open_asked_link(&mut self, cx: &mut Context<Self>) {
        let Some(asking) = self.panels.links.asking.take() else {
            return;
        };
        if let Some(host) = asking.host.filter(|_| asking.trust) {
            self.panels.links.trusted.push(host);
            self.remember_settings(cx);
        }
        cx.open_url(&asking.url);
        cx.notify();
    }

    /// Stop trusting `host`: its links are asked about again.
    pub(super) fn distrust(&mut self, host: &str, cx: &mut Context<Self>) {
        self.panels.links.trusted.retain(|known| known != host);
        self.remember_settings(cx);
        cx.notify();
    }
}

/// The question, over everything else, while a link waits.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<impl IntoElement + use<>> {
    let asking = shell.panels.links.asking.as_ref()?;
    let trust = asking.trust;
    Some(
        Dialog::new("link-warning")
            .title("Leaving Fancy Mumble")
            .w(px(440.0))
            .p(px(22.0))
            .gap(px(12.0))
            .on_dismiss(cx.listener(|shell, _, _, cx| {
                shell.panels.links.asking = None;
                cx.notify();
            }))
            .child(div().text_size(px(12.5)).text_color(theme.c.muted).child(
                "This link opens in your browser. Fancy Mumble can't vouch for where it goes.",
            ))
            .child(
                div()
                    .debug_selector(|| "link-warning-url".to_owned())
                    .px(px(10.0))
                    .py(px(8.0))
                    .rounded(theme.skin.radius_sm)
                    .bg(theme.c.card2)
                    .border_1()
                    .border_color(theme.c.line)
                    .font_family(theme.skin.mono.clone())
                    .text_size(px(12.0))
                    .child(asking.url.clone()),
            )
            .children(asking.host.as_ref().map(|host| {
                SwitchRow::new("link-trust", format!("Trust {host}"), trust).on_click(cx.listener(
                    |shell, _, _, cx| {
                        if let Some(asking) = shell.panels.links.asking.as_mut() {
                            asking.trust = !asking.trust;
                        }
                        cx.notify();
                    },
                ))
            }))
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap(px(8.0))
                    .child(Button::new("link-cancel", "Cancel").on_click(cx.listener(
                        |shell, _, _, cx| {
                            shell.panels.links.asking = None;
                            cx.notify();
                        },
                    )))
                    .child(
                        Button::new("link-open", "Open link")
                            .emphasis(Emphasis::Contained)
                            .on_click(cx.listener(|shell, _, _, cx| shell.open_asked_link(cx))),
                    ),
            ),
    )
}

#[cfg(test)]
mod tests {
    use super::host_of;

    #[test]
    fn trust_is_given_to_the_host_a_link_really_goes_to() {
        assert_eq!(
            host_of("https://Example.org/a?b=1").as_deref(),
            Some("example.org")
        );
        assert_eq!(
            host_of("http://example.org:8080").as_deref(),
            Some("example.org")
        );
        // Dressed up as another: what is before the `@` is not where it goes.
        assert_eq!(
            host_of("https://bank.example@evil.example/login").as_deref(),
            Some("evil.example")
        );
        assert_eq!(
            host_of("https://bank.example:pw@evil.example:444/x").as_deref(),
            Some("evil.example")
        );
        // Not the web: nothing to trust by host.
        assert_eq!(host_of("mailto:a@example.org"), None);
        assert_eq!(host_of("mumble://example.org"), None);
        assert_eq!(host_of("https://"), None);
    }
}
