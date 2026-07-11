// Thin Qt image-codec leaves for the Rust media pipeline (src/media.rs).
//
// cxx-qt-lib's QImage wrapper can decode and scale but not encode, so these
// three functions wrap the missing Qt API surface; the actual fit-to-budget
// strategy (mirroring the web client's utils/media.ts fitImage) stays in
// Rust, like the markdown parsing does for the highlighter.
//
// Declared to Rust in the `unsafe extern "C++"` block of src/bridge.rs.
#pragma once

#include <cstdint>

#include <QtCore/QString>
#include <QtGui/QImage>

#include "rust/cxx.h"

/// Encode `img` as JPEG at `quality` (1-100) and return the raw base64
/// payload (no `data:` prefix). Empty string when encoding fails.
QString image_to_jpeg_base64(const QImage &img, std::int32_t quality);

/// Base64-encode raw bytes (used for the pass-through path where the
/// original file already fits the server's image budget).
QString bytes_to_base64(rust::Slice<const std::uint8_t> bytes);

/// Write a `data:<mime>;base64,` URL's payload into this process's spill
/// dir ({temp}/qt6ui-chat-images/{pid}, content-hash file names so repeats
/// dedupe) and return the file path; empty on failure. Keeping chat images
/// on disk instead of in the QML model keeps the minimal client's RAM flat:
/// the UI loads a spilled image only while it is actually on screen.
QString data_url_to_spill_file(const QString &dataUrl);

/// Save `img` to `path` (format from the extension, e.g. thumbnail
/// `.thumb.jpg`/`.thumb.png` files next to their spilled originals).
bool qimage_save_file(const QImage &img, const QString &path, std::int32_t quality);

/// Resolve the image on the clipboard to a local file path: a copied image
/// file's own path when available, otherwise raster clipboard data saved as
/// a PNG in the spill dir. Empty string when the clipboard holds no image.
/// Must be called on the GUI thread (QML invokable path).
QString clipboard_image_path();
