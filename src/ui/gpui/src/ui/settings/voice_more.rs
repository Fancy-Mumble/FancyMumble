//! The Voice page's expert settings (how the noise suppressor is tuned,
//! the legacy audio backend), offered in the expert mode as the web UI
//! offers them, and how the voice packets fare.

use std::collections::BTreeMap;

use gpui::{Context, Div, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};
use mumble_tauri_lib::engine_api::audio::DenoiserParamSpec;

use super::super::Shell;
use super::super::kit::{GroupTitle, Look, Slider, SliderRow, SwitchRow};
use super::{Lit, heading};
use crate::sound_check::{PacketCounts, Stats};
use crate::theme::Theme;
use crate::words::t;

/// A knob's value, with as many decimals as its step has, and its unit.
fn knob_value(value: f32, spec: &DenoiserParamSpec) -> SharedString {
    let decimals = if spec.step < 1.0 {
        spec.step
            .to_string()
            .split('.')
            .nth(1)
            .map_or(2, str::len)
            .min(3)
    } else {
        0
    };
    let number = format!("{value:.decimals$}");
    if spec.unit.is_empty() {
        number.into()
    } else {
        format!("{number} {}", spec.unit).into()
    }
}

/// `knobs` with the one `spec` names set to the value `along` its range.
fn knob_at(
    knobs: &BTreeMap<String, f32>,
    spec: &DenoiserParamSpec,
    along: f32,
) -> BTreeMap<String, f32> {
    let steps = ((spec.max - spec.min) / spec.step).round().max(1.0);
    let value = spec.min + (along * steps).round() / steps * (spec.max - spec.min);
    let mut knobs = knobs.clone();
    let _ = knobs.insert(spec.id.to_owned(), value);
    knobs
}

impl Shell {
    /// Tune the noise suppressor, heard at once and remembered.
    fn tune(&mut self, knobs: BTreeMap<String, f32>, cx: &mut Context<Self>) {
        self.engine.tune_denoiser(knobs.clone());
        self.panels.settings.voice.knobs = knobs;
        self.remember_settings(cx);
        cx.notify();
    }
}

/// The knobs of the noise suppressor running, where it has any.
pub(super) fn tuning(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Option<Div> {
    let voice = shell.voice_settings;
    let specs = voice
        .noise_suppression
        .then(|| voice.denoiser.knobs())
        .filter(|specs| !specs.is_empty())?;
    let knobs = &shell.panels.settings.voice.knobs;
    let rows = specs.into_iter().map(|spec| {
        let value = knobs.get(spec.id).copied().unwrap_or(spec.default);
        let along = (value - spec.min) / (spec.max - spec.min).max(f32::EPSILON);
        let held = knobs.clone();
        div()
            .child(div().flex().child(SliderRow::new(
                spec.label,
                knob_value(value, &spec),
                Slider::new(format!("knob-{}", spec.id), along).on_change(cx.listener(
                    move |shell, along: &f32, _, cx| {
                        shell.tune(knob_at(&held, &spec, *along), cx);
                    },
                )),
            )))
            .when(!spec.description.is_empty(), |row| {
                row.child(
                    div()
                        .mt(px(3.0))
                        .text_size(px(11.0))
                        .text_color(theme.c.dim)
                        .child(spec.description),
                )
            })
    });
    Some(
        div()
            .mt(px(16.0))
            .child(GroupTitle::new(t!("Fine tuning")).hint(t!("The defaults suit most hardware.")))
            .child(div().flex().flex_col().gap(px(14.0)).children(rows)),
    )
}

/// The expert settings at the end of the page.
pub(super) fn expert(
    shell: &Shell,
    lit: &Lit,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let legacy = shell.voice_settings.legacy_backend;
    div()
        .child(heading(lit, t!("Expert")).wide())
        .child(
            SwitchRow::new("legacy-backend", t!("Legacy audio backend"), legacy)
                .look(Look::Card)
                .lit(lit.lights(&t!("Legacy audio backend")))
                .hint(t!(
                    "Switch to the legacy cpal backend if the default rodio backend misbehaves. Takes effect on the next voice toggle."
                ))
                .on_click(cx.listener(|shell, _, _, cx| {
                    shell.change_voice(|voice| voice.legacy_backend = !voice.legacy_backend, cx);
                })),
        )
}

/// One direction's packet counts, on a line.
fn counts_row(
    label: SharedString,
    counts: PacketCounts,
    theme: &Theme,
) -> impl IntoElement + use<> {
    div()
        .py(px(5.0))
        .flex()
        .justify_between()
        .gap(px(16.0))
        .text_size(px(11.5))
        .text_color(theme.c.muted)
        .child(label)
        .child(t!(
            "{{good}} good · {{late}} late · {{lost}} lost ({{loss}}%) · {{resync}} resync",
            good = counts.good,
            late = counts.late,
            lost = counts.lost,
            loss = counts.loss(),
            resync = counts.resync
        ))
}

/// How the voice packets fare: nothing until the server has said, since
/// zeroes would read as a perfect connection rather than none.
pub(super) fn statistics(shell: &Shell, lit: &Lit, theme: &Theme) -> impl IntoElement + use<> {
    let stats: Option<Stats> = shell.engine.voice_stats();
    let note = |says: SharedString, below: f32| {
        div()
            .pb(px(below))
            .text_size(px(11.5))
            .text_color(theme.c.dim)
            .child(says)
    };
    let shown = div().child(heading(lit, t!("Audio statistics")).wide());
    match stats {
        None => shown.child(note(
            t!("No statistics available. Connect to a server to see packet statistics."),
            8.0,
        )),
        Some(stats) => shown
            .child(note(
                t!("UDP packet counters since connection start."),
                10.0,
            ))
            .child(counts_row(t!("To client"), stats.to_client, theme))
            .child(counts_row(t!("From client"), stats.from_client, theme)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(step: f32, unit: &'static str) -> DenoiserParamSpec {
        DenoiserParamSpec {
            id: "k",
            label: "knob",
            description: "",
            min: 0.0,
            max: 1.0,
            step,
            default: 0.5,
            unit,
        }
    }

    #[test]
    fn a_knob_shows_the_decimals_its_step_has_and_lands_on_a_step() {
        assert_eq!(knob_value(0.3, &spec(0.05, "")).as_ref(), "0.30");
        assert_eq!(knob_value(12.0, &spec(1.0, "dB")).as_ref(), "12 dB");
        let set = knob_at(&BTreeMap::new(), &spec(0.25, ""), 0.6);
        assert_eq!(set.get("k"), Some(&0.5));
    }
}
