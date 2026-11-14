//! The Shortcuts page, as the web UI's: every key the window answers to
//! in the web UI's groups, each chosen by pressing it (a key chosen for
//! one thing is taken from whatever had it), whether the voice keys work
//! while another program has the keyboard, the whisper, and the keys of
//! the composer, which cannot be changed.
//!
//! Left out, each because this client has nothing it could open or show:
//! the game overlay's key, the quick switcher's and the developer
//! overlay's. Not yet built here: keys that jump to one person, and the
//! web UI's several whisper targets (this client has the one, chosen from
//! a menu).

use gpui::{Context, Div, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{
    Banner, Button, Card, Kbd, Look, Note, PageTitle, Recorder, Size, SwitchRow, Tone, rule,
};
use crate::engine::WhisperTarget;
use crate::store::{Bound, accelerator};
use crate::theme::Theme;
use crate::words::t;

/// A key chosen by pressing it: push to talk and the whisper key, which
/// keep keys of their own, or one of the others.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Chosen {
    Talk,
    Whisper,
    Bound(Bound),
}

impl Shell {
    /// Take the next key pressed as `which`.
    fn record_key(&mut self, which: Chosen, window: &mut gpui::Window, cx: &mut Context<Self>) {
        match which {
            Chosen::Talk => self.ptt.choosing = true,
            Chosen::Whisper => self.whisper.choosing_key = true,
            Chosen::Bound(bound) => {
                self.panels.settings.recording = Some(bound);
                // Until it is pressed no key does anything else: a key that
                // is bound would be taken by what it does, not chosen.
                cx.clear_key_bindings();
            }
        }
        // The key must come to the window, not to a field.
        window.focus(&self.focus, cx);
        cx.notify();
    }

    /// Stop waiting for a key to choose, and bind the keys again.
    pub(in crate::ui) fn stop_recording(&mut self, cx: &mut Context<Self>) {
        if self.panels.settings.recording.take().is_some() {
            super::super::keys::rebind(&self.panels.settings.shortcuts, cx);
            cx.notify();
        }
    }

    /// Have no key for `which`.
    fn clear_key(&mut self, which: Chosen, cx: &mut Context<Self>) {
        match which {
            Chosen::Talk => self.ptt.key = None,
            Chosen::Whisper => self.whisper.key = None,
            Chosen::Bound(bound) => {
                let _ = self.panels.settings.shortcuts.set(bound, None);
                super::super::keys::rebind(&self.panels.settings.shortcuts, cx);
            }
        }
        self.rebind_global_keys(cx);
        self.remember_settings(cx);
        cx.notify();
    }

    /// A key went down: the key being chosen, if one is; else the voice
    /// priority key, held as push to talk is. Whether it was taken.
    pub(in crate::ui) fn hear_chosen_key(
        &mut self,
        keystroke: &gpui::Keystroke,
        cx: &mut Context<Self>,
    ) -> bool {
        if let Some(bound) = self.panels.settings.recording {
            if keystroke.key == "escape" && !keystroke.modifiers.modified() {
                self.stop_recording(cx);
                return true;
            }
            // A modifier alone is the start of a combination.
            let Some(key) = accelerator(keystroke) else {
                return true;
            };
            self.panels.settings.recording = None;
            let _ = self.panels.settings.shortcuts.set(bound, Some(&key));
            super::super::keys::rebind(&self.panels.settings.shortcuts, cx);
            self.rebind_global_keys(cx);
            self.remember_settings(cx);
            cx.notify();
            return true;
        }
        if self.is_priority_key(keystroke) {
            // Held keys repeat; only the first press is a press.
            if !std::mem::replace(&mut self.panels.settings.priority_held, true) {
                self.engine.push_to_talk(true);
            }
            return true;
        }
        false
    }

    /// A key came up: the voice priority key, let go of. Whether it was.
    pub(in crate::ui) fn release_chosen_key(&mut self, keystroke: &gpui::Keystroke) -> bool {
        let priority = self
            .panels
            .settings
            .shortcuts
            .key(Bound::VoicePriority)
            .and_then(|key| key.rsplit('+').next().map(str::to_owned));
        let released = accelerator(&gpui::Keystroke {
            modifiers: gpui::Modifiers::none(),
            ..keystroke.clone()
        });
        if priority.is_some() && priority == released && self.panels.settings.priority_held {
            self.panels.settings.priority_held = false;
            self.engine.push_to_talk(false);
            return true;
        }
        false
    }

