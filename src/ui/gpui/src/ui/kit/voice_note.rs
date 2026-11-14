//! A voice message, drawn as one: play, its shape, its length, its speed.
//! The web UI's `VoiceMessageCard`.
//!
//! It only shows. Whoever owns the playing says where it stands each time
//! it is drawn, and is told what was pressed.

use std::rc::Rc;
use std::sync::Arc;

use gpui::{
    App, ElementId, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div,
    prelude::*, px,
};

use super::button::{Corner, IconButton, Variant};
use super::focus::{Ring, TabStop};
use super::waveform::Waveform;
use crate::theme::ActiveTheme;

type Pressed = Rc<dyn Fn(&mut Window, &mut App)>;
type Sought = Rc<dyn Fn(u32, &mut Window, &mut App)>;

/// How far an arrow key moves along it, as the web UI's does.
const STEP_MS: u32 = 5000;

/// The words it says, in the language the view is in.
#[derive(Debug, Clone)]
pub(crate) struct NoteWords {
    pub play: SharedString,
    pub pause: SharedString,
    pub speed: SharedString,
}

/// Where a voice message stands.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct Standing {
    pub playing: bool,
    /// Where it is, and how long it is.
    pub at_ms: u32,
    pub length_ms: u32,
    /// How fast it plays.
    pub speed: f32,
}

/// A voice message's card.
///
/// ```ignore
/// VoiceNote::new(7, bars, standing, words).on_toggle(...).on_seek(...).on_speed(...)
/// ```
#[derive(IntoElement)]
pub(crate) struct VoiceNote {
    at: usize,
    bars: Arc<[u8]>,
    standing: Standing,
    words: NoteWords,
    on_toggle: Option<Pressed>,
    on_seek: Option<Sought>,
    on_speed: Option<Pressed>,
}

impl VoiceNote {
    /// The card at `at` among the conversation's: it names the card's
    /// parts to the tests as `voice-play-<at>`, `voice-wave-<at>` and
    /// `voice-speed-<at>`.
    pub(crate) fn new(at: usize, bars: Arc<[u8]>, standing: Standing, words: NoteWords) -> Self {
        Self {
            at,
            bars,
            standing,
            words,
            on_toggle: None,
            on_seek: None,
            on_speed: None,
        }
    }

    /// Play or pause.
    pub(crate) fn on_toggle(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_toggle = Some(Rc::new(handler));
        self
    }

