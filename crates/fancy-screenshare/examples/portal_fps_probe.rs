//! Capture-freeze investigation instrument: run the app's real portal +
//! PipeWire capture path and print per-second fresh-frame counts.
//!
//! ```sh
//! cargo run -p fancy-screenshare --example portal_fps_probe \
//!     --features portal-probe
//! ```

fn main() {
    // Show the crate's negotiation diagnostics (format/modifier picked,
    // stream state changes) alongside the frame counts.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    if let Err(e) = fancy_screenshare::portal_probe_main() {
        eprintln!("probe failed: {e}");
        std::process::exit(1);
    }
}
