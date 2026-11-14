//! Fancy Mumble, drawn natively.
//!
//! One of the views over the engine, and the one meant to cost the least to
//! keep open: no web view, no script runtime, nothing drawn while nothing
//! changes. It looks like the web UI's default design and paints with the
//! same themes.
//!
//! The engine is not linked in yet. The view talks to an [`engine::Engine`],
//! and until the engine is a crate of its own that is [`demo::DemoEngine`].

// A release build opens no console window of its own on Windows; started
// from a terminal it writes there still (`console`).
#![cfg_attr(
    all(windows, not(debug_assertions), not(test)),
    windows_subsystem = "windows"
)]

mod assets;
mod away;
mod bans;
mod carry;
mod console;
mod demo;
mod embed;
mod engine;
mod formats;
mod gif;
mod hotkeys;
mod livery;
mod notify;
mod page;
mod paint;
mod panics;
mod paths;
mod picture;
mod pictures;
mod player;
mod profile;
mod profile_fields;
mod real;
mod rich;
mod rights;
mod share;
mod silence;
mod sound_check;
mod sounds;
mod startup;
mod store;
mod theme;
mod tray;
mod trim;
mod ui;
mod voice;
mod words;

use std::sync::Arc;

use gpui::{
    App, AppContext, TitlebarOptions, WindowDecorations, WindowOptions, px, size,
};

use theme::{ActiveTheme, Catalog, DEFAULT_THEME, Mode};
use ui::Shell;

