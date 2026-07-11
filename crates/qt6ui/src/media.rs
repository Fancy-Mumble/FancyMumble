//! Image-message helpers: fitting images into the server's byte budget and
//! extracting embedded images from incoming HTML bodies.
//!
//! Mirrors the web client's `ui/src/utils/media.ts` (`fitImage`,
//! `mediaToHtml`) and `ui/src/utils/gallery.ts` (gallery markers) so images
//! sent from either client render identically in both. Decoding/scaling uses
//! the already-linked Qt (`QImage` via cxx-qt-lib); the JPEG/base64 encode
//! leaves Qt can't expose through cxx-qt-lib live in `cpp/image_codec.cpp`.

use cxx_qt_lib::{AspectRatioMode, QImage, QString, TransformationMode};

use crate::bridge::qobject::{
    bytes_to_base64, data_url_to_spill_file, image_to_jpeg_base64, qimage_save_file,
};

/// Hard cap on images per gallery, mirroring `MAX_GALLERY_IMAGES`.
pub const MAX_GALLERY_IMAGES: usize = 10;

/// MIME types for the image extensions both clients accept (the image subset
/// of `EXT_TO_MIME` in media.ts).
fn mime_for_path(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        _ => "image/png",
    }
}

/// Escape a string for use inside a double-quoted HTML attribute
/// (media.ts `escapeAttr`).
pub fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

/// The marker placed at the start of each gallery image message
/// (`utils/gallery.ts galleryMarker`), letting the full client stitch a run
/// of same-group messages back into one tiled grid.
pub fn gallery_marker(group_id: &str, index: usize, total: usize) -> String {
    format!("<!-- FANCY_GALLERY:{group_id}:{index}:{total} -->")
}

/// A short, collision-resistant 8-hex-char gallery group id
/// (`gallery.ts newGalleryId`), without pulling in a rand dependency.
pub fn new_gallery_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let mixed = now
        .as_secs()
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ u64::from(now.subsec_nanos()).wrapping_mul(0x2545_F491_4F6C_DD1D)
        ^ u64::from(std::process::id());
    format!("{:08x}", (mixed >> 32) as u32 ^ mixed as u32)
}

/// Encode `img` (optionally scaled by `scale`) as a JPEG data URL.
fn encode_jpeg(img: &QImage, src_w: i32, src_h: i32, scale: f64, quality: i32) -> Result<String, String> {
    let w = (f64::from(src_w) * scale).round().max(1.0) as i32;
    let h = (f64::from(src_h) * scale).round().max(1.0) as i32;
    let scaled;
    let target = if w == src_w && h == src_h {
        img
    } else {
        // Width and height derive from one scale factor, so the aspect ratio
        // is preserved despite IgnoreAspectRatio (which just skips Qt's own
        // fitting logic).
        scaled = img.scaled(w, h, AspectRatioMode::IgnoreAspectRatio, TransformationMode::SmoothTransformation);
        &scaled
    };
    let b64 = image_to_jpeg_base64(target, quality).to_string();
    if b64.is_empty() {
        return Err("JPEG encode failed".to_owned());
    }
    Ok(format!("data:image/jpeg;base64,{b64}"))
}

/// Binary-search the highest JPEG quality in `[q_min, q_max]` whose data URL
/// fits `budget` at the given `scale`; `None` when even `q_min` overflows.
/// (media.ts `bestQualityAt`, with integer Qt qualities.)
fn best_quality_at(
    img: &QImage,
    src_w: i32,
    src_h: i32,
    scale: f64,
    q_min: i32,
    q_max: i32,
    budget: usize,
) -> Result<Option<String>, String> {
    let mut best = encode_jpeg(img, src_w, src_h, scale, q_min)?;
    if best.len() > budget {
        return Ok(None);
    }
    let (mut lo, mut hi) = (q_min, q_max);
    while lo + 1 < hi {
        let mid = (lo + hi) / 2;
        let r = encode_jpeg(img, src_w, src_h, scale, mid)?;
        if r.len() <= budget {
            best = r;
            lo = mid;
        } else {
            hi = mid;
        }
    }
    Ok(Some(best))
}

