//! Image processing commands (blur, dim, JPEG re-encode).

/// Apply a Gaussian blur to an image.
///
/// `image_base64` is the raw file content encoded as a base64 string.
/// `sigma` controls the blur strength (typical range 1.0 - 30.0).
/// Returns base64-encoded JPEG bytes.
///
/// Runs on a dedicated blocking thread so the async runtime (and Tauri IPC)
/// stays responsive while the CPU-heavy image processing executes.
#[tauri::command]
pub(crate) async fn blur_image(image_base64: String, sigma: f32) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        use base64::{engine::general_purpose::STANDARD, Engine};
        use fancy_utils::image_filter::{BlurFilter, ImageFilter};

        let image_bytes = STANDARD
            .decode(&image_base64)
            .map_err(|e| format!("Failed to decode base64 input: {e}"))?;

        let result = BlurFilter::new(sigma)
            .apply(&image_bytes)
            .map_err(|e| e.to_string())?;
        Ok(STANDARD.encode(result))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Process a chat background image by applying blur and/or dim in one pass.
///
/// `image_base64` is the raw file content encoded as a base64 string.
/// `sigma` controls blur strength (0 = no blur, typical range 1.0 - 30.0).
/// `dim` controls darkening (0.0 = no dim, 1.0 = fully black).
/// Returns base64-encoded JPEG bytes.
///
/// The image is downscaled to 960x540 before processing to keep blur fast.
/// Since the result is used as a blurred/dimmed background, the reduced
/// resolution is imperceptible.
///
/// Runs on a dedicated blocking thread so the async runtime (and Tauri IPC)
/// stays responsive while the CPU-heavy image processing executes.
#[tauri::command]
pub(crate) async fn process_background(
    image_base64: String,
    sigma: f32,
    dim: f32,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        use base64::{engine::general_purpose::STANDARD, Engine};
        use fancy_utils::image_filter::{process_pipeline, BlurFilter, DimFilter, ImageTransform};

        let image_bytes = STANDARD
            .decode(&image_base64)
            .map_err(|e| format!("Failed to decode base64 input: {e}"))?;

        let blur = BlurFilter::new(sigma);
        let dim_filter = DimFilter::new(dim);

        let mut transforms: Vec<&dyn ImageTransform> = Vec::new();
        if sigma > 0.0 {
            transforms.push(&blur);
        }
        if dim > 0.0 {
            transforms.push(&dim_filter);
        }

        if transforms.is_empty() {
            // No processing needed, but re-encode to JPEG for consistency.
            let result = process_pipeline(&image_bytes, &[], false).map_err(|e| e.to_string())?;
            return Ok(STANDARD.encode(result));
        }

        let result =
            process_pipeline(&image_bytes, &transforms, true).map_err(|e| e.to_string())?;
        Ok(STANDARD.encode(result))
    })
    .await
    .map_err(|e| e.to_string())?
}

// -- attachments ---------------------------------------------------------
//
// A pasted image, and the smaller copy Nebula's composer offers for a photo
// it is about to share, both exist only as bytes in the webview - the one
// from the clipboard, the other from a canvas resize
// (`core/features/settings/imageUtils.ts`, reused rather than redone here in
// Rust: it already decodes formats this crate's `image` build does not carry
// features for, and already lowers quality until a copy fits a budget). The
// uploader streams from a path either way, so this is the one step that has
// to happen here: put the bytes on disk under the temp dir, and say where.

/// Write base64-encoded image bytes to a scratch file, and return its path.
#[tauri::command]
pub(crate) async fn write_attachment_bytes(
    data_base64: String,
    mime_type: String,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let bytes = STANDARD
        .decode(&data_base64)
        .map_err(|e| format!("decode attachment bytes: {e}"))?;
    let ext = match mime_type.as_str() {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "png",
    };
    let dir = std::env::temp_dir().join("fancy-mumble-attachments");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("create {}: {e}", dir.display()))?;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let file = dir.join(format!("attachment-{millis}.{ext}"));
    tokio::fs::write(&file, &bytes)
        .await
        .map_err(|e| format!("write {}: {e}", file.display()))?;
    Ok(file.to_string_lossy().into_owned())
}
