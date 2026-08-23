//! The chat wallpaper's on-disk store.
//!
//! A wallpaper - still or animated - never travels through the webview as
//! JSON. The picker hands the backend a path, the backend copies or renders
//! files into `{app_data_dir}/chat-backgrounds/`, and the personalization
//! record keeps only file *names*. The webview reads a stored file back
//! exactly once per session through [`read_chat_background`], which returns
//! raw bytes over binary IPC - the frontend turns them into a blob URL.
//!
//! Two transports were tried and rejected first: data-URLs inside the
//! personalization record (read back over IPC on every cold start, capping a
//! wallpaper at well under a megabyte) and the asset protocol (`WebKitGTK`'s
//! media pipeline does its own fetching through GStreamer, which cannot open
//! Tauri's custom scheme, so `<video src="asset://...">` dies on Linux with a
//! misleading decode error).
//!
//! File names are role-prefixed so derived files can be replaced without
//! touching their source:
//!
//! - `image-*`: the picked still, or the poster frame of a picked clip
//! - `processed-*`: the still with blur/dim baked in (`fancy_utils` pipeline)
//! - `video-*`: the picked clip, byte-for-byte
//! - `video-baked-*`: the clip with blur/dim baked in ([`crate::media`])
//!
//! Every name is a fresh UUID per write: the frontend caches blob URLs by
//! name, so replacing content under a reused name would keep showing the old
//! bytes.

use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

/// Where wallpaper files land, under the app data directory.
const BACKGROUND_DIR: &str = "chat-backgrounds";

/// The largest clip accepted.
const MAX_VIDEO_BYTES: u64 = 64 * 1024 * 1024;

/// The largest still accepted (pre-downscale; the stored file is far smaller).
const MAX_IMAGE_BYTES: u64 = 100 * 1024 * 1024;

/// Longest edge of a stored still. Matches what the old webview-side resize
/// enforced, but the resize now happens here, so the source may be any size.
const IMAGE_MAX_WIDTH: u32 = 1920;
const IMAGE_MAX_HEIGHT: u32 = 1080;

/// Container extensions offered in the picker.
///
/// `MP4` is what people have and what the Rust bake can decode; `WebM` is what
/// a `WebKitGTK` build without the proprietary GStreamer decoders can play, so
/// both are accepted even though only MP4 pre-processes.
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "m4v", "webm"];
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp"];

/// The progress event a running video bake emits: `{ done, total }` frames.
const BAKE_PROGRESS_EVENT: &str = "chat-background-bake-progress";

/// What a pick stored, and what kind of wallpaper it is.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PickedChatBackground {
    kind: ChatBackgroundKind,
    file_name: String,
}

#[derive(serde::Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ChatBackgroundKind {
    Image,
    Video,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BakeProgress {
    done: u32,
    total: u32,
}

/// Reject anything that could climb out of the background directory.
///
/// Every name we hand out is role-prefix + UUID, so a name that fails this
/// came from a hand-edited record rather than from us.
fn is_safe_name(file_name: &str) -> bool {
    !file_name.is_empty()
        && !file_name.contains('/')
        && !file_name.contains('\\')
        && !std::path::Path::new(file_name)
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
}

/// The directory wallpaper files live in, created if it is missing.
fn background_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = crate::e2e_data_dir(app)?.join(BACKGROUND_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {BACKGROUND_DIR}: {e}"))?;
    Ok(dir)
}

/// Delete every stored file whose name starts with one of `roles` (all files
/// when `roles` is empty). Missing directory is fine - nothing was stored.
fn clear_roles(dir: &std::path::Path, roles: &[&str]) -> Result<(), String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("read {BACKGROUND_DIR}: {e}")),
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let matches_role = roles.is_empty()
            || roles
                .iter()
                .any(|role| name.to_string_lossy().starts_with(role));
        if matches_role && entry.path().is_file() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// Resolve a stored name to its path, verifying it names a real stored file.
