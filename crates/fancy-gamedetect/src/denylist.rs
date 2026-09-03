//! Software that never gets an overlay put over it, whatever it scores.
//!
//! The overlay's worst failure is not missing a game - that costs a hotkey
//! press - but appearing over someone's CAD drawing, their code, or the
//! spreadsheet they are presenting. So desktop software is vetoed by name
//! rather than merely out-scored, and the veto is checked before anything
//! else. A user allow-rule still beats it: this is a default, not a policy.

/// Executable stems (lowercased, no extension) that are never games.
///
/// Grouped by what they are so the list stays reviewable. Matching is exact on
/// the stem, except for the prefix entries in [`DENY_PREFIXES`].
const DENY_STEMS: &[&str] = &[
    // The shell and Windows' own surfaces.
    "explorer",
    "searchhost",
    "searchapp",
    "shellexperiencehost",
    "startmenuexperiencehost",
    "applicationframehost",
    "lockapp",
    "systemsettings",
    "taskmgr",
    "dwm",
    // Browsers. A fullscreen video is fullscreen-shaped and nothing else.
    "chrome",
    "msedge",
    "firefox",
    "brave",
    "opera",
    "vivaldi",
    "chromium",
    "zen",
    "librewolf",
    "waterfox",
    // Office and documents.
    "winword",
    "excel",
    "powerpnt",
    "onenote",
    "outlook",
    "acrord32",
    "acrobat",
    "soffice",
    "soffice.bin",
    "obsidian",
    "notion",
    // Editors, IDEs and terminals.
    "code",
    "code - insiders",
    "cursor",
    "windsurf",
    "devenv",
    "rider64",
    "idea64",
    "clion64",
    "pycharm64",
    "webstorm64",
    "goland64",
    "studio64",
    "sublime_text",
    "notepad",
    "notepad++",
    "windowsterminal",
    "wt",
    "powershell",
    "pwsh",
    "cmd",
    "conhost",
    "alacritty",
    "wezterm-gui",
    // CAD, 3D and creative tools. These are the ones an overlay must never
    // interrupt, and several of them render fullscreen and borderless.
    "acad",
    "sldworks",
    "inventor",
    "cnext",
    "fusion360",
    "rhino",
    "revit",
    "navisworks",
    "freecad",
    "blender",
    "photoshop",
    "illustrator",
    "indesign",
    "lightroom",
    "afterfx",
    "adobe premiere pro",
    "resolve",
    "maya",
    "3dsmax",
    "houdini",
    "houdinifx",
    "cinema 4d",
    "zbrush",
    "krita",
    "gimp",
    "inkscape",
    "affinity photo",
    "affinity designer",
    "figma",
    // Game engines' editors. The runtime's window class matches games too,
    // so the editor has to lose on its name.
    "unity",
    "unityhub",
    "unrealeditor",
    "ue4editor",
    "ue5editor",
    "godot",
    "gamemaker",
    "gamemakerstudio",
    "rpgmk",
    "defold",
    // Communication and meetings, including ourselves.
    "teams",
    "ms-teams",
    "zoom",
    "slack",
    "discord",
    "discordptb",
    "discordcanary",
    "telegram",
    "whatsapp",
    "signal",
    "skype",
    "webexmta",
    "fancy-mumble",
    "mumble",
    "qt6ui",
    // Remote desktop, capture and streaming hosts. The remote screen may well
    // be a game, but it is not this machine's game and the overlay would be
    // drawn on the wrong side of the wire.
    "mstsc",
    "parsecd",
    "parsec",
    "moonlight",
    "sunshine",
    "vncviewer",
    "tvnserver",
    "teamviewer",
    "anydesk",
    "rustdesk",
    "obs64",
    "obs32",
    "streamlabs obs",
    // Media players. A film is fullscreen-shaped; someone who wants the
    // roster over films adds an allow rule.
    "vlc",
    "mpv",
    "mpc-hc64",
    "mpc-be64",
    "potplayermini64",
    "wmplayer",
    "spotify",
    "plex",
    "jellyfinmediaplayer",
    // Launchers. A launcher is not the game, which is exactly what Discord's
    // `is_launcher` flag encodes.
    "steam",
    "steamwebhelper",
    "epicgameslauncher",
    "galaxyclient",
    "battle.net",
    "riotclientservices",
    "riotclientux",
    "ubisoftconnect",
    "upc",
    "uplay",
    "eadesktop",
    "origin",
    "xboxpcapp",
    "gamingservices",
    "itch",
    "playnite.desktopapp",
    "playnite.fullscreenapp",
    "heroic",
    "lutris",
];

/// Stems whose *prefix* is enough, for families that version their binaries.
const DENY_PREFIXES: &[&str] = &[
    "substance",
    "solidworks",
    "autodesk",
    "matlab",
    "labview",
    "altium",
    "kicad",
    "eagle",
    "ansys",
    "abaqus",
    "catia",
    "creo",
    "siemens nx",
    "visual studio",
    "jetbrains",
    "davinci",
];

