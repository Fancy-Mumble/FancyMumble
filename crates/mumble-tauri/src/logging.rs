//! Runtime-configurable logging for the desktop app.
//!
//! The subscriber is built once at startup with a single global level
//! filter (reloadable at runtime) feeding two independently gateable
//! sinks:
//!
//! * **terminal** (stdout) - always on in dev builds; in release builds
//!   it is off by default and enabled via the
//!   [`set_terminal_logging`] toggle (exposed in the developer settings).
//! * **file** - off by default; when enabled it appends to a
//!   date-stamped file in the OS log directory.  Enabling it can also
//!   compress (zstd) any log files older than a day, and the saved
//!   logs can be exported as a single compressed archive.
//!
//! Compression uses **zstd** rather than plain zip/deflate: it is
//! already a first-class dependency, compresses log text ~2x better
//! than deflate, and is far faster than brotli at a comparable ratio.
//! Rotated files become `<name>.log.zst`; the export is a single
//! `.log.zst` stream concatenating every log (decompressing archived
//! ones first) so a developer receives the full history in one file.
//!
//! Both sinks share the same level filter, so the existing "Log Level"
//! control governs what is captured in either place.  Each sink is
//! gated by its own cheap switch (an atomic flag for stdout, an
//! `Option<File>` behind a mutex for the file) rather than by adding or
//! removing layers - `tracing` subscribers are fixed once `init`ialised,
//! so toggling a writer is the only way to turn an output on or off at
//! runtime.

use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{reload, EnvFilter, Registry};

/// Reload handle for the global level filter (shared by both sinks).
static LEVEL_RELOAD: OnceLock<reload::Handle<EnvFilter, Registry>> = OnceLock::new();

/// The open log file, or `None` when file logging is disabled.  The fmt
/// writer locks this on every line; when it is `None` the line is
/// discarded.
static FILE_HANDLE: OnceLock<Arc<Mutex<Option<File>>>> = OnceLock::new();

/// Whether stdout logging is on in release builds.  Ignored in dev
/// builds, where terminal logging is always on.
static TERMINAL_ENABLED: AtomicBool = AtomicBool::new(false);

/// Whether to compress log files older than a day when file logging is
/// (re)enabled.
static AUTO_ZIP: AtomicBool = AtomicBool::new(false);

/// Directory where log files live (the OS app-log dir).  Set once the
/// Tauri app handle is available, which is after [`init`].
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Prefix for log file names: `fancy-mumble.<YYYY-MM-DD>.log`.
const LOG_PREFIX: &str = "fancy-mumble";

// -- Writers --------------------------------------------------------

/// `MakeWriter` for stdout that yields a discarding sink when terminal
/// logging is off (release builds with the toggle disabled).
#[derive(Clone, Copy, Default)]
struct TerminalWriter;

/// Stdout sink that drops bytes when `enabled` is false.
struct TerminalSink {
    enabled: bool,
}

impl Write for TerminalSink {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.enabled {
            io::stdout().write(buf)
        } else {
            Ok(buf.len())
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        if self.enabled {
            io::stdout().flush()
        } else {
            Ok(())
        }
    }
}

impl<'a> MakeWriter<'a> for TerminalWriter {
    type Writer = TerminalSink;
    fn make_writer(&'a self) -> Self::Writer {
        TerminalSink {
            enabled: terminal_enabled(),
        }
    }
}

/// `MakeWriter` for the log file.  Clones the shared handle per event
/// (a cheap atomic bump); the actual write locks the mutex and drops
/// the line if no file is open.
#[derive(Clone)]
struct FileWriter {
    file: Arc<Mutex<Option<File>>>,
}

/// File sink that writes to the open log file, or discards when closed.
struct FileSink {
    file: Arc<Mutex<Option<File>>>,
}

