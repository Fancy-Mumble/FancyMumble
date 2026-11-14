//! Gives the Windows executable its icon.
//!
//! GPUI takes the icon of every window from icon resource 1 of the
//! executable, which is also what Explorer and the taskbar show. Without
//! one, Windows draws its generic application icon. The icon is the Tauri
//! application's, so the two views are told apart by nothing but how they
//! draw.

use std::error::Error;

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-changed=build.rs");
    #[cfg(windows)]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        embed_icon()?;
        load_when_used();
    }
    Ok(())
}

/// Has the system load Media Foundation, which only the camera and screen
/// sharing call, at their first call instead of before `main` on every
/// start. `tests/imports.rs` keeps it so.
#[cfg(windows)]
fn load_when_used() {
    const LOADED_WHEN_USED: &[&str] = &["mf.dll", "mfplat.dll", "mfreadwrite.dll"];
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("msvc") {
        return;
    }
    println!("cargo:rustc-link-lib=delayimp");
    for library in LOADED_WHEN_USED {
        println!("cargo:rustc-link-arg=/DELAYLOAD:{library}");
    }
}

/// Writes a resource script naming the icon and links what it compiles to.
///
/// The script is written out here, not kept as a file, so that it can name
/// the icon by its full path: the resource compiler reads a relative one
/// against wherever it happens to be run from.
#[cfg(windows)]
fn embed_icon() -> Result<(), Box<dyn Error>> {
    use std::path::PathBuf;

    let icon = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?)
        .join("../../../crates/mumble-tauri/icons/icon.ico");
    println!("cargo:rerun-if-changed={}", icon.display());
    // A backslash starts an escape in a resource script's string.
    let icon = icon.display().to_string().replace('\\', "/");
    let script = PathBuf::from(std::env::var("OUT_DIR")?).join("fancy-gpui-icon.rc");
    std::fs::write(&script, format!("1 ICON \"{icon}\"\n"))?;
    embed_resource::compile(&script, embed_resource::NONE).manifest_optional()?;
    Ok(())
}
