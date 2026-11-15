//! A picture shared as a file, as a stock Mumble client is shown it.
//!
//! A stock client cannot fetch from a server's file store, and draws the
//! comment that names a shared file as nothing. The one picture it draws is
//! one inside the message, as a `data:` address. So beside a shared picture's
//! mark goes a copy of it, fenced in where only such a client reads it, as
//! the web client's `withLegacyFallback` writes it:
//!
//! ```text
//! <!-- FANCY_LEGACY --><img src="data:image/jpeg;base64,..." alt="name" /><!-- /FANCY_LEGACY -->
//! ```
//!
//! A Fancy client cuts the fence out before it reads the message
//! (`fancy_utils::html::strip_legacy_fallback`), so it never decodes the copy.
//!
//! The copy is as large as the server lets one message be: the whole
//! message counts, so it is fitted into what the rest leaves. Size is kept
//! before quality is: the picture is shrunk only once even a modest JPEG
//! quality does not fit at the size it is.

use std::sync::Arc;

use fancy_utils::html::{LEGACY_FALLBACK_CLOSE, LEGACY_FALLBACK_OPEN};
use image::{DynamicImage, GenericImageView as _, RgbImage};

/// The largest a copy is: the box the web client fits inline pictures into,
/// and what a stock client scales its own pasted pictures into. Larger, and
/// a stock client refuses to lay the message out at all.
pub const LEGACY_BOX: (u32, u32) = (1600, 1000);
/// The height several copies in one message share: a stock client lays out
/// no message taller than 2048 pixels.
const STACK_HEIGHT: u32 = 1800;
/// The lowest JPEG quality a copy is sent at before it is made smaller.
const QUALITY_FLOOR: u8 = 50;
/// The highest JPEG quality tried: above it the bytes grow for nothing seen.
const QUALITY_TOP: u8 = 92;
/// Below this longer side a copy is not made smaller any more; its quality
/// may then go down to [`QUALITY_LAST`] before it is given up.
const SMALLEST_SIDE: u32 = 320;
const QUALITY_LAST: u8 = 25;
/// Each step down in size, as a share of the side before it.
const STEP: f32 = 0.85;
/// The most of a copy's name its `alt` carries (`MAX_ALT_CHARS`).
const MOST_ALT: usize = 64;
/// The longest original kept to be sent as it is, where it fits.
const MOST_KEPT: usize = 1024 * 1024;
/// Below this many characters a copy is not worth making (`MIN_FALLBACK_BYTES`).
const LEAST_WORTH: usize = 8_000;
/// Fewer colours than this and a picture is tried as a PNG at every size.
const FEW_COLOURS: usize = 256;
/// The most copies one message carries: an album's first four, as many as
/// a Fancy client draws as tiles before its "+n". The rest keep their line,
/// which names each, so a stock client reads what else came.
pub const ALBUM_COPIES: usize = 4;

/// What a picture shared as a file keeps for its copy while it goes up: the
/// picture already no larger than [`LEGACY_BOX`], and its file where that
/// may go as it is. Cheap to clone; the pixels are shared.
#[derive(Clone)]
pub struct LegacyPicture(Arc<Kept>);

struct Kept {
    picture: DynamicImage,
    /// The file as it is, with its type, where a stock client reads that
    /// type, it is upright as it is and no larger than the box. An
    /// animation that fits then still moves.
    original: Option<(&'static str, Vec<u8>)>,
}

impl std::fmt::Debug for LegacyPicture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LegacyPicture")
            .field("size", &self.0.picture.dimensions())
            .field("original", &self.0.original.as_ref().map(|(kind, bytes)| (kind, bytes.len())))
            .finish()
    }
}

impl PartialEq for LegacyPicture {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Eq for LegacyPicture {}

/// One copy, encoded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Encoded {
    /// Its type: `image/jpeg`, `image/png` or, sent as it was, `image/gif`.
    pub kind: &'static str,
    /// The encoded picture.
    pub bytes: Vec<u8>,
    /// How large it is, in pixels.
    pub size: (u32, u32),
}

impl Encoded {
    /// How long its `data:` address is.
    fn address_len(&self) -> usize {
        address_len(self.kind, self.bytes.len())
    }

    fn address(&self) -> String {
        use base64::Engine as _;
        let mut address = format!("data:{};base64,", self.kind);
        base64::engine::general_purpose::STANDARD.encode_string(&self.bytes, &mut address);
        address
    }
}

