//! The audio device panel: which microphone and which speaker to use.

use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::Shell;
use super::kit::{Sheet, Slider, SwitchRow};
use super::widgets::{EMPHASIS, icon, label};
use crate::engine::{AudioDevice, ChosenDevices, VoiceSettings};
use crate::theme::Theme;
use crate::words::t;

/// Which of the two lists a row belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    Input,
    Output,
}

/// How long a bar is left alone before where it stands is written down.
const SETTLED: std::time::Duration = std::time::Duration::from_millis(400);

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

/// Where the threshold stands along its range, from 0 to 1. The range is
/// walked in ratios, as hearing is: the quiet end has as much of the bar
/// as the loud one.
pub(super) fn threshold_along(threshold: f32) -> f32 {
    let (low, high) = THRESHOLD_RANGE;
    (threshold.clamp(low, high) / low).ln() / (high / low).ln()
}

/// The threshold that stands `along` its range.
pub(super) fn threshold_at(along: f32) -> f32 {
    let (low, high) = THRESHOLD_RANGE;
    low * (high / low).powf(along.clamp(0.0, 1.0))
}

/// The loudest a volume goes: twice as it is.
pub(super) const LOUDEST: f32 = 2.0;

/// The volume that stands `along` a bar from silent to twice as loud, to
/// a whole percent.
pub(super) fn volume_at(along: f32) -> f32 {
    (along.clamp(0.0, 1.0) * LOUDEST * 100.0).round() / 100.0
}

/// The range bitrates are offered in, in bits a second: the web UI's.
const BITRATE_RANGE: (f32, f32) = (8_000.0, 320_000.0);

/// The bitrate that stands `along` its range, to a whole kilobit.
#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "within the range, which is positive and far below what a u32 holds"
)]
pub(super) fn bitrate_at(along: f32) -> u32 {
    let (low, high) = BITRATE_RANGE;
    let bits = low + (high - low) * along.clamp(0.0, 1.0);
    ((bits / 1000.0).round() * 1000.0) as u32
}

/// Where `bitrate` stands along its range, from 0 to 1.
#[expect(
    clippy::cast_precision_loss,
    reason = "a bitrate is far below where an f32 stops counting whole numbers"
)]
pub(super) fn bitrate_along(bitrate: u32) -> f32 {
    let (low, high) = BITRATE_RANGE;
    ((bitrate as f32 - low) / (high - low)).clamp(0.0, 1.0)
}

/// A volume as a whole percentage.
fn percent(volume: f32) -> String {
    format!("{:.0}%", volume * 100.0)
}

/// A volume a tenth louder or quieter, from silent to twice as loud.
pub(super) fn stepped_volume(volume: f32, up: bool) -> f32 {
    let tenths = (volume * 10.0).round() + if up { 1.0 } else { -1.0 };
    (tenths / 10.0).clamp(0.0, 2.0)
}

/// The bitrates voice is offered at, from frugal to more than speech
/// needs.
const BITRATES: &[u32] = &[
    8_000, 16_000, 24_000, 40_000, 56_000, 72_000, 96_000, 128_000, 192_000, 256_000, 320_000,
];

/// The next bitrate up or down from `bitrate`, which need not be one of
/// those offered.
pub(super) fn stepped_bitrate(bitrate: u32, up: bool) -> u32 {
    let next = if up {
        BITRATES.iter().find(|offered| **offered > bitrate)
    } else {
        BITRATES.iter().rev().find(|offered| **offered < bitrate)
    };
    next.copied().unwrap_or(bitrate)
}

impl Shell {
    /// Change one of the voice settings and remember it.
    pub(super) fn change_voice(
        &mut self,
        change: impl FnOnce(&mut VoiceSettings),
        cx: &mut Context<Self>,
    ) {
        change(&mut self.voice_settings);
        self.engine.set_voice_settings(self.voice_settings);
        // With push to talk switched off there is no key to be holding,
        // here or bound with the system.
        if !self.voice_settings.push_to_talk && std::mem::take(&mut self.ptt.held) {
            self.engine.push_to_talk(false);
        }
        self.rebind_global_keys(cx);
        self.remember_settings(cx);
        cx.notify();
    }

