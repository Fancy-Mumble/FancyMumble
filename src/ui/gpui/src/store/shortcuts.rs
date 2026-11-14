//! The keys the user chose for what the window does, by the web client's
//! names for each (`ShortcutBindings`) and written as it writes them
//! (`Ctrl+Shift+M`, `Alt+ArrowUp`): its kept choices are this client's.
//!
//! Only what the user changed is kept; everything else is the web
//! client's default. A key is one action's: choosing it for another takes
//! it from the first.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// What a key can be chosen for, besides push to talk and whispering,
/// which keep keys of their own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Bound {
    ToggleMute,
    ToggleDeafen,
    VoicePriority,
    ToggleActivationMode,
    MoveChannelUp,
    MoveChannelDown,
    JumpToRootChannel,
    ToggleChannelSidebar,
    ToggleMemberPanel,
    OpenQuickSearch,
    OpenSettings,
    ToggleFullscreen,
}

impl Bound {
    /// Every one, in the order the page lists them.
    pub(crate) const ALL: [Self; 12] = [
        Self::ToggleMute,
        Self::ToggleDeafen,
        Self::VoicePriority,
        Self::ToggleActivationMode,
        Self::MoveChannelUp,
        Self::MoveChannelDown,
        Self::JumpToRootChannel,
        Self::ToggleChannelSidebar,
        Self::ToggleMemberPanel,
        Self::OpenQuickSearch,
        Self::OpenSettings,
        Self::ToggleFullscreen,
    ];

    /// The web client's name for it.
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::ToggleMute => "toggleMute",
            Self::ToggleDeafen => "toggleDeafen",
            Self::VoicePriority => "voicePriority",
            Self::ToggleActivationMode => "toggleActivationMode",
            Self::MoveChannelUp => "moveChannelUp",
            Self::MoveChannelDown => "moveChannelDown",
            Self::JumpToRootChannel => "jumpToRootChannel",
            Self::ToggleChannelSidebar => "toggleChannelSidebar",
            Self::ToggleMemberPanel => "toggleMemberPanel",
            Self::OpenQuickSearch => "openQuickSearch",
            Self::OpenSettings => "openSettings",
            Self::ToggleFullscreen => "toggleFullscreen",
        }
    }

    /// Its key until the user chooses another: the web client's.
    pub(crate) const fn default_key(self) -> &'static str {
        match self {
            Self::ToggleMute => "Ctrl+Shift+M",
            Self::ToggleDeafen => "Ctrl+Shift+D",
            Self::VoicePriority | Self::ToggleActivationMode => "",
            Self::MoveChannelUp => "Alt+ArrowUp",
            Self::MoveChannelDown => "Alt+ArrowDown",
            Self::JumpToRootChannel => "Alt+Home",
            Self::ToggleChannelSidebar => "Ctrl+B",
            Self::ToggleMemberPanel => "Ctrl+U",
            Self::OpenQuickSearch => "Ctrl+F",
            Self::OpenSettings => "Ctrl+,",
            Self::ToggleFullscreen => "F11",
        }
    }
}

/// The keys as the user chose them: what differs from the defaults, by
/// the web client's names; an empty key is none.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct Bindings(BTreeMap<String, String>);

impl Bindings {
    pub(crate) fn is_default(&self) -> bool {
        self.0.is_empty()
    }

    /// The key of `bound`, as the web client writes it; none where it has
    /// none.
    pub(crate) fn key(&self, bound: Bound) -> Option<&str> {
        let key = self
            .0
            .get(bound.name())
            .map_or(bound.default_key(), String::as_str);
        (!key.is_empty()).then_some(key)
    }

    /// Give `bound` the key `key` (none for no key). An action that had
    /// that key loses it, and is said.
    pub(crate) fn set(&mut self, bound: Bound, key: Option<&str>) -> Option<Bound> {
        let key = key.unwrap_or_default();
        let taken = (!key.is_empty())
            .then(|| {
                Bound::ALL
                    .into_iter()
                    .find(|other| *other != bound && self.key(*other) == Some(key))
            })
            .flatten();
        if let Some(other) = taken {
            self.put(other, "");
        }
        self.put(bound, key);
        taken
    }

    /// Keep `key` for `bound`, as a change where it is not the default.
    fn put(&mut self, bound: Bound, key: &str) {
        if key == bound.default_key() {
            let _ = self.0.remove(bound.name());
        } else {
            let _ = self.0.insert(bound.name().to_owned(), key.to_owned());
        }
    }

    /// Every action with a key, and the key as GPUI names it.
    pub(crate) fn chosen(&self) -> impl Iterator<Item = (Bound, String)> + '_ {
        Bound::ALL
            .into_iter()
            .filter_map(|bound| Some((bound, gpui_keys(self.key(bound)?)?)))
    }
}

/// The key pressed, as the web client writes a shortcut; none for a
/// modifier pressed alone.
pub(crate) fn accelerator(keystroke: &gpui::Keystroke) -> Option<String> {
    let key = web_key(&keystroke.key)?;
    let modifiers = &keystroke.modifiers;
    let mut parts: Vec<&str> = Vec::new();
    if modifiers.control {
        parts.push("Ctrl");
    }
    if modifiers.alt {
        parts.push("Alt");
    }
    if modifiers.shift {
        parts.push("Shift");
    }
    if modifiers.platform {
        parts.push("Super");
    }
    let mut written = parts.join("+");
    if !written.is_empty() {
        written.push('+');
    }
    written.push_str(&key);
    Some(written)
}

