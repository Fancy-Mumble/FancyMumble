//! File upload/download and custom emote management.

use tauri_plugin_dialog::DialogExt;

use crate::state::{
    AddEmoteRequest, AddEmoteResponse, AppState, DownloadRequest, RemoveEmoteRequest,
    UploadBytesRequest, UploadRequest, UploadResponse,
};

/// Upload a local file to the server-side `mumble-file-server` plugin and
/// return the signed download URL.
#[tauri::command]
pub(crate) async fn upload_file(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    request: UploadRequest,
) -> Result<UploadResponse, String> {
    state.upload_file(request, app_handle).await
}

/// Upload in-memory UTF-8 content (e.g. a markdown export) to the
/// file-server plugin and return the signed download URL.
///
/// Unlike [`upload_file`], this command takes the file content as a string
/// rather than a local path.  Routing through the Tauri backend avoids the
/// CORS restriction that would block a direct browser `fetch()` to a
/// cross-origin file server.
#[tauri::command]
pub(crate) async fn upload_bytes(
    state: tauri::State<'_, AppState>,
    request: UploadBytesRequest,
) -> Result<UploadResponse, String> {
    state.upload_bytes(request).await
}

/// Cancel an in-progress upload by its `upload_id`.
#[tauri::command]
pub(crate) fn cancel_upload(state: tauri::State<'_, AppState>, upload_id: String) {
    let _ = state.cancel_upload(&upload_id);
}

/// Download a file (optionally performing the password / session-JWT
/// pre-auth ticket exchange) and write it to disk. Returns the number
/// of bytes written.
#[tauri::command]
pub(crate) async fn download_file(
    state: tauri::State<'_, AppState>,
    request: DownloadRequest,
) -> Result<u64, String> {
    state.download_file(request).await
}

/// Upload a custom server emote (admin-only on the server side).
#[tauri::command]
pub(crate) async fn add_custom_emote(
    state: tauri::State<'_, AppState>,
    request: AddEmoteRequest,
) -> Result<AddEmoteResponse, String> {
    state.add_custom_emote(request).await
}

/// Delete a custom server emote (admin-only on the server side).
#[tauri::command]
pub(crate) async fn remove_custom_emote(
    state: tauri::State<'_, AppState>,
    request: RemoveEmoteRequest,
) -> Result<(), String> {
    state.remove_custom_emote(request).await
}

/// Open the OS native save-file dialog pre-populated with `default_filename`,
/// then write `content` to the chosen path.  Returns `None` if the user
/// cancelled the dialog (not an error), or an error string if the write fails.
#[tauri::command]
pub(crate) async fn save_markdown_file(
    app_handle: tauri::AppHandle,
    content: String,
    default_filename: String,
) -> Result<Option<String>, String> {
    let chosen = app_handle
        .dialog()
        .file()
        .set_file_name(default_filename)
        .add_filter("Markdown", &["md"])
        .blocking_save_file();

    let Some(file_path) = chosen else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|e| format!("invalid path: {e}"))?;

    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

/// A single file to write during a bulk translation export.
#[derive(serde::Deserialize)]
pub(crate) struct TranslationFile {
    pub(crate) name: String,
    pub(crate) content: String,
}

/// Return which of the requested `names` already exist as files inside `folder`.
///
/// Names that contain path separators or `..` components are silently ignored
/// (they would be rejected by `write_translation_files` anyway).
#[tauri::command]
pub(crate) fn check_files_exist(folder: String, names: Vec<String>) -> Result<Vec<String>, String> {
    let dir = std::path::Path::new(&folder);
    if !dir.is_dir() {
        return Err(format!("not a directory: {folder}"));
    }
    let existing = names
        .into_iter()
        .filter(|name| {
            let has_separator = name.contains(['/', '\\']);
            let is_dotdot = name == ".." || name.starts_with("../") || name.starts_with("..\\\\");
            !has_separator && !is_dotdot && dir.join(name).exists()
        })
        .collect();
    Ok(existing)
}

/// Write one or more translation JSON files into `folder`.
///
/// Each entry's `name` must be a plain file name (no path separators, no
/// `..`).  The command rejects names that could escape the target directory.
#[tauri::command]
pub(crate) fn write_translation_files(
    folder: String,
    files: Vec<TranslationFile>,
) -> Result<(), String> {
    let dir = std::path::Path::new(&folder);
    if !dir.is_dir() {
        return Err(format!("not a directory: {folder}"));
    }
    for f in &files {
        let has_separator = f.name.contains(['/', '\\']);
        let is_dotdot = f.name == ".." || f.name.starts_with("../") || f.name.starts_with("..\\");
        if has_separator || is_dotdot {
            return Err(format!("invalid file name: {}", f.name));
        }
        let dest = dir.join(&f.name);
        std::fs::write(&dest, f.content.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}
