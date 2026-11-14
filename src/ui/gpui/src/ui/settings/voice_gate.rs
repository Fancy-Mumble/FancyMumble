//! The voice gate on the Voice page: how it is tuned (by itself from five
//! seconds of speech, or by hand on the meter), what it is set to, and
//! hearing oneself through it. The web UI's `VoiceGate`.

use gpui::{
    AnyElement, Context, Div, FontWeight, HighlightStyle, IntoElement, ParentElement, SharedString,
    Styled, StyledText, div, prelude::*, px, relative,
};

use super::super::Shell;
use super::super::kit::{
    Choice, Choices, LevelMeter, Marker, PlateButton, Shape, Slider, SliderRow,
};
use super::voice_check::{SPEECH_MS, calibrated_for};
use super::{Lit, heading};
use crate::engine::VoiceSettings;
use crate::sound_check::{REPLAY_MS, Sample};
use crate::theme::Theme;
use crate::words::t;

/// The gate's section: its heading, how it is tuned, what it is set to,
/// and hearing oneself.
pub(super) fn render(shell: &Shell, lit: &Lit, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let voice = shell.voice_settings;
    let auto = voice.auto_calibrate;
    let modes = vec![
        Choice::new(t!("Auto calibrate")).detail(t!(
            "Speak ~5 s; threshold, hysteresis and hold tune themselves."
        )),
        Choice::new(t!("Manual calibrate"))
            .detail(t!("Drag Open and Close markers directly on the meter.")),
    ];
    div()
        .child(heading(lit, t!("Voice gate")))
        .child(
            Choices::new("gate-mode", Shape::Cards, modes, usize::from(!auto)).on_choose(
                cx.listener(|shell, at: &usize, _, cx| {
                    let auto = *at == 0;
                    shell.change_voice(|voice| voice.auto_calibrate = auto, cx);
                }),
            ),
        )
        .child(if auto {
            auto_gate(shell, theme, cx)
        } else {
            manual_gate(shell, theme, cx)
        })
        .child(readout(&voice, theme))
        .child(hear_yourself(shell, theme, cx))
}

/// A card as the gate's parts are set on.
fn card(theme: &Theme) -> Div {
    div()
        .px(px(14.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.card)
        .border(theme.skin.line_width)
        .border_color(theme.c.line)
}

/// The meter as it stands, with the gate's two levels on it; moved by hand
/// where `movable`.
fn meter(shell: &Shell, movable: bool, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let voice = shell.voice_settings;
    let page = &shell.panels.settings.voice;
    let close = voice.threshold * voice.close_ratio;
    let marker = |value: f32, opens: bool, name: SharedString| Marker {
        value,
        opens,
        movable,
        name,
    };
    let markers = vec![
        marker(voice.threshold, true, t!("Open threshold")),
        marker(close, false, t!("Close threshold")),
    ];
    let shown = LevelMeter::new("gate-meter", page.level.rms, page.peak)
        .talking(page.metering && page.level.rms > voice.threshold)
        .markers(markers);
    if !movable {
        return shown;
    }
    let shell_handle = cx.weak_entity();
    shown.on_move(move |place, level, _, cx| {
        let _ = shell_handle.update(cx, |shell, cx| {
            shell.drag_voice(|voice| move_marker(voice, place, level), cx);
        });
    })
}

/// `voice` with the marker at `place` (the opening one first) moved to
/// `level`. The closing level is kept as a part of the opening one, so one
/// dragged above it holds just under it, as the web UI holds it.
fn move_marker(voice: &mut VoiceSettings, place: usize, level: f32) {
    if place == 0 {
        voice.threshold = level.clamp(0.0, 1.0);
    } else {
        let open = voice.threshold.max(level + 1e-4);
        voice.close_ratio = (level / open).clamp(0.1, 0.99);
    }
}

/// The gate tuning itself: what it needs or has, the button that starts
/// it, and while it listens how much speech it has heard and the meter.
fn auto_gate(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let page = &shell.panels.settings.voice;
    let testing = page.metering;
    let calibrated = page.calibrated_for.as_deref() == Some(calibrated_for(shell).as_str());
    let needed = !calibrated && !testing;
    let seconds = format!("{:.1}", page.speech_ms as f32 / 1000.0);
    let (title, hint) = if testing {
        (
            if page.speech_ms >= SPEECH_MS {
                t!("That's enough — stop when you like")
            } else {
                t!("Listening…")
            },
            if page.speaking() {
                t!("Speaking · {{seconds}} / 5.0 s", seconds = seconds)
            } else {
                t!("Silent · {{seconds}} / 5.0 s", seconds = seconds)
            },
        )
    } else if needed {
        (
            t!("Calibration needed"),
            t!("Speak naturally for 5 seconds so the gate tunes itself to your mic."),
        )
    } else {
        (
            t!("Gate calibrated"),
            t!("Run it again if you change microphone, room or filters."),
        )
    };
    let says = if testing {
        t!("Stop")
    } else if needed {
        t!("Calibrate")
    } else {
        t!("Recalibrate")
    };
    let row = card(theme)
        .mt(px(16.0))
        .py(px(11.0))
        .flex()
        .items_center()
        .gap(px(12.0))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .child(
                    div()
                        .text_size(px(12.0))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(if needed { theme.c.warn } else { theme.c.text })
                        .child(title),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme.c.muted)
                        .child(hint),
                ),
        )
        .child(
            PlateButton::new("gate-test", says)
                .primary(!testing)
                .on_click(cx.listener(|shell, _, _, cx| shell.toggle_meter(cx))),
        );
    let progress = page.speech_ms as f32 / SPEECH_MS as f32;
    div()
        .child(row)
        .when(testing, |gate| {
            gate.child(
                div()
                    .mt(px(10.0))
                    .h(px(4.0))
                    .rounded(theme.skin.radius_pill)
                    .bg(theme.c.card2)
                    .child(
                        div()
                            .h_full()
                            .w(relative(progress.min(1.0)))
                            .rounded(theme.skin.radius_pill)
                            .bg(theme.c.accent),
                    ),
            )
            .child(div().mt(px(6.0)).flex().child(meter(shell, false, cx)))
        })
        .into_any_element()
}

