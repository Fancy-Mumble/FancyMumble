//! Keys that work while another program has the keyboard: talking,
//! whispering, muting and deafening without coming back to this window.
//!
//! A key bound here is taken from every other program for as long as it is
//! bound: that is what makes it work everywhere, and why nothing is bound
//! until the user asks. The binding is the system's (`RegisterHotKey` on
//! Windows), through the `global-hotkey` crate the web client also uses.
//!
//! Windows only so far. Elsewhere there is nothing to bind with, and the
//! view says so by offering no switch.

/// What a key bound here does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Does {
    /// Transmit while it is held.
    Talk,
    /// Whisper to whoever was chosen while it is held.
    Whisper,
    /// Mute, or unmute.
    Mute,
    /// Deafen, or undeafen.
    Deafen,
}

/// A bound key went down or came up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Struck {
    pub does: Does,
    pub down: bool,
}

/// A key as GPUI names it (`f9`, `space`, `ctrl-shift-m`) in the form the
/// system's hotkeys are spelled in (`F9`, `SPACE`, `ctrl+shift+M`).
#[cfg_attr(
    not(windows),
    allow(dead_code, reason = "only Windows binds keys so far")
)]
fn spelled(key: &str) -> String {
    // The key itself may be a hyphen, which is also what parts the names.
    let (modifiers, key) = match key.strip_suffix('-') {
        Some(before) => (before.trim_end_matches('-'), "-"),
        None => key.rsplit_once('-').unwrap_or(("", key)),
    };
    modifiers
        .split('-')
        .filter(|modifier| !modifier.is_empty())
        .map(|modifier| match modifier {
            // What GPUI calls the Windows key, the system's hotkeys call super.
            "cmd" | "win" | "platform" => "super",
            other => other,
        })
        .chain(std::iter::once(key))
        .collect::<Vec<_>>()
        .join("+")
}

pub(crate) use bound::Hotkeys;

/// Whether this system has keys to bind at all: what decides whether the
/// switch for them is offered.
pub(crate) const AVAILABLE: bool = cfg!(windows);

/// Where there is nothing to bind with: the same shape, doing nothing, so
/// that nothing above it needs to know which system it is on.
#[cfg(not(windows))]
mod bound {
    use super::{Does, Struck};

    /// No keys: there are none to bind on this system yet.
    #[derive(Debug)]
    pub(crate) struct Hotkeys {
        struck: async_channel::Receiver<Struck>,
    }

    impl Hotkeys {
        /// # Errors
        ///
        /// Always: there is nothing to bind with here.
        pub(crate) fn new() -> Result<Self, String> {
            Err("Keys cannot be bound for other programs on this system yet".to_owned())
        }

        /// Where a bound key would be said to have been struck.
        pub(crate) fn struck(&self) -> async_channel::Receiver<Struck> {
            self.struck.clone()
        }

        /// # Errors
        ///
        /// Never: there is nothing to refuse.
        pub(crate) fn bind(&mut self, _: Does, _: Option<&str>) -> Result<(), String> {
            Ok(())
        }
    }
}

