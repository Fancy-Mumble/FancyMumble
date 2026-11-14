//! Whisper and shout targets on the Shortcuts page, as the web UI's
//! (`WhisperTargetsSection`): several, each named, each with its key, each
//! reaching people (kept by certificate where they have one) or a channel
//! (the one picked, or whichever the user is in), widened to links and
//! sub-channels, narrowed to a group. Holding a target's key speaks to it
//! and to nobody else.
//!
//! Each target keeps a slot of the server's for as long as the client
//! runs, registered again whenever who is where changes, so a key press
//! loses no first syllable; the first slot stays the whisper chosen from a
//! person's menu. The keys work in the window; binding them with the system
//! is the web UI's, which this client does for the menu's whisper key only.

use std::collections::BTreeMap;

use gpui::{Context, Div, Entity, ParentElement, SharedString, Styled, div, prelude::*, px};
use mumble_tauri_lib::engine_api::whisper::WhisperReach;

use super::super::Shell;
use super::super::kit::{
    Button, Card, Emphasis, Empty, Field, Recorder, Segmented, Select, Size, SwitchRow, Tone,
};
use super::super::text_input::TextInput;
use crate::store::{ChannelMode, Roster, WhisperBinding, WhisperKind, WhisperUser, accelerator};
use crate::theme::Theme;
use crate::words::t;

/// A target being made or changed, and the fields it is typed into.
pub(in crate::ui) struct Draft {
    pub binding: WhisperBinding,
    name: Entity<TextInput>,
    group: Entity<TextInput>,
}

/// The targets, and what the page and the keys are doing with them.
#[derive(Default)]
pub(in crate::ui) struct Whispers {
    pub targets: Vec<WhisperBinding>,
    pub draft: Option<Draft>,
    /// The target whose key is being chosen.
    pub recording: Option<String>,
    /// The slot whose key is held.
    pub held: Option<u8>,
    /// What each slot was last registered with on this connection.
    registered: BTreeMap<u8, Option<WhisperReach>>,
}

impl Whispers {
    /// The targets kept.
    pub(in crate::ui) fn kept(targets: Vec<WhisperBinding>) -> Self {
        Self {
            targets,
            ..Self::default()
        }
    }
}

/// `prefix` and `at` as a selector that lives as long as the program.
fn named(prefix: &str, at: usize) -> &'static str {
    Box::leak(format!("{prefix}-{at}").into_boxed_str())
}

