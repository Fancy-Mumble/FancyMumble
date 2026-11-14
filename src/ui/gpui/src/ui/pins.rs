//! What is pinned in the conversation on screen: a list under the pin in
//! its header, the pin put on last first. A click on one goes to its
//! message; its corner takes the pin off.

use std::time::Duration;

use gpui::{
    AnyElement, Context, IntoElement, ListOffset, ParentElement, SharedString, Styled, div,
    prelude::*, px,
};

use super::Shell;
use super::conversation::Row;
use super::kit::{IconButton, Sheet};
use super::widgets::EMPHASIS;
use crate::engine::{Action, Conversation, Pin};
use crate::theme::Theme;

/// How long a message stands out after it was gone to.
const FLASH: Duration = Duration::from_millis(1600);

/// How many messages more than the one gone to are shown with it, so that
/// it is not the first on screen.
const AROUND: usize = 8;

impl Shell {
    /// Show the list of what is pinned, or put it away.
    pub(super) fn toggle_pins(&mut self, cx: &mut Context<Self>) {
        self.pins_open = !self.pins_open;
        cx.notify();
    }

    /// Go to the message `id` of the open conversation and have it stand
    /// out for a moment. `from_newest` is how far back it is, where that
    /// is known: further back than what is shown, more is shown first.
    /// Says whether it was found.
    pub(super) fn jump_to(
        &mut self,
        id: &SharedString,
        from_newest: Option<usize>,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.place_of(id).is_none()
            && let Some(back) = from_newest
        {
            self.window = self.window.max(back + AROUND);
            self.reload_messages(cx);
        }
        let row = self.place_of(id).and_then(|index| {
            self.row_model
                .iter()
                .position(|row| matches!(row, Row::Message(at) if *at == index))
        });
        let Some(row) = row else {
            return false;
        };
        // The reader is where they asked to be, not at the newest message.
        self.at_tail.set(false);
        self.rows.scroll_to(ListOffset {
            item_ix: row.saturating_sub(1),
            offset_in_item: px(0.0),
        });
        self.seen.flashed = Some(id.clone());
        let flashed = id.clone();
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(FLASH).await;
            let _ = shell.update(cx, |shell, cx| {
                // Unless another has been gone to since.
                if shell.seen.flashed.as_ref() == Some(&flashed) {
                    shell.seen.flashed = None;
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
        true
    }

    /// A pin of the list was clicked: go to its message, and put the list
    /// away once there.
    fn open_pin(&mut self, pin: &Pin, cx: &mut Context<Self>) {
        let back = pin.said.as_ref().map(|said| said.from_newest);
        if self.jump_to(&pin.id, back, cx) {
            self.pins_open = false;
        }
    }

    /// Take the pin off the message `id`.
    fn unpin(&mut self, id: &SharedString) {
        if let Some(Conversation::Channel(channel)) = self.open {
            self.engine.act(Action::Pin {
                channel,
                id: id.to_string(),
                pinned: false,
            });
        }
    }
}

/// How long ago `at_ms` was, in a word or two. `now_ms` is the time it is.
pub(super) fn age(at_ms: u64, now_ms: u64) -> String {
    const MINUTE: u64 = 60_000;
    let ago = now_ms.saturating_sub(at_ms);
    match ago / MINUTE {
        0 => "just now".to_owned(),
        minutes @ 1..60 => format!("{minutes} min ago"),
        minutes @ 60..1440 => format!("{} h ago", minutes / 60),
        minutes => format!("{} d ago", minutes / 1440),
    }
}

/// The list, hung under the header's pin, while it is open.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<impl IntoElement + use<>> {
    if !shell.pins_open {
        return None;
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        });
    let head = div()
        .flex()
        .items_center()
        .justify_between()
        .pl(px(14.0))
        .pr(px(6.0))
        .h(px(40.0))
        .border_b_1()
        .border_color(theme.c.line)
        .child(
            div()
                .text_size(px(12.5))
                .font_weight(EMPHASIS)
                .child("Pinned messages"),
        )
        .child(
            IconButton::new("pins-close", "x")
                .tip("Close pinned messages")
                .on_click(cx.listener(|shell, _, _, cx| shell.toggle_pins(cx))),
        );
    let body = if shell.pins.is_empty() {
        nothing_pinned(theme).into_any_element()
    } else {
        div()
            .id("pins-list")
            .p(px(6.0))
            .max_h(px(420.0))
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(2.0))
            .children(
                shell
                    .pins
                    .iter()
                    .enumerate()
                    .map(|(at, pin)| pin_row(pin, at, now_ms, theme, cx)),
            )
            .into_any_element()
    };
    // The sheet is the list; what holds it is what knows where it hangs
    // and when a press landed outside it.
    Some(
        div()
            .id("pins-panel")
            .debug_selector(|| "pins-panel".to_owned())
            .absolute()
            .top(px(8.0))
            .right(px(52.0))
            .w(px(360.0))
            .on_mouse_down_out(cx.listener(|shell, _, _, cx| {
                shell.pins_open = false;
                cx.notify();
            }))
            .child(
                Sheet::new("pins-sheet")
                    .flex()
                    .flex_col()
                    .child(head)
                    .child(body),
            ),
    )
}

