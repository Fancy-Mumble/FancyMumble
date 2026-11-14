//! The last livery each server sent, kept on disk so its page shows it
//! before anything is asked, until the server's ping says otherwise.
//!
//! One server's copy is read when its page is shown, and only then: nothing
//! here is held in memory for a server that is not on screen. Kept by
//! address (`host:port`, lower case), as the web client keeps it: several
//! identities share one server. The pictures are files of their own beside
//! the words, as they came; a copy whose pictures are larger than
//! [`MOST_PICTURES`] is not kept, and only [`MOST_KEPT`] servers are.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use gpui::SharedString;
use serde::{Deserialize, Serialize};

use super::{Livery, Palette, Rgb, Tag, TagTone};

/// What one server's pictures may take on disk, together.
const MOST_PICTURES: usize = 1_500_000;
/// How many servers' copies are kept; the oldest goes first.
const MOST_KEPT: usize = 48;

/// A livery kept from an earlier visit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Kept {
    /// The digest that was current when it was kept: what a ping vouches for.
    pub digest: SharedString,
    pub livery: Arc<Livery>,
}

/// One chip, as it is written down.
#[derive(Debug, Serialize, Deserialize)]
struct StoredTag {
    label: String,
    tone: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    href: Option<String>,
}

/// One mode's colours, as written down: each re-written from three numbers.
#[derive(Debug, Default, Serialize, Deserialize)]
struct StoredPalette {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    accent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    surface: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    aura_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    aura_to: Option<String>,
}

impl From<&Palette> for StoredPalette {
    fn from(palette: &Palette) -> Self {
        let hex = |colour: Option<Rgb>| colour.map(|colour| colour.to_string());
        Self {
            accent: hex(palette.accent),
            surface: hex(palette.surface),
            aura_from: hex(palette.aura_from),
            aura_to: hex(palette.aura_to),
        }
    }
}

impl StoredPalette {
    fn read(&self) -> Option<Palette> {
        Palette::read([
            self.accent.as_deref(),
            self.surface.as_deref(),
            self.aura_from.as_deref(),
            self.aura_to.as_deref(),
        ])
    }
}

/// The words of a kept livery, as written down.
#[derive(Debug, Serialize, Deserialize)]
struct Stored {
    /// The address it is kept for: two addresses may share a file name.
    key: String,
    digest: String,
    version: u64,
    /// When it was kept, in milliseconds since 1970: for a person reading
    /// the file.
    saved_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tagline: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    motd: Option<String>,
    #[serde(default)]
    tags: Vec<StoredTag>,
    focus: (u8, u8),
    #[serde(default, skip_serializing_if = "Option::is_none")]
    dark: Option<StoredPalette>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    light: Option<StoredPalette>,
    #[serde(default)]
    banner: bool,
    #[serde(default)]
    icon: bool,
}

/// The folder the copies are kept in.
#[derive(Debug, Clone)]
pub(crate) struct Shelf {
    dir: PathBuf,
}

impl Shelf {
    pub(crate) fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// What the server at `key` said last time, if it was kept.
    pub(crate) fn read(&self, key: &str) -> Option<Kept> {
        let key = key.to_lowercase();
        let path = self.path(&key, "json");
        let stored: Stored = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
        if stored.key != key || stored.digest.is_empty() {
            return None;
        }
        let picture = |kind: &str, there: bool| -> Option<Option<Arc<gpui::Image>>> {
            if !there {
                return Some(None);
            }
            // A copy missing a picture it names is no copy.
            let bytes = std::fs::read(self.path(&key, kind)).ok()?;
            Some(Some(Arc::new(crate::picture::picture(bytes)?)))
        };
        let banner = picture("banner", stored.banner)?;
        let icon = picture("icon", stored.icon)?;
        let livery = Livery {
            version: stored.version,
            digest: stored.digest.clone().into(),
            name: super::said(stored.name.as_deref()),
            tagline: super::said(stored.tagline.as_deref()),
            motd: super::said(stored.motd.as_deref()),
            tags: stored
                .tags
                .iter()
                .map(|tag| Tag::new(&tag.label, TagTone::named(&tag.tone), tag.href.as_deref()))
                .collect(),
            banner,
            icon,
            focus: Livery::focus_of(Some((stored.focus.0.into(), stored.focus.1.into()))),
            dark: stored.dark.as_ref().and_then(StoredPalette::read),
            light: stored.light.as_ref().and_then(StoredPalette::read),
        };
        Some(Kept {
            digest: stored.digest.into(),
            livery: Arc::new(livery),
        })
    }

