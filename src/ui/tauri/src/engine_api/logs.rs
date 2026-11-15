//! Log output, for a view to turn on and steer.
//!
//! The engine says what it does through `tracing`; with nothing listening
//! all of it is dropped, and a connection that was lost overnight leaves no
//! word of why. A view calls [`start`] once, early, and from then on can
//! change what is kept while it runs.

use std::path::{Path, PathBuf};

use crate::logging;

/// Start keeping what the engine says: on the terminal in a debug build,
/// and, with `to_file`, in a file of the day under `directory`. Files older
/// than a day are compressed.
///
/// `level` is a filter as `RUST_LOG` takes one (`info`, `debug`,
/// `mumble_protocol=trace`); `None` is what the environment says, or `info`.
///
/// Call it once: a process has one place its log goes.
///
/// # Errors
///
/// When `level` is not a filter, or the file cannot be opened. Logging to
/// the terminal has started either way.
pub fn start(directory: PathBuf, level: Option<&str>, to_file: bool) -> Result<(), String> {
    logging::init();
    logging::set_log_dir(directory);
    logging::set_auto_zip(true);
    if let Some(level) = level {
        let _ = logging::set_log_level(level)?;
    }
    set_file_logging(to_file)
}

/// Change what is kept, while running. Returns the filter as applied.
///
/// # Errors
///
/// When `filter` is not one, or logging was never started.
pub fn set_level(filter: &str) -> Result<String, String> {
    logging::set_log_level(filter)
}

/// Write to the file of the day, or stop.
///
/// # Errors
///
/// When the file cannot be opened, or logging was never started.
pub fn set_file_logging(enabled: bool) -> Result<(), String> {
    logging::set_file_logging(enabled)
}

/// Write to the terminal in a release build too, or stop. A debug build
/// always does.
pub fn set_terminal_logging(enabled: bool) {
    logging::set_terminal_logging(enabled);
}

/// Compress files older than a day when file logging is turned on, or
/// leave them as they are.
pub fn set_auto_zip(enabled: bool) {
    logging::set_auto_zip(enabled);
}

/// Where the files are, made if it is not there yet.
///
/// # Errors
///
/// When logging was never started, or the directory cannot be made.
pub fn directory() -> Result<PathBuf, String> {
    logging::ensure_log_dir()
}

/// Write every kept file, oldest first, into the one compressed file `to`.
///
/// # Errors
///
/// When there is nothing to read or `to` cannot be written.
pub fn export(to: &Path) -> Result<(), String> {
    logging::export_logs(to)
}