/// What the list says when it has nothing to list.
fn nothing_pinned(theme: &Theme) -> impl IntoElement + use<> {
    div()
        .px(px(18.0))
        .py(px(26.0))
        .flex()
        .flex_col()
        .items_center()
        .gap(px(4.0))
        .child(
            div()
                .text_size(px(12.5))
                .font_weight(EMPHASIS)
                .child("No pinned messages in this channel."),
        )
        .child(
            div()
                .text_size(px(11.5))
                .text_color(theme.c.muted)
                .child("Right-click any message and choose Pin to keep it here."),
        )
}

/// One pin: who said it and how long ago, the start of what they said,
/// and who pinned it where that was somebody else.
fn pin_row(
    pin: &Pin,
    at: usize,
    now_ms: u64,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let hover = theme.c.hover;
    let (who, when, what) = match &pin.said {
        Some(said) => (
            said.sender_name.clone(),
            said.sent_at_ms.or(pin.at_ms),
            said.text.clone(),
        ),
        // Pinned, and further back than what has been fetched.
        None => (
            SharedString::from("An earlier message"),
            pin.at_ms,
            SharedString::from("Not loaded yet: it is further back than what has been read."),
        ),
    };
    // Named only when it was somebody else's doing.
    let pinner = pin.by.clone().filter(|by| *by != who);
    let (opened, unpinned) = (pin.clone(), pin.id.clone());
    div()
        .id(("pin", at))
        .debug_selector(move || format!("pin-{at}"))
        .relative()
        .px(px(10.0))
        .py(px(8.0))
        .rounded(theme.skin.radius_md)
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .on_click(cx.listener(move |shell, _, _, cx| shell.open_pin(&opened, cx)))
        .flex()
        .flex_col()
        .gap(px(2.0))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.0))
                .pr(px(28.0))
                .child(div().text_size(px(12.0)).font_weight(EMPHASIS).child(who))
                .children(when.map(|when| {
                    div()
                        .text_size(px(10.5))
                        .text_color(theme.c.dim)
                        .child(SharedString::from(age(when, now_ms)))
                })),
        )
        .child(
            div()
                .text_size(px(12.0))
                .text_color(theme.c.muted)
                .line_clamp(2)
                .child(what),
        )
        .children(pinner.map(|by| {
            div()
                .text_size(px(10.5))
                .text_color(theme.c.dim)
                .child(SharedString::from(format!("pinned by {by}")))
        }))
        .child(
            div().absolute().top(px(4.0)).right(px(4.0)).child(
                IconButton::at("unpin", at, "x")
                    .selector(format!("unpin-{at}"))
                    .size(22.0)
                    .glyph_size(11.0)
                    .tip("Unpin")
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        cx.stop_propagation();
                        shell.unpin(&unpinned);
                    })),
            ),
        )
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::age;

    #[test]
    fn an_age_is_said_in_the_largest_unit_that_has_passed() {
        const MINUTE: u64 = 60_000;
        let now = 10 * 24 * 60 * MINUTE;
        assert_eq!(age(now, now), "just now");
        assert_eq!(age(now - 59 * MINUTE, now), "59 min ago");
        assert_eq!(age(now - 60 * MINUTE, now), "1 h ago");
        assert_eq!(age(now - 23 * 60 * MINUTE, now), "23 h ago");
        assert_eq!(age(now - 3 * 24 * 60 * MINUTE, now), "3 d ago");
        // A clock that is behind the server's does not make it the future.
        assert_eq!(age(now + MINUTE, now), "just now");
    }
}
