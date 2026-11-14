//! The band that says a lost connection is being tried again: when, which
//! attempt, and the two ways out of waiting.

use std::time::{Duration, Instant};

use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::Shell;
use super::kit::{Button, Emphasis, Sheet};
use super::widgets::EMPHASIS;
use crate::engine::Retry;
use crate::theme::Theme;

/// How often the countdown is read again while a retry is waited for.
const TICK: Duration = Duration::from_millis(500);

impl Shell {
    /// Keep the countdown moving for as long as a retry is waited for.
    /// One watcher at a time: it ends itself once there is nothing to
    /// count down to.
    pub(super) fn watch_retry(&mut self, cx: &mut Context<Self>) {
        if self.snapshot.retry.is_none() || self.chrome.retry_watched {
            return;
        }
        self.chrome.retry_watched = true;
        cx.spawn(async move |shell, cx| {
            loop {
                cx.background_executor().timer(TICK).await;
                let waiting = shell.update(cx, |shell, cx| {
                    cx.notify();
                    shell.chrome.retry_watched = shell.snapshot.retry.is_some();
                    shell.chrome.retry_watched
                });
                if !waiting.unwrap_or(false) {
                    break;
                }
            }
        })
        .detach();
    }
}

/// What the band says under its heading: how long until the next attempt,
/// or that it is under way, and which attempt it is.
fn detail(retry: Retry, now: Instant) -> SharedString {
    let left = retry.at.saturating_duration_since(now);
    let state = if left.is_zero() {
        "Waiting to reconnect".to_owned()
    } else {
        // A second that has begun is still to wait: 0.2 s reads as 1.
        format!("Retrying in {}s", left.as_secs_f32().ceil())
    };
    format!("{state} · attempt {}", retry.attempt).into()
}

/// The band, over the foot of the window, while a retry is waited for.
pub(super) fn banner(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<impl IntoElement + use<>> {
    let retry = shell.snapshot.retry?;
    Some(
        div()
            .debug_selector(|| "reconnect".to_owned())
            .absolute()
            .left_0()
            .right_0()
            .bottom(px(92.0))
            .flex()
            .justify_center()
            .child(
                Sheet::new("reconnect")
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(12.0))
                    .px(px(16.0))
                    .py(px(10.0))
                    .child(div().size(px(8.0)).rounded_full().bg(theme.c.warn))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .text_size(px(12.5))
                                    .font_weight(EMPHASIS)
                                    .child("Connection interrupted"),
                            )
                            .child(
                                div()
                                    .text_size(px(10.5))
                                    .text_color(theme.c.muted)
                                    .child(detail(retry, Instant::now())),
                            ),
                    )
                    .child(
                        Button::new("retry-now", "Retry now")
                            .emphasis(Emphasis::Contained)
                            .on_click(cx.listener(|shell, _, _, _| shell.engine.retry_now())),
                    )
                    .child(
                        Button::new("retry-cancel", "Cancel")
                            .on_click(cx.listener(|shell, _, _, _| shell.engine.disconnect())),
                    ),
            ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_band_counts_whole_seconds_down_and_then_says_it_is_waiting() {
        let now = Instant::now();
        let retry = |after: Duration, attempt| Retry {
            attempt,
            at: now + after,
        };
        assert_eq!(
            detail(retry(Duration::from_secs(8), 3), now).as_ref(),
            "Retrying in 8s · attempt 3"
        );
        assert_eq!(
            detail(retry(Duration::from_millis(200), 1), now).as_ref(),
            "Retrying in 1s · attempt 1",
            "a second that has begun is still to wait"
        );
        assert_eq!(
            detail(retry(Duration::ZERO, 2), now + Duration::from_secs(1)).as_ref(),
            "Waiting to reconnect · attempt 2"
        );
    }
}
