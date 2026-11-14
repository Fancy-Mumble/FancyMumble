//! The account record store, as Tauri commands.
//!
//! What this account keeps on the server for itself: the document library, the
//! citation master list, the calendar. These replace the file-server plugin's
//! `fileserver_get_private` / `fileserver_put_private`, which needed a plugin,
//! an HTTP listener and a session JWT to do the same thing - and which
//! reported every user of a server without that plugin as unregistered.

use crate::state::AppState;
use crate::state::records::StoredRecord;

/// Read one of this account's records.
///
/// `found` false is an absent record - the ordinary answer before anything has
/// been stored - and not an error. An error is the server refusing, which
/// includes a guest asking at all.
#[tauri::command]
pub(crate) async fn account_record_get(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<StoredRecord, String> {
    state.record_get(key).await
}

/// Store one of this account's records, and answer with what now stands.
#[tauri::command]
pub(crate) async fn account_record_put(
    state: tauri::State<'_, AppState>,
    key: String,
    value: String,
) -> Result<StoredRecord, String> {
    state.record_put(key, value).await
}

/// Remove one of this account's records.
#[tauri::command]
pub(crate) async fn account_record_remove(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<StoredRecord, String> {
    state.record_remove(key).await
}

/// Which of this account's records start with `prefix`.
#[tauri::command]
pub(crate) async fn account_record_list(
    state: tauri::State<'_, AppState>,
    prefix: String,
) -> Result<Vec<String>, String> {
    state.record_list(prefix).await
}

/// Whether this server keeps per-account records at all.
///
/// `null` while nothing has asked yet, which is the honest answer: the store
/// announces nothing, so the only way to know is to have asked once.
#[tauri::command]
pub(crate) fn account_records_available(state: tauri::State<'_, AppState>) -> Option<bool> {
    state.records_available()
}
