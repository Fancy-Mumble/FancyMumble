//! The player on Windows: a `WebView2` web view, through wry, on a thread of
//! its own (see `win32` for why), told by the client's thread where to be.

use std::borrow::Cow;
use std::sync::mpsc;

use gpui::Window;
use wry::dpi::{PhysicalPosition, PhysicalSize};
use wry::raw_window_handle::{HasWindowHandle, RawWindowHandle};
use wry::{
    MemoryUsageLevel, WebContext, WebView, WebViewBuilder, WebViewBuilderExtWindows as _,
    WebViewExtWindows as _,
};

use super::page::ORIGIN;
use super::place::Rect;
use super::win32::{self, Parent};
use super::{Page, Placement, Said, Screen, Screens};

/// The scheme the framing page is served by. The web view serves a scheme
/// `name` of its own at `https://name.…`, and the page's address is
/// [`ORIGIN`]: this is its first label.
const SCHEME: &str = "com";

/// Web views, one for each video played.
#[derive(Debug)]
pub(super) struct WebViews;

impl Screens for WebViews {
    fn plays_in_place(&self) -> bool {
        true
    }

    fn open(
        &self,
        page: &Page,
        window: &Window,
        said: async_channel::Sender<Said>,
    ) -> Result<Box<dyn Screen>, String> {
        let parent = match HasWindowHandle::window_handle(window).map(|handle| handle.as_raw()) {
            Ok(RawWindowHandle::Win32(handle)) => Parent(handle.hwnd),
            _ => return Err("not a Windows window".to_owned()),
        };
        let (orders, taken) = mpsc::channel();
        let (named, name) = mpsc::sync_channel(1);
        let page = page.clone();
        // Not joined: the thread ends once its orders do.
        let _player = std::thread::Builder::new()
            .name("player".to_owned())
            .spawn(move || {
                let _ = named.send(win32::this_thread());
                play(&page, parent, &said, &taken);
            })
            .map_err(|error| error.to_string())?;
        let thread = name.recv().map_err(|error| error.to_string())?;
        Ok(Box::new(Remote {
            orders: Some(orders),
            thread,
        }))
    }
}

/// What the client's thread tells the player's.
#[derive(Debug, Clone, Copy)]
enum Order {
    Start,
    PlayOn,
    Pause,
    Place(Placement),
    Keys,
    Rest(bool),
}

/// The player, from the client's thread: orders go to its own.
struct Remote {
    /// Taken when it is dropped, which is what ends the player's thread.
    orders: Option<mpsc::Sender<Order>>,
    thread: u32,
}

impl Remote {
    fn tell(&self, order: Order) {
        if self
            .orders
            .as_ref()
            .is_some_and(|orders| orders.send(order).is_ok())
        {
            win32::wake(self.thread);
        }
    }
}

impl Screen for Remote {
    fn start(&mut self) {
        self.tell(Order::Start);
    }

    fn play_on(&mut self) {
        self.tell(Order::PlayOn);
    }

    fn pause(&mut self) {
        self.tell(Order::Pause);
    }

    fn place(&mut self, placement: Placement) {
        self.tell(Order::Place(placement));
    }

    fn release_keys(&mut self) {
        self.tell(Order::Keys);
    }

    fn rest(&mut self, resting: bool) {
        self.tell(Order::Rest(resting));
    }
}

impl Drop for Remote {
    /// The orders end, and with them the player's thread and its web view.
    fn drop(&mut self) {
        drop(self.orders.take());
        win32::wake(self.thread);
    }
}

/// The player's thread: make the web view, then follow orders until there
/// are no more.
fn play(
    page: &Page,
    parent: Parent,
    said: &async_channel::Sender<Said>,
    taken: &mpsc::Receiver<Order>,
) {
    let mut screen = match WebScreen::open(page, parent, said.clone()) {
        Ok(screen) => screen,
        Err(error) => {
            tracing::warn!(%error, "no web view to play in");
            let _ = said.try_send(Said::Failed);
            return;
        }
    };
    // Minimised, the window's video is paused (`ui::playing`): told by the
    // system on this thread's loop, for as long as the player lives.
    let _minimising = win32::Minimising::watch(parent, said.clone());
    let follow = |screen: &mut WebScreen| loop {
        match taken.try_recv() {
            Ok(order) => screen.follow(order),
            Err(mpsc::TryRecvError::Empty) => return true,
            Err(mpsc::TryRecvError::Disconnected) => return false,
        }
    };
    if follow(&mut screen) {
        win32::run(|msg| msg.is_some() || follow(&mut screen));
    }
}

