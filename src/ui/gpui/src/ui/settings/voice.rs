//! The Voice page, ordered as the web UI's is by where in the chain a
//! control acts: the devices, when the microphone opens and how the gate
//! is tuned (`voice_gate`), what is done to the voice here, what leaves
//! for the server, and how its packets fare (`voice_more`).

use gpui::{Context, Div, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::devices::{Kind, LOUDEST, bitrate_along, bitrate_at, volume_at};
use super::super::kit::{
    Button, Choice, Choices, Emphasis, Field, Look, PageTitle, Segmented, Select, Shape, Size,
    Slider, SliderRow, SwitchRow, ValueHeader,
};
use super::{Lit, heading};
use crate::engine::{AudioDevice, Connection, Voice, VoiceSettings};
use crate::sound_check::Denoiser;
use crate::sound_check::settings::FRAMES_MS;
use crate::theme::Theme;
use crate::words::t;

/// When the microphone is sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Activation {
    /// While it hears speech.
    Voice,
    /// Always.
    Continuous,
    /// While a key is held.
    PushToTalk,
}

impl Activation {
    const ALL: [Self; 3] = [Self::Voice, Self::Continuous, Self::PushToTalk];

    /// The mode the engine's two settings come to: the web UI shows the
    /// two as one choice.
    fn of(voice: &VoiceSettings) -> Self {
        if voice.push_to_talk {
            Self::PushToTalk
        } else if voice.threshold <= 0.0 {
            Self::Continuous
        } else {
            Self::Voice
        }
    }

    /// `voice` set to send in this mode; a gate that was open all the way
    /// gets the web UI's usual level back.
    fn apply(self, voice: &mut VoiceSettings) {
        voice.push_to_talk = self == Self::PushToTalk;
        if self == Self::Continuous {
            voice.threshold = 0.0;
        } else if voice.threshold <= 0.0 {
            voice.threshold = 0.02;
        }
    }

    fn choice(self) -> Choice {
        match self {
            Self::Voice => {
                Choice::new(t!("Voice activation")).detail(t!("Transmits while you talk."))
            }
            Self::Continuous => Choice::new(t!("Continuous")).detail(t!("Always transmits.")),
            Self::PushToTalk => {
                Choice::new(t!("Push to talk")).detail(t!("Only while a key is held."))
            }
        }
    }
}

/// A volume from silent to twice as loud as a whole percentage.
fn percent(volume: f32) -> SharedString {
    t!("{{value}}%", value = (volume * 100.0).round())
}

/// The page.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let voice = shell.voice_settings;
    let activation = Activation::of(&voice);
    let lit = &shell.panels.settings.lit;
    let expert = shell.panels.settings.user_mode.expert();
    div()
        .child(title(shell, cx))
        .child(devices(shell, cx))
        .when(cfg!(windows), |page| page.child(exclusive(&voice, lit, cx)))
        .child(heading(lit, t!("Activation mode")))
        .child(
            Choices::new(
                "activation",
                Shape::Cards,
                Activation::ALL.map(Activation::choice).into(),
                Activation::ALL
                    .iter()
                    .position(|mode| *mode == activation)
                    .unwrap_or(0),
            )
            .on_choose(cx.listener(|shell, at: &usize, _, cx| {
                if let Some(mode) = Activation::ALL.get(*at) {
                    shell.change_voice(|voice| mode.apply(voice), cx);
                }
            })),
        )
        .when(activation == Activation::Voice, |page| {
            page.child(super::voice_gate::render(shell, lit, theme, cx))
        })
        .child(processing(&voice, lit, theme, cx))
        .when(expert, |page| {
            page.children(super::voice_more::tuning(shell, theme, cx))
        })
        .child(transmission(&voice, lit, cx))
        .when(expert, |page| {
            page.child(super::voice_more::expert(shell, lit, cx))
        })
        .child(super::voice_more::statistics(shell, lit, theme))
}

/// The page's title, and the switch that turns voice on or off as a whole.
fn title(shell: &Shell, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let title = PageTitle::new(t!("Voice"));
    if shell.snapshot.connection != Connection::Connected {
        return title;
    }
    let running = shell.snapshot.voice != Voice::Off;
    let says = if running {
        t!("Turn voice off")
    } else {
        t!("Turn voice on")
    };
    title.action(
        Button::new("voice-power", says)
            .emphasis(Emphasis::Outlined)
            .size(Size::Compact)
            .on_click(cx.listener(move |shell, _, _, cx| {
                if running {
                    shell.engine.turn_voice_off();
                } else {
                    shell.engine.toggle_microphone();
                }
                cx.notify();
            })),
    )
}