/// Fit the image file at `path` into `max_bytes` as a data URL, mirroring
/// media.ts `fitImage`: pass the original through when it already fits,
/// else re-encode as JPEG maximizing quality at full resolution, and only
/// scale down when even quality 10 overflows.
pub fn fit_image_file(path: &str, max_bytes: usize) -> Result<String, String> {
    let max_bytes = if max_bytes < 5000 { 131_072 } else { max_bytes }; // bogus-limit guard
    let raw = std::fs::read(path).map_err(|e| format!("read failed: {e}"))?;

    // 1. Original fits -> return as-is (lossless, keeps GIF animation).
    let mime = mime_for_path(path);
    if "data:;base64,".len() + mime.len() + raw.len().div_ceil(3) * 4 <= max_bytes {
        return Ok(format!("data:{mime};base64,{}", bytes_to_base64(&raw)));
    }

    let img = QImage::from_data(&raw, None).ok_or_else(|| "unsupported image format".to_owned())?;
    let (src_w, src_h) = (img.width(), img.height());
    if src_w == 0 || src_h == 0 {
        return Err("image has zero dimensions".to_owned());
    }

    // Leave room for the HTML wrapper (<img src="..." alt="..." />).
    let budget = max_bytes.saturating_sub(100);

    // 2. Full resolution - maximize quality.
    if let Some(full_res) = best_quality_at(&img, src_w, src_h, 1.0, 10, 95, budget)? {
        return Ok(full_res);
    }

    // 3. Scale down: estimate a starting scale from the byte-size ratio.
    let low_q = encode_jpeg(&img, src_w, src_h, 1.0, 10)?;
    let est_scale = ((budget as f64 / low_q.len() as f64).sqrt() * 1.1).min(0.95);

    //    Find a guaranteed-to-fit lower bound by halving from the estimate.
    let mut lo = 0.0_f64;
    let mut best_scaled: Option<String> = None;
    let mut probe = est_scale;
    for _ in 0..15 {
        if probe < 0.005 {
            break;
        }
        let r = encode_jpeg(&img, src_w, src_h, probe, 70)?;
        if r.len() <= budget {
            best_scaled = Some(r);
            lo = probe;
            break;
        }
        probe *= 0.5;
    }
    let Some(mut best_scaled) = best_scaled else {
        return encode_jpeg(&img, src_w, src_h, 0.01, 10); // absolute fallback
    };

    //    Binary-search scale upward from lo.
    let mut hi = (lo * 3.0).min(1.0);
    for _ in 0..12 {
        if hi - lo < 0.002 {
            break;
        }
        let mid = (lo + hi) / 2.0;
        let r = encode_jpeg(&img, src_w, src_h, mid, 70)?;
        if r.len() <= budget {
            best_scaled = r;
            lo = mid;
        } else {
            hi = mid;
        }
    }

    //    Maximize quality at the final scale.
    Ok(best_quality_at(&img, src_w, src_h, lo, 70, 95, budget)?.unwrap_or(best_scaled))
}

/// Chat thumbnails render at most 320x240; thumbnail files hold 2x that
/// (hi-dpi) so the bubble never has to touch the full-size image.
const THUMB_MAX_W: i32 = 640;
const THUMB_MAX_H: i32 = 480;

/// Offload chat images to disk so the UI never holds base64 payloads in
/// RAM: each `data:` URL is written to the per-process spill dir (see
/// cpp/image_codec.cpp), large images additionally get an on-disk
/// thumbnail, and only `{"thumb", "full"}` file URLs reach the QML model.
/// The bubble decodes just the thumbnail while it is on screen; the full
/// image is opened only when the lightbox asks for it. `http(s)` sources
/// pass through untouched (tiny strings, loaded on demand); failed spills
/// are dropped.
pub fn spill_images(images: Vec<String>) -> Vec<serde_json::Value> {
    images
        .into_iter()
        .filter_map(|src| {
            if src.starts_with("http://") || src.starts_with("https://") {
                return Some(serde_json::json!({ "thumb": src, "full": src }));
            }
            let path = data_url_to_spill_file(&QString::from(&src)).to_string();
            if path.is_empty() {
                return None;
            }
            let full_url = file_url(&path);
            let thumb_url = spill_thumbnail(&path).unwrap_or_else(|| full_url.clone());
            Some(serde_json::json!({ "thumb": thumb_url, "full": full_url }))
        })
        .collect()
}

fn file_url(path: &str) -> String {
    format!("file:///{}", path.replace('\\', "/"))
}

/// Fit an image file into `max_bytes` of RAW bytes (not data-URL chars) -
/// the shape `UserState.texture` wants. Pass-through when it already
/// fits; otherwise re-encoded via `fit_image_file` and read back from the
/// spill file (the JPEG bytes land on disk anyway for the local echo).
pub fn fit_image_file_bytes(path: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
    let raw = std::fs::read(path).map_err(|e| format!("read failed: {e}"))?;
    if raw.len() <= max_bytes {
        return Ok(raw);
    }
    // Data URLs are base64: budget the string form at 4/3 the byte cap.
    let data_url = fit_image_file(path, max_bytes * 4 / 3)?;
    let spilled = data_url_to_spill_file(&QString::from(&data_url)).to_string();
    if spilled.is_empty() {
        return Err("spill failed".to_owned());
    }
    std::fs::read(&spilled).map_err(|e| format!("read spill failed: {e}"))
}

