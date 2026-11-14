//! Words set in one of the theme's voices: a heading, a subtitle, the words
//! on a plate, a state said aloud.
//!
//! A theme that sets a role apart (`theme::Voices`) has it in capitals,
//! leaning, spaced out or heavier; one that does not gets the words as any
//! label is set, spaced as the window spaces all its text. Spacing is the
//! text style's `letter_spacing` (CSS's `letter-spacing`), which the fork
//! adds to GPUI's text layout.

use gpui::{AnyElement, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use crate::theme::{Theme, Voice};

/// The roles a theme may give a voice of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Role {
    Heading,
    Subtitle,
    Plate,
    Day,
    Tag,
    Wordmark,
}

impl Role {
    /// This role's voice in `theme`.
    pub(crate) fn voice(self, theme: &Theme) -> Voice {
        let voices = theme.skin.marks.voices;
        match self {
            Self::Heading => voices.heading,
            Self::Subtitle => voices.subtitle,
            Self::Plate => voices.plate,
            Self::Day => voices.day,
            Self::Tag => voices.tag,
            Self::Wordmark => voices.wordmark,
        }
    }
}

/// `text` in `role`'s voice: what a view puts where it would put the label.
pub(crate) fn voiced(text: &str, role: Role, theme: &Theme) -> AnyElement {
    let voice = role.voice(theme);
    let words = if voice.caps {
        SharedString::from(text.to_uppercase())
    } else {
        crate::ui::widgets::label(text, theme)
    };
    // A role the theme does not set apart is spaced as all its text is:
    // the window's own spacing, inherited.
    let track = (voice != Voice::default()).then_some(voice.track);
    div()
        .flex_none()
        .min_w_0()
        .when(voice.italic, gpui::Styled::italic)
        .when_some(voice.weight, gpui::Styled::font_weight)
        .when_some(track, gpui::Styled::letter_spacing)
        .truncate()
        .child(words)
        .into_any_element()
}

/// `words` with `spacing` pixels after every letter, as CSS's
/// `letter-spacing` sets them: a spacing in pixels, whatever the size, in
/// place of the theme's own.
pub(crate) fn spaced(words: &str, spacing: f32) -> gpui::Div {
    div()
        .flex()
        .flex_row()
        .overflow_hidden()
        .letter_spacing(0.0)
        .children(words.chars().map(|letter| {
            div()
                .flex_none()
                .mr(px(spacing))
                .child(SharedString::from(letter.to_string()))
        }))
}