/// How long the `data:` address of `len` bytes of type `kind` is.
fn address_len(kind: &str, len: usize) -> usize {
    "data:;base64,".len() + kind.len() + len.div_ceil(3) * 4
}

/// The type of the picture file `bytes`, where a stock client reads it.
fn legacy_kind(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xff, 0xd8, 0xff, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', b'8', ..] => Some("image/gif"),
        _ => None,
    }
}

/// Whether the picture file `bytes` is upright as it is stored: a camera
/// photo that says to be turned would be drawn lying down by a stock client.
fn upright(bytes: &[u8]) -> bool {
    use image::ImageDecoder as _;
    image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()
        .and_then(|reader| reader.into_decoder().ok())
        .and_then(|mut decoder| decoder.orientation().ok())
        .is_some_and(|way| way == image::metadata::Orientation::NoTransforms)
}

/// `picture` made no larger than `most`, keeping its shape.
fn within(picture: &DynamicImage, most: (u32, u32)) -> Option<DynamicImage> {
    let (width, height) = picture.dimensions();
    (width > most.0 || height > most.1).then(|| picture.thumbnail(most.0, most.1))
}

impl LegacyPicture {
    /// What to keep of `picture`, decoded from the file `file` and turned
    /// upright: a copy no larger than [`LEGACY_BOX`], and the file itself
    /// where it could go as it is. Made where the picture is decoded anyway,
    /// so that nothing is decoded twice; the decoded picture can go after.
    #[must_use]
    pub fn new(picture: &DynamicImage, file: &[u8]) -> Self {
        let shrunk = within(picture, LEGACY_BOX);
        let original = match (legacy_kind(file), &shrunk) {
            (Some(kind), None) if file.len() <= MOST_KEPT && upright(file) => {
                Some((kind, file.to_vec()))
            }
            _ => None,
        };
        let picture = shrunk.unwrap_or_else(|| picture.clone());
        // An alpha channel nothing shows through costs a quarter more to
        // keep, and says nothing.
        let picture = if picture.color().has_alpha() && !shows_through(&picture) {
            DynamicImage::ImageRgb8(picture.into_rgb8())
        } else {
            picture
        };
        Self(Arc::new(Kept { picture, original }))
    }

    /// How large the kept copy is.
    #[must_use]
    pub fn size(&self) -> (u32, u32) {
        self.0.picture.dimensions()
    }

    /// The copy fitted into an address of at most `room` characters, no
    /// taller than `height`; `None` where nothing worth showing fits.
    #[must_use]
    pub fn fitted(&self, room: usize, height: u32) -> Option<Encoded> {
        let most = (LEGACY_BOX.0, LEGACY_BOX.1.min(height));
        if let Some((kind, bytes)) = &self.0.original {
            let (width, tall) = self.0.picture.dimensions();
            if width <= most.0 && tall <= most.1 && address_len(kind, bytes.len()) <= room {
                return Some(Encoded {
                    kind,
                    bytes: bytes.clone(),
                    size: (width, tall),
                });
            }
        }
        Fitter::new(&self.0.picture, most, room).fit()
    }

    /// The fenced block a stock client is shown for this picture, named
    /// `name`, no longer than `room` characters as a server counts them;
    /// `None` where no copy worth showing fits. `link`, the file's address
    /// where anybody may open it, goes under the copy, so the original is a
    /// click away.
    #[must_use]
    pub fn block(&self, name: &str, link: Option<&str>, room: usize, height: u32) -> Option<String> {
        let around = fenced("", name, link).encode_utf16().count();
        let space = room.checked_sub(around)?;
        if space < LEAST_WORTH {
            return None;
        }
        let copy = self.fitted(space, height)?;
        (copy.address_len() <= space).then(|| fenced(&copy.address(), name, link))
    }
}

/// The fence around a copy at `address`, named `name`: the web client's
/// `legacyFence(mediaToHtml(address, "image", name.slice(0, 64)))`, and
/// under it, for a file anybody may open, a link to it named as the file.
#[must_use]
pub fn fenced(address: &str, name: &str, link: Option<&str>) -> String {
    let under = link.map_or_else(String::new, |link| {
        format!(
            r#"<br><a href="{}">{}</a>"#,
            super::gifs::escaped(link),
            super::gifs::escaped(name)
        )
    });
    let mut units = 0;
    let short: String = name
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= MOST_ALT
        })
        .collect();
    format!(
        r#"{LEGACY_FALLBACK_OPEN}<img src="{address}" alt="{}" />{under}{LEGACY_FALLBACK_CLOSE}"#,
        super::gifs::escaped(&short)
    )
}

