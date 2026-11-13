//! The view's component kit: the handful of parts every screen is built
//! from, each drawn in one place.
//!
//! A component is a small builder that turns into an element, the way a
//! component library's `<Button>` or `<IconButton>` does: say what it is,
//! pick a variant, hand it a click handler. It reads the theme itself, so a
//! screen does not thread colours and corner sizes through to its buttons,
//! and a change to how a button looks is a change here and nowhere else.

mod avatar;
mod backdrop;
mod button;
mod control;
mod dialog;
mod surface;

use gpui::{Hsla, SharedString, Styled, Svg, px, svg};

pub(crate) use avatar::{Avatar, tint};
pub(crate) use backdrop::Backdrop;
pub(crate) use button::{Button, Corner, Emphasis, IconButton, Size, Variant};
pub(crate) use control::{MenuItem, Radio, Switch};
pub(crate) use dialog::{Dialog, Sheet};
pub(crate) use surface::{Badge, Kbd, Nearest, Paper};

use crate::theme::Theme;

/// The ink a component is drawn in, by what it is for and not by its
/// colour: the theme decides the colour.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) enum Tone {
    /// Secondary text, and most icons.
    #[default]
    Muted,
    /// The faintest rung: hints, decoration.
    Dim,
    /// The accent, as a foreground.
    Accent,
    /// Destructive, or off.
    Danger,
    /// The band's secondary ink.
    Bar,
    /// The rail's faint ink.
    Rail,
}

impl Tone {
    /// This tone's colour in `theme`.
    pub(crate) fn of(self, theme: &Theme) -> Hsla {
        match self {
            Self::Muted => theme.c.muted,
            Self::Dim => theme.c.dim,
            Self::Accent => theme.c.accent_text,
            Self::Danger => theme.c.bad,
            Self::Bar => theme.c.bar_dim,
            Self::Rail => theme.c.rail_dim,
        }
    }
}

/// A bundled icon, `size` square, in `color`.
pub(crate) fn icon(name: &'static str, size: f32, color: Hsla) -> Svg {
    svg()
        .path(SharedString::from(format!("icons/{name}.svg")))
        .size(px(size))
        .flex_none()
        .text_color(color)
}