    /// Keep what the server at `key` just said. A livery without a digest
    /// could never be checked against a ping, and is not kept; nor is one
    /// whose pictures are too large.
    ///
    /// # Errors
    ///
    /// When the files cannot be written.
    pub(crate) fn put(&self, key: &str, livery: &Livery) -> std::io::Result<()> {
        let key = key.to_lowercase();
        let bytes = |picture: Option<&Arc<gpui::Image>>| picture.map_or(0, |p| p.bytes().len());
        if livery.digest.is_empty()
            || bytes(livery.banner.as_ref()) + bytes(livery.icon.as_ref()) > MOST_PICTURES
        {
            return Ok(());
        }
        std::fs::create_dir_all(&self.dir)?;
        for (kind, picture) in [("banner", &livery.banner), ("icon", &livery.icon)] {
            match picture {
                Some(picture) => std::fs::write(self.path(&key, kind), picture.bytes())?,
                None => remove(&self.path(&key, kind))?,
            }
        }
        let palette = |palette: Option<&Palette>| palette.map(StoredPalette::from);
        let stored = Stored {
            key: key.clone(),
            digest: livery.digest.to_string(),
            version: livery.version,
            saved_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |since| {
                    u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
                }),
            name: livery.name.as_ref().map(ToString::to_string),
            tagline: livery.tagline.as_ref().map(ToString::to_string),
            motd: livery.motd.as_ref().map(ToString::to_string),
            tags: livery
                .tags
                .iter()
                .map(|tag| StoredTag {
                    label: tag.label.to_string(),
                    tone: tag.tone.name().to_owned(),
                    href: tag.href.as_ref().map(ToString::to_string),
                })
                .collect(),
            focus: livery.focus,
            dark: palette(livery.dark.as_ref()),
            light: palette(livery.light.as_ref()),
            banner: livery.banner.is_some(),
            icon: livery.icon.is_some(),
        };
        let text = serde_json::to_string_pretty(&stored).map_err(std::io::Error::other)?;
        // Written whole or not at all: the words name the pictures.
        let partial = self.path(&key, "json.partial");
        std::fs::write(&partial, text)?;
        std::fs::rename(partial, self.path(&key, "json"))?;
        self.keep_newest();
        Ok(())
    }

    /// Forget what the server at `key` said: it says now it has no livery.
    ///
    /// # Errors
    ///
    /// When a file is there and cannot be removed.
    pub(crate) fn forget(&self, key: &str) -> std::io::Result<()> {
        let key = key.to_lowercase();
        for kind in ["json", "banner", "icon"] {
            remove(&self.path(&key, kind))?;
        }
        Ok(())
    }

    /// The file of `kind` kept for `key`.
    fn path(&self, key: &str, kind: &str) -> PathBuf {
        self.dir.join(format!("{}.{kind}", name_of(key)))
    }

    /// Let go of the copies kept longest ago, beyond [`MOST_KEPT`].
    fn keep_newest(&self) {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return;
        };
        let mut kept: Vec<(std::time::SystemTime, PathBuf)> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .filter_map(|path| Some((std::fs::metadata(&path).ok()?.modified().ok()?, path)))
            .collect();
        if kept.len() <= MOST_KEPT {
            return;
        }
        kept.sort();
        for (_, path) in kept.iter().take(kept.len() - MOST_KEPT) {
            for kind in ["json", "banner", "icon"] {
                let _ = remove(&path.with_extension(kind));
            }
        }
    }
}

