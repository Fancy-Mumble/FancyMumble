//! The audio device panel: which microphone and which speaker to use.

use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::Shell;
use super::widgets::{EMPHASIS, icon, label, opaque};
use crate::engine::{AudioDevice, ChosenDevices, VoiceSettings};
use crate::theme::Theme;

/// Which of the two lists a row belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Input,
    Output,
}

/// The steps the activation threshold moves in: each press of `-` or `+`
/// is half as loud again, or a third quieter.
const THRESHOLD_STEP: f32 = 1.5;
const THRESHOLD_RANGE: (f32, f32) = (0.001, 0.5);

/// The threshold one step up or down, held within its range.
pub(super) fn stepped_threshold(threshold: f32, up: bool) -> f32 {
    let stepped = if up {
        threshold * THRESHOLD_STEP
    } else {
        threshold / THRESHOLD_STEP
    };
    stepped.clamp(THRESHOLD_RANGE.0, THRESHOLD_RANGE.1)
}

impl Shell {
    /// Change one of the voice settings and remember it.
    fn change_voice(&mut self, change: impl FnOnce(&mut VoiceSettings), cx: &mut Context<Self>) {
        change(&mut self.voice_settings);
        self.engine.set_voice_settings(self.voice_settings);
        // With push to talk switched off there is no key to be holding.
        if !self.voice_settings.push_to_talk && std::mem::take(&mut self.ptt_held) {
            self.engine.push_to_talk(false);
        }
        self.remember_settings(cx);
        cx.notify();
    }

    /// Open or close the panel. Opening asks the system for its devices, off
    /// the view's thread: enumeration can stall on a driver.
    pub(super) fn toggle_devices(&mut self, cx: &mut Context<Self>) {
        self.devices_open = !self.devices_open;
        if self.devices_open {
            self.chosen_devices = self.engine.chosen_devices();
            let engine = std::sync::Arc::clone(&self.engine);
            cx.spawn(async move |shell, cx| {
                let devices = cx
                    .background_executor()
                    .spawn(async move { engine.audio_devices() })
                    .await;
                let _ = shell.update(cx, |shell, cx| {
                    shell.devices = Some(devices);
                    cx.notify();
                });
            })
            .detach();
        }
        cx.notify();
    }

    /// Use `device` (or the system's default, for `None`) as the microphone
    /// or the speaker, and remember the choice.
    fn choose_device(&mut self, kind: Kind, device: Option<SharedString>, cx: &mut Context<Self>) {
        match kind {
            Kind::Input => self.chosen_devices.input = device,
            Kind::Output => self.chosen_devices.output = device,
        }
        self.engine.choose_devices(self.chosen_devices.clone());
        self.remember_settings(cx);
        cx.notify();
    }
}

/// The panel, above the user tile it was opened from.
pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let panel = div()
        .id("devices")
        .absolute()
        .bottom(px(112.0))
        .left(theme.skin.rail_width + px(12.0))
        .w(theme.skin.column_width - px(24.0))
        .max_h(px(560.0))
        .overflow_y_scroll()
        .occlude()
        .flex()
        .flex_col()
        .gap(px(2.0))
        .p(px(8.0))
        .rounded(theme.skin.radius_lg)
        .bg(opaque(theme.c.card, theme.c.bg0))
        .border_1()
        .border_color(theme.c.line2)
        .shadow_lg();
    let Some(devices) = &shell.devices else {
        return panel.child(
            div()
                .p(px(8.0))
                .text_color(theme.c.muted)
                .child("Looking for audio devices…"),
        );
    };
    let ChosenDevices { input, output } = &shell.chosen_devices;
    panel
        .child(heading("Voice", theme))
        .child(push_to_talk_row(shell, theme, cx))
        .child(toggle(
            "noise-suppression",
            "Noise suppression",
            shell.voice_settings.noise_suppression,
            theme,
            cx,
        ))
        .child(toggle(
            "automatic-gain",
            "Automatic gain",
            shell.voice_settings.automatic_gain,
            theme,
            cx,
        ))
        .when(!shell.voice_settings.push_to_talk, |panel| {
            panel.child(sensitivity_row(shell.voice_settings.threshold, theme, cx))
        })
        .child(heading("Microphone", theme))
        .children(rows(
            Kind::Input,
            &devices.inputs,
            input.as_ref(),
            theme,
            cx,
        ))
        .child(heading("Speakers", theme))
        .children(rows(
            Kind::Output,
            &devices.outputs,
            output.as_ref(),
            theme,
            cx,
        ))
}

/// A setting that is on or off.
fn toggle(
    id: &'static str,
    name: &'static str,
    on: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> gpui::Stateful<gpui::Div> {
    let hover = theme.c.hover;
    div()
        .id(id)
        .debug_selector(move || id.to_owned())
        .min_h(px(30.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(8.0))
        .rounded(theme.skin.radius_md)
        .cursor_pointer()
        .text_size(px(13.0))
        .hover(move |style| style.bg(hover))
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.change_voice(
                |voice| match id {
                    "push-to-talk" => voice.push_to_talk = !voice.push_to_talk,
                    "noise-suppression" => voice.noise_suppression = !voice.noise_suppression,
                    _ => voice.automatic_gain = !voice.automatic_gain,
                },
                cx,
            );
        }))
        .child(div().flex_1().min_w_0().child(name))
        .child(switch(on, theme))
}

