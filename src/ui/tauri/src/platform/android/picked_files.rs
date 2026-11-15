//! Bridge to the Android `PickedFilesPlugin`, which turns the `content://`
//! address the system file picker returns into a file in the app's cache.

use tauri::Wry;
use tauri::plugin::PluginHandle;

/// Managed state holding the Tauri mobile plugin handle for
/// `PickedFilesPlugin` (Kotlin).
pub struct PickedFilesHandle(pub PluginHandle<Wry>);

/// What the plugin answers: where the copy is, and the file's own name.
#[derive(serde::Deserialize)]
pub struct LocalCopy {
    pub path: String,
    pub name: String,
}

/// Copy the file behind `uri` into the app's cache, under the name its
/// provider reports.
pub async fn local_copy(handle: &PickedFilesHandle, uri: &str) -> Result<LocalCopy, String> {
    handle
        .0
        .run_mobile_plugin_async::<LocalCopy>("localCopy", serde_json::json!({ "uri": uri }))
        .await
        .map_err(|e| e.to_string())
}