fn stored_path(
    app: &tauri::AppHandle,
    file_name: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    if !is_safe_name(file_name) {
        return Ok(None);
    }
    let path = crate::e2e_data_dir(app)?.join(BACKGROUND_DIR).join(file_name);
    Ok(path.is_file().then_some(path))
}

/// Open the OS picker for an image or a video, copy or render the choice into
/// the store, and say which kind it was. `None` means the user cancelled.
///
/// A picked image is decoded and downscaled here (not in the webview): the
/// source may be a 100 MB photograph, and the only thing that ever crosses to
/// the frontend is the stored file's name.
#[tauri::command]
pub(crate) async fn pick_chat_background(
    app_handle: tauri::AppHandle,
) -> Result<Option<PickedChatBackground>, String> {
    let all: Vec<&str> = IMAGE_EXTENSIONS
        .iter()
        .chain(VIDEO_EXTENSIONS.iter())
        .copied()
        .collect();
    let chosen = app_handle
        .dialog()
        .file()
        .add_filter("Images & videos", &all)
        .add_filter("Images", IMAGE_EXTENSIONS)
        .add_filter("Videos", VIDEO_EXTENSIONS)
        .blocking_pick_file();

    let Some(chosen) = chosen else {
        return Ok(None);
    };
    let source = chosen
        .into_path()
        .map_err(|e| format!("invalid path: {e}"))?;

    // Lower-cased so a `.MP4` from Windows lands in the same branch.
    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let size = std::fs::metadata(&source)
        .map_err(|e| format!("stat file: {e}"))?
        .len();

    let dir = background_dir(&app_handle)?;
    if VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        if size > MAX_VIDEO_BYTES {
            return Err(format!(
                "That clip is {} MB. The limit is {} MB.",
                size / (1024 * 1024),
                MAX_VIDEO_BYTES / (1024 * 1024)
            ));
        }
        clear_roles(&dir, &[])?;
        let file_name = format!("video-{}.{extension}", uuid::Uuid::new_v4());
        let destination = dir.join(&file_name);
        let _bytes = tokio::fs::copy(&source, &destination)
            .await
            .map_err(|e| format!("copy video: {e}"))?;
        return Ok(Some(PickedChatBackground {
            kind: ChatBackgroundKind::Video,
            file_name,
        }));
    }

    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("\".{extension}\" is not a supported image or video format."));
    }
    if size > MAX_IMAGE_BYTES {
        return Err(format!(
            "That image is {} MB. The limit is {} MB.",
            size / (1024 * 1024),
            MAX_IMAGE_BYTES / (1024 * 1024)
        ));
    }

    let file_name = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let bytes = std::fs::read(&source).map_err(|e| format!("read image: {e}"))?;
        let mut img = image::load_from_memory(&bytes).map_err(|e| format!("decode image: {e}"))?;
        if img.width() > IMAGE_MAX_WIDTH || img.height() > IMAGE_MAX_HEIGHT {
            img = img.resize(
                IMAGE_MAX_WIDTH,
                IMAGE_MAX_HEIGHT,
                image::imageops::FilterType::Triangle,
            );
        }
        let mut jpeg = Vec::new();
        // JPEG deliberately: a wallpaper is composited over an opaque wash and
        // never needs transparency, and JPEG keeps the store small.
        img.to_rgb8()
            .write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg)
            .map_err(|e| format!("encode image: {e}"))?;
        clear_roles(&dir, &[])?;
        let file_name = format!("image-{}.jpg", uuid::Uuid::new_v4());
        std::fs::write(dir.join(&file_name), &jpeg).map_err(|e| format!("store image: {e}"))?;
        Ok(file_name)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(Some(PickedChatBackground {
        kind: ChatBackgroundKind::Image,
        file_name,
    }))
}