/// The names of keys that are not one character, as GPUI and as the web
/// client write them.
const NAMED: [(&str, &str); 14] = [
    ("up", "ArrowUp"),
    ("down", "ArrowDown"),
    ("left", "ArrowLeft"),
    ("right", "ArrowRight"),
    ("home", "Home"),
    ("end", "End"),
    ("pageup", "PageUp"),
    ("pagedown", "PageDown"),
    ("enter", "Enter"),
    ("tab", "Tab"),
    ("backspace", "Backspace"),
    ("delete", "Delete"),
    ("insert", "Insert"),
    ("space", "Space"),
];

/// A key as GPUI names it, as the web client names it.
fn web_key(key: &str) -> Option<String> {
    if matches!(
        key,
        "control" | "alt" | "shift" | "platform" | "function" | ""
    ) {
        return None;
    }
    if let Some((_, web)) = NAMED.iter().find(|(gpui, _)| *gpui == key) {
        return Some((*web).to_owned());
    }
    if key.chars().count() == 1 {
        return Some(key.to_uppercase());
    }
    // F1 to F24, and anything else GPUI names in words.
    let mut chars = key.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
}

/// A shortcut as the web client writes it, as GPUI names its keys
/// (`ctrl-shift-m`); none for one this cannot read.
pub(crate) fn gpui_keys(accelerator: &str) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut pieces: Vec<&str> = accelerator.split('+').collect();
    // `Ctrl++` is the plus key.
    if accelerator.ends_with("++") {
        pieces.truncate(pieces.len().saturating_sub(2));
        pieces.push("+");
    }
    let (key, modifiers) = pieces.split_last()?;
    for modifier in modifiers {
        parts.push(
            match *modifier {
                "Ctrl" | "Control" | "CommandOrControl" => "ctrl",
                "Alt" => "alt",
                "Shift" => "shift",
                "Super" | "Meta" | "Command" => "cmd",
                _ => return None,
            }
            .to_owned(),
        );
    }
    let key = NAMED
        .iter()
        .find(|(_, web)| web == key)
        .map_or_else(|| key.to_lowercase(), |(gpui, _)| (*gpui).to_owned());
    if key.is_empty() {
        return None;
    }
    parts.push(key);
    Some(parts.join("-"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keystroke(text: &str) -> gpui::Keystroke {
        gpui::Keystroke::parse(text).expect("a keystroke")
    }

    #[test]
    fn a_key_pressed_is_written_as_the_web_client_writes_it_and_read_back() {
        assert_eq!(
            accelerator(&keystroke("ctrl-shift-m")).as_deref(),
            Some("Ctrl+Shift+M")
        );
        assert_eq!(
            accelerator(&keystroke("alt-up")).as_deref(),
            Some("Alt+ArrowUp")
        );
        assert_eq!(accelerator(&keystroke("f11")).as_deref(), Some("F11"));
        assert_eq!(accelerator(&keystroke("ctrl-,")).as_deref(), Some("Ctrl+,"));
        for bound in Bound::ALL {
            if let Some(gpui) = gpui_keys(bound.default_key()) {
                let back = accelerator(&keystroke(&gpui));
                assert_eq!(back.as_deref(), Some(bound.default_key()), "{bound:?}");
            }
        }
        assert_eq!(gpui_keys("Ctrl+Shift+M").as_deref(), Some("ctrl-shift-m"));
        assert_eq!(gpui_keys("Alt+Home").as_deref(), Some("alt-home"));
        assert_eq!(gpui_keys("Hyper+X"), None, "not a modifier this knows");
        assert_eq!(gpui_keys(""), None);
    }

    #[test]
    fn a_key_is_one_actions_and_choosing_it_again_takes_it_from_the_first() {
        let mut keys = Bindings::default();
        assert_eq!(keys.key(Bound::ToggleMute), Some("Ctrl+Shift+M"));
        assert_eq!(keys.key(Bound::VoicePriority), None, "none until chosen");
        // Ctrl+B is the sidebar's: the activation mode takes it.
        assert_eq!(
            keys.set(Bound::ToggleActivationMode, Some("Ctrl+B")),
            Some(Bound::ToggleChannelSidebar)
        );
        assert_eq!(keys.key(Bound::ToggleChannelSidebar), None);
        assert_eq!(keys.key(Bound::ToggleActivationMode), Some("Ctrl+B"));
        // Back to its default: nothing is kept for it.
        assert_eq!(keys.set(Bound::ToggleMute, Some("Ctrl+Shift+M")), None);
        assert!(!keys.0.contains_key("toggleMute"));
        // Cleared: kept as none.
        let _ = keys.set(Bound::ToggleFullscreen, None);
        assert_eq!(keys.key(Bound::ToggleFullscreen), None);
        let kept = serde_json::to_string(&keys).expect("json");
        assert_eq!(
            kept,
            r#"{"toggleActivationMode":"Ctrl+B","toggleChannelSidebar":"","toggleFullscreen":""}"#
        );
        let chosen: Vec<String> = keys.chosen().map(|(_, key)| key).collect();
        assert!(chosen.contains(&"ctrl-b".to_owned()) && !chosen.contains(&"f11".to_owned()));
    }
}