/// A file name for an address: its FNV-1a hash, which any address makes.
fn name_of(key: &str) -> String {
    let hash = key.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    });
    format!("{hash:016x}")
}

/// Remove `path`; one that is not there is removed already.
fn remove(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A PNG of one colour, `side` square.
    pub(crate) fn png(side: u32, colour: [u8; 3]) -> Vec<u8> {
        let [r, g, b] = colour;
        let pixels = image::RgbaImage::from_pixel(side, side, image::Rgba([r, g, b, 255]));
        let mut file = Vec::new();
        pixels
            .write_to(
                &mut std::io::Cursor::new(&mut file),
                image::ImageFormat::Png,
            )
            .expect("a PNG");
        file
    }

    pub(crate) fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("fancy-gpui-livery-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn livery(digest: &str) -> Livery {
        Livery {
            version: 3,
            digest: digest.to_owned().into(),
            name: Some("Crimson Hall".into()),
            tagline: Some("A red room".into()),
            motd: None,
            tags: vec![Tag::new(
                "Rules",
                TagTone::Accent,
                Some("https://example.org"),
            )],
            banner: crate::picture::picture(png(8, [200, 20, 60])).map(Arc::new),
            icon: None,
            focus: (40, 20),
            dark: Palette::read([Some("#e0245e"), None, None, None]),
            light: None,
        }
    }

    #[test]
    fn a_livery_comes_back_as_it_was_kept_and_is_forgotten() {
        let dir = scratch("round");
        let shelf = Shelf::new(&dir);
        assert!(
            shelf.read("example.org:64738").is_none(),
            "nothing kept yet"
        );
        shelf
            .put("Example.org:64738", &livery("aaaa"))
            .expect("writable");
        let kept = shelf.read("example.org:64738").expect("kept");
        assert_eq!(kept.digest.as_ref(), "aaaa");
        assert_eq!(*kept.livery, livery("aaaa"), "as it was, picture and all");
        assert!(
            shelf.read("example.org:1").is_none(),
            "another port is another server"
        );
        shelf.forget("example.org:64738").expect("removable");
        assert!(shelf.read("example.org:64738").is_none());
        assert_eq!(std::fs::read_dir(&dir).map(Iterator::count).unwrap_or(0), 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn what_cannot_be_checked_or_is_too_large_is_not_kept() {
        let dir = scratch("refused");
        let shelf = Shelf::new(&dir);
        shelf.put("a:1", &livery("")).expect("nothing to write");
        assert!(
            shelf.read("a:1").is_none(),
            "no digest, nothing to check it by"
        );
        let huge = Livery {
            banner: Some(Arc::new(gpui::Image::from_bytes(
                gpui::ImageFormat::Png,
                vec![0; MOST_PICTURES + 1],
            ))),
            ..livery("bbbb")
        };
        shelf.put("a:1", &huge).expect("nothing to write");
        assert!(shelf.read("a:1").is_none(), "too large to keep");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_copy_missing_its_picture_is_no_copy() {
        let dir = scratch("torn");
        let shelf = Shelf::new(&dir);
        shelf.put("a:1", &livery("cccc")).expect("writable");
        std::fs::remove_file(shelf.path("a:1", "banner")).expect("there");
        assert!(shelf.read("a:1").is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn only_so_many_servers_are_kept() {
        let dir = scratch("many");
        let shelf = Shelf::new(&dir);
        let plain = Livery {
            banner: None,
            ..livery("dddd")
        };
        for port in 0..=MOST_KEPT {
            shelf.put(&format!("a:{port}"), &plain).expect("writable");
        }
        let kept = (0..=MOST_KEPT)
            .filter(|port| shelf.read(&format!("a:{port}")).is_some())
            .count();
        assert_eq!(kept, MOST_KEPT);
        let _ = std::fs::remove_dir_all(dir);
    }
}