/// The sentence that says what the two markers are, with their words in
/// the markers' colours.
fn explainer(theme: &Theme) -> StyledText {
    let parts = [
        t!("Transmission starts above"),
        t!("Open"),
        t!("and stops below"),
        t!("Close"),
        t!(", so a pause between words does not cut you off."),
    ];
    let mut said = String::new();
    let mut lit = Vec::new();
    for (at, part) in parts.iter().enumerate() {
        if at > 0 && at < 4 {
            said.push(' ');
        }
        let from = said.len();
        said.push_str(part);
        let ink = match at {
            1 => Some(theme.c.ok),
            3 => Some(theme.c.warn),
            _ => None,
        };
        if let Some(ink) = ink {
            let style = HighlightStyle {
                color: Some(ink),
                font_weight: Some(FontWeight::SEMIBOLD),
                ..HighlightStyle::default()
            };
            lit.push((from..said.len(), style));
        }
    }
    StyledText::new(said).with_highlights(lit)
}

/// The gate set by hand on the meter: what the markers are, the meter,
/// what is heard against them, and how long the gate holds.
fn manual_gate(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    let voice = shell.voice_settings;
    let page = &shell.panels.settings.voice;
    let close = voice.threshold * voice.close_ratio;
    let status = if !page.metering {
        t!("Start the meter to see where your voice sits against the markers.")
    } else if page.level.rms > voice.threshold {
        t!(
            "Transmitting now · open {{open}}% · close {{close}}%",
            open = format!("{:.1}", voice.threshold * 100.0),
            close = format!("{:.1}", close * 100.0)
        )
    } else {
        t!("Below the threshold — nothing is being sent.")
    };
    let says = if page.metering {
        t!("Stop")
    } else {
        t!("Test microphone")
    };
    let hold = voice.hold_frames;
    card(theme)
        .mt(px(16.0))
        .py(px(13.0))
        .child(
            div()
                .text_size(px(11.0))
                .line_height(px(16.5))
                .text_color(theme.c.muted)
                .child(explainer(theme)),
        )
        .child(div().mt(px(4.0)).flex().child(meter(shell, true, cx)))
        .child(
            div()
                .mt(px(4.0))
                .flex()
                .items_center()
                .gap(px(12.0))
                .child(
                    div()
                        .flex_1()
                        .text_size(px(11.0))
                        .text_color(theme.c.muted)
                        .child(status),
                )
                .child(
                    PlateButton::new("gate-test", says)
                        .primary(!page.metering)
                        .on_click(cx.listener(|shell, _, _, cx| shell.toggle_meter(cx))),
                ),
        )
        .child(div().mt(px(12.0)).flex().child(SliderRow::new(
            t!("Hold — how long the gate stays open after you stop"),
            t!("{{count}} frames", count = hold),
            Slider::new("gate-hold", (hold.saturating_sub(1)) as f32 / 49.0).on_change(
                cx.listener(|shell, along: &f32, _, cx| {
                    let frames = 1 + (along * 49.0).round() as u32;
                    shell.drag_voice(|voice| voice.hold_frames = frames, cx);
                }),
            ),
        )))
        .into_any_element()
}

