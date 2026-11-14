//! The strip the composer shows in place of its field while a voice
//! message is recorded: throw it away, a dot that says it is recording,
//! the time against the server's limit, and the level as it comes in.
//! The web UI's `VoiceRecorderBar`; sending is the composer's own button.

use std::rc::Rc;

use gpui::{
    App, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div, prelude::*, px,
};

use super::Tone;
use super::button::{Corner, IconButton};
use super::waveform::{Keep, Waveform};
use crate::theme::ActiveTheme;

type Pressed = Rc<dyn Fn(&mut Window, &mut App)>;

/// How the take stands.
#[derive(Debug, Clone, Default)]
pub(crate) struct TakeShown {
    pub elapsed_ms: u32,
    /// The server's limit, 0 for none.
    pub limit_ms: u32,
    /// The latest levels, 0 to 1, oldest first.
    pub levels: Vec<f32>,
    /// What it says after the level, where it says anything: that the
    /// limit was reached, or that it is being sent.
    pub said: Option<SharedString>,
}

/// The recording strip.
///
/// ```ignore
/// TakeBar::new(shown, discard_words).on_discard(...)
/// ```
#[derive(IntoElement)]
pub(crate) struct TakeBar {
    shown: TakeShown,
    /// The words of the discard button.
    discard: SharedString,
    on_discard: Option<Pressed>,
}

impl TakeBar {
    pub(crate) fn new(shown: TakeShown, discard: SharedString) -> Self {
        Self {
            shown,
            discard,
            on_discard: None,
        }
    }

    /// Throw the take away. Without it the button is shown faded: the take
    /// is on its way.
    pub(crate) fn on_discard(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_discard = Some(Rc::new(handler));
        self
    }
}

/// Bars the level is drawn with: the newest at the send end.
pub(crate) const LIVE_BARS: usize = 32;

/// A level as the height of its bar: quiet speech still shows.
fn bar_of(level: f32) -> f32 {
    (level.max(0.0).sqrt() * 1.8).min(1.0)
}

impl RenderOnce for TakeBar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let TakeShown {
            elapsed_ms,
            limit_ms,
            levels,
            said,
        } = self.shown;
        // Right-aligned and padded, so the strip does not grow as the take
        // does.
        let mut heights = vec![0.0; LIVE_BARS.saturating_sub(levels.len())];
        heights.extend(
            levels
                .iter()
                .rev()
                .take(LIVE_BARS)
                .rev()
                .map(|level| bar_of(*level)),
        );
        let time = match limit_ms {
            0 => crate::voice::clock(elapsed_ms),
            limit => format!(
                "{} / {}",
                crate::voice::clock(elapsed_ms),
                crate::voice::clock(limit)
            ),
        };
        // It beats while recording, and is still once nothing more comes.
        let beat = if said.is_some() {
            0.5
        } else {
            let turn = f64::from(elapsed_ms % 1200) / 1200.0 * std::f64::consts::TAU;
            (0.625 + 0.375 * turn.cos()) as f32
        };
        let discard = IconButton::new("voice-discard", "trash-2")
            .size(32.0)
            .glyph_size(16.0)
            .corner(Corner::Pill)
            .tone(Tone::Muted)
            .tip(self.discard)
            .faded(self.on_discard.is_none())
            .when_some(self.on_discard, |button, discard| {
                button.on_click(move |_, window, cx| discard(window, cx))
            });
        div()
            .debug_selector(|| "voice-take".to_owned())
            .flex_1()
            .min_w_0()
            .flex()
            .items_center()
            .gap(px(10.0))
            .px(px(4.0))
            .child(discard)
            .child(
                div()
                    .flex_none()
                    .size(px(10.0))
                    .rounded_full()
                    .bg(theme.c.bad)
                    .opacity(beat),
            )
            .child(
                div()
                    .flex_none()
                    .debug_selector(|| "voice-take-time".to_owned())
                    .text_size(px(12.0))
                    .text_color(theme.c.text.opacity(0.8))
                    .child(SharedString::from(time)),
            )
            .child(
                Waveform::new("voice-take-level", heights, 1.0)
                    .tall(24.0)
                    .keep(Keep::End),
            )
            .when_some(said, |strip, said| {
                strip.child(
                    div()
                        .flex_none()
                        .debug_selector(|| "voice-take-said".to_owned())
                        .text_size(px(12.0))
                        .text_color(theme.c.text.opacity(0.8))
                        .child(said),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quiet_level_still_shows_and_a_loud_one_fills_the_bar() {
        assert!(bar_of(0.01) > 0.15);
        assert!((bar_of(1.0) - 1.0).abs() < f32::EPSILON);
        assert!(bar_of(-1.0).abs() < f32::EPSILON);
    }
}