/// Window classes that are never a game, whatever the executable is called.
///
/// Only the ones that positively identify a non-game surface: a generic
/// toolkit class (Qt, WPF, `WinForms`) says nothing either way, because plenty
/// of small games ship in them.
const DENY_CLASSES: &[&str] = &[
    "CabinetWClass", // Explorer window
    "Progman",       // desktop
    "WorkerW",       // desktop wallpaper host
    "Shell_TrayWnd", // taskbar
    "#32770",        // a plain dialog box
    "MCLWindow",     // Minecraft Launcher
];

/// Directory names that mean "this is the thing that starts games", not a game.
///
/// Launchers defeat name matching: the Minecraft Launcher ships as
/// `C:\XboxGames\Minecraft Launcher\content\minecraft.exe`, which is
/// installed under a game store (so it scores as one) and is called
/// `minecraft.exe` (so no deny-list of executable names can catch it without
/// also catching the game). Its *path* says what it is, and so does almost
/// every other launcher's. This is Discord's `is_launcher` flag, derived
/// rather than looked up.
const LAUNCHER_PATH_MARKERS: &[&str] = &["launcher", "bootstrapper"];

/// Why the veto fired, for the diagnostics panel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Veto {
    /// The executable is on the deny-list.
    Executable,
    /// It lives in a launcher's directory, whatever it is called.
    Launcher,
    /// The window class is a shell surface or a launcher's.
    WindowClass,
}

/// Is this window vetoed outright?
pub(crate) fn veto_for(exe_path: &str, exe_stem: &str, class: &str) -> Option<Veto> {
    let stem = exe_stem.trim().to_ascii_lowercase();
    if DENY_STEMS.contains(&stem.as_str()) {
        return Some(Veto::Executable);
    }
    if DENY_PREFIXES.iter().any(|p| stem.starts_with(p)) {
        return Some(Veto::Executable);
    }
    if is_launcher_path(exe_path) {
        return Some(Veto::Launcher);
    }
    if DENY_CLASSES.iter().any(|c| c.eq_ignore_ascii_case(class)) {
        return Some(Veto::WindowClass);
    }
    None
}

/// Does any directory this executable sits in name it a launcher?
///
/// Only the directories are examined, never the file name: a game called
/// `Rocket Launcher.exe` is a game, and the folder it lives in is what says
/// otherwise.
fn is_launcher_path(exe_path: &str) -> bool {
    let lowered = exe_path.to_ascii_lowercase();
    let mut segments: Vec<&str> = lowered.split(['\\', '/']).collect();
    // Drop the file name; a launcher is identified by where it lives.
    let _file = segments.pop();
    segments
        .iter()
        .any(|segment| LAUNCHER_PATH_MARKERS.iter().any(|m| segment.contains(m)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Most cases care only about the name, so spell the path once.
    fn veto(stem: &str, class: &str) -> Option<Veto> {
        veto_for(&format!("c:\\apps\\{stem}.exe"), stem, class)
    }

    #[test]
    fn productivity_software_is_vetoed() {
        for stem in ["explorer", "acad", "code", "winword", "blender", "chrome"] {
            assert!(veto(stem, "SomeClass").is_some(), "{stem} should be vetoed");
        }
    }

    #[test]
    fn a_launcher_is_caught_by_its_directory_whatever_it_is_called() {
        assert_eq!(
            veto_for(
                "c:\\xboxgames\\minecraft launcher\\content\\minecraft.exe",
                "minecraft",
                "MCLWindow",
            ),
            Some(Veto::Launcher)
        );
        assert_eq!(
            veto_for(
                "c:\\program files\\rockstar games\\launcher\\playgtav.exe",
                "playgtav",
                "X",
            ),
            Some(Veto::Launcher)
        );
    }

    #[test]
    fn the_file_name_alone_never_makes_something_a_launcher() {
        // A game may legitimately be called this; only its directories decide.
        assert_eq!(
            veto_for(
                "d:\\games\\arena\\rocket launcher.exe",
                "rocket launcher",
                "X"
            ),
            None
        );
    }

    #[test]
    fn versioned_families_are_vetoed_by_prefix() {
        assert!(veto("substance 3d painter", "X").is_some());
        assert!(veto("davinci resolve", "X").is_some());
    }

    #[test]
    fn the_unity_editor_loses_but_a_unity_game_does_not() {
        assert!(veto("unity", "UnityWndClass").is_some());
        assert!(veto("eldenring", "UnityWndClass").is_none());
    }

    #[test]
    fn launchers_are_not_games() {
        for stem in ["steam", "epicgameslauncher", "battle.net", "upc"] {
            assert!(veto(stem, "X").is_some(), "{stem} is a launcher");
        }
    }

    #[test]
    fn shell_surfaces_are_vetoed_by_class() {
        assert_eq!(veto("somegame", "CabinetWClass"), Some(Veto::WindowClass));
    }

    #[test]
    fn an_ordinary_game_survives() {
        assert!(veto("eldenring", "ELDEN RING").is_none());
        assert!(veto("factorio", "SDL_app").is_none());
    }
}
