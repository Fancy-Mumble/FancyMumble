//! Keys that go to one person, on the Shortcuts page, as the web UI's
//! "Jump to user": each a person kept by certificate (or, without one, by
//! name on the server they were picked on), a key chosen by pressing it,
//! and a press that opens the conversation with them.
//!
//! The web client looks for them on every server it is on; this client
//! reads the people of the server on screen, so it finds them there.

use gpui::{Context, Div, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{
    Banner, Button, Card, Emphasis, Empty, Note, Recorder, Select, Size, Tone,
};
use crate::engine::Conversation;
use crate::store::{Someone, UserShortcut, accelerator};
use crate::theme::Theme;
use crate::words::t;

impl Shell {
    /// Open the picker of somebody to bind a key to, or close it.
    fn pick_jump(&mut self, open: bool, cx: &mut Context<Self>) {
        self.panels.settings.picking_jump = open.then_some(None);
        cx.notify();
    }

    /// Bind a key to the person of `session` on the server on screen.
    fn add_jump(&mut self, session: u32, cx: &mut Context<Self>) {
        let Some(user) = self
            .snapshot
            .users
            .iter()
            .find(|user| user.session == session)
        else {
            return;
        };
        let active = self.snapshot.sessions.iter().find(|entry| entry.active);
        let hash = user.hash.as_ref().map(ToString::to_string);
        let jumps = &mut self.panels.settings.jumps;
        let id = format!(
            "us-{}",
            jumps.iter().map(|jump| jump.id.len()).sum::<usize>() + jumps.len() + 1
        );
        jumps.push(UserShortcut {
            id,
            hotkey: String::new(),
            user_name: user.name.to_string(),
            server_id: hash
                .is_none()
                .then(|| active.map(|entry| entry.key.to_string()))
                .flatten(),
            server_label: hash
                .is_none()
                .then(|| active.map(|entry| entry.name.to_string()))
                .flatten(),
            user_hash: hash,
        });
        self.panels.settings.picking_jump = None;
        self.remember_settings(cx);
        cx.notify();
    }

    /// Unbind the key of the shortcut `id`.
    fn remove_jump(&mut self, id: &str, cx: &mut Context<Self>) {
        self.panels.settings.jumps.retain(|jump| jump.id != id);
        self.remember_settings(cx);
        cx.notify();
    }

    /// Take the next key pressed as the key of the shortcut `id`.
    fn record_jump(&mut self, id: String, window: &mut gpui::Window, cx: &mut Context<Self>) {
        self.panels.settings.recording_jump = Some(id);
        cx.clear_key_bindings();
        window.focus(&self.focus, cx);
        cx.notify();
    }

    /// A key went down: the key of a shortcut being chosen, or a shortcut's
    /// key, which opens the conversation with its person. Whether it was
    /// taken.
    pub(in crate::ui) fn hear_jump_key(
        &mut self,
        keystroke: &gpui::Keystroke,
        cx: &mut Context<Self>,
    ) -> bool {
        if let Some(id) = self.panels.settings.recording_jump.clone() {
            let escape = keystroke.key == "escape" && !keystroke.modifiers.modified();
            let Some(key) = accelerator(keystroke).filter(|_| !escape) else {
                if escape {
                    self.panels.settings.recording_jump = None;
                    super::super::keys::rebind(&self.panels.settings.shortcuts, cx);
                    cx.notify();
                }
                return true;
            };
            if let Some(jump) = self
                .panels
                .settings
                .jumps
                .iter_mut()
                .find(|jump| jump.id == id)
            {
                jump.hotkey = key;
            }
            self.panels.settings.recording_jump = None;
            super::super::keys::rebind(&self.panels.settings.shortcuts, cx);
            self.remember_settings(cx);
            cx.notify();
            return true;
        }
        let Some(pressed) = accelerator(keystroke) else {
            return false;
        };
        let found = self
            .panels
            .settings
            .jumps
            .iter()
            .filter(|jump| jump.hotkey == pressed)
            .find_map(|jump| self.find_jump(jump));
        let Some((on, session)) = found else {
            return false;
        };
        // Somebody on another server: that one is turned to first, as the
        // web UI's jump switches server before it opens the conversation.
        if self.active_session.as_ref() != Some(&on) {
            self.engine.activate_session(&on);
            self.take_snapshot();
            self.follow_active_session(cx);
        }
        self.open_conversation(Conversation::Direct(session), cx);
        true
    }

    /// Where `jump` goes: by certificate on any server the client is on,
    /// else by name on the server it was made on, if that one is open; the
    /// session it is on, and theirs there.
    fn find_jump(&self, jump: &UserShortcut) -> Option<(SharedString, u32)> {
        let made_on = jump.server_id.as_deref().and_then(|key| {
            self.snapshot
                .sessions
                .iter()
                .find(|entry| entry.key.as_ref() == key)
        });
        if let Some((on, session)) = self.engine.find_user(
            jump.user_hash.as_deref(),
            &jump.user_name,
            made_on.map(|entry| entry.id.as_ref()),
        ) {
            return Some((on, session));
        }
        // A server that cannot search its other sessions: the one on show.
        let here = self.snapshot.sessions.iter().find(|entry| entry.active)?;
        jump.find(
            self.snapshot.users.iter().map(|user| Someone {
                session: user.session,
                name: user.name.as_ref(),
                hash: user.hash.as_ref().map(AsRef::as_ref),
            }),
            &here.key,
        )
        .map(|session| (here.id.clone(), session))
    }
}

/// The group: its heading, the shortcuts, and the way to add one.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let settings = &shell.panels.settings;
    let list = if settings.jumps.is_empty() {
        Empty::new(t!("No user shortcuts yet.")).into_any_element()
    } else {
        Card::new()
            .children(
                settings
                    .jumps
                    .iter()
                    .map(|jump| row(shell, jump, theme, cx)),
            )
            .into_any_element()
    };
    div()
        .child(super::heading(&settings.lit, t!("Jump to user (cross-server)")).hint(t!(
            "Bind a global hotkey to a specific person. Users are identified solely by their certificate hash, so when you press the hotkey the app finds them on whichever server you are currently connected to and opens the direct message."
        )))
        .child(list)
        .child(match settings.picking_jump {
            Some(chosen) => picker(shell, chosen, theme, cx).into_any_element(),
            None => div()
                .mt(px(10.0))
                .flex()
                .child(
                    Button::new("jump-add", t!("Add user shortcut"))
                        .emphasis(Emphasis::Outlined)
                        .size(Size::Compact)
                        .on_click(cx.listener(|shell, _, _, cx| shell.pick_jump(true, cx))),
                )
                .into_any_element(),
        })
}

