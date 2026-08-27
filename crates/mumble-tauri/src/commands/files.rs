//! File upload/download and custom emote management.

use tauri_plugin_dialog::DialogExt;

use crate::state::{
    AddEmoteRequest, AddEmoteResponse, AdminDeleteDocumentRequest, AdminDeleteRequest,
    AdminListRequest, AdminPreviewRequest, AppState, DownloadBytesRequest, DownloadRequest,
    PrivateStorageRequest, RemoveEmoteRequest, UploadBinaryRequest, UploadBytesRequest,
    UploadRequest, UploadResponse,
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

/// Upload in-memory binary content (base64-encoded, e.g. a `.glb` 3D model
/// picked in the webview) to the file-server plugin and return the signed
/// download URL.  Like [`upload_bytes`] but preserves non-UTF-8 bytes.
#[tauri::command]
pub(crate) async fn upload_binary(
    state: tauri::State<'_, AppState>,
    request: UploadBinaryRequest,
) -> Result<UploadResponse, String> {
    state.upload_binary(request).await
}

/// Download a (possibly access-controlled) file into memory and return its
/// bytes as base64.  Used to render inline resources (3D models) in the webview
/// without a CORS-blocked direct browser fetch to the file server.
#[tauri::command]
pub(crate) async fn download_to_base64(
    state: tauri::State<'_, AppState>,
    request: DownloadBytesRequest,
) -> Result<String, String> {
    state.download_to_base64(request).await
}

/// Cancel an in-progress upload by its `upload_id`.
#[tauri::command]
pub(crate) fn cancel_upload(state: tauri::State<'_, AppState>, upload_id: String) {
    let _ = state.cancel_upload(&upload_id);
}

/// Admin dashboard: list every file the server stores plus storage stats.
/// The server gates this on the caller's session JWT granting admin rights.
#[tauri::command]
pub(crate) async fn fileserver_admin_list_files(
    state: tauri::State<'_, AppState>,
    request: AdminListRequest,
) -> Result<serde_json::Value, String> {
    state.admin_list_files(request).await
}

/// Admin dashboard: list every persisted live-doc document.
/// Gated server-side on the caller's session JWT granting admin rights.
#[tauri::command]
pub(crate) async fn fileserver_admin_list_documents(
    state: tauri::State<'_, AppState>,
    request: AdminListRequest,
) -> Result<serde_json::Value, String> {
    state.admin_list_documents(request).await
}

/// Admin dashboard: list each user's stored calendar blob and its size.
/// Gated server-side on the caller's session JWT granting admin rights.
#[tauri::command]
pub(crate) async fn fileserver_admin_list_calendars(
    state: tauri::State<'_, AppState>,
    request: AdminListRequest,
) -> Result<serde_json::Value, String> {
    state.admin_list_calendars(request).await
}

/// Admin dashboard: delete a single stored file (blob + metadata).
#[tauri::command]
pub(crate) async fn fileserver_admin_delete_file(
    state: tauri::State<'_, AppState>,
    request: AdminDeleteRequest,
) -> Result<(), String> {
    state.admin_delete_file(request).await
}

/// Admin dashboard: delete a persisted live-doc document (all revisions).
#[tauri::command]
pub(crate) async fn fileserver_admin_delete_document(
    state: tauri::State<'_, AppState>,
    request: AdminDeleteDocumentRequest,
) -> Result<(), String> {
    state.admin_delete_document(request).await
}

/// Admin dashboard: stream a file's raw bytes back as base64 for an inline
/// preview (e.g. an image thumbnail) without a CORS-blocked browser fetch.
#[tauri::command]
pub(crate) async fn fileserver_admin_file_base64(
    state: tauri::State<'_, AppState>,
    request: AdminPreviewRequest,
) -> Result<String, String> {
    state.admin_file_base64(request).await
}

/// "My shared files": list only the files the caller uploaded.  The server
/// scopes the result to the caller's session JWT, so this needs no admin
/// rights and never exposes other users' files.
#[tauri::command]
pub(crate) async fn fileserver_my_list_files(
    state: tauri::State<'_, AppState>,
    request: AdminListRequest,
) -> Result<serde_json::Value, String> {
    state.my_list_files(request).await
}

/// "My shared files": delete one of the caller's own files (server returns 404
/// for any file that isn't theirs).
#[tauri::command]
pub(crate) async fn fileserver_my_delete_file(
    state: tauri::State<'_, AppState>,
    request: AdminDeleteRequest,
) -> Result<(), String> {
    state.my_delete_file(request).await
}

/// "My shared files": stream one of the caller's own files back as base64 for
/// an inline preview.
#[tauri::command]
pub(crate) async fn fileserver_my_file_base64(
    state: tauri::State<'_, AppState>,
    request: AdminPreviewRequest,
) -> Result<String, String> {
    state.my_file_base64(request).await
}

/// "My shared files": the public, browser-openable signed download URL for one
/// of the caller's own files (public files only; errors otherwise).
#[tauri::command]
pub(crate) async fn fileserver_my_file_link(
    state: tauri::State<'_, AppState>,
    request: AdminDeleteRequest,
) -> Result<String, String> {
    state.my_file_link(request).await
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

/// Read a value from the caller's per-user private storage on the
/// file-server (registered users only).  Returns `null` if absent.
#[tauri::command]
pub(crate) async fn fileserver_get_private(
    state: tauri::State<'_, AppState>,
    request: PrivateStorageRequest,
) -> Result<Option<String>, String> {
    state.private_get(request).await
}

/// Write a value to the caller's per-user private storage on the
/// file-server (registered users only).
#[tauri::command]
pub(crate) async fn fileserver_put_private(
    state: tauri::State<'_, AppState>,
    request: PrivateStorageRequest,
) -> Result<(), String> {
    state.private_put(request).await
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

/// Read a local file and return its contents base64-encoded.
///
/// Used for files dropped onto the window, which reach the webview as a bare
/// path. The webview cannot read that path itself: `convertFileSrc` turns it
/// into an `asset://` URL, and on Linux the `WebKitGTK` backend registers that
/// custom scheme as secure but never as CORS-enabled, so a `fetch()` against it
/// yields an empty body rather than the file. Reading here and handing the
/// bytes back over IPC is the same detour [`upload_bytes`] takes.
#[tauri::command]
pub(crate) async fn read_file_base64(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("read {path}: {e}"))?;
    if bytes.is_empty() {
        return Err(format!("file is empty: {path}"));
    }
    Ok(STANDARD.encode(bytes))
}

/// The size of a local file, in bytes.
///
/// A composer that stages a file before uploading it says how big it is, and
/// that is the one thing about a bare path the webview cannot work out for
/// itself. Reading the whole file back through [`read_file_base64`] just to
/// measure it would pull a video through IPC to print "84 MB".
#[tauri::command]
pub(crate) async fn file_size(path: String) -> Result<u64, String> {
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("stat {path}: {e}"))?;
    Ok(meta.len())
}

// -- the canon file service --------------------------------------------
//
// A server running the plugin and a server running the canon service both
// share files; the difference is who authorises the transfer. These commands
// are the canon half, and the frontend picks between them on what the server
// turned out to speak - see `starling_files_available`.

/// Share one local file with a channel over the canon handshake.
///
/// Progress arrives on the same `upload-progress` events as the plugin path,
/// keyed by `upload_id`, and `cancel_upload` stops it the same way.
#[tauri::command]
pub(crate) async fn starling_upload_file(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    file_path: String,
    channel_id: u32,
    mime_type: Option<String>,
    upload_id: Option<String>,
) -> Result<crate::state::starling_files::SharedUpload, String> {
    state
        .starling_upload_file(
            file_path,
            channel_id,
            mime_type,
            upload_id.unwrap_or_default(),
            app_handle,
        )
        .await
}

/// Fetch one shared object as base64.
#[tauri::command]
pub(crate) async fn starling_download_to_base64(
    state: tauri::State<'_, AppState>,
    key: String,
) -> Result<String, String> {
    state.starling_download_to_base64(key).await
}

/// Fetch one shared object straight to a path on disk.
#[tauri::command]
pub(crate) async fn starling_download_to_file(
    state: tauri::State<'_, AppState>,
    key: String,
    dest_path: String,
) -> Result<u64, String> {
    state.starling_download_to_file(key, dest_path).await
}

/// Ask what has been shared in a channel.
///
/// The listing arrives as the `starling-file-listing` event rather than as a
/// return value, because the same event is what an unprompted refresh uses.
#[tauri::command]
pub(crate) async fn starling_list_files(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    limit: Option<u32>,
) -> Result<(), String> {
    state
        .starling_list_files(channel_id, limit.unwrap_or(100))
        .await
}

/// Whether this server does files the canon way.
///
/// `None` means nobody has asked yet. The frontend treats that as "try it":
/// the first attempt is what settles the question.
#[tauri::command]
pub(crate) fn starling_files_available(state: tauri::State<'_, AppState>) -> Option<bool> {
    state.starling_files_available()
}