impl Shell {
    /// Who is on the server now, as a target is resolved against it.
    fn roster(&self) -> Roster<'_> {
        Roster {
            people: self
                .snapshot
                .users
                .iter()
                .filter(|user| Some(user.session) != self.snapshot.own_session)
                .map(|user| (user.session, user.name.as_ref(), user.hash.as_ref().map(AsRef::as_ref)))
                .collect(),
            channels: self.snapshot.channels.iter().map(|channel| channel.id).collect(),
            current: self.snapshot.current_channel,
        }
    }

    /// Register each target in its slot, sending only what changed; a slot
    /// whose target went is emptied.
    pub(in crate::ui) fn sync_whispers(&mut self) {
        if self.snapshot.connection != crate::engine::Connection::Connected {
            return;
        }
        let roster = self.roster();
        let mut wanted: BTreeMap<u8, Option<WhisperReach>> = self
            .panels
            .settings
            .whispers
            .targets
            .iter()
            .enumerate()
            .filter_map(|(at, target)| Some((WhisperBinding::slot(at)?, target.reach(&roster))))
            .collect();
        drop(roster);
        let whispers = &mut self.panels.settings.whispers;
        for slot in whispers.registered.keys() {
            let _ = wanted.entry(*slot).or_insert(None);
        }
        for (slot, reach) in wanted {
            if whispers.registered.get(&slot).is_some_and(|held| *held == reach) {
                continue;
            }
            if reach.is_none() && !whispers.registered.contains_key(&slot) {
                continue;
            }
            self.engine.register_whisper(slot, reach.clone());
            let _ = whispers.registered.insert(slot, reach);
        }
    }

    /// Another connection: nothing is registered there yet.
    pub(in crate::ui) fn forget_whisper_slots(&mut self) {
        self.panels.settings.whispers.registered.clear();
        self.panels.settings.whispers.held = None;
    }

    /// A key went down: a target's key being chosen, or a target's key
    /// held to speak to it. Whether it was taken.
    pub(in crate::ui) fn hear_whisper_key(&mut self, keystroke: &gpui::Keystroke, cx: &mut Context<Self>) -> bool {
        let whispers = &mut self.panels.settings.whispers;
        if let Some(id) = whispers.recording.clone() {
            let escape = keystroke.key == "escape" && !keystroke.modifiers.modified();
            let Some(key) = accelerator(keystroke).filter(|_| !escape) else {
                if escape {
                    whispers.recording = None;
                    super::super::keys::rebind(&self.panels.settings.shortcuts, cx);
                    cx.notify();
                }
                return true;
            };
            if let Some(target) = whispers.targets.iter_mut().find(|target| target.id == id) {
                target.hotkey = key;
            }
            whispers.recording = None;
            super::super::keys::rebind(&self.panels.settings.shortcuts, cx);
            self.remember_settings(cx);
            cx.notify();
            return true;
        }
        let Some(pressed) = accelerator(keystroke) else {
            return false;
        };
        let Some(at) = whispers.targets.iter().position(|target| target.hotkey == pressed) else {
            return false;
        };
        // Held keys repeat; only the first press is a press.
        if whispers.held.is_some() {
            return true;
        }
        let Some(slot) = WhisperBinding::slot(at) else {
            return false;
        };
        // An unresolvable target sends nothing: never the channel instead.
        let reach = self.panels.settings.whispers.targets[at].reach(&self.roster());
        if let Some(reach) = reach {
            self.panels.settings.whispers.held = Some(slot);
            self.engine.whisper_slot(slot, Some(reach));
        }
        true
    }

    /// A key came up: the end of a target's whisper, if it was its key.
    pub(in crate::ui) fn release_whisper_key(&mut self, keystroke: &gpui::Keystroke) -> bool {
        let whispers = &mut self.panels.settings.whispers;
        let Some(slot) = whispers.held else {
            return false;
        };
        let released = accelerator(&gpui::Keystroke {
            modifiers: gpui::Modifiers::none(),
            ..keystroke.clone()
        });
        let at = usize::from(slot) - 2;
        let key = whispers
            .targets
            .get(at)
            .and_then(|target| target.hotkey.rsplit('+').next().map(str::to_owned));
        if released.is_none() || key != released {
            return false;
        }
        whispers.held = None;
        self.engine.whisper_slot(slot, None);
        true
    }

    /// Start making a new target, or change the one with `id`.
    fn draft_whisper(&mut self, id: Option<String>, cx: &mut Context<Self>) {
        let count = self.panels.settings.whispers.targets.len();
        let binding = match id {
            Some(id) => self
                .panels
                .settings
                .whispers
                .targets
                .iter()
                .find(|target| target.id == id)
                .cloned(),
            None => Some(WhisperBinding::new(
                format!("wt-{}", whisper_serial(&self.panels.settings.whispers.targets)),
                t!("Whisper {{n}}", n = count + 1).to_string(),
            )),
        };
        let Some(binding) = binding else {
            return;
        };
        let field = |cx: &mut Context<Self>, text: String| {
            cx.new(|cx| {
                let mut field = TextInput::new(SharedString::default(), cx);
                field.set_text(text);
                field
            })
        };
        let name = field(cx, binding.name.clone());
        let group = field(cx, binding.group.clone().unwrap_or_default());
        self.panels.settings.whispers.draft = Some(Draft { binding, name, group });
        cx.notify();
    }

    /// Change the target being made.
    fn change_draft(&mut self, change: impl FnOnce(&mut WhisperBinding), cx: &mut Context<Self>) {
        if let Some(draft) = &mut self.panels.settings.whispers.draft {
            change(&mut draft.binding);
        }
        cx.notify();
    }

    /// Keep the target being made, in place of the one it changes.
    fn save_draft(&mut self, cx: &mut Context<Self>) {
        let Some(mut draft) = self.panels.settings.whispers.draft.take() else {
            return;
        };
        draft.binding.name = draft.name.read(cx).text().trim().to_owned();
        let group = draft.group.read(cx).text().trim().to_owned();
        draft.binding.group = Some(group).filter(|group| !group.is_empty());
        if !draft.binding.complete() {
            self.panels.settings.whispers.draft = Some(draft);
            return;
        }
        let targets = &mut self.panels.settings.whispers.targets;
        match targets.iter_mut().find(|target| target.id == draft.binding.id) {
            Some(target) => *target = draft.binding,
            None => targets.push(draft.binding),
        }
        self.sync_whispers();
        self.remember_settings(cx);
        cx.notify();
    }

    /// Forget the target `id`.
    fn remove_whisper(&mut self, id: &str, cx: &mut Context<Self>) {
        self.panels.settings.whispers.targets.retain(|target| target.id != id);
        self.sync_whispers();
        self.remember_settings(cx);
        cx.notify();
    }

    /// Take the next key pressed as the key of the target `id`.
    fn record_whisper_key(&mut self, id: String, window: &mut gpui::Window, cx: &mut Context<Self>) {
        self.panels.settings.whispers.recording = Some(id);
        cx.clear_key_bindings();
        window.focus(&self.focus);
        cx.notify();
    }
}