    /// Go to a place in it, in milliseconds.
    pub(crate) fn on_seek(
        mut self,
        handler: impl Fn(u32, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_seek = Some(Rc::new(handler));
        self
    }

    /// Play it at the next speed.
    pub(crate) fn on_speed(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_speed = Some(Rc::new(handler));
        self
    }
}

/// Bars drawn for a voice message that carried no shape of its own.
const FLAT: [u8; 48] = [24; 48];

/// Where a key pressed on the bars goes, from `at_ms` in `length_ms`;
/// `None` for a key that is not for going anywhere.
pub(crate) fn keyed(key: &str, at_ms: u32, length_ms: u32) -> Option<u32> {
    match key {
        "right" => Some(at_ms.saturating_add(STEP_MS).min(length_ms)),
        "left" => Some(at_ms.saturating_sub(STEP_MS)),
        "home" => Some(0),
        "end" => Some(length_ms),
        _ => None,
    }
}

/// `1×`, `1.5×`: how fast it plays, as the web UI writes it.
pub(crate) fn speed_words(speed: f32) -> SharedString {
    let tenths = (speed * 10.0).round();
    if tenths % 10.0 == 0.0 {
        format!("{}×", tenths / 10.0).into()
    } else {
        format!("{:.1}×", tenths / 10.0).into()
    }
}

impl RenderOnce for VoiceNote {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let Standing {
            playing,
            at_ms,
            length_ms,
            speed,
        } = self.standing;
        let played = if length_ms > 0 {
            at_ms as f32 / length_ms as f32
        } else {
            0.0
        };
        // Its length at rest, where it is once it has been started.
        let shown = if playing || at_ms > 0 {
            at_ms
        } else {
            length_ms
        };
        let bars: &[u8] = if self.bars.is_empty() {
            &FLAT
        } else {
            &self.bars
        };
        let heights = bars.iter().map(|bar| f32::from(*bar) / 100.0).collect();
        let at = self.at;
        let toggle = IconButton::at("voice-play", at, if playing { "pause" } else { "play" })
            .size(36.0)
            .glyph_size(16.0)
            .corner(Corner::Pill)
            .variant(Variant::Solid)
            .tip(if playing {
                self.words.pause.clone()
            } else {
                self.words.play.clone()
            })
            .faded(self.on_toggle.is_none())
            .when_some(self.on_toggle.clone(), |button, toggle| {
                button.on_click(move |_, window, cx| toggle(window, cx))
            });
        let wave = Waveform::new(format!("voice-wave-{at}"), heights, played)
            .lowest(0.12)
            .when_some(self.on_seek.clone(), |wave, seek| {
                let pressed = Rc::clone(&seek);
                let toggle = self.on_toggle.clone();
                wave.on_press(move |along, window, cx| {
                    pressed((along * length_ms as f32) as u32, window, cx);
                })
                .on_key(move |key, window, cx| {
                    if let Some(to) = keyed(key, at_ms, length_ms) {
                        seek(to, window, cx);
                        return true;
                    }
                    match (key, &toggle) {
                        ("space" | "enter", Some(toggle)) => {
                            toggle(window, cx);
                            true
                        }
                        _ => false,
                    }
                })
            });
        div()
            .id(("voice-note", at))
            .debug_selector(move || format!("voice-note-{at}"))
            .w(px(352.0))
            .max_w_full()
            .flex()
            .items_center()
            .gap(px(10.0))
            .py(px(6.0))
            .pl(px(6.0))
            .pr(px(10.0))
            .rounded(theme.skin.radius_pill)
            .bg(theme.c.text.opacity(0.08))
            .child(toggle)
            .child(wave)
            .child(
                div()
                    .flex_none()
                    .text_size(px(12.0))
                    .text_color(theme.c.text.opacity(0.8))
                    .child(SharedString::from(crate::voice::clock(shown))),
            )
            .child(SpeedButton {
                id: ("voice-speed", at).into(),
                selector: format!("voice-speed-{at}"),
                says: speed_words(speed),
                tip: self.words.speed,
                on_click: self.on_speed,
            })
    }
}

/// The quiet button that says how fast it plays.
#[derive(IntoElement)]
struct SpeedButton {
    id: ElementId,
    selector: String,
    says: SharedString,
    tip: SharedString,
    on_click: Option<Pressed>,
}

impl RenderOnce for SpeedButton {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let hover = theme.c.text.opacity(0.08);
        let stop = self
            .on_click
            .is_some()
            .then(|| TabStop::new(self.id.clone(), window, cx));
        let ring = Ring {
            corner: theme.skin.radius_pill,
            ink: theme.c.accent,
        };
        let selector = self.selector;
        let button = div()
            .id(self.id)
            .debug_selector(move || selector.clone())
            .flex_none()
            .px(px(6.0))
            .py(px(2.0))
            .rounded(theme.skin.radius_pill)
            .text_size(px(11.0))
            .font_weight(gpui::FontWeight::SEMIBOLD)
            .text_color(theme.c.text.opacity(0.75))
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .tooltip(super::keyed_tip(self.tip, None::<SharedString>))
            .when_some(self.on_click, |button, handler| {
                button.on_click(move |_, window, cx| handler(window, cx))
            })
            .child(self.says);
        match stop {
            Some(stop) => stop.wrap(button, ring, window),
            None => button,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_arrows_move_five_seconds_and_stay_inside() {
        assert_eq!(keyed("right", 1000, 10_000), Some(6000));
        assert_eq!(keyed("right", 8000, 10_000), Some(10_000));
        assert_eq!(keyed("left", 3000, 10_000), Some(0));
        assert_eq!(keyed("home", 3000, 10_000), Some(0));
        assert_eq!(keyed("end", 3000, 10_000), Some(10_000));
        assert_eq!(keyed("a", 3000, 10_000), None);
    }

    #[test]
    fn a_speed_is_written_as_the_web_writes_it() {
        assert_eq!(speed_words(1.0).as_ref(), "1×");
        assert_eq!(speed_words(1.5).as_ref(), "1.5×");
        assert_eq!(speed_words(2.0).as_ref(), "2×");
    }
}
