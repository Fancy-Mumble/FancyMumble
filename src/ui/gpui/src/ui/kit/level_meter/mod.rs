//! A level meter with the gate's markers on it: the web UI's `VuMeter`.
//!
//! It only shows. Whoever runs the meter says what is heard and where the
//! markers stand each time it is drawn, and is told where one was moved
//! to. Built from three parts: the track (`track`), a place for the
//! keyboard over each marker that can be moved (the arrows move it), and
//! the axis under them.

mod scale;
mod track;

use std::rc::Rc;

use gpui::{
    App, ElementId, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div,
    prelude::*, px, relative,
};

pub(crate) use scale::{along, held_peak, level_at};

use super::focus::{Ring, TabStop};
use crate::theme::ActiveTheme;

/// How tall the track is, and the handles above it.
const TRACK_HIGH: f32 = 10.0;
const HANDLE_HIGH: f32 = 22.0;
const HANDLE_WIDE: f32 = 18.0;

/// How far one press of an arrow moves a marker, along the axis.
const STEP: f32 = 0.01;

/// Where a marker was moved to: its place among the markers, and the
/// place along the axis, 0 to 1.
pub(crate) type Moved = Rc<dyn Fn(usize, f32, &mut Window, &mut App)>;

/// One marker on the meter.
#[derive(Debug, Clone)]
pub(crate) struct Marker {
    /// The level it stands at, 0 to 1.
    pub value: f32,
    /// Whether it is the gate's opening level; else its closing one.
    pub opens: bool,
    /// Whether it can be moved: it then has a handle and a keyboard stop.
    pub movable: bool,
    /// What it is called, for whoever rests the pointer on its handle.
    pub name: SharedString,
}

/// The meter.
///
/// ```ignore
/// LevelMeter::new("gate-meter", level, peak).talking(true).markers(markers).on_move(...)
/// ```
#[derive(IntoElement)]
pub(crate) struct LevelMeter {
    id: SharedString,
    level: f32,
    peak: f32,
    talking: bool,
    markers: Vec<Marker>,
    on_move: Option<Moved>,
}

impl LevelMeter {
    /// A meter showing the level `rms` (0 to 1) and a held peak already
    /// placed along the axis (`peak`, 0 to 1). `id` names it to the tests.
    pub(crate) fn new(id: impl Into<SharedString>, rms: f32, peak: f32) -> Self {
        Self {
            id: id.into(),
            level: along(rms),
            peak,
            talking: false,
            markers: Vec::new(),
            on_move: None,
        }
    }

    /// Ringed: what is heard now would open the gate.
    pub(crate) fn talking(mut self, talking: bool) -> Self {
        self.talking = talking;
        self
    }

    pub(crate) fn markers(mut self, markers: Vec<Marker>) -> Self {
        self.markers = markers;
        self
    }

    /// Called with a marker's place and the level it was moved to.
    pub(crate) fn on_move(
        mut self,
        handler: impl Fn(usize, f32, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_move = Some(Rc::new(move |place, along, window, cx| {
            handler(place, level_at(along), window, cx);
        }));
        self
    }
}

/// The keyboard's place over the handle of the marker at `place`.
fn marker_stop(
    id: &SharedString,
    place: usize,
    marker: &Marker,
    on_move: &Moved,
    window: &mut Window,
    cx: &mut App,
) -> impl IntoElement + use<> {
    let theme = ActiveTheme::get(cx);
    let stop_id = ElementId::Name(format!("{id}-marker-{place}").into());
    let selector = format!("{id}-marker-{place}");
    let at = along(marker.value);
    let moved = Rc::clone(on_move);
    let handle = div()
        .id(stop_id.clone())
        .debug_selector(move || selector.clone())
        .absolute()
        .top_0()
        .left(relative(at))
        .ml(px(-HANDLE_WIDE / 2.0))
        .w(px(HANDLE_WIDE))
        .h(px(HANDLE_HIGH))
        .tooltip(super::keyed_tip(marker.name.clone(), None::<SharedString>))
        .on_key_down(move |event, window, cx| {
            let to = match event.keystroke.key.as_str() {
                "left" | "down" => at - STEP,
                "right" | "up" => at + STEP,
                "home" => 0.0,
                "end" => 1.0,
                _ => return,
            };
            cx.stop_propagation();
            moved(place, to.clamp(0.0, 1.0), window, cx);
        });
    let ring = Ring {
        corner: theme.skin.radius_sm,
        ink: theme.c.accent,
    };
    TabStop::new(stop_id, window, cx).wrap(handle, ring, window)
}

/// The axis under the track.
fn axis(cx: &App) -> impl IntoElement + use<> {
    let theme = ActiveTheme::get(cx);
    let label = |says: &'static str| div().child(says);
    div()
        .mt(px(3.0))
        .px(px(2.0))
        .flex()
        .justify_between()
        .text_size(px(10.0))
        .text_color(theme.c.dim)
        .child(label("-60"))
        .child(label("-40"))
        .child(label("-20"))
        .child(label("0 dB"))
}

impl RenderOnce for LevelMeter {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let stops: Vec<_> = match &self.on_move {
            Some(on_move) => self
                .markers
                .iter()
                .enumerate()
                .filter(|(_, marker)| marker.movable)
                .map(|(place, marker)| marker_stop(&self.id, place, marker, on_move, window, cx))
                .collect(),
            None => Vec::new(),
        };
        let selector = self.id.to_string();
        div()
            .debug_selector(move || selector.clone())
            .flex_1()
            .min_w_0()
            .child(
                div()
                    .relative()
                    .child(track::Track {
                        id: ElementId::Name(format!("{}-track", self.id).into()),
                        level: self.level,
                        peak: self.peak,
                        talking: self.talking,
                        markers: self.markers,
                        on_move: self.on_move,
                    })
                    .children(stops),
            )
            .child(axis(cx))
    }
}