impl super::EngineHandle {
    /// Whether a stock client in `channel` reads what this client sends
    /// there: not where the channel is sealed end to end and the plain
    /// copy is only a placeholder, which would carry no picture anyway.
    fn legacy_reads(&self, channel: u32) -> bool {
        let snapshot = self.state.inner.snapshot();
        let Ok(state) = snapshot.lock() else {
            return true;
        };
        let sealed = state
            .channels
            .get(&channel)
            .and_then(|known| known.pchat_protocol)
            .is_some_and(|protocol| protocol.is_encrypted());
        !(sealed && state.prefs.disable_dual_path)
    }

    /// [`message`] for files shared with `channel` as `how` says, on the
    /// engine's blocking threads. No copy for a password share, which the
    /// server is not to be able to look at (the web client's rule). A share
    /// that expires does get one, although the copy then outlives the file
    /// in every stock client's log and in a server's archive: a week is
    /// what a share lasts unless the sender says otherwise, and without a
    /// copy then a stock client would see no picture at all.
    pub(super) async fn shared_message(
        &self,
        channel: u32,
        lead: String,
        parts: Vec<Part>,
        how: &super::ShareAs,
    ) -> String {
        let copies =
            !matches!(how.reach, super::Reach::Password(_)) && self.legacy_reads(channel);
        let limits = self.message_limits();
        let plain = parts.clone();
        let plain_lead = lead.clone();
        crate::state::runtime::spawn_blocking(move || message(&lead, &parts, limits, copies))
            .await
            .unwrap_or_else(|_| message(&plain_lead, &plain, limits, false))
    }
}

/// One shared file of a message, as the message is put together.
#[derive(Debug, Clone)]
pub struct Part {
    /// The mark a Fancy client draws the file from.
    pub mark: String,
    /// The line a stock client reads for it where it has no copy, unfenced
    /// (the web client's `legacyFileLine`).
    pub line: String,
    /// The picture a copy is made of, where it is one.
    pub picture: Option<LegacyPicture>,
    /// What the file is called.
    pub name: String,
    /// Its address, where anybody may open it.
    pub link: Option<String>,
}

/// `html` fenced so only a stock client draws it.
fn fence(html: &str) -> String {
    format!("{LEGACY_FALLBACK_OPEN}{html}{LEGACY_FALLBACK_CLOSE}")
}

/// The message that says `lead` and shares `parts`, on a server that takes
/// `limits`, as the web client's `withLegacyFallback` writes it: what was
/// said, then the marks a line each; then, fenced for stock clients, the
/// lines of the files that get no copy, joined by breaks; then a fenced copy
/// a line each for the first [`ALBUM_COPIES`] pictures where `copies` and
/// the room allow. The copies share evenly what the message with every
/// line leaves of the limit. Never a message the server would refuse where
/// the bare one would be taken.
///
/// Slow: pictures are encoded, several times over. Not for a thread that
/// must answer quickly.
#[must_use]
pub fn message(lead: &str, parts: &[Part], limits: super::gifs::MessageLimits, copies: bool) -> String {
    let marks: Vec<&str> = parts.iter().map(|part| part.mark.as_str()).collect();
    let body = match lead {
        "" => marks.join("\n"),
        said => format!("{said}\n{}", marks.join("\n")),
    };
    if !limits.allow_html || parts.is_empty() {
        return body;
    }
    let every_line = fence(
        &parts
            .iter()
            .map(|part| part.line.as_str())
            .collect::<Vec<_>>()
            .join("<br>"),
    );
    let blocks = if copies {
        let used = body.encode_utf16().count() + every_line.encode_utf16().count() + 1;
        copy_blocks(parts, used, limits)
    } else {
        vec![None; parts.len()]
    };
    let lines: Vec<&str> = parts
        .iter()
        .zip(&blocks)
        .filter(|(_, block)| block.is_none())
        .map(|(part, _)| part.line.as_str())
        .collect();
    let with_lines = if lines.is_empty() {
        body.clone()
    } else {
        let candidate = format!("{body}\n{}", fence(&lines.join("<br>")));
        if super::gifs::accepted(&candidate, limits) {
            candidate
        } else {
            body.clone()
        }
    };
    let copied: Vec<&str> = blocks.iter().flatten().map(String::as_str).collect();
    for start in [&with_lines, &body] {
        let joined = std::iter::once(start.as_str())
            .chain(copied.iter().copied())
            .collect::<Vec<_>>()
            .join("\n");
        if super::gifs::accepted(&joined, limits) {
            return joined;
        }
    }
    body
}