/// Spill a raw Mumble avatar texture (`UserState.texture` bytes) to disk
/// and return its `{"thumb", "full"}` file URLs. MIME sniffing mirrors the
/// web client's `textureToDataUrl` (JPEG magic, else PNG).
pub fn spill_texture(bytes: &[u8]) -> Option<serde_json::Value> {
    if bytes.is_empty() {
        return None;
    }
    let mime = if bytes.starts_with(&[0xff, 0xd8]) { "image/jpeg" } else { "image/png" };
    let data_url = format!("data:{mime};base64,{}", bytes_to_base64(bytes));
    spill_images(vec![data_url]).into_iter().next()
}

/// Write a `<= 640x480` thumbnail next to a spilled image and return its
/// file URL. `None` when the original is already small enough (the bubble
/// can use it directly) or anything fails. JPEG unless the source has an
/// alpha channel (PNG then, so transparency survives).
fn spill_thumbnail(full_path: &str) -> Option<String> {
    let raw = std::fs::read(full_path).ok()?;
    let img = QImage::from_data(&raw, None)?;
    drop(raw);
    if img.width() <= THUMB_MAX_W && img.height() <= THUMB_MAX_H {
        return None;
    }
    let ext = if img.has_alpha_channel() { "png" } else { "jpg" };
    let thumb_path = format!("{full_path}.thumb.{ext}");
    if !std::path::Path::new(&thumb_path).exists() {
        let scaled = img.scaled(
            THUMB_MAX_W,
            THUMB_MAX_H,
            AspectRatioMode::KeepAspectRatio,
            TransformationMode::SmoothTransformation,
        );
        if !qimage_save_file(&scaled, &QString::from(&thumb_path), 85) {
            return None;
        }
    }
    Some(file_url(&thumb_path))
}

/// Startup sweep of the spill root: delete per-process subdirs untouched
/// for a day (their sessions are long gone; a live instance keeps its dir
/// fresh with every spilled image). Concurrent instances are never hit.
pub fn sweep_stale_spill() {
    let root = std::env::temp_dir().join("qt6ui-chat-images");
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(24 * 3600);
    let Ok(entries) = std::fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .map_or(true, |t| t < cutoff);
        if stale {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Split a message body into displayable images and the remaining HTML.
///
/// Returns the body with every `<img>` tag removed plus the extracted `src`
/// values the QML side may load: `data:image/...` payloads and `http(s)`
/// URLs (the GIF picker sends those). Anything else - notably `file:` -
/// is dropped so a remote sender can't make this client read local files.
pub fn extract_images(html: &str) -> (String, Vec<String>) {
    let bytes = html.as_bytes();
    let mut out = String::with_capacity(html.len());
    let mut images = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let rest = &html[i + 1..];
            let is_img = rest.len() >= 4
                && rest[..3].eq_ignore_ascii_case("img")
                && matches!(rest.as_bytes()[3], b' ' | b'\t' | b'\n' | b'\r' | b'/' | b'>');
            if is_img {
                if let Some(gt) = html[i..].find('>') {
                    let tag = &html[i + 1..i + gt];
                    if let Some(src) = attr_value(tag, "src") {
                        let lower = src.to_ascii_lowercase();
                        if lower.starts_with("data:image/")
                            || lower.starts_with("http://")
                            || lower.starts_with("https://")
                        {
                            images.push(src.to_owned());
                        }
                    }
                    i += gt + 1;
                    continue;
                }
            }
        }
        // Copy the (possibly multi-byte) char and advance.
        let ch_len = html[i..].chars().next().map_or(1, char::len_utf8);
        out.push_str(&html[i..i + ch_len]);
        i += ch_len;
    }
    (out, images)
}

