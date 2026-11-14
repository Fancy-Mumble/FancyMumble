//! The recovery phrase of an identity: shown, and typed back in.

/// The 24-word recovery phrase of identity `label`.
#[tauri::command]
pub(crate) fn get_recovery_phrase(app: tauri::AppHandle, label: String) -> Result<String, String> {
    crate::state::pchat::IdentityStore::new(crate::e2e_data_dir(&app)?).recovery_phrase(&label)
}

/// Give identity `label` the seed a recovery phrase stands for. Takes effect
/// on the next connect with that identity.
#[tauri::command]
pub(crate) fn restore_recovery_phrase(
    app: tauri::AppHandle,
    label: String,
    phrase: String,
) -> Result<(), String> {
    crate::state::pchat::IdentityStore::new(crate::e2e_data_dir(&app)?)
        .restore_seed(&label, &phrase)
}
