//! A face: a picture, or the initials of whoever has none.

use std::sync::Arc;

use gpui::{
    App, Hsla, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div,
    linear_color_stop, linear_gradient, prelude::*, px,
};

use crate::theme::{ActiveTheme, Theme};
use crate::ui::widgets::EMPHASIS;

/// The first letters of the first two words of `name`, in capitals, as the
/// web UI cuts them: words end at spaces, underscores, dots and hyphens.
fn initials(name: &str) -> String {
    name.split(|c: char| c.is_whitespace() || matches!(c, '_' | '.' | '-'))
        .filter(|word| !word.is_empty())
        .take(2)
        .filter_map(|word| word.chars().next())
        .flat_map(char::to_uppercase)
        .collect()
}

/// The pair of colours a subject with no picture is given: always the same
/// for the same key, and as quiet for one key as for the next.
///
/// The web UI's `serverTint`: only the hue comes from the key.
pub(crate) fn tint(key: &str) -> (Hsla, Hsla) {
    let mut hash = 0x811c_9dc5_u32;
    for unit in key.to_lowercase().encode_utf16() {
        hash = (hash ^ u32::from(unit)).wrapping_mul(0x0100_0193);
    }
    hash ^= hash >> 16;
    hash = hash.wrapping_mul(0x7feb_352d);
    hash ^= hash >> 15;
    hash = hash.wrapping_mul(0x846c_a68b);
    hash ^= hash >> 16;
    let hue = hash % 360;
    #[expect(clippy::cast_precision_loss, reason = "a hue below 360")]
    let at = |hue: u32| gpui::hsla((hue % 360) as f32 / 360.0, 0.23, 0.46, 1.0);
    (at(hue), at(hue + 274))
}

/// The corner an avatar of `size` gets: a circle unless the theme squares
/// its avatars off.
fn avatar_radius(size: f32, theme: &Theme) -> gpui::Pixels {
    theme.skin.radius_avatar.unwrap_or(px(size / 2.0))
}

/// A user's avatar, or a server's tile.
///
/// ```ignore
/// Avatar::new(&user.name).picture(user.avatar.as_ref()).size(38.0)
/// Avatar::new(&server.name).tile(&server.key).size(40.0)
/// ```
#[derive(IntoElement)]
pub(crate) struct Avatar {
    initials: SharedString,
    picture: Option<Arc<gpui::Image>>,
    size: f32,
    /// The gradient of a tile: a square for a server, not a face.
    tile: Option<(Hsla, Hsla)>,
    /// The presence pip at the lower trailing corner.
    status: Option<Hsla>,
    /// Whether to ring it as somebody who is speaking.
    talking: bool,
}

impl Avatar {
    /// A 32px face for `name`: their initials until a picture is given.
    pub(crate) fn new(name: &str) -> Self {
        Self {
            initials: initials(name).into(),
            picture: None,
            size: 32.0,
            tile: None,
            status: None,
            talking: false,
        }
    }

    pub(crate) fn picture(mut self, picture: Option<&Arc<gpui::Image>>) -> Self {
        self.picture = picture.cloned();
        self
    }

    /// The side, in pixels.
    pub(crate) fn size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }

    /// A server's tile: the rail's corner, and the colours `key` hashes to.
    pub(crate) fn tile(mut self, key: &str) -> Self {
        self.tile = Some(tint(key));
        self
    }

    /// Ring the face: its owner is speaking.
    pub(crate) fn talking(mut self, talking: bool) -> Self {
        self.talking = talking;
        self
    }

    /// A presence pip of this colour.
    pub(crate) fn status(mut self, color: Option<Hsla>) -> Self {
        self.status = color;
        self
    }
}

impl RenderOnce for Avatar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let size = self.size;
        let radius = if self.tile.is_some() {
            theme.skin.radius_rail
        } else {
            avatar_radius(size, &theme)
        };
        let face = match self.picture {
            Some(picture) => gpui::img(picture)
                .size(px(size))
                .rounded(radius)
                .object_fit(gpui::ObjectFit::Cover)
                .into_any_element(),
            None => div()
                .size(px(size))
                .rounded(radius)
                .map(|face| match self.tile {
                    Some((from, to)) => face
                        .bg(linear_gradient(
                            135.0,
                            linear_color_stop(from, 0.0),
                            linear_color_stop(to, 1.0),
                        ))
                        .text_color(gpui::white()),
                    None => face.bg(theme.c.card2).text_color(theme.c.muted),
                })
                .flex()
                .items_center()
                .justify_center()
                .text_size(px((size * 0.38).max(9.0)))
                .line_height(gpui::relative(1.0))
                .font_weight(EMPHASIS)
                .child(self.initials)
                .into_any_element(),
        };
        // The pip is a quarter of the face, inside a ring of the window's
        // own colour, hanging a pixel past the corner.
        let pip = (size * 0.24).max(6.0);
        div()
            .relative()
            .flex_none()
            .size(px(size))
            .child(face)
            // Round the face and outside it, so nothing moves when it shows.
            .when(self.talking, |avatar| {
                avatar.child(
                    div()
                        .absolute()
                        .top(px(-2.0))
                        .left(px(-2.0))
                        .size(px(size + 4.0))
                        .rounded(radius + px(2.0))
                        .border_2()
                        .border_color(theme.c.ok),
                )
            })
            .when_some(self.status, |avatar, color| {
                avatar.child(
                    div()
                        .absolute()
                        .right(px(-1.0))
                        .bottom(px(-1.0))
                        .size(px(pip + 4.0))
                        .rounded_full()
                        .bg(theme.c.bg0)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(div().size(px(pip)).rounded_full().bg(color)),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initials_take_the_first_letter_of_up_to_two_words() {
        assert_eq!(initials("magical.rocks"), "MR");
        assert_eq!(initials("Alex"), "A");
        assert_eq!(initials("the big-server_here"), "TB");
        assert_eq!(initials("  "), "");
        assert_eq!(initials("élan vital"), "ÉV");
    }

    #[test]
    fn a_tint_is_stable_and_is_the_web_uis() {
        // `serverTint("magical.rocks:64738")` in the web UI is #905a7a to
        // #5a5b90.
        let (from, to) = tint("magical.rocks:64738");
        let bytes = |color: Hsla| {
            let rgba = gpui::Rgba::from(color);
            [rgba.r, rgba.g, rgba.b].map(|part| (part * 255.0).round() as u8)
        };
        assert_eq!(bytes(from), [144, 90, 122]);
        assert_eq!(bytes(to), [90, 91, 144]);
        assert_eq!(tint("MAGICAL.rocks:64738"), tint("magical.rocks:64738"));
        assert_ne!(tint("a:1").0, tint("b:1").0);
    }
}