impl Write for FileSink {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if let Ok(mut guard) = self.file.lock() {
            if let Some(file) = guard.as_mut() {
                return file.write(buf);
            }
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        if let Ok(mut guard) = self.file.lock() {
            if let Some(file) = guard.as_mut() {
                return file.flush();
            }
        }
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for FileWriter {
    type Writer = FileSink;
    fn make_writer(&'a self) -> Self::Writer {
        FileSink {
            file: self.file.clone(),
        }
    }
}

// -- Init -----------------------------------------------------------

/// Whether stdout logging should currently emit.  Always on in dev so
/// `cargo run` / `cargo tauri dev` behave as before; gated by the
/// runtime toggle in release.
fn terminal_enabled() -> bool {
    cfg!(debug_assertions) || TERMINAL_ENABLED.load(Ordering::Relaxed)
}

/// Initialise the global tracing subscriber.  Must be called exactly
/// once, early in startup.  The level comes from `RUST_LOG` (falling
/// back to `info`); file logging starts disabled until
/// [`set_file_logging`] is called.
pub(crate) fn init() {
    let default_filter = std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into());
    let filter = EnvFilter::try_new(&default_filter).unwrap_or_else(|_| EnvFilter::new("info"));
    let (filter_layer, reload_handle) = reload::Layer::new(filter);

    let file_handle: Arc<Mutex<Option<File>>> = Arc::new(Mutex::new(None));
    let file_writer = FileWriter {
        file: file_handle.clone(),
    };

    let stdout_layer = tracing_subscriber::fmt::layer().with_writer(TerminalWriter);
    let file_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_writer(file_writer);

    tracing_subscriber::registry()
        .with(filter_layer)
        .with(stdout_layer)
        .with(file_layer)
        .init();