    /// Change one of the voice settings from a bar being dragged: heard at
    /// once, and written down once the bar has been left alone a moment,
    /// not at every step of the drag.
    pub(super) fn drag_voice(
        &mut self,
        change: impl FnOnce(&mut VoiceSettings),
        cx: &mut Context<Self>,
    ) {
        change(&mut self.voice_settings);
        self.engine.set_voice_settings(self.voice_settings);
        let dragged = self.voice_settings;
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(SETTLED).await;
            let _ = shell.update(cx, |shell, cx| {
                // Dragged on meanwhile: that step's own timer writes it.
                if shell.voice_settings == dragged {
                    shell.remember_settings(cx);
                }
            });
        })
        .detach();
        cx.notify();
    }

    /// Open or close the panel. Opening asks the system for its devices, off
    /// the view's thread: enumeration can stall on a driver.
    pub(super) fn toggle_devices(&mut self, cx: &mut Context<Self>) {
        self.devices_open = !self.devices_open;
        if self.devices_open {
            self.look_for_devices(cx);
        }
        cx.notify();
    }

    /// Ask the system what there is to speak into and listen from, for
    /// whatever is about to list it.
    pub(super) fn look_for_devices(&mut self, cx: &mut Context<Self>) {
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

    /// Use `device` (or the system's default, for `None`) as the microphone
    /// or the speaker, and remember the choice.
    pub(super) fn choose_device(
        &mut self,
        kind: Kind,
        device: Option<SharedString>,
        cx: &mut Context<Self>,
    ) {
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
    Sheet::new("devices")
        .scrolls()
        .absolute()
        .bottom(px(112.0))
        .left(theme.skin.rail_width + px(12.0))
        .w(theme.skin.column_width - px(24.0))
        .max_h(px(560.0))
        .p(px(8.0))
        // A column that gives way with the sheet, as its rows do with it.
        .flex()
        .flex_col()
        .child(body(shell, false, theme, cx).min_h_0())
}

/// What the panel holds, as a column: how voice is sent, and the devices it
/// goes through. The settings page shows the same.
pub(super) fn body(shell: &Shell, bars: bool, theme: &Theme, cx: &mut Context<Shell>) -> gpui::Div {
    let panel = div().flex().flex_col().gap(px(2.0));
    let Some(devices) = &shell.devices else {
        return panel.child(
            div()
                .p(px(8.0))
                .text_color(theme.c.muted)
                .child(t!("Looking for audio devices…")),
        );
    };
    let ChosenDevices { input, output } = &shell.chosen_devices;
    panel
        .child(heading(&t!("Voice"), theme))
        .child(push_to_talk_row(shell, theme, cx))
        .child(whisper_key_row(shell, theme, cx))
        // On the page, which has the room; the panel stays what fits.
        .children(global_keys_row(shell, cx).filter(|_| bars))
        .child(toggle(
            "noise-suppression",
            t!("Noise suppression"),
            shell.voice_settings.noise_suppression,
            cx,
        ))
        .child(toggle(
            "automatic-gain",
            t!("Auto gain"),
            shell.voice_settings.automatic_gain,
            cx,
        ))
        .when(!shell.voice_settings.push_to_talk, |panel| {
            panel.child(level_row(
                Level {
                    id: "threshold",
                    name: t!("Open threshold"),
                    says: format!("{:.1}%", shell.voice_settings.threshold * 100.0),
                    along: threshold_along(shell.voice_settings.threshold),
                    step: |voice, up| voice.threshold = stepped_threshold(voice.threshold, up),
                    drag: |voice, along| voice.threshold = threshold_at(along),
                    bar: bars,
                },
                theme,
                cx,
            ))
        })
        .children(loudness_rows(shell, bars, theme, cx))
        .child(heading(&t!("Input device"), theme))
        .children(rows(
            Kind::Input,
            &devices.inputs,
            input.as_ref(),
            theme,
            cx,
        ))
        .child(heading(&t!("Output device"), theme))
        .children(rows(
            Kind::Output,
            &devices.outputs,
            output.as_ref(),
            theme,
            cx,
        ))
}

/// How loud, how good and by which road voice travels.
fn loudness_rows(
    shell: &Shell,
    bars: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> [gpui::AnyElement; 4] {
    let voice = &shell.voice_settings;
    [
        level_row(
            Level {
                id: "input-volume",
                name: t!("Microphone volume"),
                says: percent(voice.input_volume),
                along: voice.input_volume / LOUDEST,
                step: |voice, up| voice.input_volume = stepped_volume(voice.input_volume, up),
                drag: |voice, along| voice.input_volume = volume_at(along),
                bar: bars,
            },
            theme,
            cx,
        )
        .into_any_element(),
        level_row(
            Level {
                id: "output-volume",
                name: t!("Speaker volume"),
                says: percent(voice.output_volume),
                along: voice.output_volume / LOUDEST,
                step: |voice, up| voice.output_volume = stepped_volume(voice.output_volume, up),
                drag: |voice, along| voice.output_volume = volume_at(along),
                bar: bars,
            },
            theme,
            cx,
        )
        .into_any_element(),
        level_row(
            Level {
                id: "bitrate",
                name: t!("Voice quality"),
                says: t!("{{value}} kb/s", value = voice.bitrate_bps / 1000).to_string(),
                along: bitrate_along(voice.bitrate_bps),
                step: |voice, up| voice.bitrate_bps = stepped_bitrate(voice.bitrate_bps, up),
                drag: |voice, along| voice.bitrate_bps = bitrate_at(along),
                bar: bars,
            },
            theme,
            cx,
        )
        .into_any_element(),
        toggle(
            "voice-over-tcp",
            t!("Force TCP audio"),
            voice.voice_over_tcp,
            cx,
        )
        .into_any_element(),
    ]
}

/// A setting that is on or off.
fn toggle(id: &'static str, name: SharedString, on: bool, cx: &mut Context<Shell>) -> SwitchRow {
    SwitchRow::new(id, name, on).on_click(cx.listener(move |shell, _, _, cx| {
        shell.change_voice(
            |voice| match id {
                "push-to-talk" => voice.push_to_talk = !voice.push_to_talk,
                "noise-suppression" => voice.noise_suppression = !voice.noise_suppression,
                "voice-over-tcp" => voice.voice_over_tcp = !voice.voice_over_tcp,
                _ => voice.automatic_gain = !voice.automatic_gain,
            },
            cx,
        );
    }))
}

/// The switch that binds the voice keys with the system, where the system
/// has keys to bind: the talk key, the whisper key, mute and deafen then
/// work while another program has the keyboard, and are taken from every
/// other program for as long.
fn global_keys_row(shell: &Shell, cx: &mut Context<Shell>) -> Option<SwitchRow> {
    let on = shell.panels.settings.global_keys;
    crate::hotkeys::AVAILABLE.then(|| {
        SwitchRow::new("global-keys", t!("Keys work in other programs too"), on)
            .on_click(cx.listener(move |shell, _, _, cx| shell.set_global_keys(!on, cx)))
    })
}

/// The key held to whisper to whoever was chosen from a user's or a
/// channel's menu.
fn whisper_key_row(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement {
    let key = if shell.whisper.choosing_key {
        t!("Press a key combo...")
    } else {
        shell.whisper.key.as_ref().map_or_else(
            || t!("Not set"),
            |key| key.to_uppercase().into(),
        )
    };
    let hover = theme.c.hover;
    div()
        .min_h(px(30.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(8.0))
        .text_size(px(13.0))
        .child(div().flex_1().min_w_0().child(t!("Whisper")))
        .child(
            div()
                .id("whisper-key")
                .debug_selector(|| "whisper-key".to_owned())
                .px(px(8.0))
                .py(px(2.0))
                .rounded(theme.skin.radius_sm)
                .bg(theme.c.card2)
                .text_size(px(11.0))
                .text_color(theme.c.muted)
                .cursor_pointer()
                .hover(move |style| style.bg(hover))
                .on_click(cx.listener(|shell, _, window, cx| {
                    shell.whisper.choosing_key = true;
                    // The key must come to the window, not to a field.
                    window.focus(&shell.focus);
                    cx.notify();
                }))
                .child(key),
        )
}

/// Push to talk: the switch, and the key that is held.
fn push_to_talk_row(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let on = shell.voice_settings.push_to_talk;
    let key = if shell.ptt.choosing {
        t!("Press a key combo...")
    } else {
        shell.ptt.key.as_ref().map_or_else(
            || t!("Not set"),
            |key| key.to_uppercase().into(),
        )
    };
    let hover = theme.c.hover;
    let row = toggle("push-to-talk", t!("Push to talk"), on, cx);
    if !on {
        return row;
    }
    row.trailing(
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
                shell.ptt.choosing = true;
                // The key must come to the window, not to a field.
                window.focus(&shell.focus);
                cx.stop_propagation();
                cx.notify();
            }))
            .child(key),
    )
}

/// One level of the voice settings: what it is called, where it stands in
/// words and along its bar, and how a step and a drag change it.
struct Level {
    /// Names its bar and its buttons for the tests.
    id: &'static str,
    name: SharedString,
    says: String,
    /// Where it stands along its range, from 0 to 1.
    along: f32,
    /// A press of its minus or its plus.
    step: fn(&mut VoiceSettings, bool),
    /// Its bar dragged to somewhere along its range.
    drag: fn(&mut VoiceSettings, f32),
    /// Whether it has a bar at all: the page has the room, the panel
    /// that opens over the conversation does not.
    bar: bool,
}

/// A setting that goes up and down in steps: its name, what it stands at,
/// and a button either side. `id` names the buttons `<id>-down` and
/// `<id>-up`.
fn level_row(level: Level, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let Level {
        id,
        name,
        says: stands_at,
        along,
        step: step_it,
        drag,
        bar,
    } = level;
    let hover = theme.c.hover;
    let step = |glyph: &'static str, up: bool, cx: &mut Context<Shell>| {
        let way = if up { "up" } else { "down" };
        div()
            .id((id, usize::from(up)))
            .debug_selector(move || format!("{id}-{way}"))
            .size(px(22.0))
            .rounded(theme.skin.radius_sm)
            .flex()
            .items_center()
            .justify_center()
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .on_click(cx.listener(move |shell, _, _, cx| {
                shell.change_voice(|voice| step_it(voice, up), cx);
            }))
            .child(icon(glyph, 12.0, theme.c.muted))
    };
    // Two lines, so that it fits the narrow panel as well as the page:
    // what it is and where it stands, then the bar to drag it along.
    let said = div()
        .min_h(px(30.0))
        .flex()
        .items_center()
        .gap(px(6.0))
        .child(div().flex_1().min_w_0().child(name))
        .child(step("minus", false, cx))
        .child(
            div()
                .min_w(px(58.0))
                .flex()
                .justify_center()
                .text_size(px(12.0))
                .text_color(theme.c.muted)
                .child(stands_at),
        )
        .child(step("plus", true, cx));
    let bar = bar.then(|| {
        Slider::new(id, along).on_change(cx.listener(move |shell, along: &f32, _, cx| {
            let along = *along;
            shell.drag_voice(|voice| drag(voice, along), cx);
        }))
    });
    let said = said.px(px(8.0)).text_size(px(13.0));
    let Some(bar) = bar else {
        return said;
    };
    div()
        .flex()
        .flex_col()
        .pb(px(6.0))
        .child(said)
        .child(div().px(px(8.0)).child(bar))
}

fn heading(text: &str, theme: &Theme) -> impl IntoElement + use<> {
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
        t!("System default"),
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
