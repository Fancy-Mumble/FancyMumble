//! How wide a line of words is set, without a window: what a table needs
//! to share its width out among its columns as a browser shares a table's.

use gpui::{App, FontWeight, Pixels, px};

use crate::theme::Theme;

/// How a run of words is set: its size, its weight, and the room added
/// after every letter.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Setting {
    pub size: f32,
    pub weight: FontWeight,
    /// Pixels after each letter, as CSS's `letter-spacing` adds them.
    pub spacing: f32,
}

impl Setting {
    pub(crate) const fn new(size: f32, weight: FontWeight) -> Self {
        Self {
            size,
            weight,
            spacing: 0.0,
        }
    }

    pub(crate) const fn spaced(mut self, spacing: f32) -> Self {
        self.spacing = spacing;
        self
    }

    /// How wide `words` are, set this way in the theme's face. A letter
    /// the face has no shape for is counted as wide as an average one.
    pub(crate) fn width(self, words: &str, theme: &Theme, cx: &App) -> f32 {
        let system = cx.text_system();
        let mut font = gpui::font(theme.skin.font.clone());
        font.weight = self.weight;
        let id = system.resolve_font(&font);
        let size: Pixels = px(self.size);
        let fallback = f32::from(size) * 0.6;
        words
            .chars()
            .map(|letter| {
                system
                    .advance(id, size, letter)
                    .map_or(fallback, |advance| f32::from(advance.width))
                    + self.spacing
            })
            .sum()
    }
}