/// The two devices side by side, each with how loud it is under it.
fn devices(shell: &Shell, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let voice = shell.voice_settings;
    let found = shell.devices.as_ref();
    let chosen = &shell.chosen_devices;
    let column = |kind: Kind, cx: &mut Context<Shell>| {
        let (id, label, listed, chosen, bar, volume, name) = match kind {
            Kind::Input => (
                "input-device",
                t!("Input device"),
                found.map(|found| found.inputs.as_slice()),
                chosen.input.as_ref(),
                "input-volume",
                voice.input_volume,
                t!("Microphone volume"),
            ),
            Kind::Output => (
                "output-device",
                t!("Output device"),
                found.map(|found| found.outputs.as_slice()),
                chosen.output.as_ref(),
                "output-volume",
                voice.output_volume,
                t!("Speaker volume"),
            ),
        };
        let listed: Vec<AudioDevice> = listed.unwrap_or_default().to_vec();
        let lit = shell.panels.settings.lit.lights(&label);
        let at = chosen
            .and_then(|chosen| listed.iter().position(|device| device.name == *chosen))
            .map_or(0, |at| at + 1);
        let names = std::iter::once(t!("System default"))
            .chain(listed.iter().map(|device| device.name.clone()))
            .collect();
        div()
            .flex_1()
            .min_w_0()
            .child(
                Field::new(
                    label,
                    Select::new(id, names, at).on_choose(cx.listener(
                        move |shell, at: &usize, _, cx| {
                            let device = at.checked_sub(1).and_then(|at| listed.get(at));
                            shell.choose_device(kind, device.map(|device| device.name.clone()), cx);
                        },
                    )),
                )
                .lit(lit),
            )
            .child(div().mt(px(14.0)).flex().child(SliderRow::new(
                name,
                percent(volume),
                Slider::new(bar, volume / LOUDEST).on_change(cx.listener(
                    move |shell, along: &f32, _, cx| {
                        let to = volume_at(*along);
                        shell.drag_voice(
                            |voice| match kind {
                                Kind::Input => voice.input_volume = to,
                                Kind::Output => voice.output_volume = to,
                            },
                            cx,
                        );
                    },
                )),
            )))
    };
    div()
        .flex()
        .gap(px(20.0))
        .child(column(Kind::Input, cx))
        .child(column(Kind::Output, cx))
}

/// Taking the microphone for this client alone: exclusive mode on Windows,
/// with the devices, as the web UI sets it.
fn exclusive(
    voice: &VoiceSettings,
    lit: &Lit,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    div().mt(px(18.0)).child(
        SwitchRow::new(
            "exclusive-input",
            t!("Exclusive microphone mode"),
            voice.exclusive_input,
        )
        .look(Look::Card)
        .lit(lit.lights(&t!("Exclusive microphone mode")))
        .hint(t!(
            "Takes the device straight from the driver, locking other applications out of it."
        ))
        .on_click(cx.listener(|shell, _, _, cx| {
            shell.change_voice(|voice| voice.exclusive_input = !voice.exclusive_input, cx);
        })),
    )
}

/// What a noise suppressor is called on its pill.
fn denoiser_name(denoiser: Option<Denoiser>) -> SharedString {
    match denoiser {
        None => t!("Off"),
        Some(Denoiser::Rnnoise) => t!("RNNoise"),
        Some(Denoiser::DeepFilterNet) => t!("DeepFilterNet"),
        Some(Denoiser::OmlsaImcra) => t!("OMLSA + IMCRA"),
        Some(Denoiser::SpectralSubtraction) => t!("Spectral subtraction"),
    }
}

/// What a noise suppressor is, in one line under the pills.
fn denoiser_hint(denoiser: Option<Denoiser>) -> SharedString {
    match denoiser {
        None => t!("No processing — the microphone is sent as it is heard."),
        Some(Denoiser::Rnnoise) => {
            t!("Neural network trained on real speech — works well in most environments.")
        }
        Some(Denoiser::DeepFilterNet) => {
            t!("State-of-the-art deep learning. Best quality, highest CPU cost.")
        }
        Some(Denoiser::OmlsaImcra) => t!("Modern classical estimator — very smooth suppression."),
        Some(Denoiser::SpectralSubtraction) => {
            t!("The lightest option, and the best on steady background noise.")
        }
    }
}

