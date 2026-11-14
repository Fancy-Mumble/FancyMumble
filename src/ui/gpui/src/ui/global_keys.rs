//! The voice keys from any program: the switch that binds them with the
//! system, and what one of them struck does.
//!
//! Bound only once asked for: a key bound with the system is taken from
//! every other program for as long as it is.

use gpui::Context;

use super::Shell;
use crate::engine::Connection;
use crate::hotkeys::{Does, Hotkeys, Struck};

impl Shell {
    /// Let the voice keys work from other programs, or keep them to this
    /// window.
    pub(super) fn set_global_keys(&mut self, on: bool, cx: &mut Context<Self>) {
        self.panels.settings.global_keys = on;
        self.rebind_global_keys(cx);
        self.remember_settings(cx);
        cx.notify();
    }

    /// Bind with the system what the settings say is bound, and give back
    /// what they no longer do. Called whenever one of those changes: the
    /// switch, the keys themselves, whether talking takes a key.
    pub(super) fn rebind_global_keys(&mut self, cx: &mut Context<Self>) {
        if !self.panels.settings.global_keys && self.chrome.hotkeys.is_none() {
            return;
        }
        // A key that is no longer bound cannot say it came up.
        if std::mem::take(&mut self.ptt.held) {
            self.engine.push_to_talk(false);
        }
        if std::mem::take(&mut self.whisper.held) {
            self.engine.whisper(false);
        }
        if !self.panels.settings.global_keys {
            // Dropped: the system has every key back.
            self.chrome.hotkeys = None;
            return;
        }
        if self.chrome.hotkeys.is_none() {
            match Hotkeys::new() {
                Ok(hotkeys) => {
                    self.hear_global_keys(&hotkeys, cx);
                    self.chrome.hotkeys = Some(hotkeys);
                }
                Err(problem) => {
                    self.panels.settings.global_keys = false;
                    self.toast(problem, super::toasts::Kind::Told, cx);
                    return;
                }
            }
        }
        let talk = self
            .voice_settings
            .push_to_talk
            .then(|| self.ptt.key.clone())
            .flatten();
        let wanted = [
            (Does::Talk, talk),
            (Does::Whisper, self.whisper.key.clone()),
            (Does::Mute, self.chosen_global(crate::store::Bound::ToggleMute)),
            (Does::Deafen, self.chosen_global(crate::store::Bound::ToggleDeafen)),
        ];
        let Some(hotkeys) = self.chrome.hotkeys.as_mut() else {
            return;
        };
        // One key that cannot be bound does not cost the others.
        let refused: Vec<String> = wanted
            .into_iter()
            .filter_map(|(does, key)| {
                let key = key.as_ref().map(AsRef::<str>::as_ref);
                hotkeys.bind(does, key).err()
            })
            .collect();
        // Said where it can be seen from anywhere in the window; the log
        // has it too, for a launch that found a key taken.
        if !refused.is_empty() && self.chrome.told_of_keys != refused {
            self.toast(refused.join(" · "), super::toasts::Kind::Told, cx);
        }
        self.chrome.told_of_keys = refused;
    }

    /// Listen for the keys `hotkeys` binds, for as long as they are bound.
    fn hear_global_keys(&self, hotkeys: &Hotkeys, cx: &mut Context<Self>) {
        let struck = hotkeys.struck();
        cx.spawn(async move |shell, cx| {
            while let Ok(struck) = struck.recv().await {
                let heard = shell.update(cx, |shell, cx| shell.global_key(struck, cx));
                if heard.is_err() {
                    break;
                }
            }
        })
        .detach();
    }

    /// A key bound with the system went down or came up, in whichever
    /// program had the keyboard.
    pub(super) fn global_key(&mut self, struck: Struck, cx: &mut Context<Self>) {
        let connected = self.snapshot.connection == Connection::Connected;
        tracing::debug!(?struck, connected, "a key bound with the system was struck");
        match struck.does {
            Does::Talk => {
                let talks = self.voice_settings.push_to_talk && connected;
                // Up is always heard: a key held when the server went away
                // must still let go.
                if (talks || !struck.down) && self.ptt.held != struck.down {
                    self.ptt.held = struck.down;
                    self.engine.push_to_talk(struck.down);
                }
            }
            Does::Whisper => {
                if self.whisper.held != struck.down {
                    self.whisper.held = struck.down;
                    self.engine.whisper(struck.down);
                }
            }
            Does::Mute if struck.down && connected => self.engine.toggle_microphone(),
            Does::Deafen if struck.down && connected => self.engine.toggle_deafen(),
            Does::Mute | Does::Deafen => {}
        }
        cx.notify();
    }
}
