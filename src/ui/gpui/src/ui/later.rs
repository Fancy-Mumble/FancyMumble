//! Messages the server is to send later: asking for one, and the list of
//! those still waiting, each of which can be called off.

use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::Shell;
use super::kit::{Button, Dialog, IconButton, Tone};
use super::widgets::{EMPHASIS, Zone};
use crate::engine::{Action, ChannelId, Scheduled};
use crate::rich::Rich;
use crate::theme::Theme;

/// The open list.
#[derive(Default)]
pub(super) struct Panel {
    /// What waits, as the server last said; `None` until it has.
    pub waiting: Option<Vec<Scheduled>>,
}

/// When `answer` means, in Unix epoch milliseconds, seen from `now_ms` on
/// `zone`: a time of day (`18:30`, today or else tomorrow) or a wait
/// (`15m`, `2h`, `1d`). `None` for anything else, and for no wait at all.
pub(super) fn when(answer: &str, now_ms: u64, zone: Zone) -> Option<u64> {
    let answer = answer.trim().to_lowercase();
    if let Some((hours, minutes)) = answer.split_once(':') {
        let hours: i64 = hours
            .trim()
            .parse()
            .ok()
            .filter(|hours| (0..24).contains(hours))?;
        let minutes: i64 = minutes
            .trim()
            .parse()
            .ok()
            .filter(|minutes| (0..60).contains(minutes))?;
        let now = zone.wall_seconds(now_ms);
        let wanted = hours * 3600 + minutes * 60;
        // Already past today: tomorrow.
        let ahead = (wanted - now.rem_euclid(86_400)).rem_euclid(86_400);
        let ahead = if ahead == 0 { 86_400 } else { ahead };
        return Some(now_ms + u64::try_from(ahead).ok()? * 1000);
    }
    let digits = answer.trim_end_matches(|c: char| c.is_alphabetic() || c == ' ');
    let unit = answer[digits.len()..].trim();
    let seconds_each = match unit {
        "m" | "min" | "mins" | "minute" | "minutes" => 60,
        "h" | "hr" | "hour" | "hours" => 3600,
        "d" | "day" | "days" => 86_400,
        _ => return None,
    };
    let count: u64 = digits.trim().parse().ok().filter(|count| *count > 0)?;
    Some(now_ms + count.checked_mul(seconds_each)?.checked_mul(1000)?)
}

/// `at_ms` as a day and a time on the local clock.
fn said_when(at_ms: u64) -> String {
    use chrono::TimeZone;

    i64::try_from(at_ms)
        .ok()
        .and_then(|at| chrono::Local.timestamp_millis_opt(at).single())
        .map_or_else(String::new, |at| at.format("%a, %b %-d, %H:%M").to_string())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| {
            u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
        })
}

impl Shell {
    /// Open the list of what waits, asking the server for it.
    pub(super) fn open_later(&mut self, cx: &mut Context<Self>) {
        self.panels.later = Some(Panel::default());
        self.engine.request_scheduled();
        cx.notify();
    }

    /// Have the server send what is in the composer to `channel` at the
    /// time `answer` names. Says whether that was understood: an answer
    /// that names no time changes nothing, so it can be put right.
    pub(super) fn send_later(
        &mut self,
        channel: ChannelId,
        answer: &str,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(at_ms) = when(answer, now_ms(), self.zone) else {
            return false;
        };
        let body = self.composer.read(cx).text().trim().to_owned();
        if body.is_empty() {
            self.notice = Some("Write the message first, then say when to send it.".into());
            return true;
        }
        self.engine.act(Action::SendLater {
            channel,
            body,
            at_ms,
        });
        self.composer.update(cx, |composer, _| composer.clear());
        true
    }

    /// The server said what waits.
    pub(super) fn take_scheduled(&mut self, waiting: Vec<Scheduled>) {
        if let Some(panel) = self.panels.later.as_mut() {
            panel.waiting = Some(waiting);
        }
    }

    /// The server took a message to send later, or a cancellation.
    pub(super) fn schedule_taken(&mut self) {
        // The list as the server has it now.
        if self.panels.later.is_some() {
            self.engine.request_scheduled();
        }
    }