/// Automatic gain, and while the gate is set by hand how far it may raise
/// the voice.
fn auto_gain(voice: &VoiceSettings, lit: &Lit, cx: &mut Context<Shell>) -> SwitchRow {
    let row = SwitchRow::new("automatic-gain", t!("Auto gain"), voice.automatic_gain)
        .look(Look::Card)
        .lit(lit.lights(&t!("Auto gain")))
        .hint(t!(
            "Automatically adjusts microphone volume for consistent levels."
        ))
        .on_click(cx.listener(|shell, _, _, cx| {
            shell.change_voice(|voice| voice.automatic_gain = !voice.automatic_gain, cx);
        }));
    if !voice.automatic_gain || voice.auto_calibrate {
        return row;
    }
    let gain = voice.max_gain_db;
    row.under(div().mt(px(10.0)).flex().child(SliderRow::new(
        t!("Max amplification"),
        t!("{{value}} dB", value = gain.round()),
        Slider::new("max-gain", (gain - 1.0) / 39.0).on_change(cx.listener(
            |shell, along: &f32, _, cx| {
                let to = (1.0 + along * 39.0).round();
                shell.drag_voice(|voice| voice.max_gain_db = to, cx);
            },
        )),
    )))
}

/// What is done to the voice before it leaves.
fn processing(
    voice: &VoiceSettings,
    lit: &Lit,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let offered: Vec<Option<Denoiser>> = std::iter::once(None)
        .chain(Denoiser::available().into_iter().map(Some))
        .collect();
    let running = voice.noise_suppression.then_some(voice.denoiser);
    let taken = offered.iter().position(|one| *one == running).unwrap_or(0);
    let names: Vec<SharedString> = offered.iter().map(|one| denoiser_name(*one)).collect();
    div()
        .child(
            heading(lit, t!("Processing"))
                .hint(t!(
                    "What happens to your voice before it leaves your machine."
                ))
                .wide(),
        )
        .child(auto_gain(voice, lit, cx))
        .child(div().mt(px(18.0)).mb(px(8.0)).child(ValueHeader::new(
            t!("Noise suppression"),
            denoiser_name(running),
        )))
        .child(
            div()
                .flex()
                .child(
                    Segmented::new("noise-suppression", names, taken).on_choose(cx.listener(
                        move |shell, at: &usize, _, cx| {
                            let chosen = offered.get(*at).copied().flatten();
                            shell.change_voice(
                                |voice| {
                                    voice.noise_suppression = chosen.is_some();
                                    if let Some(chosen) = chosen {
                                        voice.denoiser = chosen;
                                    }
                                },
                                cx,
                            );
                        },
                    )),
                ),
        )
        .child(
            div()
                .mt(px(8.0))
                .text_size(px(11.0))
                .text_color(theme.c.dim)
                .child(denoiser_hint(running)),
        )
}

/// How the voice travels to the server.
fn transmission(
    voice: &VoiceSettings,
    lit: &Lit,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let ms = |value: u32| t!("{{value}} ms", value = value);
    let taken = FRAMES_MS
        .iter()
        .position(|one| *one == voice.frame_ms)
        .unwrap_or(1);
    div()
        .child(
            heading(lit, t!("Transmission"))
                .hint(t!("How your voice travels to the server."))
                .wide(),
        )
        .child(div().flex().child(SliderRow::new(
            t!("Quality — higher bitrate means better audio, more bandwidth"),
            t!("{{value}} kb/s", value = voice.bitrate_bps / 1000),
            Slider::new("bitrate", bitrate_along(voice.bitrate_bps)).on_change(cx.listener(
                |shell, along: &f32, _, cx| {
                    let to = bitrate_at(*along);
                    shell.drag_voice(|voice| voice.bitrate_bps = to, cx);
                },
            )),
        )))
        .child(div().mt(px(16.0)).mb(px(8.0)).child(ValueHeader::new(
            t!("Audio per packet — smaller is lower latency, larger saves bandwidth"),
            ms(voice.frame_ms),
        )))
        .child(div().flex().child(
            Segmented::new("frame-size", FRAMES_MS.map(ms), taken).on_choose(cx.listener(
                |shell, at: &usize, _, cx| {
                    if let Some(frame) = FRAMES_MS.get(*at).copied() {
                        shell.change_voice(|voice| voice.frame_ms = frame, cx);
                    }
                },
            )),
        ))
        .child(
            div().mt(px(18.0)).child(
                SwitchRow::new("voice-over-tcp", t!("Force TCP audio"), voice.voice_over_tcp)
                    .look(Look::Card)
                    .lit(lit.lights(&t!("Force TCP audio")))
                    .hint(t!(
                        "Send audio over the TCP tunnel instead of UDP — for strict firewalls or NAT that blocks UDP."
                    ))
                    .on_click(cx.listener(|shell, _, _, cx| {
                        shell.change_voice(|voice| voice.voice_over_tcp = !voice.voice_over_tcp, cx);
                    })),
            ),
        )
}