/// What the gate is set to, in one quiet line.
fn readout(voice: &VoiceSettings, theme: &Theme) -> impl IntoElement + use<> {
    let part = |says: SharedString| div().child(says);
    div()
        .mt(px(10.0))
        .flex()
        .flex_wrap()
        .gap(px(14.0))
        .text_size(px(10.5))
        .text_color(theme.c.dim)
        .child(part(t!(
            "threshold {{value}}%",
            value = format!("{:.1}", voice.threshold * 100.0)
        )))
        .child(part(t!(
            "close {{value}}%",
            value = (voice.close_ratio * 100.0).round()
        )))
        .child(part(t!(
            "hold {{count}} frame",
            "hold {{count}} frames",
            count = voice.hold_frames
        )))
        .child(part(t!(
            "max gain {{value}} dB",
            value = format!("{:.1}", voice.max_gain_db)
        )))
}

/// Recording oneself through the filters and playing it back.
fn hear_yourself(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let sample = shell.panels.settings.voice.sample;
    let seconds = |ms: u32| (ms + 500) / 1000;
    let (says, bar) = match sample {
        Sample::Idle => (t!("Record sample"), None),
        Sample::Recording {
            elapsed_ms,
            capacity_ms,
        } => (
            t!(
                "Stop recording · {{elapsed}} / {{total}} s",
                elapsed = seconds(elapsed_ms),
                total = seconds(capacity_ms)
            ),
            Some(theme.c.bad),
        ),
        Sample::Playing {
            elapsed_ms,
            total_ms,
        } => (
            t!(
                "Stop playback · {{elapsed}} / {{total}} s",
                elapsed = seconds(elapsed_ms),
                total = seconds(total_ms)
            ),
            Some(theme.c.accent),
        ),
    };
    let button = PlateButton::new("hear-yourself", says)
        .side(16.0)
        .on_click(cx.listener(|shell, _, _, cx| shell.toggle_sample(cx)));
    let button = match bar {
        Some(ink) => button.progress(sample.progress(), ink),
        None => button,
    };
    card(theme)
        .mt(px(20.0))
        .py(px(13.0))
        .child(
            div()
                .text_size(px(12.5))
                .font_weight(FontWeight::SEMIBOLD)
                .child(t!("Hear yourself")),
        )
        .child(
            div()
                .mt(px(4.0))
                .mb(px(10.0))
                .text_size(px(11.0))
                .line_height(px(16.5))
                .text_color(theme.c.muted)
                .child(t!(
                    "Record up to {{seconds}} s through the same filters your listeners receive, then play it back.",
                    seconds = REPLAY_MS / 1000
                )),
        )
        .child(div().flex().child(button))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_close_marker_holds_under_the_open_one() {
        let mut voice = VoiceSettings {
            threshold: 0.02,
            ..VoiceSettings::default()
        };
        move_marker(&mut voice, 1, 0.01);
        assert!((voice.close_ratio - 0.5).abs() < 1e-4);
        move_marker(&mut voice, 1, 0.5);
        assert!(
            (voice.close_ratio - 0.99).abs() < 1e-6,
            "never over the open one"
        );
        move_marker(&mut voice, 0, 0.05);
        assert!((voice.threshold - 0.05).abs() < 1e-6);
    }
}