    fn call_off(&mut self, id: &SharedString, cx: &mut Context<Self>) {
        self.engine.act(Action::CancelScheduled(id.clone()));
        // Gone from the list at once; the server's answer confirms it.
        if let Some(waiting) = self
            .panels
            .later
            .as_mut()
            .and_then(|panel| panel.waiting.as_mut())
        {
            waiting.retain(|message| message.id != *id);
        }
        cx.notify();
    }
}

/// The list, over a veil.
pub(super) fn render(
    shell: &Shell,
    panel: &Panel,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let body = match &panel.waiting {
        None => div()
            .text_color(theme.c.muted)
            .child("Asking the server…")
            .into_any_element(),
        Some(waiting) if waiting.is_empty() => div()
            .debug_selector(|| "later-none".to_owned())
            .text_color(theme.c.muted)
            .child("Nothing is waiting to be sent.")
            .into_any_element(),
        Some(waiting) => div()
            .flex()
            .flex_col()
            .gap(px(4.0))
            .children(
                waiting
                    .iter()
                    .enumerate()
                    .map(|(at, message)| row(shell, at, message, theme, cx)),
            )
            .into_any_element(),
    };
    Dialog::new("later")
        .title("Messages to send later")
        .w(px(480.0))
        .max_h(px(520.0))
        .scrolls()
        .gap(px(14.0))
        .p(px(22.0))
        .child(body)
        .child(
            div()
                .flex()
                .justify_end()
                .child(Button::new("later-close", "Close").on_click(cx.listener(
                    |shell, _, _, cx| {
                        shell.panels.later = None;
                        cx.notify();
                    },
                ))),
        )
}

/// One waiting message: how it starts, where it goes and when, and the way
/// to call it off.
fn row(
    shell: &Shell,
    at: usize,
    message: &Scheduled,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let text = Rich::parse(&message.html).text;
    let first_line = text.lines().next().unwrap_or_default().to_owned();
    let places: Vec<String> = message
        .channels
        .iter()
        .map(|id| {
            shell
                .snapshot
                .channels
                .iter()
                .find(|channel| channel.id == *id)
                .map_or_else(|| format!("#{id}"), |channel| format!("#{}", channel.name))
        })
        .collect();
    let id = message.id.clone();
    div()
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(12.0))
        .py(px(8.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.card)
        .border_1()
        .border_color(theme.c.line)
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(div().truncate().font_weight(EMPHASIS).child(first_line))
                .child(
                    div()
                        .truncate()
                        .text_size(px(11.5))
                        .text_color(theme.c.muted)
                        .child(format!(
                            "{} · {}",
                            places.join(", "),
                            said_when(message.at_ms)
                        )),
                ),
        )
        .child(
            IconButton::at("later-cancel", at, "trash-2")
                .tone(Tone::Danger)
                .on_click(cx.listener(move |shell, _, _, cx| shell.call_off(&id, cx))),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 21:37 UTC.
    const NOW: u64 = 1_760_045_820_000;
    const MINUTE: u64 = 60_000;

    #[test]
    fn a_wait_is_counted_from_now() {
        let utc = Zone::Fixed(0);
        assert_eq!(when("15m", NOW, utc), Some(NOW + 15 * MINUTE));
        assert_eq!(when(" 2 h ", NOW, utc), Some(NOW + 120 * MINUTE));
        assert_eq!(when("1 day", NOW, utc), Some(NOW + 24 * 60 * MINUTE));
        assert_eq!(when("0m", NOW, utc), None, "no wait is no answer");
        assert_eq!(when("soon", NOW, utc), None);
        assert_eq!(when("", NOW, utc), None);
        assert_eq!(when("15", NOW, utc), None, "fifteen what?");
    }

    #[test]
    fn a_time_of_day_is_today_or_else_tomorrow_on_the_local_clock() {
        let utc = Zone::Fixed(0);
        assert_eq!(when("22:00", NOW, utc), Some(NOW + 23 * MINUTE));
        // Already past: tomorrow's.
        assert_eq!(when("21:00", NOW, utc), Some(NOW + (24 * 60 - 37) * MINUTE));
        // The same minute is a day away, not now.
        assert_eq!(when("21:37", NOW, utc), Some(NOW + 24 * 60 * MINUTE));
        // An hour east it is 22:37 already.
        assert_eq!(
            when("23:00", NOW, Zone::Fixed(3600)),
            Some(NOW + 23 * MINUTE)
        );
        assert_eq!(when("24:00", NOW, utc), None);
        assert_eq!(when("9:75", NOW, utc), None);
    }
}