/// A fenced copy for each of the first [`ALBUM_COPIES`] pictures of
/// `parts` that fits, `None` for every other part; the copies share what
/// `used` characters leave of the limit.
fn copy_blocks(
    parts: &[Part],
    used: usize,
    limits: super::gifs::MessageLimits,
) -> Vec<Option<String>> {
    let pictures = parts
        .iter()
        .filter(|part| part.picture.is_some())
        .count()
        .min(ALBUM_COPIES);
    let limit = match limits.max_image_message_length {
        0 => super::gifs::MessageLimits::default().max_image_message_length,
        limit => limit,
    } as usize;
    let height = stacked_height(pictures);
    let mut remaining = limit.saturating_sub(used);
    let mut left = pictures;
    parts
        .iter()
        .map(|part| {
            let picture = part.picture.as_ref().filter(|_| left > 0)?;
            // Every block after the body costs the newline that joins it on.
            let share = (remaining / left).checked_sub(1);
            left -= 1;
            let block = picture.block(&part.name, part.link.as_deref(), share?, height)?;
            remaining -= block.encode_utf16().count() + 1;
            Some(block)
        })
        .collect()
}

/// A size in bytes as the web client's `formatBytes` writes it: `812 B`,
/// `1.5 KiB`, `3.8 MiB`, `12 MiB`.
#[must_use]
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["KiB", "MiB", "GiB", "TiB", "PiB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    #[allow(
        clippy::cast_precision_loss,
        reason = "said to one decimal; nobody shares a file of 2^53 bytes"
    )]
    let mut size = bytes as f64 / 1024.0;
    let mut unit = 0;
    while size >= 1024.0 && unit + 1 < UNITS.len() {
        size /= 1024.0;
        unit += 1;
    }
    if size >= 10.0 || size.fract() == 0.0 {
        format!("{} {}", size.round(), UNITS[unit])
    } else {
        format!("{size:.1} {}", UNITS[unit])
    }
}

