//! Forgetting everything the view keeps: what "reset all data" deletes of
//! this client's own files. The engine's identities are its to delete.

use std::path::Path;

use super::Store;

/// The view's files and folders under the data directory.
const KEPT: [&str; 5] = [
    "view.json",
    "servers.json",
    super::WALLPAPER,
    "walls",
    "liveries",
];

impl Store {
    /// The directory everything is kept in.
    pub(crate) fn dir(&self) -> &Path {
        &self.dir
    }

    /// Delete every file and folder this view keeps. What was not there is
    /// not an error.
    ///
    /// # Errors
    ///
    /// When one is there and cannot be deleted.
    pub(crate) fn forget_everything(&self) -> std::io::Result<()> {
        for name in KEPT {
            let path = self.dir.join(name);
            let gone = if path.is_dir() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
            match gone {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error),
                _ => {}
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn everything_the_view_keeps_goes_and_nothing_beside_it() {
        let dir = std::env::temp_dir().join(format!("fancy-gpui-reset-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = Store::new(&dir);
        store
            .save_settings(&super::super::Settings::default())
            .expect("writable");
        let _ = store.keep_chat_background(b"wall").expect("writable");
        std::fs::write(dir.join("other.txt"), b"not ours").expect("writable");
        store.forget_everything().expect("forgotten");
        assert!(!dir.join("view.json").exists() && !dir.join("walls").exists());
        assert!(dir.join("other.txt").exists());
        store
            .forget_everything()
            .expect("nothing there is not an error");
        let _ = std::fs::remove_dir_all(dir);
    }
}