fn main() {
    let mut startup = startup::Startup::begin();
    console::attach();
    panics::keep_in_log();
    gpui_platform::application()
        .with_assets(assets::Assets)
        .run(move |cx: &mut App| {
            startup.done("platform");
            ui::keys::bind(cx);

            let (engine, store) = start_engine();
            startup.done("engine");
            if let Err(error) = cx.text_system().add_fonts(assets::fonts()) {
                eprintln!("the bundled typeface could not be loaded: {error}");
            }
            startup.done("fonts");
            install_theme(store.as_ref(), cx);
            startup.done("theme");
            words::start(store.as_ref());
            let closing = Arc::clone(&engine);
            cx.on_app_quit(move |_| {
                closing.shutdown();
                async {}
            })
            .detach();
            let placed = store.as_ref().and_then(|store| store.settings().window);
            let options = WindowOptions {
                window_bounds: Some(ui::placed::opening(placed, cx)),
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
            // `FANCY_GPUI_TRAY=on|off`; else an icon with the real engine,
            // which is the one with a store.
            let in_tray = tray::wanted(
                std::env::var("FANCY_GPUI_TRAY").ok().as_deref(),
                store.is_some(),
            );
            let opened = cx.open_window(options, |window, cx| {
                cx.new(|cx| Shell::new(engine, store, window, cx))
            });
            let Ok(window) = opened else {
                eprintln!("the window could not be opened");
                cx.quit();
                return;
            };
            startup.done("window");
            let _ = window.update(cx, |_, window, _| startup.report_after_first_frame(window));
            ui::keys::act_on(window, cx);
            if in_tray {
                let _ = window.update(cx, |shell, window, cx| shell.put_in_tray(window, cx));
            }
            if let Ok(what) = std::env::var("FANCY_GPUI_OPEN") {
                let _ = window.update(cx, |shell, window, cx| {
                    shell.open_for_inspection(&what, window, cx);
                });
            }
            // `FANCY_GPUI_WALL=<picture file>` puts that behind the conversation
            // for this run, for looking at one where nothing can choose it.
            let wall = std::env::var_os("FANCY_GPUI_WALL")
                .and_then(|path| std::fs::read(path).ok())
                .and_then(|file| picture::wallpaper(&file).ok());
            if let Some(wall) = wall {
                let _ = window.update(cx, |shell, _, cx| shell.show_wall(wall, cx));
            }
            // `FANCY_GPUI_STAGE=<folder>` has the files in that folder wait
            // above the composer, for looking at them where nothing can
            // choose them.
            if let Some(folder) = std::env::var_os("FANCY_GPUI_STAGE") {
                let files = std::fs::read_dir(folder)
                    .into_iter()
                    .flatten()
                    .flatten()
                    .map(|entry| entry.path())
                    .collect();
                let _ = window.update(cx, |shell, _, cx| shell.stage_for_inspection(files, cx));
            }
            say_what_is_held(window, cx);
            // Closing the main window ends the application; a window beside
            // it (a share popped out) only closes.
            cx.on_window_closed(|cx, _| {
                if !cx.windows().iter().any(|window| window.downcast::<Shell>().is_some()) {
                    cx.quit();
                }
            })
            .detach();
            cx.activate(true);
        });
}

/// With `FANCY_GPUI_HOLDS=<seconds>`, write what the conversation holds
/// into the log that often: for looking into memory.
fn say_what_is_held(window: gpui::WindowHandle<Shell>, cx: &mut App) {
    let every = std::env::var("FANCY_GPUI_HOLDS")
        .ok()
        .and_then(|secs| secs.parse().ok());
    let Some(every) = every else {
        return;
    };
    let pause = std::time::Duration::from_secs(every);
    cx.spawn(async move |cx| {
        let mut shown = true;
        while shown {
            cx.background_executor().timer(pause).await;
            shown = window
                .update(cx, |shell, _, cx| {
                    tracing::info!(holds = %shell.holds(cx), "memory");
                })
                .is_ok();
        }
    })
    .detach();
}

/// The engine the view runs on, and where the view keeps its own settings.
///
/// The real engine unless `FANCY_GPUI_ENGINE=demo` asks for the server that
/// exists only in memory (`FANCY_GPUI_DEMO=connected` starts on it rather
/// than on the connect screen, `FANCY_GPUI_DEMO=plain` on the same server
/// with nothing of Fancy Mumble's on it; `FANCY_GPUI_DEMO_TALKING=<session>` has that
/// user talking; `FANCY_GPUI_DEMO_POLL` puts a poll to the lounge;
/// `FANCY_GPUI_DEMO_SAY=<html>` has Rin say that there, for looking at how a
/// message is drawn; `FANCY_GPUI_DEMO_PICTURES=<folder>` has Rin show the
/// pictures in that folder; `FANCY_GPUI_DEMO_FACES=<folder>` gives everybody
/// a face and a banner from the pictures in it). The demo remembers nothing.
fn start_engine() -> (Arc<dyn engine::Engine>, Option<store::Store>) {
    let env = |name: &str| std::env::var(name).ok();
    if env("FANCY_GPUI_ENGINE").as_deref() == Some("demo") {
        let demo = match env("FANCY_GPUI_DEMO").as_deref() {
            Some("connected") => demo::DemoEngine::new(),
            Some("plain") => demo::DemoEngine::plain(),
            _ => demo::DemoEngine::disconnected(),
        };
        // The demo server takes voice messages as Starling does by default;
        // `FANCY_GPUI_DEMO_VOICE=<count>` has that many said in the lounge.
        if env("FANCY_GPUI_DEMO").as_deref() != Some("plain") {
            demo.voice().allow(Some(voice::Support {
                available: true,
                max_seconds: 120,
                max_bytes: 2 << 20,
            }));
        }
        if let Some(count) = env("FANCY_GPUI_DEMO_VOICE").and_then(|count| count.parse().ok()) {
            demo.voice_messages(count);
        }
        // With `FANCY_GPUI_DEMO_GIFS`: Rin says this many GIFs from it.
        if let Some(count) = env("FANCY_GPUI_DEMO_GIFS_SAID").and_then(|count| count.parse().ok()) {
            demo.say_gifs(count);
        }
        if let Some(session) = env("FANCY_GPUI_DEMO_TALKING").and_then(|id| id.parse().ok()) {
            demo.talk(session, true);
        }
        if let Some(html) = env("FANCY_GPUI_DEMO_SAY") {
            demo.say_as(3, "Rin", engine::Conversation::Channel(1), &html);
        }
        if let Some(folder) = env("FANCY_GPUI_DEMO_PICTURES") {
            demo.show_pictures(std::path::Path::new(&folder));
        }
        if let Some(folder) = env("FANCY_GPUI_DEMO_FACES") {
            demo.give_faces(std::path::Path::new(&folder));
        }
        // `FANCY_GPUI_DEMO_MEMBERS=<count>` registers that many made-up
        // members who are not on, every second one with a picture.
        if let Some(count) = env("FANCY_GPUI_DEMO_MEMBERS").and_then(|count| count.parse().ok()) {
            demo.fill_directory(count, 2);
        }
        // Something to look at: a poll, answered.
        if env("FANCY_GPUI_DEMO_POLL").is_some() {
            use engine::{Action, Engine as _};
            demo.act(Action::CreatePoll {
                channel: 1,
                question: "Where to on Saturday?".to_owned(),
                options: ["The lake", "The hills", "Stay in"]
                    .map(str::to_owned)
                    .to_vec(),
                multiple: false,
            });
            demo.act(Action::Vote {
                channel: 1,
                poll: "poll-0".to_owned(),
                selected: vec![1],
            });
        }
        // `FANCY_GPUI_DEMO_SHARES=<count>`: that many in the lounge share
        // their screens (the test pattern), or `elsewhere`: the user's own
        // account shares from another device. `FANCY_GPUI_DEMO_DRAW`: Rin
        // draws on it.
        match env("FANCY_GPUI_DEMO_SHARES").as_deref() {
            Some("elsewhere") => demo.share_from_elsewhere(),
            // Rin shares a screen and a camera beside it.
            Some("camera") => demo.share_with_camera(3),
            Some(count) => demo.share_screens(count.parse().unwrap_or(1)),
            None => {}
        }
        if env("FANCY_GPUI_DEMO_DRAW").is_some() {
            demo.draw_on_share();
        }
        return (Arc::new(demo), None);
    }
    let dir = paths::data_dir();
    real::start_logs(&dir, env("FANCY_GPUI_LOG").as_deref());
    match real::RealEngine::start(&dir) {
        Ok(engine) => {
            let engine: Arc<dyn engine::Engine> = Arc::new(engine);
            let store = store::Store::new(dir);
            // The devices chosen last time, before voice can be turned on.
            let stored = store.settings();
            if let Some(voice) = stored.voice {
                engine.set_voice_settings(voice);
            }
            if !stored.denoiser_knobs.is_empty() {
                engine.tune_denoiser(stored.denoiser_knobs.clone());
            }
            if stored.input_device.is_some() || stored.output_device.is_some() {
                engine.choose_devices(engine::ChosenDevices {
                    input: stored.input_device.map(Into::into),
                    output: stored.output_device.map(Into::into),
                });
            }
            // `FANCY_GPUI_CONNECT=<saved identity id>` connects at once, and
            // `FANCY_GPUI_SAY=<text>` then says that in the channel arrived
            // in: for driving the view where nothing can click or type.
            if let Some(id) = env("FANCY_GPUI_CONNECT").or(stored.auto_connect) {
                engine.connect(&id, env("FANCY_GPUI_PASSWORD"));
                if let Some(text) = env("FANCY_GPUI_SAY") {
                    say_once_connected(Arc::clone(&engine), text);
                }
            }
            (engine, Some(store))
        }
        Err(error) => {
            eprintln!("the engine could not start ({error}); showing the demo instead");
            (Arc::new(demo::DemoEngine::disconnected()), None)
        }
    }
}

/// Send `text` to the channel `engine` arrives in, once it has arrived;
/// gives up after twenty seconds.
fn say_once_connected(engine: Arc<dyn engine::Engine>, text: String) {
    drop(std::thread::spawn(move || {
        for _ in 0..200 {
            if let Some(channel) = engine.snapshot().current_channel {
                engine.send_message(engine::Conversation::Channel(channel), text);
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }));
}

/// Start in the theme the environment names, else the one remembered, else
/// the default.
///
/// `FANCY_GPUI_THEME` and `FANCY_GPUI_MODE` (`light`/`dark`/`system`) override what
/// is stored, for looking at a theme without choosing it.
fn install_theme(store: Option<&store::Store>, cx: &mut App) {
    let stored = store.map(store::Store::settings).unwrap_or_default();
    let wanted = std::env::var("FANCY_GPUI_THEME")
        .ok()
        .or(stored.theme)
        .unwrap_or_else(|| DEFAULT_THEME.to_owned());
    let named = std::env::var("FANCY_GPUI_MODE").ok().or(stored.mode);
    let mode = Mode::named(named.as_deref(), cx.window_appearance());
    let fonts = cx.text_system().all_font_names();
    let catalog = Catalog::get();
    let theme = catalog
        .resolve(&wanted, mode, &fonts)
        .or_else(|| catalog.resolve(DEFAULT_THEME, mode, &fonts))
        .unwrap_or_else(theme::emergency_theme);
    cx.set_global(ActiveTheme(Arc::new(theme)));
}
