//! Toasts: a word at the foot of the window that something was done, gone
//! again by itself. Where the web UI has a snackbar.
//!
//! A refusal that needs an answer stays where it was (the notice by the
//! form it concerns); a toast is for what needs none.

use std::time::Duration;

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::widgets::{EMPHASIS, icon};
use crate::theme::Theme;

/// How long a toast stays, as the web UI's does.
const STAYS: Duration = Duration::from_secs(4);

/// The most shown at once: an older one makes room.
const MOST: usize = 3;

/// What a toast is about, which is its colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    /// Something asked for was done.
    Done,
    /// Something to know, neither good nor bad.
    Told,
}

/// One toast.
#[derive(Debug, Clone)]
struct Toast {
    /// What tells it from the others: counted up.
    id: u64,
    says: SharedString,
    kind: Kind,
}

/// The toasts showing, the newest last.
#[derive(Debug, Default)]
pub(super) struct Toasts {
    showing: Vec<Toast>,
    made: u64,
}

impl Toasts {
    /// What each toast showing says, the newest last.
    #[cfg(test)]
    pub(super) fn said(&self) -> Vec<&str> {
        self.showing
            .iter()
            .map(|toast| toast.says.as_ref())
            .collect()
    }
}

impl Shell {
    /// Say `says` at the foot of the window for a few seconds.
    pub(super) fn toast(
        &mut self,
        says: impl Into<SharedString>,
        kind: Kind,
        cx: &mut Context<Self>,
    ) {
        let toasts = &mut self.chrome.toasts;
        toasts.made += 1;
        let id = toasts.made;
        toasts.showing.push(Toast {
            id,
            says: says.into(),
            kind,
        });
        let over = toasts.showing.len().saturating_sub(MOST);
        drop(toasts.showing.drain(..over));
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(STAYS).await;
            let _ = shell.update(cx, |shell, cx| shell.dismiss_toast(id, cx));
        })
        .detach();
        cx.notify();
    }

    /// Take the toast `id` away, if it is still there.
    fn dismiss_toast(&mut self, id: u64, cx: &mut Context<Self>) {
        let showing = &mut self.chrome.toasts.showing;
        let before = showing.len();
        showing.retain(|toast| toast.id != id);
        if showing.len() != before {
            cx.notify();
        }
    }
}

/// The toasts, stacked over the foot of the window, in the middle.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<impl IntoElement + use<>> {
    let showing = &shell.chrome.toasts.showing;
    if showing.is_empty() {
        return None;
    }
    Some(
        div()
            .absolute()
            .left_0()
            .right_0()
            .bottom(px(24.0))
            .flex()
            .flex_col()
            .items_center()
            .gap(px(8.0))
            .children(showing.iter().map(|toast| one(toast, theme, cx))),
    )
}

/// One toast: a filled pill in the colour of what it is about, with the
/// way to send it off early.
fn one(toast: &Toast, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let (ground, glyph) = match toast.kind {
        Kind::Done => (theme.c.ok, "check"),
        Kind::Told => (theme.c.accent, "info"),
    };
    // Dark ink on the filled ground, as the theme's accent carries.
    let ink = theme.c.on_accent;
    let id = toast.id;
    div()
        .id(("toast", usize::try_from(id).unwrap_or(usize::MAX)))
        .debug_selector(|| "toast".to_owned())
        .occlude()
        .flex()
        .items_center()
        .gap(px(10.0))
        .pl(px(14.0))
        .pr(px(8.0))
        .py(px(8.0))
        .max_w(px(520.0))
        .rounded(theme.skin.radius_md)
        .bg(ground)
        .text_color(ink)
        .text_size(px(13.0))
        .font_weight(EMPHASIS)
        .shadow(theme.c.shadow.cast())
        .child(icon(glyph, 15.0, ink))
        .child(div().min_w_0().child(toast.says.clone()))
        .child(
            div()
                .id(("toast-close", usize::try_from(id).unwrap_or(usize::MAX)))
                .debug_selector(|| "toast-close".to_owned())
                .p(px(4.0))
                .rounded(theme.skin.radius_sm)
                .cursor_pointer()
                .hover(|style| style.opacity(0.7))
                .on_click(cx.listener(move |shell, _, _, cx| shell.dismiss_toast(id, cx)))
                .child(icon("x", 13.0, ink)),
        )
        .into_any_element()
}