/// One shortcut: who, where they are found, its key, and the way to drop it.
fn row(
    shell: &Shell,
    jump: &UserShortcut,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let scope = match (&jump.user_hash, &jump.server_label) {
        (Some(_), _) => t!("matches across all servers"),
        (None, Some(server)) => t!("only on {{server}} (no certificate)", server = server),
        (None, None) => t!("server-scoped (no certificate)"),
    };
    let (record, remove) = (jump.id.clone(), jump.id.clone());
    let id = named("jump", &jump.id);
    let recording = shell.panels.settings.recording_jump.as_deref() == Some(jump.id.as_str());
    let key = (!jump.hotkey.is_empty()).then(|| SharedString::from(jump.hotkey.clone()));
    div()
        .py(px(4.0))
        .flex()
        .items_center()
        .gap(px(10.0))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .child(
                    div()
                        .text_size(px(12.5))
                        .font_weight(super::super::widgets::EMPHASIS)
                        .truncate()
                        .child(SharedString::from(jump.user_name.clone())),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme.c.muted)
                        .truncate()
                        .child(scope),
                ),
        )
        .child(
            Recorder::new(id, SharedString::default(), key, recording)
                .words(
                    t!("Not set"),
                    t!("Press a key combo..."),
                    t!("Clear shortcut"),
                )
                .on_record(cx.listener(move |shell, _, window, cx| {
                    shell.record_jump(record.clone(), window, cx);
                }))
                .on_clear(cx.listener({
                    let id = jump.id.clone();
                    move |shell, _, _, cx| {
                        if let Some(jump) =
                            shell.panels.settings.jumps.iter_mut().find(|j| j.id == id)
                        {
                            jump.hotkey.clear();
                        }
                        shell.remember_settings(cx);
                        cx.notify();
                    }
                })),
        )
        .child(
            Button::new(named("jump-remove", &jump.id), t!("Remove"))
                .size(Size::Compact)
                .tone(Tone::Danger)
                .on_click(cx.listener(move |shell, _, _, cx| shell.remove_jump(&remove, cx))),
        )
}

