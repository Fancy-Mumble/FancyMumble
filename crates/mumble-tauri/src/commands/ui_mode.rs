//! Commands for switching between the full (Tauri) and minimal (qt6ui)
//! interfaces. See [`crate::ui_mode`] for the marker-file contract.

use crate::ui_mode;

/// Return the persisted interface mode: `"full"` or `"minimal"`.
#[tauri::command]
pub(crate) fn get_ui_mode() -> &'static str {
    match ui_mode::current_mode() {
        ui_mode::UiMode::Full => "full",
        ui_mode::UiMode::Minimal => "minimal",
    }
}

/// Persist the interface mode marker. Takes effect on the next app start
/// (or immediately via [`relaunch_in_minimal_mode`]).
#[tauri::command]
pub(crate) fn set_ui_mode(mode: String) -> Result<(), String> {
    let mode = ui_mode::UiMode::parse(&mode)
        .ok_or_else(|| format!("invalid ui mode '{mode}' (expected 'full' or 'minimal')"))?;
    ui_mode::set_mode(mode)
}

/// Coarse hardware numbers for the first-run weak-PC prompt.
#[tauri::command]
pub(crate) fn get_system_specs() -> ui_mode::SystemSpecs {
    ui_mode::system_specs()
}

/// Launch the minimal qt6ui client and exit this (full) app.
///
/// Errors - typically "binary not found" - leave the full app running so
/// the caller can surface the problem instead of stranding the user.
#[tauri::command]
pub(crate) fn relaunch_in_minimal_mode(app: tauri::AppHandle) -> Result<(), String> {
    ui_mode::launch_minimal_client()?;
    tracing::info!("relaunching into minimal (qt6ui) client");
    app.exit(0);
    Ok(())
}
