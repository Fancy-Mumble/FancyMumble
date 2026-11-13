//! Fancy Mumble, drawn natively.
//!
//! One of the views over the engine, and the one meant to cost the least to
//! keep open: no web view, no script runtime, nothing drawn while nothing
//! changes. It looks like the web UI's default design and paints with the
//! same themes.
//!
//! The engine is not linked in yet. The view talks to an [`engine::Engine`],
//! and until the engine is a crate of its own that is [`demo::DemoEngine`].

mod assets;
mod demo;
mod engine;
mod theme;
mod ui;

use std::sync::Arc;

use gpui::{
    App, AppContext, Application, Bounds, KeyBinding, TitlebarOptions, WindowBounds,
    WindowDecorations, WindowOptions, actions, px, size,
};

use theme::{ActiveTheme, Catalog, DEFAULT_THEME, Mode};
use ui::Shell;

actions!(
    fancy,
    [
        /// Move to the next theme of the catalogue.
        NextTheme,
        /// Flip between the light and dark drawing of the theme.
        ToggleMode,
        /// Close the application.
        Quit
    ]
);

/// The window's size on first launch, as the web UI opens.
const WINDOW: (f32, f32) = (1410.0, 758.0);

fn main() {
    Application::new()
        .with_assets(assets::Assets)
        .run(|cx: &mut App| {
            install_theme(cx);
            cx.bind_keys([
                KeyBinding::new("ctrl-shift-t", NextTheme, None),
                KeyBinding::new("ctrl-shift-l", ToggleMode, None),
                KeyBinding::new("ctrl-q", Quit, None),
            ]);
            cx.on_action(|_: &Quit, cx| cx.quit());

            // A launch starts off the server, as a real one does;
            // `FANCY_GPUI_DEMO=connected` starts on it.
            let demo = if std::env::var("FANCY_GPUI_DEMO").as_deref() == Ok("connected") {
                demo::DemoEngine::new()
            } else {
                demo::DemoEngine::disconnected()
            };
            // `FANCY_GPUI_DEMO_TALKING=<session>` has that user talking, so the
            // talking ring can be looked at without a microphone.
            if let Some(session) = std::env::var("FANCY_GPUI_DEMO_TALKING")
                .ok()
                .and_then(|session| session.parse().ok())
            {
                demo.talk(session, true);
            }
            let engine: Arc<dyn engine::Engine> = Arc::new(demo);
            let bounds = Bounds::centered(None, size(px(WINDOW.0), px(WINDOW.1)), cx);
            let options = WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions {
                    title: Some("Fancy Mumble".into()),
                    appears_transparent: true,
                    ..TitlebarOptions::default()
                }),
                // The band is the title bar; the window draws its own frame.
                window_decorations: Some(WindowDecorations::Client),
                window_min_size: Some(size(px(720.0), px(480.0))),
                app_id: Some("fancy-mumble".to_owned()),
                ..WindowOptions::default()
            };
            let opened = cx.open_window(options, |_, cx| cx.new(|cx| Shell::new(engine, cx)));
            let Ok(window) = opened else {
                eprintln!("the window could not be opened");
                cx.quit();
                return;
            };
            cx.on_action(move |_: &NextTheme, cx| {
                let _ = window.update(cx, |shell, _, cx| shell.next_theme(cx));
            });
            cx.on_action(move |_: &ToggleMode, cx| {
                let _ = window.update(cx, |shell, _, cx| shell.toggle_mode(cx));
            });
            // One window: closing it ends the application.
            cx.on_window_closed(|cx| cx.quit()).detach();
            cx.activate(true);
        });
}

/// Start in the theme the environment names, or the default.
///
/// `FANCY_GPUI_THEME` and `FANCY_GPUI_MODE` (`light`/`dark`) stand in for the
/// stored preference until the engine's settings are behind the view.
fn install_theme(cx: &mut App) {
    let wanted = std::env::var("FANCY_GPUI_THEME").unwrap_or_else(|_| DEFAULT_THEME.to_owned());
    let mode = match std::env::var("FANCY_GPUI_MODE").as_deref() {
        Ok("light") => Mode::Light,
        _ => Mode::Dark,
    };
    let fonts = cx.text_system().all_font_names();
    let catalog = Catalog::get();
    let theme = catalog
        .resolve(&wanted, mode, &fonts)
        .or_else(|| catalog.resolve(DEFAULT_THEME, mode, &fonts))
        .unwrap_or_else(theme::emergency_theme);
    cx.set_global(ActiveTheme(Arc::new(theme)));
}