/// `prefix-id` as a name that lives as long as the program, for a control's
/// id: made once for each shortcut ever shown, not at every frame.
fn named(prefix: &str, id: &str) -> &'static str {
    thread_local! {
        static NAMED: std::cell::RefCell<std::collections::HashMap<String, &'static str>> =
            std::cell::RefCell::default();
    }
    let key = format!("{prefix}-{id}");
    NAMED.with_borrow_mut(|named| {
        *named
            .entry(key.clone())
            .or_insert_with(|| Box::leak(key.into_boxed_str()))
    })
}

/// The picker of somebody on the server on screen.
fn picker(
    shell: &Shell,
    chosen: Option<u32>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let own = shell.snapshot.own_session;
    let mut people: Vec<_> = shell
        .snapshot
        .users
        .iter()
        .filter(|user| Some(user.session) != own)
        .collect();
    people.sort_by(|a, b| a.name.cmp(&b.name));
    let sessions: Vec<u32> = people.iter().map(|user| user.session).collect();
    let mut names = vec![t!("Select a user...")];
    names.extend(people.iter().map(|user| {
        if user.hash.is_some() {
            user.name.clone()
        } else {
            SharedString::from(format!("{} ({})", user.name, t!("no certificate")))
        }
    }));
    let at = chosen
        .and_then(|session| sessions.iter().position(|known| *known == session))
        .map_or(0, |at| at + 1);
    let connected = shell.snapshot.connection == crate::engine::Connection::Connected;
    Card::new()
        .mt(px(10.0))
        .child(div().text_size(px(12.0)).font_weight(super::super::widgets::EMPHASIS).mb(px(7.0)).child(t!("Pick a user from the active server")))
        .when(!connected, |card| card.child(Banner::new(Note::Warn).child(t!("Connect to a server first to pick a user."))))
        .when(connected && sessions.is_empty(), |card| {
            card.child(Banner::new(Note::Warn).child(t!(
                "No other users with a certificate hash are visible on this server."
            )))
        })
        .child(div().mt(px(8.0)).child(Select::new("jump-pick", names, at).on_choose(cx.listener(
            move |shell, at: &usize, _, cx| {
                shell.panels.settings.picking_jump = Some(at.checked_sub(1).and_then(|at| sessions.get(at).copied()));
                cx.notify();
            },
        ))))
        .child(div().mt(px(7.0)).text_size(px(11.0)).text_color(theme.c.muted).child(t!(
            "Users with a certificate match on every server you join. Users without one stay tied to the current server."
        )))
        .child(
            div()
                .mt(px(10.0))
                .flex()
                .justify_end()
                .gap(px(6.0))
                .child(
                    Button::new("jump-cancel", t!("Cancel"))
                        .size(Size::Compact)
                        .on_click(cx.listener(|shell, _, _, cx| shell.pick_jump(false, cx))),
                )
                .child(div().when(chosen.is_none(), |add| add.opacity(0.4)).child(
                    Button::new("jump-confirm", t!("Add"))
                        .emphasis(Emphasis::Contained)
                        .size(Size::Compact)
                        .on_click(cx.listener(move |shell, _, _, cx| {
                            if let Some(session) = chosen {
                                shell.add_jump(session, cx);
                            }
                        })),
                )),
        )
}