/// The line a stock client reads for a shared file without a copy, as the
/// web client's `legacyFileLine` writes it: a picture or a paperclip, its
/// name (a link where `link` is one anybody may follow), its size, and a
/// lock where it is sealed with a password.
#[must_use]
pub fn file_line(name: &str, size: Option<u64>, link: Option<&str>, sealed: bool) -> String {
    let lower = name.to_ascii_lowercase();
    let picture = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif", ".svg"]
        .iter()
        .any(|ending| lower.ends_with(ending));
    let glyph = if picture { "\u{1f5bc}\u{fe0f}" } else { "\u{1f4ce}" };
    let named = super::gifs::escaped(name);
    let shown = match link {
        Some(link) => format!(r#"<a href="{}">{named}</a>"#, super::gifs::escaped(link)),
        None => named,
    };
    let size = size
        .filter(|size| *size > 0)
        .map_or_else(String::new, |size| format!(" ({})", format_bytes(size)));
    let lock = if sealed { " \u{1f512}" } else { "" };
    format!("{glyph} {shown}{size}{lock}")
}

/// The height each of `count` copies in one message may be.
#[must_use]
pub fn stacked_height(count: usize) -> u32 {
    let count = u32::try_from(count.max(1)).unwrap_or(u32::MAX);
    (STACK_HEIGHT / count).min(LEGACY_BOX.1)
}

/// Whether anything shows through `picture` anywhere.
fn shows_through(picture: &DynamicImage) -> bool {
    match picture {
        DynamicImage::ImageRgba8(pixels) => pixels.pixels().any(|pixel| pixel.0[3] < 255),
        other => other.to_rgba8().pixels().any(|pixel| pixel.0[3] < 255),
    }
}

/// Whether `picture` has so few colours that a PNG may well be the smaller.
fn few_colours(picture: &DynamicImage) -> bool {
    let mut seen = std::collections::HashSet::new();
    let rgba = picture.to_rgba8();
    for pixel in rgba.pixels() {
        let _ = seen.insert(pixel.0);
        if seen.len() > FEW_COLOURS {
            return false;
        }
    }
    true
}

/// The search for the best copy that fits: one picture, one box, one room.
struct Fitter {
    /// The picture as a PNG would keep it.
    picture: DynamicImage,
    /// The picture as a JPEG is made of it: what shows through laid on white.
    opaque: RgbImage,
    /// Whether a PNG is worth trying at every size, not only the first.
    png_everywhere: bool,
    room: usize,
}

impl Fitter {
    fn new(picture: &DynamicImage, most: (u32, u32), room: usize) -> Self {
        let picture = within(picture, most).unwrap_or_else(|| picture.clone());
        let shows_through = picture.color().has_alpha();
        let opaque = if shows_through {
            on_white(&picture)
        } else {
            picture.to_rgb8()
        };
        Self {
            png_everywhere: shows_through || few_colours(&picture),
            picture,
            opaque,
            room,
        }
    }

    /// The largest copy that fits at a quality worth looking at; failing
    /// that, the smallest size at whatever quality fits.
    fn fit(&self) -> Option<Encoded> {
        let (width, height) = self.opaque.dimensions();
        let mut scale = 1.0_f32;
        let mut first = true;
        loop {
            let size = scaled((width, height), scale);
            let last = size.0.max(size.1) <= SMALLEST_SIDE || scale < 0.01;
            if (first || self.png_everywhere)
                && let Some(png) = self.png(size)
            {
                return Some(png);
            }
            first = false;
            let floor = if last { QUALITY_LAST } else { QUALITY_FLOOR };
            if let Some(jpeg) = self.best_jpeg(size, floor) {
                return Some(jpeg);
            }
            if last {
                return None;
            }
            scale *= STEP;
        }
    }

    fn fits(&self, copy: &Encoded) -> bool {
        copy.address_len() <= self.room
    }

    fn png(&self, size: (u32, u32)) -> Option<Encoded> {
        let picture = self.resized_picture(size);
        let mut bytes = Vec::new();
        picture
            .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
            .ok()?;
        let copy = Encoded {
            kind: "image/png",
            bytes,
            size,
        };
        self.fits(&copy).then_some(copy)
    }

    /// The best JPEG at `size` no worse than `floor` that fits, if any.
    fn best_jpeg(&self, size: (u32, u32), floor: u8) -> Option<Encoded> {
        let pixels = self.resized_opaque(size);
        let at = |quality: u8| jpeg(&pixels, quality).filter(|copy| self.fits(copy));
        if let Some(top) = at(QUALITY_TOP) {
            return Some(top);
        }
        let mut best = at(floor)?;
        let (mut low, mut high) = (floor, QUALITY_TOP);
        while high - low > 2 {
            let middle = low + (high - low) / 2;
            match at(middle) {
                Some(copy) => {
                    best = copy;
                    low = middle;
                }
                None => high = middle,
            }
        }
        Some(best)
    }

    fn resized_opaque(&self, size: (u32, u32)) -> RgbImage {
        if size == self.opaque.dimensions() {
            return self.opaque.clone();
        }
        image::imageops::resize(&self.opaque, size.0, size.1, image::imageops::FilterType::CatmullRom)
    }

    fn resized_picture(&self, size: (u32, u32)) -> DynamicImage {
        if size == self.picture.dimensions() {
            return self.picture.clone();
        }
        self.picture
            .resize_exact(size.0, size.1, image::imageops::FilterType::CatmullRom)
    }
}

/// `natural` at `scale`, never smaller than one pixel a side.
fn scaled(natural: (u32, u32), scale: f32) -> (u32, u32) {
    #[allow(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a picture's side is a few thousand pixels, and the result is rounded and at least one"
    )]
    let side = |of: u32| ((of as f32 * scale).round() as u32).max(1);
    (side(natural.0), side(natural.1))
}

/// `picture` with what shows through laid on white: a JPEG keeps no
/// transparency, and black under a dark logo would hide it.
fn on_white(picture: &DynamicImage) -> RgbImage {
    let rgba = picture.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let over = |c: u8| {
            let (c, a) = (u16::from(c), u16::from(a));
            u8::try_from((c * a + 255 * (255 - a)) / 255).unwrap_or(u8::MAX)
        };
        image::Rgb([over(r), over(g), over(b)])
    })
}

fn jpeg(pixels: &RgbImage, quality: u8) -> Option<Encoded> {
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality)
        .encode_image(pixels)
        .ok()?;
    Some(Encoded {
        kind: "image/jpeg",
        bytes,
        size: pixels.dimensions(),
    })
}

#[cfg(test)]
mod tests;
