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
mod paths;
mod real;
mod store;
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
            cx.bind_keys([
                KeyBinding::new("ctrl-shift-t", NextTheme, None),
                KeyBinding::new("ctrl-shift-l", ToggleMode, None),
                KeyBinding::new("ctrl-q", Quit, None),
            ]);
            cx.on_action(|_: &Quit, cx| cx.quit());

            let (engine, store) = start_engine();
            install_theme(store.as_ref(), cx);
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
            let opened =
                cx.open_window(options, |_, cx| cx.new(|cx| Shell::new(engine, store, cx)));
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

/// The engine the view runs on, and where the view keeps its own settings.
///
/// The real engine unless `FANCY_GPUI_ENGINE=demo` asks for the server that
/// exists only in memory (`FANCY_GPUI_DEMO=connected` starts on it rather
/// than on the connect screen; `FANCY_GPUI_DEMO_TALKING=<session>` has that
/// user talking). The demo remembers nothing.
fn start_engine() -> (Arc<dyn engine::Engine>, Option<store::Store>) {
    let env = |name: &str| std::env::var(name).ok();
    if env("FANCY_GPUI_ENGINE").as_deref() == Some("demo") {
        let demo = if env("FANCY_GPUI_DEMO").as_deref() == Some("connected") {
            demo::DemoEngine::new()
        } else {
            demo::DemoEngine::disconnected()
        };
        if let Some(session) = env("FANCY_GPUI_DEMO_TALKING").and_then(|id| id.parse().ok()) {
            demo.talk(session, true);
        }
        return (Arc::new(demo), None);
    }
    let dir = paths::data_dir();
    match real::RealEngine::start(&dir) {
        Ok(engine) => {
            // `FANCY_GPUI_CONNECT=<saved identity id>` connects at once, for
            // driving the view where nothing can click.
            if let Some(id) = env("FANCY_GPUI_CONNECT") {
                engine::Engine::connect(&engine, &id, env("FANCY_GPUI_PASSWORD"));
            }
            (Arc::new(engine), Some(store::Store::new(dir)))
        }
        Err(error) => {
            eprintln!("the engine could not start ({error}); showing the demo instead");
            (Arc::new(demo::DemoEngine::disconnected()), None)
        }
    }
}

/// Start in the theme the environment names, else the one remembered, else
/// the default.
///
/// `FANCY_GPUI_THEME` and `FANCY_GPUI_MODE` (`light`/`dark`) override what
/// is stored, for looking at a theme without choosing it.
fn install_theme(store: Option<&store::Store>, cx: &mut App) {
    let stored = store.map(store::Store::settings).unwrap_or_default();
    let wanted = std::env::var("FANCY_GPUI_THEME")
        .ok()
        .or(stored.theme)
        .unwrap_or_else(|| DEFAULT_THEME.to_owned());
    let mode = match std::env::var("FANCY_GPUI_MODE")
        .ok()
        .or(stored.mode)
        .as_deref()
    {
        Some("light") => Mode::Light,
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
