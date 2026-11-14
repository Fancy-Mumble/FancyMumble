//! Reading a page a server wrote (`crate::page`) for the view: where it is
//! asked for if it is small, on another thread if it may take longer than a
//! frame.

use std::sync::Arc;

use gpui::{AnyElement, AppContext as _, Context, IntoElement, ParentElement, Styled, div};

use super::kit::{PageView, Surface};
use super::{Shell, Subject};
use crate::page::Page;
use crate::theme::Theme;
use crate::words::t;

/// The largest document read where it is asked for. A larger one carries
/// pictures, and reading them can take longer than a frame.
const READ_HERE_MOST: usize = 16 << 10;

impl Shell {
    /// Read `html`, and hand the page to `then` once it is read: at once
    /// if it is small, else when another thread has read it.
    pub(super) fn read_page(
        &mut self,
        html: gpui::SharedString,
        cx: &mut Context<Self>,
        then: impl FnOnce(&mut Self, Arc<Page>, &mut Context<Self>) + 'static,
    ) {
        if html.len() <= READ_HERE_MOST {
            then(self, Arc::new(Page::read(&html)), cx);
            return;
        }
        let reading = cx.background_spawn(async move { Page::read(&html) });
        cx.spawn(async move |shell, cx| {
            let page = Arc::new(reading.await);
            let _ = shell.update(cx, |shell, cx| {
                then(shell, page, cx);
                cx.notify();
            });
        })
        .detach();
    }
}

/// A channel's description or the server's welcome, on the card that
/// describes it, in the measures the web client gives each there: the
/// welcome at 12.5 on lines of 1.5 (`ServerInfoPanel`), a description at
/// 12 on lines of 1.6 in the secondary ink (`ChannelInfoSheet`).
pub(super) fn about(
    subject: Subject,
    page: &Arc<Page>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    if page.is_empty() {
        return div()
            .text_color(theme.c.muted)
            .child(t!("Nothing has been written here."))
            .into_any_element();
    }
    let surface = match subject {
        Subject::Channel(_) => Surface::text(12.0, 1.6, theme).inked(theme.c.muted),
        _ => Surface::text(12.5, 1.5, theme),
    };
    let viewer = cx.weak_entity();
    PageView::new("about", Arc::clone(page), surface)
        .on_link(move |url, _, cx| {
            let _ = viewer.update(cx, |shell, cx| shell.follow_link(url, cx));
        })
        .into_any_element()
}
