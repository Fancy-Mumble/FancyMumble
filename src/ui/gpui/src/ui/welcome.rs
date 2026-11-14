//! The server's welcome message: read once per message, shown in a dialog
//! when a connection is made, as the web client shows it
//! (`WelcomeMessageModal`): a title, the message scrolling under it, and a
//! button that closes it.
//!
//! The web client shows a message once per server and text by default,
//! and remembers that across launches; this remembers it for as long as
//! the program runs. What was read is let go of once the dialog is closed;
//! the server's details read it again if they are opened.

use std::collections::HashSet;
use std::hash::{Hash as _, Hasher as _};
use std::sync::Arc;

use gpui::{
    Context, IntoElement, ParentElement, SharedString, Styled, Window, div, prelude::*, px,
    relative,
};

use super::Shell;
use super::kit::{Button, Dialog, Emphasis, PageView, Surface};
use crate::page::Page;
use crate::theme::Theme;
use crate::words::t;

/// The welcome message as this view holds it.
#[derive(Debug, Default)]
pub(super) struct Welcome {
    /// Which server's message is on screen, and which message, as a
    /// fingerprint of its text.
    of: Option<(SharedString, u64)>,
    /// The message read, while it may be shown.
    page: Option<Arc<Page>>,
    /// The servers and messages shown in this run of the program.
    seen: HashSet<(SharedString, u64)>,
}

/// A fingerprint of `html`, to tell one message from another without
/// keeping a second copy of it.
fn fingerprint(html: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    html.hash(&mut hasher);
    hasher.finish()
}

impl Shell {
    /// The server on screen, as the welcome it showed is remembered by.
    fn welcome_server(&self) -> SharedString {
        self.active_session.clone().unwrap_or_default()
    }

    /// Read the server's welcome message, if it is not the one already
    /// read, and has not been shown for this server in this run.
    pub(super) fn read_welcome(&mut self, cx: &mut Context<Self>) {
        let Some(html) = self
            .snapshot
            .welcome
            .clone()
            .filter(|html| !html.trim().is_empty())
        else {
            self.welcome.of = None;
            self.welcome.page = None;
            return;
        };
        let of = (self.welcome_server(), fingerprint(&html));
        if self.welcome.of.as_ref() == Some(&of) {
            return;
        }
        self.welcome.of = Some(of.clone());
        self.welcome.page = None;
        // As the user asked it to be shown (Settings, Notifications).
        if !self.welcome_wanted(of.1)
            || (self.welcome.seen.contains(&of) && !self.welcome_always())
        {
            return;
        }
        self.read_page(html, cx, move |shell, page, _| {
            // Still the message on screen, once it is read.
            if shell.welcome.of.as_ref() == Some(&of) {
                shell.welcome.page = Some(page);
            }
        });
    }

    /// The welcome of the server the view opens on. The real engine's
    /// connection was made by this run of the program, often before the
    /// view's first frame: its welcome has not been seen, and is shown. A
    /// made-up engine, which keeps nothing, starts on a server nobody just
    /// arrived at.
    pub(super) fn begin_welcome(&mut self, cx: &mut Context<Self>) {
        if self.store.is_some() {
            self.read_welcome(cx);
        } else {
            self.pass_welcome();
        }
    }

    /// The welcome of a server the view opened on, rather than arrived at:
    /// it was shown when the connection was made, so it is not again.
    fn pass_welcome(&mut self) {
        self.welcome_dismissed = true;
        self.welcome.page = None;
        if let Some(html) = self.snapshot.welcome.as_ref() {
            let of = (self.welcome_server(), fingerprint(html));
            self.welcome.of = Some(of.clone());
            let _ = self.welcome.seen.insert(of);
        }
    }

    /// Show the welcome again, as if the connection had just been made.
    pub(super) fn show_welcome_again(&mut self, cx: &mut Context<Self>) {
        if let Some(of) = self.welcome.of.take() {
            let _ = self.welcome.seen.remove(&of);
        }
        self.welcome_dismissed = false;
        self.read_welcome(cx);
        cx.notify();
    }

    /// The welcome message, while it is to be shown: read, with something
    /// in it, not yet closed on this connection.
    pub(super) fn welcome_to_show(&self) -> Option<Arc<Page>> {
        self.welcome
            .page
            .as_ref()
            .filter(|page| !self.welcome_dismissed && !page.is_empty())
            .map(Arc::clone)
    }

    /// Close the welcome: it is not shown again for this server and this
    /// message while the program runs, and what was read of it is let go.
    pub(super) fn close_welcome(&mut self, cx: &mut Context<Self>) {
        self.welcome_dismissed = true;
        if let Some(of) = self.welcome.of.clone() {
            self.welcome_closed(of.1, cx);
            let _ = self.welcome.seen.insert(of);
        }
        self.welcome.page = None;
        crate::trim::soon(cx);
        cx.notify();
    }
}

/// The measures of the web client's welcome dialog
/// (`WelcomeMessageModal.module.css`): 520 wide, at most four fifths of the
/// window tall, the message at 13.5 on lines of 1.55 in the secondary ink.
const WIDE: f32 = 520.0;
const TEXT: f32 = 13.5;
const LEAD: f32 = 1.55;
/// Its links' ink: `var(--accent, #2aabee)`, a variable no Nebula theme
/// sets, so every theme shows this blue.
const LINK: gpui::Rgba = gpui::Rgba {
    r: 0x2a as f32 / 255.0,
    g: 0xab as f32 / 255.0,
    b: 0xee as f32 / 255.0,
    a: 1.0,
};

/// The welcome dialog, while there is a welcome to show.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    window: &Window,
    cx: &mut Context<Shell>,
) -> Option<impl IntoElement + use<>> {
    let page = shell.welcome_to_show()?;
    let viewer = cx.weak_entity();
    let surface = Surface {
        link: LINK.into(),
        ..Surface::text(TEXT, LEAD, theme).inked(theme.c.muted)
    };
    let tallest = window.viewport_size().height * 0.8;
    Some(
        Dialog::new("welcome")
            .title(t!("Welcome"))
            .w(px(WIDE))
            .max_w(relative(0.92))
            .max_h(tallest)
            .p(px(24.0))
            .gap(px(14.0))
            .on_dismiss(cx.listener(|shell, _, _, cx| shell.close_welcome(cx)))
            .child(
                div()
                    .id("welcome-body")
                    .debug_selector(|| "welcome-body".to_owned())
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(
                        PageView::new("welcome", page, surface).on_link(move |url, _, cx| {
                            let _ = viewer.update(cx, |shell, cx| shell.follow_link(url, cx));
                        }),
                    ),
            )
            .child(
                div().flex_none().flex().justify_end().child(
                    Button::new("dismiss-welcome", t!("Close"))
                        .emphasis(Emphasis::Contained)
                        .on_click(cx.listener(|shell, _, _, cx| shell.close_welcome(cx))),
                ),
            ),
    )
}
