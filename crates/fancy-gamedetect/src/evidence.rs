//! What counts as evidence that the foreground window is a game, and how much
//! each piece is worth.
//!
//! Weights are deliberately arranged so that no single soft signal reaches the
//! `Game` threshold on its own. "It is fullscreen and has no title bar"
//! describes a game, a film and a slideshow equally well, so it can only ever
//! support a verdict, never carry one. The signals that do carry one are the
//! ones that mean somebody already classified the program as a game: a game
//! store installed it, Windows remembers it as a game, or it announces itself
//! as one.

/// One thing the classifier noticed, and what it was worth.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reason {
    /// Stable machine-readable tag, e.g. `"store:steam"` or `"veto:browser"`.
    pub code: String,
    /// What it contributed to the score. Zero for observations kept only for
    /// the diagnostics panel; vetoes carry their weight but end the scoring.
    pub weight: i32,
    /// Free-form detail: the matched install directory, the window class.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl Reason {
    /// A scoring reason with no further detail.
    #[must_use]
    pub fn new(code: &str, weight: i32) -> Self {
        Self {
            code: code.to_owned(),
            weight,
            detail: None,
        }
    }

    /// A scoring reason that names what it matched.
    #[must_use]
    pub fn detailed(code: &str, weight: i32, detail: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            weight,
            detail: Some(detail.into()),
        }
    }
}

/// The evidence kinds, with the weight each contributes.
///
/// Kept as an enum rather than loose integers so the diagnostics panel, the
/// tests and the tuning notes all talk about the same things.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Evidence {
    /// The executable lives under a game store's install directory.
    InstalledUnderStore,
    /// Windows' own `GameConfigStore` lists this executable as a game -
    /// written when Game Bar's "Remember this is a game" is ticked and when
    /// Fullscreen Optimizations classifies a title.
    WindowsRemembersGame,
    /// The process is publishing Discord Rich Presence.
    PublishesPresence,
    /// Borderless and covering its monitor.
    FullscreenShaped,
    /// The shell reports a fullscreen app is running.
    ShellBusy,
    /// A game engine's window class.
    EngineWindowClass,
}

impl Evidence {
    /// The score this evidence contributes.
    #[must_use]
    pub const fn weight(self) -> i32 {
        match self {
            Self::PublishesPresence => 70,
            Self::InstalledUnderStore => 60,
            Self::WindowsRemembersGame => 50,
            Self::EngineWindowClass => 40,
            Self::FullscreenShaped => 25,
            Self::ShellBusy => 10,
        }
    }

    /// The tag this evidence is reported under.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::InstalledUnderStore => "store",
            Self::WindowsRemembersGame => "windows-game-list",
            Self::PublishesPresence => "rich-presence",
            Self::FullscreenShaped => "fullscreen-shaped",
            Self::ShellBusy => "shell-busy",
            Self::EngineWindowClass => "engine-class",
        }
    }
}

/// Window classes that only a game engine's runtime registers.
///
/// A hit here is worth a lot because these are the runtimes games ship in and
/// almost nothing else does. The editors built on the same engines register
/// the same class, which is why the deny-list checks executable names first -
/// `Unity.exe` is the editor, and it loses regardless of its window class.
const ENGINE_CLASSES: &[(&str, &str)] = &[
    ("UnityWndClass", "Unity"),
    ("UnrealWindow", "Unreal Engine"),
    ("GLFW30", "GLFW (LWJGL, Minecraft)"),
    ("SDL_app", "SDL"),
    ("Valve001", "GoldSrc/Source"),
    ("CryENGINE", "CryEngine"),
    ("RGSS Player", "RPG Maker"),
    ("Godot_Engine", "Godot"),
    ("YYGameMakerYY", "GameMaker"),
    ("LWJGL", "LWJGL"),
    ("Riot Client", "Riot"),
    ("D3D Window", "generic Direct3D"),
];

/// Recognise a game engine by its window class.
///
/// Case-insensitive: the class is whatever the runtime registered, and the
/// same engine has shipped it capitalised differently across versions.
#[must_use]
pub(crate) fn engine_for_class(class: &str) -> Option<&'static str> {
    ENGINE_CLASSES
        .iter()
        .find(|(needle, _)| needle.eq_ignore_ascii_case(class))
        .map(|(_, engine)| *engine)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_classes_match_case_insensitively() {
        assert_eq!(engine_for_class("unitywndclass"), Some("Unity"));
        assert_eq!(engine_for_class("UnrealWindow"), Some("Unreal Engine"));
        assert_eq!(engine_for_class("Chrome_WidgetWin_1"), None);
    }

    #[test]
    fn no_single_soft_signal_reaches_the_game_threshold() {
        // The threshold lives in `classify`; this asserts the invariant the
        // weights exist to keep - a film in a player must not score its way in.
        let soft = Evidence::FullscreenShaped.weight() + Evidence::ShellBusy.weight();
        assert!(soft < crate::classify::GAME_THRESHOLD);
    }

    #[test]
    fn any_hard_signal_alone_is_a_game() {
        for hard in [Evidence::PublishesPresence, Evidence::InstalledUnderStore] {
            assert!(hard.weight() >= crate::classify::GAME_THRESHOLD);
        }
    }
}
