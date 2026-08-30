//! Diagnostic probe for the camera capture path.
//!
//! Enumerates cameras across all backends (Media Foundation via nokhwa +
//! DirectShow), then captures one real thumbnail from each device - the exact
//! code path the picker's thumbnail loop and the broadcast's fail-fast probe
//! run in the app. Camera bugs are usually machine-specific (driver zoo,
//! registered legacy DirectShow codecs), so run this ON the affected machine,
//! in release to match the app's panic=abort behaviour:
//!
//! ```text
//! cargo run --release -p fancy-screenshare --example camera_probe
//! ```

// This example drives only fancy-screenshare's public API, so acknowledge
// every crate dependency it inherits but doesn't touch (the crate's
// convention for `unused_crate_dependencies`; see e.g. sine_mic.rs).
use base64 as _;
use bytes as _;
use fast_image_resize as _;
use image as _;
use nokhwa as _;
use openh264 as _;
use openh264_sys2 as _;
use rand as _;
use serde as _;
use serde_json as _;
use tokio as _;
use tracing as _;
use tracing_subscriber as _;
use webrtc as _;
use xcap as _;
// Windows-only deps: only acknowledge them there.
#[cfg(windows)]
use windows as _;
#[cfg(windows)]
use windows_core as _;
// Linux GPU-pipeline deps, present only with the default `gpu` feature.
#[cfg(all(target_os = "linux", feature = "gpu"))]
use {ashpd as _, cros_codecs as _, libloading as _, pipewire as _};

use fancy_screenshare::{sources, SourceKind};

fn main() -> Result<(), String> {
    let list = sources::list_sources()?;
    let cams: Vec<_> = list
        .into_iter()
        .filter(|s| s.kind == SourceKind::Device)
        .collect();
    println!(
        "devices: {:?}",
        cams.iter().map(|c| (c.id, &c.title)).collect::<Vec<_>>()
    );

    for cam in &cams {
        println!("--- thumbnail id={} ({}) ...", cam.id, cam.title);
        match sources::capture_thumbnail(SourceKind::Device, cam.id, 320) {
            Ok(url) => println!("OK: data url {} bytes", url.len()),
            Err(e) => println!("ERR: {e}"),
        }

        // Sustained flow: repeated thumbnails must KEEP working (each waits for
        // genuinely new samples). A device that freezes after its first frame
        // - e.g. a clocked graph whose renderer blocks on virtual-camera
        // timestamps - fails here with "no new frame".
        println!("--- sustained flow id={} (3 captures) ...", cam.id);
        let start = std::time::Instant::now();
        for round in 1..=3 {
            match sources::capture_thumbnail(SourceKind::Device, cam.id, 64) {
                Ok(_) => println!("round {round}: ok ({} ms)", start.elapsed().as_millis()),
                Err(e) => println!("round {round}: ERR: {e}"),
            }
        }
    }
    println!("probe done");
    Ok(())
}