    /// The key chosen for `bound` as a key cap says it, for a tooltip; none
    /// where it has no key.
    pub(in crate::ui) fn key_caption(&self, bound: Bound) -> Option<SharedString> {
        self.panels
            .settings
            .shortcuts
            .key(bound)
            .map(|key| SharedString::from(key.to_owned()))
    }

    /// The key chosen for `bound`, as GPUI names it: for binding it with
    /// the system.
    pub(in crate::ui) fn chosen_global(&self, bound: Bound) -> Option<SharedString> {
        self.panels
            .settings
            .shortcuts
            .key(bound)
            .and_then(crate::store::gpui_keys)
            .map(Into::into)
    }

    /// Whether `keystroke` is the voice priority key, and there is a
    /// server to speak on.
    fn is_priority_key(&self, keystroke: &gpui::Keystroke) -> bool {
        self.snapshot.connection == crate::engine::Connection::Connected
            && self
                .panels
                .settings
                .shortcuts
                .key(Bound::VoicePriority)
                .is_some_and(|key| accelerator(keystroke).as_deref() == Some(key))
    }
}

/// Words asked for when they are drawn, so that they follow the language.
type Words = fn() -> SharedString;

/// The groups after the global voice keys, as the web UI groups them: what
/// each key does, and which.
const GROUPS: [(Words, &[(Words, Bound)]); 3] = [
    (
        || t!("Voice - in-app"),
        &[(|| t!("Toggle activation mode"), Bound::ToggleActivationMode)],
    ),
    (
        || t!("Channel and navigation"),
        &[
            (|| t!("Move to channel above"), Bound::MoveChannelUp),
            (|| t!("Move to channel below"), Bound::MoveChannelDown),
            (|| t!("Jump to root channel"), Bound::JumpToRootChannel),
            (|| t!("Toggle channel sidebar"), Bound::ToggleChannelSidebar),
            (|| t!("Toggle member panel"), Bound::ToggleMemberPanel),
            (|| t!("Quick Channel Search"), Bound::OpenQuickSearch),
        ],
    ),
    (
        || t!("Window"),
        &[
            (|| t!("Open Settings"), Bound::OpenSettings),
            (|| t!("Toggle fullscreen"), Bound::ToggleFullscreen),
        ],
    ),
];

/// What the fixed keys of the composer do.
const BUILT_IN: [(Words, &str); 6] = [
    (|| t!("Send message"), "enter"),
    (|| t!("New line"), "shift-enter"),
    (|| t!("Bold"), "ctrl-b"),
    (|| t!("Italic"), "ctrl-i"),
    (|| t!("Inline code"), "ctrl-e"),
    (|| t!("Mention picker"), "@"),
];

/// The page.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let lit = &shell.panels.settings.lit;
    div()
        .child(PageTitle::new(t!("Shortcuts")))
        .child(Banner::new(Note::Info).child(t!(
            "Shortcuts marked global work even when the app is in the background. In-app shortcuts only fire while the window is focused."
        )))
        .child(super::heading(lit, t!("Voice - global")))
        .child(
            Card::new()
                .child(recorder(shell, Chosen::Talk, t!("Push to talk"), cx))
                .child(recorder(shell, Chosen::Bound(Bound::ToggleMute), t!("Toggle mute"), cx))
                .child(recorder(
                    shell,
                    Chosen::Bound(Bound::ToggleDeafen),
                    t!("Toggle deafen"),
                    cx,
                ))
                .child(recorder(
                    shell,
                    Chosen::Bound(Bound::VoicePriority),
                    t!("Voice priority (hold to override)"),
                    cx,
                )),
        )
        .children(crate::hotkeys::AVAILABLE.then(|| global_keys(shell, cx)))
        .children(GROUPS.map(|(group, keys)| {
            div().child(super::heading(lit, group())).child(
                Card::new().children(
                    keys.iter()
                        .map(|(does, bound)| recorder(shell, Chosen::Bound(*bound), does(), cx)),
                ),
            )
        }))
        .child(rule(cx))
        .child(whisper(shell, theme, cx))
        .child(rule(cx))
        .child(
            super::heading(lit, t!("Chat - built-in (not configurable)"))
                .hint(t!("These shortcuts are always active inside the message composer.")),
        )
        .child(Card::new().children(BUILT_IN.map(|(does, key)| fixed_row(does(), key, theme))))
}

