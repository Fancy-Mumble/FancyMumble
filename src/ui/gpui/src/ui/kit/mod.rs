//! The view's component kit: the handful of parts every screen is built
//! from, each drawn in one place.
//!
//! A component is a small builder that turns into an element, the way a
//! component library's `<Button>` or `<IconButton>` does: say what it is,
//! pick a variant, hand it a click handler. It reads the theme itself, so a
//! screen does not thread colours and corner sizes through to its buttons,
//! and a change to how a button looks is a change here and nowhere else.

mod action_row;
mod avatar;
mod backdrop;
mod blocks;
mod built;
pub(crate) mod floating;
mod button;
mod chip;
mod choice;
mod colour_well;
mod control;
mod dialog;
mod edges;
mod expandable;
mod face_stack;
mod faded;
mod focus;
mod focus_point;
mod heading;
mod lettering;
mod lit;
mod marks;
mod marked_field;
mod member_picker;
pub(crate) mod over_picture;
mod picture;
mod plates;
mod shape;
mod voiced;
mod page;
mod recorder;
mod role_pill;
mod select;
mod text_box;
mod tick_box;
mod play_mark;
pub(crate) mod poster;
mod search_field;
mod segmented;
mod split_view;
pub(crate) mod table;
mod slider;
mod level_meter;
mod plate_button;
mod send_plate;
mod surface;
mod take_bar;
mod tooltip;
mod toolbar;
mod voice_note;
mod wall;
mod waveform;

use gpui::{Hsla, SharedString, Styled, Svg, px, svg};

pub(crate) use action_row::ActionRow;
pub(crate) use avatar::{Avatar, frame_radius, tint, user_tint};
pub(crate) use backdrop::backdrop;
pub(crate) use blocks::{Banner, Card, Empty, Note, rule};
pub(crate) use button::{Button, Corner, Emphasis, IconButton, Size, Variant};
pub(crate) use chip::{Chip, ChipTone};
pub(crate) use choice::{ChipButton, Choice, Choices, Shape};
pub(crate) use colour_well::{ColourWell, PALETTE, hex};
pub(crate) use control::{Look, MenuItem, Radio, Switch, SwitchRow};
pub(crate) use expandable::Expandable;
pub(crate) use face_stack::{Face, FaceStack};
pub(crate) use faded::Faded;
pub(crate) use picture::Picture;
pub(crate) use focus_point::FocusPicker;
pub(crate) use wall::Wall;
pub(crate) use page::{PageView, Scrolled, Surface};
pub(crate) use heading::{Field, GroupTitle, LINE, PageTitle, ValueHeader};
pub(crate) use lit::take_lit;
pub(crate) use edges::{Edge, edged};
pub(crate) use marked_field::MarkedField;
pub(crate) use member_picker::MemberPicker;
pub(crate) use marks::{conversation_ground, expander_ring, hazard, rail_wordmark};
pub(crate) use plates::{
    day_plate, header_mark, heading_rule, name_plate, row_finish, section_heading, selection_bar, subtitle,
};
pub(crate) use shape::{Finish, cut_into, shaped};
pub(crate) use voiced::{Role, spaced, voiced};
pub(crate) use recorder::Recorder;
pub(crate) use role_pill::{PillStep, RolePill};
pub(crate) use select::Select;
pub(crate) use text_box::TextBox;
pub(crate) use tick_box::TickBox;
pub(crate) use dialog::{Dialog, Sheet};
#[cfg(test)]
pub(crate) use focus::{held_inside, keyboard_at};
pub(crate) use focus::{Hold, Reachable, Way, arrows_held, walk};
pub(crate) use play_mark::PlayMark;
pub(crate) use search_field::SearchField;
pub(crate) use segmented::Segmented;
pub(crate) use split_view::{ListRow, Placeholder, SplitView};
pub(crate) use slider::{Slider, SliderRow};
pub(crate) use surface::{Badge, Kbd, Nearest, Paper};
pub(crate) use take_bar::{LIVE_BARS, TakeBar, TakeShown};
pub(crate) use level_meter::{LevelMeter, Marker, held_peak};
pub(crate) use plate_button::PlateButton;
pub(crate) use send_plate::SendPlate;
pub(crate) use voice_note::{NoteWords, Standing, VoiceNote};
pub(crate) use tooltip::keyed_tip;
pub(crate) use toolbar::{Divider, ToolButton, Toolbar};

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
#[must_use]
pub(crate) fn icon(name: &'static str, size: f32, color: Hsla) -> Svg {
    svg()
        .path(SharedString::from(format!("icons/{name}.svg")))
        .size(px(size))
        .flex_none()
        .text_color(color)
}