/// A number no target's id has yet.
fn whisper_serial(targets: &[WhisperBinding]) -> usize {
    (1..)
        .find(|n| !targets.iter().any(|target| target.id == format!("wt-{n}")))
        .unwrap_or(0)
}

/// What a target reaches, said in a line.
fn summary(target: &WhisperBinding) -> SharedString {
    match target.kind {
        WhisperKind::Users if target.users.is_empty() => t!("No target set"),
        WhisperKind::Users => {
            let names: Vec<&str> = target.users.iter().map(|user| user.name.as_str()).collect();
            t!("To {{names}}", names = names.join(", "))
        }
        WhisperKind::Channel if target.channel_mode == ChannelMode::Current => {
            t!("Shout to your current channel")
        }
        WhisperKind::Channel => match &target.channel_name {
            Some(name) => t!("Shout to {{name}}", name = name.clone()),
            None => t!("No target set"),
        },
    }
}

/// The group: its heading, the targets, and the way to add one.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let whispers = &shell.panels.settings.whispers;
    let list = if whispers.targets.is_empty() {
        div().child(Empty::new(t!("No whisper or shout targets yet.")))
    } else {
        div().child(Card::new().children(
            whispers.targets.iter().enumerate().map(|(at, target)| row(shell, at, target, theme, cx)),
        ))
    };
    div()
        .child(list)
        .child(match &whispers.draft {
            Some(draft) => editor(shell, draft, theme, cx),
            None => div().mt(px(10.0)).flex().child(
                Button::new("whisper-add", t!("Add whisper target"))
                    .emphasis(Emphasis::Outlined)
                    .size(Size::Compact)
                    .on_click(cx.listener(|shell, _, _, cx| shell.draft_whisper(None, cx))),
            ),
        })
}