/// The switch that binds the voice keys with the system, where the system
/// has keys to bind: they then work while another program has the
/// keyboard, and are taken from every other program for as long.
fn global_keys(shell: &Shell, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let on = shell.panels.settings.global_keys;
    div().mt(px(14.0)).child(
        SwitchRow::new("global-keys", t!("Keys work in other programs too"), on)
            .look(Look::Setting)
            .hint(t!(
                "Binds push to talk, the whisper key, mute and deafen with the system. A key bound that way is taken from every other program."
            ))
            .on_click(cx.listener(move |shell, _, _, cx| shell.set_global_keys(!on, cx))),
    )
}

/// A key chosen by pressing it, called `label`.
fn recorder(
    shell: &Shell,
    which: Chosen,
    label: SharedString,
    cx: &mut Context<Shell>,
) -> Recorder {
    let (id, key, recording): (&'static str, Option<SharedString>, bool) = match which {
        Chosen::Talk => (
            "push-to-talk-key",
            shell.ptt.key.clone().map(|key| key.to_uppercase().into()),
            shell.ptt.choosing,
        ),
        Chosen::Whisper => (
            "whisper-key",
            shell
                .whisper
                .key
                .clone()
                .map(|key| key.to_uppercase().into()),
            shell.whisper.choosing_key,
        ),
        Chosen::Bound(bound) => (
            bound.name(),
            shell
                .panels
                .settings
                .shortcuts
                .key(bound)
                .map(|key| SharedString::from(key.to_owned())),
            shell.panels.settings.recording == Some(bound),
        ),
    };
    Recorder::new(id, label, key, recording)
        .words(
            t!("Not set"),
            t!("Press a key combo..."),
            t!("Clear shortcut"),
        )
        .on_record(cx.listener(move |shell, _, window, cx| shell.record_key(which, window, cx)))
        .on_clear(cx.listener(move |shell, _, _, cx| shell.clear_key(which, cx)))
}

/// A key as GPUI names it (`ctrl-shift-m`) as a key cap writes it
/// (`Ctrl+Shift+M`).
fn cap(key: &str) -> SharedString {
    key.split('-')
        .map(|part| {
            let mut chars = part.chars();
            chars.next().map_or_else(String::new, |first| {
                first.to_uppercase().chain(chars).collect()
            })
        })
        .collect::<Vec<_>>()
        .join("+")
        .into()
}

/// A key that does one thing and cannot be changed.
fn fixed_row(does: SharedString, key: &'static str, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .py(px(5.0))
        .flex()
        .items_center()
        .gap(px(12.0))
        .child(div().flex_1().min_w_0().text_size(px(12.5)).child(does))
        .child(
            div()
                .flex_none()
                .text_size(px(11.0))
                .text_color(theme.c.muted)
                .child(Kbd::new(cap(key))),
        )
}

/// The one whisper of this client: who it goes to, its key, and the way
/// to stop whispering to them.
fn whisper(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let summary = match &shell.whisper.target {
        Some((WhisperTarget::User(_), name)) => t!("To {{names}}", names = name),
        Some((WhisperTarget::Channel(_), name)) => t!("Shout to {{name}}", name = name),
        None => t!("No target set"),
    };
    let chosen = shell.whisper.target.is_some();
    div()
        .child(super::heading(&shell.panels.settings.lit, t!("Whisper and shout")).hint(t!(
            "Hold a key to speak to specific people or to another channel instead of the one you are in. It works in every activation mode."
        )))
        .child(
            Card::new().child(
                div()
                    .py(px(4.0))
                    .flex()
                    .items_center()
                    .gap(px(10.0))
                    .child(
                        div()
                            .flex_1()
                            .min_w(px(140.0))
                            .child(
                                div()
                                    .text_size(px(12.5))
                                    .font_weight(super::super::widgets::EMPHASIS)
                                    .child(t!("Whisper")),
                            )
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.c.muted)
                                    .truncate()
                                    .child(summary),
                            ),
                    )
                    .child(recorder(shell, Chosen::Whisper, SharedString::default(), cx))
                    .when(chosen, |row| {
                        row.child(
                            Button::new("whisper-forget", t!("Remove"))
                                .size(Size::Compact)
                                .tone(Tone::Danger)
                                .on_click(cx.listener(|shell, _, _, cx| {
                                    shell.set_whisper_target(None, cx);
                                })),
                        )
                    }),
            ),
        )
}