/// Extract a double-quoted attribute value from a raw tag body
/// (same shape as fancy-utils' private `attr_value`).
fn attr_value<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{name}=\"");
    let start = lower.find(&needle)? + needle.len();
    let end = tag[start..].find('"')? + start;
    Some(&tag[start..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_keeps_text_and_pulls_data_images() {
        let (html, images) =
            extract_images("hello <b>world</b> <img src=\"data:image/png;base64,AAAA\" alt=\"x\" /> bye");
        assert_eq!(html, "hello <b>world</b>  bye");
        assert_eq!(images, vec!["data:image/png;base64,AAAA".to_owned()]);
    }

    #[test]
    fn extract_accepts_http_and_drops_file_urls() {
        let (html, images) = extract_images(
            "<img src=\"https://example.com/a.gif\"><img src=\"file:///C:/secret.png\">",
        );
        assert_eq!(html, "");
        assert_eq!(images, vec!["https://example.com/a.gif".to_owned()]);
    }

    #[test]
    fn extract_ignores_non_img_tags_and_img_prefixed_words() {
        let (html, images) = extract_images("an <imglike> tag and <i>imgs</i>");
        assert_eq!(html, "an <imglike> tag and <i>imgs</i>");
        assert!(images.is_empty());
    }

    #[test]
    fn gallery_marker_matches_web_format() {
        assert_eq!(gallery_marker("abc123", 1, 4), "<!-- FANCY_GALLERY:abc123:1:4 -->");
        assert_eq!(new_gallery_id().len(), 8);
    }

    /// Minimal 24-bit BMP writer (Qt decodes BMP without plugins) so the
    /// fit test needs no image assets.
    fn write_bmp(path: &std::path::Path, w: usize, h: usize, noise: bool) {
        let row = (w * 3).div_ceil(4) * 4;
        let data_size = row * h;
        let mut out = Vec::with_capacity(54 + data_size);
        out.extend_from_slice(b"BM");
        out.extend_from_slice(&(54 + data_size as u32).to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&54u32.to_le_bytes());
        out.extend_from_slice(&40u32.to_le_bytes());
        out.extend_from_slice(&(w as i32).to_le_bytes());
        out.extend_from_slice(&(h as i32).to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&24u16.to_le_bytes());
        out.extend_from_slice(&[0; 24]); // no compression, defaults
        let mut rng = 0x1234_5678_u32;
        for y in 0..h {
            let mut written = 0;
            for x in 0..w {
                if noise {
                    // xorshift noise defeats JPEG compression -> forces the
                    // quality/scale search.
                    rng ^= rng << 13;
                    rng ^= rng >> 17;
                    rng ^= rng << 5;
                    out.extend_from_slice(&[rng as u8, (rng >> 8) as u8, (rng >> 16) as u8]);
                } else {
                    let c = if (x / 4 + y / 4) % 2 == 0 { 0xff } else { 0x20 };
                    out.extend_from_slice(&[c, c, c]);
                }
                written += 3;
            }
            while written % 4 != 0 {
                out.push(0);
                written += 1;
            }
        }
        std::fs::write(path, out).expect("write test bmp");
    }

    /// One test drives every Qt-dependent path: image codecs want a
    /// QGuiApplication, and only one may exist per process.
    #[test]
    fn fit_image_passes_small_through_and_compresses_large() {
        let _app = cxx_qt_lib::QGuiApplication::new();
        let dir = std::env::temp_dir();

        // Small image fits the budget -> lossless pass-through, original mime.
        let small = dir.join("qt6ui-fit-small.bmp");
        write_bmp(&small, 16, 16, false);
        let url = fit_image_file(small.to_str().unwrap(), 131_072).expect("small fit");
        assert!(url.starts_with("data:image/bmp;base64,"), "got {}", &url[..40]);

        // Incompressible noise far over the budget -> JPEG within budget.
        let large = dir.join("qt6ui-fit-large.bmp");
        write_bmp(&large, 800, 600, true);
        let url = fit_image_file(large.to_str().unwrap(), 131_072).expect("large fit");
        assert!(url.starts_with("data:image/jpeg;base64,"), "got {}", &url[..40]);
        assert!(url.len() <= 131_072, "data URL too big: {}", url.len());

        // Spill: data URLs land on disk (RAM offload) with a separate
        // thumbnail for large images; http(s) sources pass through.
        let spilled = spill_images(vec![url, "https://example.com/x.gif".to_owned()]);
        assert_eq!(spilled.len(), 2);
        let (thumb, full) = (
            spilled[0]["thumb"].as_str().unwrap(),
            spilled[0]["full"].as_str().unwrap(),
        );
        assert!(full.starts_with("file:///"), "got {full}");
        assert!(std::path::Path::new(&full["file:///".len()..]).is_file(), "missing {full}");
        // 800x600 exceeds the 640x480 thumb box -> distinct thumbnail file.
        assert_ne!(thumb, full);
        assert!(thumb.ends_with(".thumb.jpg"), "got {thumb}");
        assert!(std::path::Path::new(&thumb["file:///".len()..]).is_file(), "missing {thumb}");
        assert_eq!(spilled[1]["thumb"], "https://example.com/x.gif");
        assert_eq!(spilled[1]["full"], "https://example.com/x.gif");

        let _ = std::fs::remove_file(small);
        let _ = std::fs::remove_file(large);
    }
}
