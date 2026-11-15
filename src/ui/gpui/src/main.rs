//! Fancy Mumble, drawn natively: the desktop program. The view itself is the
//! library (`lib.rs`), which the Android package runs too.

// A release build opens no console window of its own on Windows; started
// from a terminal it writes there still (`console`).
#![cfg_attr(
    all(windows, not(debug_assertions), not(test)),
    windows_subsystem = "windows"
)]

fn main() {
    let launch = fancy_gpui::Launch::begin();
    gpui_platform::application()
        .with_assets(fancy_gpui::Launch::assets())
        .run(move |cx| launch.run(cx));
}