    let _ = LEVEL_RELOAD.set(reload_handle);
    let _ = FILE_HANDLE.set(file_handle);
}

/// Record the directory where log files should be written.  Called once
/// the Tauri app handle (and thus the app-log dir) is available.
pub(crate) fn set_log_dir(dir: PathBuf) {
    let _ = LOG_DIR.set(dir);
}

/// Return the log directory, creating it if it does not yet exist.
///
/// The directory is only created lazily (when file logging is enabled),
/// so "open log folder" / "export" must materialise it on demand rather
/// than failing when the user has never enabled file logging.
pub(crate) fn ensure_log_dir() -> Result<PathBuf, String> {
    let dir = LOG_DIR
        .get()
        .cloned()
        .ok_or_else(|| "log directory not configured yet".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create log dir: {e}"))?;
    Ok(dir)
}

// -- Runtime controls ----------------------------------------------

/// Change the level filter at runtime (shared by both sinks).  Returns
/// the filter string that was actually applied.
pub(crate) fn set_log_level(filter: &str) -> Result<String, String> {
    let handle = LEVEL_RELOAD
        .get()
        .ok_or_else(|| "logging not initialised".to_string())?;
    let new_filter =
        EnvFilter::try_new(filter).map_err(|e| format!("invalid filter '{filter}': {e}"))?;
    let applied = format!("{new_filter}");
    handle
        .reload(new_filter)
        .map_err(|e| format!("failed to reload filter: {e}"))?;
    tracing::info!(filter = %applied, "log level changed");
    Ok(applied)
}

/// Enable or disable stdout logging in release builds (no-op effect in
/// dev, where stdout is always on).
pub(crate) fn set_terminal_logging(enabled: bool) {
    TERMINAL_ENABLED.store(enabled, Ordering::Relaxed);
}

/// Enable or disable compressing day-old log files when file logging is
/// turned on.
pub(crate) fn set_auto_zip(enabled: bool) {
    AUTO_ZIP.store(enabled, Ordering::Relaxed);
}

/// Turn file logging on or off.
///
/// Enabling opens (creating if needed) the current day's log file in
/// append mode and, when auto-zip is on, compresses any older log files
/// first.  Disabling closes the file so subsequent lines are dropped.
pub(crate) fn set_file_logging(enabled: bool) -> Result<(), String> {
    let handle = FILE_HANDLE
        .get()
        .ok_or_else(|| "logging not initialised".to_string())?;

    if !enabled {
        if let Ok(mut guard) = handle.lock() {
            *guard = None;
        }
        return Ok(());
    }

    let dir = LOG_DIR
        .get()
        .ok_or_else(|| "log directory not configured yet".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("create log dir: {e}"))?;

    if AUTO_ZIP.load(Ordering::Relaxed) {
        if let Err(e) = compress_old_logs(dir) {
            tracing::warn!("auto-compression of old logs failed: {e}");
        }
    }

    let path = current_log_path(dir);
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open log file {}: {e}", path.display()))?;

    if let Ok(mut guard) = handle.lock() {
        *guard = Some(file);
    }
    tracing::info!("file logging enabled: {}", path.display());
    Ok(())
}

/// Path of today's log file inside `dir`.
fn current_log_path(dir: &Path) -> PathBuf {
    let date = chrono::Local::now().format("%Y-%m-%d");
    dir.join(format!("{LOG_PREFIX}.{date}.log"))
}

// -- Compression / export -------------------------------------------

/// zstd compression level used for rotation and export.  Level 9 is a
/// good middle ground for log text: ~2x deflate's ratio while still
/// compressing tens of MB per second, so even a verbose `trace` session
/// exports quickly.
const ZSTD_LEVEL: i32 = 9;

/// Compress every `*.log` file in `dir` older than one day into a
/// sibling `<name>.log.zst`, then delete the original.  The current
/// day's file is left untouched.  Returns the number of files
/// compressed.
pub(crate) fn compress_old_logs(dir: &Path) -> Result<usize, String> {
    let today = current_log_path(dir);
    let cutoff = std::time::SystemTime::now() - std::time::Duration::from_secs(24 * 60 * 60);
    let entries = std::fs::read_dir(dir).map_err(|e| format!("read log dir: {e}"))?;

    let mut compressed = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if path == today {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("log") {
            continue;
        }
        // Only compress files that have not been touched in the last day.
        let modified = entry.metadata().and_then(|m| m.modified()).ok();
        if modified.is_some_and(|m| m > cutoff) {
            continue;
        }
        match compress_file_zstd(&path) {
            Ok(()) => {
                let _ = std::fs::remove_file(&path);
                compressed += 1;
            }
            Err(e) => tracing::warn!("failed to compress {}: {e}", path.display()),
        }
    }
    Ok(compressed)
}

/// Compress a single file into `<path>.zst` (sibling, `.log.zst`).
fn compress_file_zstd(path: &Path) -> Result<(), String> {
    let zst_path = path.with_extension("log.zst");
    let source = File::open(path).map_err(|e| format!("open log: {e}"))?;
    let dest = File::create(&zst_path).map_err(|e| format!("create zst: {e}"))?;
    zstd::stream::copy_encode(source, dest, ZSTD_LEVEL)
        .map_err(|e| format!("zstd encode: {e}"))?;
    Ok(())
}

/// Export every log file in the directory into a single compressed
/// `.log.zst` stream at `dest`.  Plain `*.log` files are concatenated
/// directly; archived `*.log.zst` files are decompressed first, so the
/// result is one readable, chronologically-prefixed log history.  Each
/// file is preceded by a `===== <name> =====` banner.
pub(crate) fn export_logs(dest: &Path) -> Result<(), String> {
    let dir = ensure_log_dir()?;
    let dir = dir.as_path();

    // Flush the live file so in-progress lines make it into the export.
    if let Some(handle) = FILE_HANDLE.get() {
        if let Ok(mut guard) = handle.lock() {
            if let Some(file) = guard.as_mut() {
                let _ = file.flush();
            }
        }
    }

    // Collect sources sorted by name so days come out in order.
    let mut sources: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| format!("read log dir: {e}"))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && matches!(
                    p.file_name().and_then(|n| n.to_str()),
                    Some(name) if name.ends_with(".log") || name.ends_with(".log.zst")
                )
        })
        .collect();
    sources.sort();

    if sources.is_empty() {
        return Err("no log files to export".into());
    }

    let dest_file =
        File::create(dest).map_err(|e| format!("create export {}: {e}", dest.display()))?;
    let mut encoder = zstd::stream::write::Encoder::new(dest_file, ZSTD_LEVEL)
        .map_err(|e| format!("zstd encoder: {e}"))?;

    for path in &sources {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        let banner = format!("\n===== {name} =====\n");
        encoder
            .write_all(banner.as_bytes())
            .map_err(|e| format!("export write: {e}"))?;

        if name.ends_with(".zst") {
            let archived = File::open(path).map_err(|e| format!("open {name}: {e}"))?;
            zstd::stream::copy_decode(archived, &mut encoder)
                .map_err(|e| format!("decode {name}: {e}"))?;
        } else {
            let bytes = std::fs::read(path).map_err(|e| format!("read {name}: {e}"))?;
            encoder
                .write_all(&bytes)
                .map_err(|e| format!("export write: {e}"))?;
        }
    }

    // `finish` returns the inner file handle, which we don't need.
    let _ = encoder.finish().map_err(|e| format!("zstd finish: {e}"))?;
    Ok(())
}
