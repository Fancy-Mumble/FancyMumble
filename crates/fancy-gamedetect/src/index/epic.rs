//! Epic Games Store installs, from the launcher's own manifests.
//!
//! The Epic launcher writes one JSON `.item` file per installed game into
//! `%PROGRAMDATA%\Epic\EpicGamesLauncher\Data\Manifests`, carrying the install
//! location and the display name. This is the same directory Playnite reads,
//! and it needs no launcher process to be running.

use super::{normalise_dir, InstalledGame, Store};

/// Add every Epic game on this machine.
pub(super) fn collect(out: &mut Vec<InstalledGame>) {
    let Some(dir) = manifest_dir() else { return };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("item") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        if let Some(game) = parse_manifest(&text) {
            out.push(game);
        }
    }
}

fn manifest_dir() -> Option<std::path::PathBuf> {
    let program_data = std::env::var_os("PROGRAMDATA")?;
    Some(
        std::path::Path::new(&program_data)
            .join("Epic")
            .join("EpicGamesLauncher")
            .join("Data")
            .join("Manifests"),
    )
}

/// Turn one `.item` manifest into an index entry.
fn parse_manifest(text: &str) -> Option<InstalledGame> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let install = value.get("InstallLocation")?.as_str()?;
    if install.is_empty() {
        return None;
    }
    let name = value
        .get("DisplayName")
        .and_then(serde_json::Value::as_str)
        .or_else(|| value.get("AppName").and_then(serde_json::Value::as_str))
        .unwrap_or("Epic game");
    Some(InstalledGame {
        store: Store::Epic,
        name: name.to_owned(),
        install_dir: normalise_dir(install),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_manifest_yields_its_install_location_and_name() {
        let text = r#"{
            "FormatVersion": 0,
            "AppName": "Fortnite",
            "DisplayName": "Fortnite",
            "InstallLocation": "D:\\Epic\\Fortnite",
            "LaunchExecutable": "FortniteGame\\Binaries\\Win64\\FortniteClient.exe"
        }"#;
        let game = parse_manifest(text).expect("manifest parses");
        assert_eq!(game.store, Store::Epic);
        assert_eq!(game.name, "Fortnite");
        assert_eq!(game.install_dir, "d:\\epic\\fortnite");
    }

    #[test]
    fn a_manifest_without_an_install_location_is_skipped() {
        assert!(parse_manifest(r#"{"DisplayName":"X"}"#).is_none());
        assert!(parse_manifest(r#"{"DisplayName":"X","InstallLocation":""}"#).is_none());
    }

    #[test]
    fn a_manifest_falls_back_to_the_app_name() {
        let game = parse_manifest(r#"{"AppName":"Abc","InstallLocation":"C:\\G"}"#)
            .expect("manifest parses");
        assert_eq!(game.name, "Abc");
    }
}
