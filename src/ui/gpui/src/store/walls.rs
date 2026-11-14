//! The files of the pictures kept for behind the conversation: one each,
//! under `walls` in the data directory, named by what is in them, and let
//! go of once the shelf no longer names them.

use std::hash::{Hash, Hasher};
use std::path::PathBuf;

use super::{Backgrounds, ChatBackground, Store};

/// The folder the pictures are kept in, under the data directory.
const WALLS: &str = "walls";

impl Store {
    /// The pictures kept for behind the conversation, as `stored` says. A
    /// picture kept before there was a shelf is put on it, shown.
    pub(crate) fn backgrounds(&self, stored: &Backgrounds) -> Backgrounds {
        if !stored.is_empty() || !self.dir.join(super::WALLPAPER).is_file() {
            return stored.clone();
        }
        let mut shelf = Backgrounds::default();
        let _ = shelf.remember(ChatBackground::new(super::WALLPAPER));
        shelf
    }

    /// The picture kept as `file`, as an encoded image; none if `file` is
    /// not one of the names this keeps pictures under, or is gone.
    pub(crate) fn chat_background(&self, file: &str) -> Option<Vec<u8>> {
        std::fs::read(self.wall_path(file)?).ok()
    }

    /// Keep `picture`, an encoded image, for behind the conversation, and
    /// say the name it is kept under. The same picture twice is one file.
    ///
    /// # Errors
    ///
    /// When the file cannot be written.
    pub(crate) fn keep_chat_background(&self, picture: &[u8]) -> std::io::Result<String> {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        picture.hash(&mut hasher);
        let name = format!("{WALLS}/{:016x}.jpg", hasher.finish());
        let dir = self.dir.join(WALLS);
        std::fs::create_dir_all(&dir)?;
        let path = self.dir.join(&name);
        if !path.is_file() {
            std::fs::write(path, picture)?;
        }
        Ok(name)
    }

    /// Delete every kept picture `shelf` does not name.
    pub(crate) fn prune_chat_backgrounds(&self, shelf: &Backgrounds) {
        let named = |name: &str| shelf.recents.iter().any(|entry| entry.file == name);
        if !named(super::WALLPAPER) {
            let _ = std::fs::remove_file(self.dir.join(super::WALLPAPER));
        }
        let Ok(files) = std::fs::read_dir(self.dir.join(WALLS)) else {
            return;
        };
        for file in files.flatten() {
            let name = format!("{WALLS}/{}", file.file_name().to_string_lossy());
            if !named(&name) {
                let _ = std::fs::remove_file(file.path());
            }
        }
    }

    /// Where the picture kept as `file` is, if that is a name this keeps
    /// pictures under: nothing read from the settings file reaches outside
    /// the folder.
    fn wall_path(&self, file: &str) -> Option<PathBuf> {
        if file == super::WALLPAPER {
            return Some(self.dir.join(file));
        }
        let name = file.strip_prefix(WALLS)?.strip_prefix('/')?;
        let plain = !name.is_empty()
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
            && !name.starts_with('.');
        plain.then(|| self.dir.join(WALLS).join(name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("fancy-gpui-walls-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn pictures_are_kept_once_read_back_and_let_go_when_the_shelf_drops_them() {
        let dir = scratch("keep");
        let store = Store::new(&dir);
        let a = store.keep_chat_background(b"first").expect("writable");
        assert_eq!(store.keep_chat_background(b"first").expect("again"), a);
        let b = store.keep_chat_background(b"second").expect("writable");
        assert_eq!(store.chat_background(&a).as_deref(), Some(&b"first"[..]));
        let mut shelf = Backgrounds::default();
        let _ = shelf.remember(ChatBackground::new(b.clone()));
        store.prune_chat_backgrounds(&shelf);
        assert!(
            store.chat_background(&a).is_none(),
            "not on the shelf: gone"
        );
        assert!(store.chat_background(&b).is_some());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_name_that_climbs_out_of_the_folder_is_not_read() {
        let store = Store::new(scratch("names"));
        for name in [
            "../view.json",
            "walls/../view.json",
            "walls/",
            "/etc/passwd",
            "walls/.x",
        ] {
            assert!(store.wall_path(name).is_none(), "{name}");
        }
        assert!(store.wall_path("walls/0123abcd.jpg").is_some());
    }

    #[test]
    fn a_picture_kept_before_the_shelf_is_put_on_it() {
        let dir = scratch("legacy");
        let store = Store::new(&dir);
        assert!(store.backgrounds(&Backgrounds::default()).is_empty());
        std::fs::create_dir_all(&dir).expect("writable");
        std::fs::write(dir.join(super::super::WALLPAPER), b"old").expect("writable");
        let shelf = store.backgrounds(&Backgrounds::default());
        assert_eq!(
            shelf.current().map(|entry| entry.file.as_str()),
            Some(super::super::WALLPAPER)
        );
        assert_eq!(
            store.chat_background(super::super::WALLPAPER).as_deref(),
            Some(&b"old"[..])
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