/// A switch: a track with a knob at the end that says on.
fn switch(on: bool, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .flex_none()
        .w(px(30.0))
        .h(px(17.0))
        .p(px(2.0))
        .rounded(theme.skin.radius_pill)
        .bg(if on { theme.c.accent } else { theme.c.card2 })
        .flex()
        .when(on, Styled::justify_end)
        .child(
            div()
                .size(px(13.0))
                .rounded(theme.skin.radius_pill)
                .bg(if on { theme.c.on_accent } else { theme.c.muted }),
        )
}

/// Push to talk: the switch, and the key that is held.
fn push_to_talk_row(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let on = shell.voice_settings.push_to_talk;
    let key = if shell.choosing_ptt_key {
        SharedString::from("Press a key…")
    } else {
        shell.ptt_key.as_ref().map_or_else(
            || SharedString::from("Set key"),
            |key| key.to_uppercase().into(),
        )
    };
    let hover = theme.c.hover;
    toggle("push-to-talk", "Push to talk", on, theme, cx).when(on, |row| {
        row.child(
            div()
                .id("push-to-talk-key")
                .debug_selector(|| "push-to-talk-key".to_owned())
                .px(px(8.0))
                .py(px(2.0))
                .rounded(theme.skin.radius_sm)
                .bg(theme.c.card2)
                .text_size(px(11.0))
                .text_color(theme.c.muted)
                .hover(move |style| style.bg(hover))
                .on_click(cx.listener(|shell, _, window, cx| {
                    shell.choosing_ptt_key = true;
                    // The key must come to the window, not to a field.
                    window.focus(&shell.focus);
                    cx.stop_propagation();
                    cx.notify();
                }))
                .child(key),
        )
    })
}

/// How loud the microphone must be to count as speech.
fn sensitivity_row(
    threshold: f32,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    let step = |id: &'static str, glyph: &'static str, up: bool, cx: &mut Context<Shell>| {
        div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .size(px(22.0))
            .rounded(theme.skin.radius_sm)
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .on_click(cx.listener(move |shell, _, _, cx| {
                shell.change_voice(
                    |voice| voice.threshold = stepped_threshold(voice.threshold, up),
                    cx,
                );
            }))
            .child(icon(glyph, 12.0, theme.c.muted))
    };
    div()
        .min_h(px(30.0))
        .flex()
        .items_center()
        .gap(px(6.0))
        .px(px(8.0))
        .text_size(px(13.0))
        .child(div().flex_1().min_w_0().child("Activation level"))
        .child(step("threshold-down", "minus", false, cx))
        .child(
            div()
                .min_w(px(44.0))
                .flex()
                .justify_center()
                .text_size(px(12.0))
                .text_color(theme.c.muted)
                .child(format!("{:.1}%", threshold * 100.0)),
        )
        .child(step("threshold-up", "plus", true, cx))
}

fn heading(text: &'static str, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .px(px(8.0))
        .pt(px(8.0))
        .pb(px(4.0))
        .text_size(px(11.0))
        .font_weight(EMPHASIS)
        .text_color(theme.c.muted)
        .child(label(text, theme))
}

/// "System default", then each device.
fn rows(
    kind: Kind,
    devices: &[AudioDevice],
    chosen: Option<&SharedString>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Vec<gpui::AnyElement> {
    let prefix = match kind {
        Kind::Input => "input",
        Kind::Output => "output",
    };
    let mut rows = vec![row(
        format!("{prefix}-default"),
        "System default".into(),
        chosen.is_none(),
        kind,
        None,
        theme,
        cx,
    )];
    rows.extend(devices.iter().map(|device| {
        row(
            format!("{prefix}-{}", device.name),
            device.name.clone(),
            chosen == Some(&device.name),
            kind,
            Some(device.name.clone()),
            theme,
            cx,
        )
    }));
    rows
}

fn row(
    tag: String,
    name: SharedString,
    current: bool,
    kind: Kind,
    device: Option<SharedString>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> gpui::AnyElement {
    let hover = theme.c.hover;
    div()
        .id(SharedString::from(tag.clone()))
        .debug_selector(move || tag)
        .min_h(px(30.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(8.0))
        .py(px(4.0))
        .rounded(theme.skin.radius_md)
        .cursor_pointer()
        .text_size(px(13.0))
        .when(current, |row| row.bg(theme.c.accent_soft))
        .when(!current, |row| row.hover(move |style| style.bg(hover)))
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.choose_device(kind, device.clone(), cx);
        }))
        .child(div().flex_1().min_w_0().child(name))
        .when(current, |row| {
            row.child(icon("check", 13.0, theme.c.accent_text))
        })
        .into_any_element()
}
