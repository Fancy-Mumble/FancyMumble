//! Bridge to the Android `SystemBarsPlugin`, which keeps the page clear of
//! the status bar, the gesture bar and the keyboard, and sets the bars' icons
//! to read against whatever the page paints behind them.

use tauri::Wry;
use tauri::plugin::PluginHandle;

/// Managed state holding the Tauri mobile plugin handle for
/// `SystemBarsPlugin` (Kotlin).
pub struct SystemBarsHandle(pub PluginHandle<Wry>);

/// Dark bar icons when `light` (a light page behind them), light icons
/// otherwise. The plugin re-sends the insets with every call, so this is also
/// how a freshly loaded page gets them.
pub fn set_style(handle: &SystemBarsHandle, light: bool) -> Result<(), String> {
    handle
        .0
        .run_mobile_plugin::<()>("setStyle", serde_json::json!({ "light": light }))
        .map_err(|e| e.to_string())
}
