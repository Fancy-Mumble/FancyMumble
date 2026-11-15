//! Forgetting what the engine keeps on this device: its identities and
//! the certificates of the older layout. What the web client's "reset all
//! data" deletes of the engine's, for a view that resets too.

use std::path::Path;

/// Delete the identities and the older certificates kept under
/// `data_dir`. What was not there is not an error.
///
/// # Errors
///
/// When one is there and cannot be deleted.
pub fn forget_identities(data_dir: &Path) -> Result<(), String> {
    for dir in [
        crate::state::pchat::IDENTITIES_DIR,
        crate::state::pchat::LEGACY_CERTS_DIR,
    ] {
        remove_if_present(&data_dir.join(dir), true)?;
    }
    Ok(())
}

/// Delete a path, treating "it was not there" as success.
///
/// Checking `exists()` first and then deleting races anything that removes
/// the path in between, and reports that race as a hard failure.
pub(crate) fn remove_if_present(path: &Path, recursive: bool) -> Result<(), String> {
    let result = if recursive {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    match result {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("could not remove {}: {e}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_identities_go_and_nothing_else_does() {
        let dir = std::env::temp_dir().join(format!("engine-reset-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("identities").join("alex")).expect("writable");
        std::fs::create_dir_all(dir.join("certs")).expect("writable");
        std::fs::write(dir.join("other.json"), b"{}").expect("writable");
        forget_identities(&dir).expect("forgotten");
        assert!(!dir.join("identities").exists() && !dir.join("certs").exists());
        assert!(dir.join("other.json").exists());
        forget_identities(&dir).expect("nothing there is not an error");
        let _ = std::fs::remove_dir_all(dir);
    }
}
