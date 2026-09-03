//! Per-window constraints exposed to the frontend.
//!
//! These commands wrap the platform-specific helpers in
//! [`crate::platform::window`].  They operate on the calling window
//! (resolved automatically by Tauri via the `window` parameter), so
//! every webview window gets its own independent constraints.

use crate::platform::window::{WindowExt, WindowExtError};

/// Constrain (or release) the calling window's content aspect ratio.
///
/// Pass `Some(width / height)` to lock the ratio - native resize
/// gestures will be clamped without flicker.  Pass `None` (or omit
/// the field) to remove the constraint.
///
/// Returns:
/// - `Ok(true)`  - native constraint installed.
/// - `Ok(false)` - this platform has no native implementation; the
///   frontend should fall back to a JS resize handler.
/// - `Err(...)`  - the call reached the native layer but failed.
#[tauri::command]
pub(crate) fn set_window_aspect_ratio(
    window: tauri::WebviewWindow,
    ratio: Option<f64>,
) -> Result<bool, String> {
    match window.set_aspect_ratio(ratio) {
        Ok(()) => Ok(true),
        Err(WindowExtError::Unsupported) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Replace the calling window's icon with pixels drawn by the frontend.
///
/// The mark in the title bar is the theme's accent and every theme moves
/// it; the icon Windows shows in the taskbar and in Alt-Tab was a PNG
/// shipped with the build that never did, so a squared acid-yellow skin
/// still sat behind a rounded cyan tile.  The frontend draws the mark it
/// already draws in the chrome and hands the pixels here, which keeps one
/// drawing rather than two that drift apart.
///
/// `rgba` is RGBA8 and must be exactly `width * height * 4` bytes.  A
/// short buffer is refused here rather than passed on: the platform layer
/// reads the length it was promised, so a wrong one is a crash and not a
/// wrong picture.
///
/// Windows and Linux take the icon.  macOS draws its from the app bundle
/// and ignores this, and mobile has no window icon at all; both answer
/// `Ok`, because a themed icon is decoration and there is nothing a caller
/// could do about a platform that has no such concept.
#[tauri::command]
pub(crate) fn set_window_icon(
    window: tauri::WebviewWindow,
    rgba: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let expected = usize::try_from(width)
        .ok()
        .zip(usize::try_from(height).ok())
        .and_then(|(w, h)| w.checked_mul(h))
        .and_then(|area| area.checked_mul(4))
        .ok_or_else(|| format!("an icon of {width}x{height} does not fit in memory"))?;
    if rgba.len() != expected {
        return Err(format!(
            "an icon of {width}x{height} needs {expected} bytes, got {}",
            rgba.len()
        ));
    }
    window
        .set_icon(tauri::image::Image::new_owned(rgba, width, height))
        .map_err(|e| e.to_string())
}