/// Return a stored file's raw bytes.
///
/// This is binary IPC ([`tauri::ipc::Response`]), not JSON: the frontend
/// receives an `ArrayBuffer` and wraps it in a blob URL. An unknown or unsafe
/// name is an error - the frontend checks existence through the record, not by
/// probing here.
#[tauri::command]
pub(crate) fn read_chat_background(
    app_handle: tauri::AppHandle,
    file_name: String,
) -> Result<tauri::ipc::Response, String> {
    let Some(path) = stored_path(&app_handle, &file_name)? else {
        return Err(format!("no stored background named {file_name}"));
    };
    let bytes = std::fs::read(&path).map_err(|e| format!("read {file_name}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Bake blur/dim into a stored still, replacing any previous `processed-*`
/// file, and return the new file's name.
#[tauri::command]
pub(crate) async fn process_chat_background_image(
    app_handle: tauri::AppHandle,
    file_name: String,
    sigma: f32,
    dim: f32,
) -> Result<String, String> {
    let Some(path) = stored_path(&app_handle, &file_name)? else {
        return Err(format!("no stored background named {file_name}"));
    };
    let dir = background_dir(&app_handle)?;

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        use fancy_utils::image_filter::{process_pipeline, BlurFilter, DimFilter, ImageTransform};

        let bytes = std::fs::read(&path).map_err(|e| format!("read {file_name}: {e}"))?;
        let blur = BlurFilter::new(sigma);
        let dim_filter = DimFilter::new(dim);
        let mut transforms: Vec<&dyn ImageTransform> = Vec::new();
        if sigma > 0.0 {
            transforms.push(&blur);
        }
        if dim > 0.0 {
            transforms.push(&dim_filter);
        }
        let processed =
            process_pipeline(&bytes, &transforms, true).map_err(|e| e.to_string())?;

        clear_roles(&dir, &["processed-"])?;
        let out_name = format!("processed-{}.jpg", uuid::Uuid::new_v4());
        std::fs::write(dir.join(&out_name), &processed)
            .map_err(|e| format!("store processed image: {e}"))?;
        Ok(out_name)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Decode a poster frame out of a stored clip with the bundled OpenH264 (no
/// system codecs involved), store it as an `image-*` still, and return its
/// name. `None` means this clip cannot be decoded here (not H.264) - the
/// frontend then falls back to capturing a frame in the webview.
#[tauri::command]
pub(crate) async fn extract_chat_background_poster(
    app_handle: tauri::AppHandle,
    file_name: String,
) -> Result<Option<String>, String> {
    let Some(path) = stored_path(&app_handle, &file_name)? else {
        return Err(format!("no stored background named {file_name}"));
    };
    let dir = background_dir(&app_handle)?;

    tokio::task::spawn_blocking(move || -> Result<Option<String>, String> {
        let Ok(jpeg) = crate::media::chat_wallpaper::extract_poster(&path) else {
            return Ok(None);
        };
        clear_roles(&dir, &["image-"])?;
        let out_name = format!("image-{}.jpg", uuid::Uuid::new_v4());
        std::fs::write(dir.join(&out_name), &jpeg)
            .map_err(|e| format!("store poster: {e}"))?;
        Ok(Some(out_name))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Store a webview-captured poster frame (base64 JPEG/PNG bytes) as the
/// `image-*` still. The fallback for clips the Rust decoder cannot open.
#[tauri::command]
pub(crate) async fn store_chat_background_poster(
    app_handle: tauri::AppHandle,
    image_base64: String,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD
        .decode(&image_base64)
        .map_err(|e| format!("decode poster: {e}"))?;
    let dir = background_dir(&app_handle)?;
    clear_roles(&dir, &["image-"])?;
    let out_name = format!("image-{}.jpg", uuid::Uuid::new_v4());
    tokio::fs::write(dir.join(&out_name), &bytes)
        .await
        .map_err(|e| format!("store poster: {e}"))?;
    Ok(out_name)
}

/// Bake blur/dim into every frame of a stored clip ([`crate::media`]),
/// replacing any previous `video-baked-*` file, and return the new name.
///
/// Long-running: minutes for a long clip. Progress goes out as
/// `chat-background-bake-progress` events; the caller decides what to do with
/// a stale result (the sliders may have moved while this ran).
#[tauri::command]
pub(crate) async fn bake_chat_background_video(
    app_handle: tauri::AppHandle,
    file_name: String,
    sigma: f32,
    dim: f32,
) -> Result<String, String> {
    let Some(path) = stored_path(&app_handle, &file_name)? else {
        return Err(format!("no stored background named {file_name}"));
    };
    let dir = background_dir(&app_handle)?;
    let events = app_handle.clone();

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let out_name = format!("video-baked-{}.mp4", uuid::Uuid::new_v4());
        let out_path = dir.join(&out_name);
        crate::media::chat_wallpaper::bake_video(&path, &out_path, sigma, dim, |done, total| {
            let _ = events.emit(BAKE_PROGRESS_EVENT, BakeProgress { done, total });
        })
        .inspect_err(|_| {
            let _ = std::fs::remove_file(&out_path);
        })?;
        // Only retire the previous bake once the new one exists, so a failed
        // bake never leaves the record pointing at nothing.
        let entries = std::fs::read_dir(&dir).map_err(|e| format!("read store: {e}"))?;
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("video-baked-") && name != out_name.as_str() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        Ok(out_name)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Forget the wallpaper, deleting every stored file.
#[tauri::command]
pub(crate) fn clear_chat_background(app_handle: tauri::AppHandle) -> Result<(), String> {
    let dir = crate::e2e_data_dir(&app_handle)?.join(BACKGROUND_DIR);
    clear_roles(&dir, &[])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_names_that_climb_out_of_the_directory() {
        assert!(is_safe_name("video-f6b1c0de.mp4"));
        assert!(!is_safe_name(""));
        assert!(!is_safe_name(".."));
        assert!(!is_safe_name("../../personalization.json"));
        assert!(!is_safe_name("nested/clip.mp4"));
        assert!(!is_safe_name("nested\\clip.mp4"));
        assert!(!is_safe_name("/etc/passwd"));
    }

    #[test]
    fn clearing_by_role_leaves_other_roles_alone() {
        let temp = tempfile::tempdir().expect("tempdir");
        let dir = temp.path().join(BACKGROUND_DIR);
        std::fs::create_dir_all(&dir).expect("create");
        std::fs::write(dir.join("video-a.mp4"), b"clip").expect("write");
        std::fs::write(dir.join("video-baked-b.mp4"), b"baked").expect("write");
        std::fs::write(dir.join("image-c.jpg"), b"poster").expect("write");

        clear_roles(&dir, &["video-baked-"]).expect("clear");
        assert!(dir.join("video-a.mp4").exists());
        assert!(!dir.join("video-baked-b.mp4").exists());
        assert!(dir.join("image-c.jpg").exists());

        clear_roles(&dir, &[]).expect("clear all");
        assert_eq!(std::fs::read_dir(&dir).expect("read").count(), 0);

        // A pick before anything was ever stored must not error.
        clear_roles(&temp.path().join("never-created"), &[]).expect("missing dir is fine");
    }

    #[test]
    fn video_baked_names_do_not_match_the_video_role_prefix_accidentally() {
        // "video-baked-" starts with "video-", so clearing the raw clip role
        // would also take the bake with it. That is intended: a new clip
        // invalidates its predecessor's bake. This test just pins it down.
        let temp = tempfile::tempdir().expect("tempdir");
        let dir = temp.path().join(BACKGROUND_DIR);
        std::fs::create_dir_all(&dir).expect("create");
        std::fs::write(dir.join("video-baked-b.mp4"), b"baked").expect("write");
        clear_roles(&dir, &["video-"]).expect("clear");
        assert!(!dir.join("video-baked-b.mp4").exists());
    }
}
