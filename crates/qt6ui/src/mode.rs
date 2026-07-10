//! Switch-back to the full (Tauri) client.
//!
//! Mirrors the `ui-mode` marker-file contract from
//! `mumble-tauri/src/ui_mode.rs`: a file named `ui-mode` in the app config
//! dir containing `full` or `minimal`. This crate is intentionally not a
//! workspace member (see README), so the logic is duplicated here instead
//! of shared through a crate.

use std::path::PathBuf;
use std::process::Command;

use crate::constants::{ENV_FULL_CLIENT_BIN, FULL_CLIENT_BINARY_NAMES, UI_MODE_MARKER_FILE};
use crate::store::config_dir;

/// Persist `full` so the next FancyMumble start stays in the full interface.
fn write_full_marker() -> std::io::Result<()> {
    let dir = config_dir().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "no config dir")
    })?;
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(UI_MODE_MARKER_FILE), "full")
}

/// Locate the full FancyMumble client binary.
///
/// Search order: `FANCY_FULL_CLIENT_BIN` env override, siblings of this
/// executable (bundled installs), then the dev workspace `target` dirs
/// found by walking up from this executable
/// (`crates/qt6ui/target/{profile}` → `{workspace}/target/{profile}`).
fn find_full_client() -> Option<PathBuf> {
    let names: Vec<String> = FULL_CLIENT_BINARY_NAMES
        .iter()
        .map(|n| {
            if cfg!(windows) {
                format!("{n}.exe")
            } else {
                (*n).to_owned()
            }
        })
        .collect();

    if let Ok(p) = std::env::var(ENV_FULL_CLIENT_BIN) {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }

    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    for name in &names {
        let sibling = exe_dir.join(name);
        if sibling.is_file() {
            return Some(sibling);
        }
    }

    // Dev layout: walk up towards the workspace root and probe its target dir.
    let mut dir = exe_dir.as_path();
    for _ in 0..5 {
        for profile in ["release", "debug"] {
            for name in &names {
                let candidate = dir.join("target").join(profile).join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        dir = dir.parent()?;
    }
    None
}

/// Write the `full` marker and start the full client. Returns `true` when
/// the full client was spawned (the caller should then quit this app);
/// `false` leaves this client running so the user is never stranded.
pub fn switch_to_full_mode() -> bool {
    if let Err(e) = write_full_marker() {
        tracing::error!("failed to write ui-mode marker: {e}");
        return false;
    }
    let Some(bin) = find_full_client() else {
        tracing::error!(
            "full client binary not found (set {ENV_FULL_CLIENT_BIN} or place FancyMumble next to qt6ui)"
        );
        return false;
    };
    match Command::new(&bin).spawn() {
        Ok(_) => {
            tracing::info!("switching to full client: {}", bin.display());
            true
        }
        Err(e) => {
            tracing::error!("failed to start {}: {e}", bin.display());
            false
        }
    }
}
