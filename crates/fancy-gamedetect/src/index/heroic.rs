//! Epic and GOG games installed through Heroic, which is how they get onto a
//! Linux machine at all.
//!
//! Heroic drives `legendary` for Epic and its own downloader for GOG, and both
//! record what they installed in JSON under `~/.config/heroic` - the same
//! files Heroic itself reads on startup, so no launcher has to be running.
//! Standalone `legendary` (no Heroic) keeps its own copy of that file, and the
//! Flatpak build keeps everything under `~/.var/app`.
//!
//! Windows has none of this: there the Epic launcher's own manifests are
//! authoritative and `epic.rs` reads them instead.

use super::{normalise_dir, InstalledGame, Store};

/// Add every Heroic-installed game on this machine.
pub(super) fn collect(out: &mut Vec<InstalledGame>) {
    for path in legendary_files() {
        if let Ok(text) = std::fs::read_to_string(&path) {
            out.extend(parse_legendary(&text));
        }
    }
    for path in gog_files() {
        if let Ok(text) = std::fs::read_to_string(&path) {
            out.extend(parse_gog(&text));
        }
    }
}

/// Where `legendary` records the Epic games it installed.
#[cfg(target_os = "linux")]
fn legendary_files() -> Vec<String> {
    config_roots()
        .into_iter()
        .flat_map(|root| {
            [
                format!("{root}/heroic/legendaryConfig/legendary/installed.json"),
                format!("{root}/legendary/installed.json"),
            ]
        })
        .collect()
}

/// Where Heroic records the GOG games it installed.
#[cfg(target_os = "linux")]
fn gog_files() -> Vec<String> {
    config_roots()
        .into_iter()
        .map(|root| format!("{root}/heroic/gog_store/installed.json"))
        .collect()
}

/// The config directories Heroic and legendary write to, native and Flatpak.
#[cfg(target_os = "linux")]
fn config_roots() -> Vec<String> {
    let Ok(home) = std::env::var("HOME") else {
        return Vec::new();
    };
    let native = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| format!("{home}/.config"));
    vec![
        native,
        format!("{home}/.var/app/com.heroicgameslauncher.hgl/config"),
    ]
}

#[cfg(not(target_os = "linux"))]
fn legendary_files() -> Vec<String> {
    Vec::new()
}

#[cfg(not(target_os = "linux"))]
fn gog_files() -> Vec<String> {
    Vec::new()
}

/// `legendary`'s `installed.json`: one object per game, keyed by app name.
fn parse_legendary(text: &str) -> Vec<InstalledGame> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    let Some(games) = value.as_object() else {
        return Vec::new();
    };
    games
        .values()
        .filter_map(|game| {
            let install = game.get("install_path")?.as_str()?;
            let name = game
                .get("title")
                .and_then(serde_json::Value::as_str)
                .map_or_else(|| fallback_name(install), str::to_owned);
            entry(Store::Epic, name, install)
        })
        .collect()
}

/// Heroic's `gog_store/installed.json`: a list under `installed`, which
/// carries no title - hence [`fallback_name`].
fn parse_gog(text: &str) -> Vec<InstalledGame> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    let Some(games) = value.get("installed").and_then(serde_json::Value::as_array) else {
        return Vec::new();
    };
    games
        .iter()
        .filter_map(|game| {
            let install = game.get("install_path")?.as_str()?;
            entry(Store::Gog, fallback_name(install), install)
        })
        .collect()
}

fn entry(store: Store, name: String, install: &str) -> Option<InstalledGame> {
    if install.is_empty() {
        return None;
    }
    Some(InstalledGame {
        store,
        name,
        install_dir: normalise_dir(install),
    })
}

/// The install directory's own name, for the stores that record no title.
/// It is what the user picked in the installer, so it reads like the game.
fn fallback_name(install: &str) -> String {
    std::path::Path::new(install).file_name().map_or_else(
        || install.to_owned(),
        |name| name.to_string_lossy().into_owned(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legendary_entries_carry_their_title() {
        let games = parse_legendary(
            r#"{
                "Sugar": {
                    "app_name": "Sugar",
                    "title": "Alan Wake 2",
                    "install_path": "/home/u/Games/Alan Wake 2"
                }
            }"#,
        );
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "Alan Wake 2");
        assert_eq!(games[0].install_dir, "/home/u/games/alan wake 2");
        assert_eq!(games[0].store, Store::Epic);
    }

    #[test]
    fn a_gog_entry_is_named_after_its_directory() {
        let games = parse_gog(
            r#"{"installed": [
                {"appName": "1207658930", "install_path": "/games/Cyberpunk 2077"}
            ]}"#,
        );
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "Cyberpunk 2077");
        assert_eq!(games[0].store, Store::Gog);
    }

    #[test]
    fn a_game_with_no_install_path_is_skipped() {
        assert!(parse_legendary(r#"{"Sugar": {"title": "X"}}"#).is_empty());
        assert!(parse_gog(r#"{"installed": [{"appName": "X"}]}"#).is_empty());
    }

    #[test]
    fn nonsense_json_yields_no_games() {
        assert!(parse_legendary("not json").is_empty());
        assert!(parse_gog("[]").is_empty());
    }
}