#[cfg(windows)]
mod bound {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, PoisonError};

    use global_hotkey::hotkey::HotKey;
    use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};

    use super::{Does, Struck, spelled};

    /// What each bound key does, by the id the system reports it under:
    /// read where the system calls back, which is not always this thread.
    type Table = Arc<Mutex<HashMap<u32, Does>>>;

    /// The keys bound with the system. Dropping it gives them all back.
    pub(crate) struct Hotkeys {
        manager: GlobalHotKeyManager,
        bound: HashMap<Does, HotKey>,
        table: Table,
        struck: async_channel::Receiver<Struck>,
    }

    impl std::fmt::Debug for Hotkeys {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.debug_struct("Hotkeys")
                .field("bound", &self.bound.keys().collect::<Vec<_>>())
                .finish_non_exhaustive()
        }
    }

    impl Hotkeys {
        /// Ready to bind keys, on the thread that runs the window: the
        /// system reports a key to the thread that bound it.
        ///
        /// # Errors
        ///
        /// When the system gives no window to hear the keys with.
        pub(crate) fn new() -> Result<Self, String> {
            let manager = GlobalHotKeyManager::new().map_err(|error| error.to_string())?;
            let table = Table::default();
            let (said, struck) = async_channel::unbounded();
            let heard = Arc::clone(&table);
            // One per process, and kept for its life: a second set of keys
            // would hear nothing. There is one window, and one set.
            GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
                let does = heard
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .get(&event.id)
                    .copied();
                if let Some(does) = does {
                    let down = event.state == HotKeyState::Pressed;
                    let _ = said.try_send(Struck { does, down });
                }
            }));
            Ok(Self {
                manager,
                bound: HashMap::new(),
                table,
                struck,
            })
        }

        /// Where a bound key is said to have gone down or come up.
        pub(crate) fn struck(&self) -> async_channel::Receiver<Struck> {
            self.struck.clone()
        }

        /// Have `key`, as GPUI names it, do `does`; or with `None`, have
        /// nothing do it. What did it before is given back first.
        ///
        /// # Errors
        ///
        /// When the key is none the system knows, or another program holds
        /// it. Nothing does `does` then.
        pub(crate) fn bind(&mut self, does: Does, key: Option<&str>) -> Result<(), String> {
            if let Some(held) = self.bound.remove(&does) {
                let _ = self.manager.unregister(held);
                let _ = self.table().remove(&held.id());
            }
            let Some(key) = key else {
                return Ok(());
            };
            let hotkey: HotKey = spelled(key)
                .parse()
                .map_err(|_| format!("{key} cannot be used from other programs"))?;
            self.manager.register(hotkey).map_err(|error| {
                tracing::warn!(key, ?does, %error, "a key could not be bound with the system");
                match error {
                    global_hotkey::Error::AlreadyRegistered(_) => {
                        format!("{} is taken by another program", key.to_uppercase())
                    }
                    other => other.to_string(),
                }
            })?;
            let _ = self.table().insert(hotkey.id(), does);
            let _ = self.bound.insert(does, hotkey);
            tracing::info!(
                key,
                id = hotkey.id(),
                ?does,
                "bound a key for use in any program"
            );
            Ok(())
        }

        fn table(&self) -> std::sync::MutexGuard<'_, HashMap<u32, Does>> {
            self.table.lock().unwrap_or_else(PoisonError::into_inner)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_is_spelled_the_way_the_system_reads_it() {
        assert_eq!(spelled("f9"), "f9");
        assert_eq!(spelled("space"), "space");
        assert_eq!(spelled("ctrl-shift-m"), "ctrl+shift+m");
        assert_eq!(spelled("cmd-alt-k"), "super+alt+k");
        // The hyphen is a key too.
        assert_eq!(spelled("-"), "-");
        assert_eq!(spelled("ctrl--"), "ctrl+-");
    }

    #[cfg(windows)]
    #[test]
    fn the_keys_this_client_binds_are_ones_the_system_knows() {
        use global_hotkey::hotkey::HotKey;
        for key in [
            "f9",
            "space",
            "a",
            "ctrl-shift-m",
            "ctrl-shift-d",
            "pageup",
            "-",
        ] {
            let parsed: Result<HotKey, _> = spelled(key).parse();
            assert!(parsed.is_ok(), "{key}");
        }
        // Two keys are two ids: what the system reports them by.
        let id = |key: &str| {
            spelled(key)
                .parse::<HotKey>()
                .map(|hotkey| hotkey.id())
                .ok()
        };
        assert_ne!(id("ctrl-shift-m"), id("ctrl-shift-d"));
        assert!(spelled("no such key").parse::<HotKey>().is_err());
    }
}