/// One target: its name and whom it reaches, its key, and changing or
/// forgetting it.
fn row(
    shell: &Shell,
    at: usize,
    target: &WhisperBinding,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> gpui::Stateful<Div> {
    let recording = shell.panels.settings.whispers.recording.as_deref() == Some(target.id.as_str());
    let key = Some(target.hotkey.clone()).filter(|key| !key.is_empty()).map(SharedString::from);
    let (record, edit, remove) = (target.id.clone(), target.id.clone(), target.id.clone());
    let clear = target.id.clone();
    div()
        .id(("whisper-target", at))
        .debug_selector(move || format!("whisper-target-{at}"))
        .py(px(4.0))
        .flex()
        .items_center()
        .gap(px(10.0))
        .child(
            div()
                .flex_1()
                .min_w(px(140.0))
                .child(div().truncate().text_size(px(12.5)).font_weight(super::super::widgets::EMPHASIS).child(SharedString::from(target.name.clone())))
                .child(div().truncate().text_size(px(11.0)).text_color(theme.c.muted).child(summary(target))),
        )
        .child(
            Recorder::new(named("whisper-key", at), SharedString::default(), key, recording)
                .words(t!("Not set"), t!("Press a key combo..."), t!("Clear shortcut"))
                .on_record(cx.listener(move |shell, _, window, cx| {
                    shell.record_whisper_key(record.clone(), window, cx);
                }))
                .on_clear(cx.listener(move |shell, _, _, cx| {
                    if let Some(target) = shell.panels.settings.whispers.targets.iter_mut().find(|target| target.id == clear) {
                        target.hotkey.clear();
                    }
                    shell.remember_settings(cx);
                    cx.notify();
                })),
        )
        .child(
            Button::new("whisper-edit", t!("Edit"))
                .selector(named("whisper-edit", at))
                .size(Size::Compact)
                .on_click(cx.listener(move |shell, _, _, cx| shell.draft_whisper(Some(edit.clone()), cx))),
        )
        .child(
            Button::new("whisper-remove", t!("Remove"))
                .selector(named("whisper-remove", at))
                .tone(Tone::Danger)
                .size(Size::Compact)
                .on_click(cx.listener(move |shell, _, _, cx| shell.remove_whisper(&remove, cx))),
        )
}

/// The target being made: its name, whether it whispers or shouts, whom
/// or where, and keeping it.
fn editor(shell: &Shell, draft: &Draft, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let binding = &draft.binding;
    let named_ok = !draft.name.read(cx).text().trim().is_empty();
    let reaches = WhisperBinding {
        name: "-".to_owned(),
        ..binding.clone()
    }
    .complete();
    let kind = match binding.kind {
        WhisperKind::Users => 0,
        WhisperKind::Channel => 1,
    };
    let body = match binding.kind {
        WhisperKind::Users => people(shell, binding, theme, cx),
        WhisperKind::Channel => channel(shell, draft, theme, cx),
    };
    let save = Button::new("whisper-save", t!("Save"))
        .emphasis(Emphasis::Contained)
        .size(Size::Compact);
    let on = named_ok && reaches;
    div().mt(px(10.0)).debug_selector(|| "whisper-editor".to_owned()).child(
        Card::new()
            .child(div().mt(px(8.0)).mb(px(14.0)).child(Field::new(t!("Name"), super::account_box(&draft.name, "whisper-name", theme))))
            .child(Field::new(
                t!("Target"),
                Segmented::new("whisper-kind", [t!("Whisper to users"), t!("Shout to channel")], kind).on_choose(cx.listener(
                    |shell, at: &usize, _, cx| {
                        let to = if *at == 0 { WhisperKind::Users } else { WhisperKind::Channel };
                        shell.change_draft(|binding| binding.kind = to, cx);
                    },
                )),
            ))
            .child(div().mt(px(14.0)).child(body))
            .child(
                div()
                    .mt(px(10.0))
                    .flex()
                    .justify_end()
                    .gap(px(6.0))
                    .child(
                        Button::new("whisper-cancel", t!("Cancel"))
                            .size(Size::Compact)
                            .on_click(cx.listener(|shell, _, _, cx| {
                                shell.panels.settings.whispers.draft = None;
                                cx.notify();
                            })),
                    )
                    .child(if on {
                        save.on_click(cx.listener(|shell, _, _, cx| shell.save_draft(cx)))
                    } else {
                        save.disabled(true)
                    }),
            ),
    )
}

/// The people a whisper reaches, and the way to add one of those here.
fn people(shell: &Shell, binding: &WhisperBinding, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let candidates: Vec<(SharedString, Option<SharedString>)> = {
        let mut here: Vec<_> = shell
            .snapshot
            .users
            .iter()
            .filter(|user| Some(user.session) != shell.snapshot.own_session)
            .filter(|user| {
                !binding.users.iter().any(|picked| match &picked.hash {
                    Some(hash) => user.hash.as_ref().is_some_and(|known| known.as_ref() == hash),
                    None => user.name.as_ref() == picked.name,
                })
            })
            .map(|user| (user.name.clone(), user.hash.clone()))
            .collect();
        here.sort_by(|a, b| a.0.cmp(&b.0));
        here
    };
    let picked = if binding.users.is_empty() {
        div().mb(px(8.0)).text_size(px(11.5)).text_color(theme.c.muted).child(t!("No users picked yet."))
    } else {
        div().mb(px(8.0)).flex().flex_wrap().gap(px(6.0)).children(binding.users.iter().enumerate().map(|(at, user)| {
            div()
                .flex()
                .items_center()
                .gap(px(4.0))
                .pl(px(10.0))
                .pr(px(4.0))
                .py(px(3.0))
                .text_size(px(12.0))
                .rounded(theme.skin.radius_md)
                .bg(theme.c.accent_soft)
                .border_1()
                .border_color(theme.c.accent_line)
                .child(SharedString::from(user.name.clone()))
                .child(
                    super::super::kit::IconButton::at("whisper-unpick", at, "x")
                        .size(16.0)
                        .glyph_size(12.0)
                        .on_click(cx.listener(move |shell, _, _, cx| {
                            shell.change_draft(|binding| drop(binding.users.remove(at)), cx);
                        })),
                )
        }))
    };
    let names: Vec<SharedString> = std::iter::once(t!("Add a user..."))
        .chain(candidates.iter().map(|(name, _)| name.clone()))
        .collect();
    div()
        .child(div().mb(px(7.0)).text_size(px(12.0)).font_weight(super::super::widgets::EMPHASIS).child(t!("Users")))
        .child(picked)
        .child(Select::new("whisper-pick", names, 0).on_choose(cx.listener(move |shell, at: &usize, _, cx| {
            let Some((name, hash)) = at.checked_sub(1).and_then(|at| candidates.get(at)).cloned() else {
                return;
            };
            shell.change_draft(
                |binding| {
                    binding.users.push(WhisperUser {
                        name: name.to_string(),
                        hash: hash.map(|hash| hash.to_string()),
                    });
                },
                cx,
            );
        })))
        .child(div().mt(px(7.0)).text_size(px(11.0)).text_color(theme.c.muted).child(t!("Users with a certificate are found on any server. Users without one are matched by name.")))
}

/// Where a shout goes: the channel picked or the one the user is in, its
/// links and sub-channels, and a group.
fn channel(shell: &Shell, draft: &Draft, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let binding = &draft.binding;
    let mode = usize::from(binding.channel_mode == ChannelMode::Current);
    let mut channels: Vec<(u32, SharedString)> = shell
        .snapshot
        .channels
        .iter()
        .map(|channel| (channel.id, channel.name.clone()))
        .collect();
    channels.sort_by(|a, b| a.1.cmp(&b.1));
    let chosen = binding
        .channel_id
        .and_then(|id| channels.iter().position(|(known, _)| *known == id))
        .map_or(0, |at| at + 1);
    let names: Vec<SharedString> = std::iter::once(t!("Pick a channel"))
        .chain(channels.iter().map(|(_, name)| name.clone()))
        .collect();
    let (links, children) = (binding.links, binding.children);
    div()
        .child(Field::new(
            t!("Channel"),
            Segmented::new("whisper-mode", [t!("A specific channel"), t!("My current channel")], mode).on_choose(
                cx.listener(|shell, at: &usize, _, cx| {
                    let to = if *at == 0 { ChannelMode::Fixed } else { ChannelMode::Current };
                    shell.change_draft(|binding| binding.channel_mode = to, cx);
                }),
            ),
        ))
        .when(binding.channel_mode == ChannelMode::Fixed, |group| {
            group.child(div().mt(px(14.0)).child(Field::new(
                t!("Pick a channel"),
                Select::new("whisper-channel", names, chosen).on_choose(cx.listener(move |shell, at: &usize, _, cx| {
                    let picked = at.checked_sub(1).and_then(|at| channels.get(at)).cloned();
                    shell.change_draft(
                        |binding| {
                            binding.channel_id = picked.as_ref().map(|(id, _)| *id);
                            binding.channel_name = picked.map(|(_, name)| name.to_string());
                        },
                        cx,
                    );
                })),
            )))
        })
        .child(
            div()
                .mt(px(14.0))
                .child(SwitchRow::new("whisper-links", t!("Include linked channels"), links).on_click(cx.listener(
                    move |shell, _, _, cx| shell.change_draft(|binding| binding.links = !links, cx),
                )))
                .child(SwitchRow::new("whisper-children", t!("Include sub-channels"), children).on_click(cx.listener(
                    move |shell, _, _, cx| shell.change_draft(|binding| binding.children = !children, cx),
                ))),
        )
        .child(div().mt(px(14.0)).child(Field::new(
            t!("Only members of group"),
            div()
                .child(div().mt(px(-3.0)).mb(px(7.0)).text_size(px(11.5)).text_color(theme.c.muted).child(t!(
                    "Optional. An ACL group name such as admin. Leave it empty to reach everyone."
                )))
                .child(super::account_box(&draft.group, "whisper-group", theme)),
        )))
}