/// A web view, and where it was put.
struct WebScreen {
    view: WebView,
    /// Kept for as long as the view: it holds where the view keeps its
    /// files. Dropped after it.
    _context: WebContext,
    frame: Option<Rect>,
    shows: Option<Rect>,
    visible: bool,
}

impl WebScreen {
    fn open(
        page: &Page,
        parent: Parent,
        said: async_channel::Sender<Said>,
    ) -> Result<Self, String> {
        // The client's own, made now: nothing of the web view's exists
        // before a video is played.
        let folder = crate::paths::data_dir().join("cache").join("web-view");
        let mut context = WebContext::new(Some(folder));
        let framing = page.framing().into_bytes();
        // What the browser is started with, and why: `settings`.
        let arguments = super::settings::arguments();
        // `FANCY_GPUI_PLAYER_TIMES` says how long it took to be made and to
        // play, for measuring a new player against keeping one.
        let times = std::env::var_os("FANCY_GPUI_PLAYER_TIMES").map(|_| std::time::Instant::now());
        let told_playing = std::cell::Cell::new(false);
        let view = WebViewBuilder::new_with_web_context(&mut context)
            .with_visible(false)
            .with_focused(false)
            .with_additional_browser_args(arguments)
            .with_https_scheme(true)
            .with_custom_protocol(SCHEME.to_owned(), move |_, request| {
                // Only the page: the scheme's prefix would take any
                // `https://com.…` address the page asked for.
                let page = request.uri().path() == "/";
                wry::http::Response::builder()
                    .status(if page { 200 } else { 404 })
                    .header(wry::http::header::CONTENT_TYPE, "text/html; charset=utf-8")
                    .body(Cow::Owned(if page { framing.clone() } else { Vec::new() }))
                    .unwrap_or_default()
            })
            .with_ipc_handler(move |request| {
                if let Ok(state) = request.body().parse() {
                    if let Some(made) = times.filter(|_| state == Said::Playing && !told_playing.get()) {
                        told_playing.set(true);
                        eprintln!("player: playing {} ms after it was asked for", made.elapsed().as_millis());
                    }
                    let _ = said.try_send(state);
                }
            })
            // Nothing is loaded until it can be seen: see `Screen::start`.
            .build_as_child(&parent)
            .map_err(|error| error.to_string())?;
        if let Some(made) = times {
            eprintln!("player: made in {} ms", made.elapsed().as_millis());
        }
        Ok(Self {
            view,
            _context: context,
            frame: None,
            shows: None,
            visible: false,
        })
    }

    fn follow(&mut self, order: Order) {
        match order {
            Order::Start => {
                let _ = self.view.load_url(&format!("{ORIGIN}/"));
            }
            Order::PlayOn => {
                let _ = self.view.evaluate_script("play()");
            }
            Order::Pause => {
                let _ = self.view.evaluate_script("call('pauseVideo',[])");
            }
            Order::Place(placement) => self.place(placement),
            Order::Keys => {
                let _ = self.view.focus_parent();
            }
            // `FANCY_GPUI_PLAYER_NO_REST` keeps it working normally, for
            // measuring what resting saves.
            Order::Rest(_) if std::env::var_os("FANCY_GPUI_PLAYER_NO_REST").is_some() => {}
            Order::Rest(resting) => {
                let level = if resting {
                    MemoryUsageLevel::Low
                } else {
                    MemoryUsageLevel::Normal
                };
                let _ = self.view.set_memory_usage_level(level);
            }
        }
    }

    fn place(&mut self, placement: Placement) {
        let Placement::Shown { frame, shows } = placement else {
            self.show(false);
            return;
        };
        if self.frame != Some(frame) {
            self.frame = Some(frame);
            let _ = self.view.set_bounds(wry::Rect {
                position: PhysicalPosition::new(frame.x, frame.y).into(),
                size: PhysicalSize::new(frame.width, frame.height).into(),
            });
        }
        if self.shows != shows {
            self.shows = shows;
            win32::cut(&self.view, shows);
        }
        self.show(true);
    }

    fn show(&mut self, visible: bool) {
        if std::mem::replace(&mut self.visible, visible) != visible {
            let _ = self.view.set_visible(visible);
        }
    }
}
