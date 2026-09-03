//! The launchers that record their installs in the registry.
//!
//! GOG, Ubisoft, EA and Battle.net each keep a key per installed game holding
//! its directory, so one shallow enumeration per store answers "did a game
//! store put this here?". Riot and the Xbox app use fixed directories instead.
//!
//! Every read is `HKEY_LOCAL_MACHINE` or `HKEY_CURRENT_USER` under a
//! vendor-owned path; nothing is written, and a missing or unreadable key
//! simply contributes nothing.

use super::{normalise_dir, InstalledGame, Store};

/// Registry locations that hold one subkey per installed game.
///
/// `(store, root path, value holding the directory, value holding the name)`.
/// The 32-bit view (`WOW6432Node`) is where all four of these write on a
/// 64-bit Windows, because their launchers are 32-bit.
const GAME_KEYS: &[(Store, &str, &str, &str)] = &[
    (
        Store::Gog,
        "SOFTWARE\\WOW6432Node\\GOG.com\\Games",
        "path",
        "gameName",
    ),
    (
        Store::Ubisoft,
        "SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs",
        "InstallDir",
        "",
    ),
    (
        Store::Ea,
        "SOFTWARE\\WOW6432Node\\EA Games",
        "Install Dir",
        "DisplayName",
    ),
    (
        Store::Ea,
        "SOFTWARE\\WOW6432Node\\Origin Games",
        "Install Dir",
        "DisplayName",
    ),
    (
        Store::BattleNet,
        "SOFTWARE\\WOW6432Node\\Blizzard Entertainment",
        "InstallPath",
        "DisplayName",
    ),
];

/// Add every game the registry-backed launchers know about.
#[cfg(windows)]
pub(super) fn collect(out: &mut Vec<InstalledGame>) {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    for (store, root, dir_value, name_value) in GAME_KEYS {
        let Ok(parent) = hklm.open_subkey(root) else {
            continue;
        };
        for child_name in parent.enum_keys().flatten() {
            let Ok(child) = parent.open_subkey(&child_name) else {
                continue;
            };
            let Ok(dir) = child.get_value::<String, _>(dir_value) else {
                continue;
            };
            if dir.trim().is_empty() {
                continue;
            }
            let name = child
                .get_value::<String, _>(name_value)
                .ok()
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| child_name.clone());
            out.push(InstalledGame {
                store: *store,
                name,
                install_dir: normalise_dir(&dir),
            });
        }
    }
    collect_fixed_dirs(out);
}

#[cfg(not(windows))]
pub(super) fn collect(_out: &mut Vec<InstalledGame>) {}

/// Riot and the Xbox app install into fixed, well-known directories.
///
/// Neither exposes a per-game registry key the way the others do, and
/// `WindowsApps` is not readable at all, so the directory itself stands in for
/// the list: anything running from inside it came from that store.
#[cfg(windows)]
fn collect_fixed_dirs(out: &mut Vec<InstalledGame>) {
    let mut candidates: Vec<(Store, String, &str)> = Vec::new();
    if let Some(program_data) = std::env::var_os("PROGRAMDATA") {
        let riot = std::path::Path::new(&program_data).join("Riot Games");
        candidates.push((
            Store::Riot,
            riot.to_string_lossy().into_owned(),
            "Riot game",
        ));
    }
    for drive in ["c:", "d:", "e:"] {
        candidates.push((Store::Xbox, format!("{drive}\\XboxGames"), "Xbox game"));
    }
    // Riot installs the games themselves next to the client, not under
    // ProgramData; the launcher's own directory is covered by the deny-list.
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        let riot = std::path::Path::new(&program_files).join("Riot Games");
        candidates.push((
            Store::Riot,
            riot.to_string_lossy().into_owned(),
            "Riot game",
        ));
    }

    for (store, dir, label) in candidates {
        if std::path::Path::new(&dir).is_dir() {
            out.push(InstalledGame {
                store,
                name: label.to_owned(),
                install_dir: normalise_dir(&dir),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_key_names_a_directory_value() {
        for (_, root, dir_value, _) in GAME_KEYS {
            assert!(!root.is_empty());
            assert!(!dir_value.is_empty(), "{root} needs a directory value");
        }
    }

    #[test]
    fn the_gog_key_reads_the_documented_values() {
        let gog = GAME_KEYS
            .iter()
            .find(|(store, ..)| *store == Store::Gog)
            .expect("GOG is indexed");
        assert_eq!(gog.2, "path");
        assert_eq!(gog.3, "gameName");
    }
}
