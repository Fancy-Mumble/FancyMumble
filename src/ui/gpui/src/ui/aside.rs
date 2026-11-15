//! Windows beside the main one: a share popped out now, a picture or a
//! conversation later.
//!
//! One of each name is open at a time, and none before it is asked for. It
//! shares everything with the main window that is not the main window's
//! own: the engine and the shell it is reached through, the theme and the
//! words (both are the application's, and a change to either draws every
//! window again). Closing the main window closes it. Where it was left is
//! kept under its name with the settings, as the main window's place is.
//! The keyboard walks its own controls with Tab, Escape closes it as its
//! close button does, and F11 puts it over the whole screen.
//!
//! This is the one place that asks GPUI for a second window, a window kept
//! over the others, or an overlay (`WindowKind::Floating` and
//! `WindowKind::Overlay`, and `Window::set_bounds`, which Fancy Mumble's
//! fork of GPUI adds): another GPUI underneath is a change to this file.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;
use std::time::Duration;

use gpui::{
    AnyView, AnyWindowHandle, App, AppContext, Bounds, Context, FocusHandle, Focusable,
    IntoElement, ParentElement, Pixels, Render, SharedString, Styled, Subscription,
    TitlebarOptions, WeakEntity, Window, WindowBackgroundAppearance, WindowBounds, WindowKind,
    WindowOptions, div, prelude::*, px, relative, size,
};

use super::Shell;
use super::keys::{Dismiss, FocusBack, FocusNext, ToggleFullscreen};
use super::kit::{Way, walk};
use crate::store::Placed;
use crate::theme::ActiveTheme;

/// How long a window beside has to have been left alone before where it is
/// gets written down, as for the main window.
const SETTLED: Duration = Duration::from_millis(600);

/// What closing a window beside does to the shell, other than closing it.
pub(crate) type Closed = fn(&mut Shell, &mut Context<Shell>);

/// A window beside the main one, as it is asked for.
pub(crate) struct Opening {
    /// Its name: one of a name is open at a time, and its place is kept
    /// under it.
    pub name: &'static str,
    pub title: SharedString,
    /// Its size the first time, and the least it can be made.
    pub first: (f32, f32),
    pub least: (f32, f32),
    pub kind: Kind,
    /// What the shell does when the window is closed by its own close, by
    /// Escape or by the system: whatever was in it goes back.
    pub closed: Closed,
}

/// What kind of window beside it is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Kind {
    /// Kept over every other window.
    OnTop,
    /// Laid over the screen at t with nothing of its own: the pointer
    /// passes through it, it never takes the keyboard, it is left out of
    /// screen captures, and where it lies is its content's to say, not
    /// remembered.
    Overlay { at: Bounds<Pixels> },
}

/// The windows open beside the main one, and where each was left.
#[derive(Default)]
pub(crate) struct Asides {
    /// Shared with the watch on the main window, which closes them when
    /// that closes. A name without a window is being opened.
    open: Rc<RefCell<BTreeMap<&'static str, Option<AnyWindowHandle>>>>,
    places: BTreeMap<String, Placed>,
    /// Watching for the main window to close: from the first window beside
    /// it on.
    main_closed: Option<Subscription>,
}

impl Asides {
    /// None open, and the places remembered from before.
    pub(crate) fn remembering(places: BTreeMap<String, Placed>) -> Self {
        Self {
            places,
            ..Self::default()
        }
    }

    /// Where each was left, to be kept with the settings.
    pub(crate) fn places(&self) -> &BTreeMap<String, Placed> {
        &self.places
    }

    /// The window of `name`, while it is open.
    pub(crate) fn window(&self, name: &str) -> Option<AnyWindowHandle> {
        self.open.borrow().get(name).copied().flatten()
    }

    /// Whether `name` is open, or being opened.
    fn has(&self, name: &str) -> bool {
        self.open.borrow().contains_key(name)
    }

    /// Forget that `name` is open: its window is closing or closed.
    fn forget(&self, name: &str) -> Option<AnyWindowHandle> {
        self.open.borrow_mut().remove(name).flatten()
    }

    /// Close them all when the window of the shell is gone. Watched for
    /// from the first one opened, never before.
    fn watch_main(&mut self, cx: &mut App) {
        if self.main_closed.is_some() {
            return;
        }
        let open = Rc::clone(&self.open);
        self.main_closed = Some(cx.on_window_closed(move |cx, _| {
            let main_open = cx
                .windows()
                .iter()
                .any(|window| window.downcast::<Shell>().is_some());
            if main_open {
                return;
            }
            let closing = std::mem::take(&mut *open.borrow_mut());
            for window in closing.into_values().flatten() {
                let _ = window.update(cx, |_, window, _| window.remove_window());
            }
        }));
    }
}

impl Shell {
    /// Open a window beside this one as `opening` says, showing what
    /// `content` makes; one of that name already open is brought forward
    /// instead. It is opened once the shell is done with what it is doing:
    /// a window is drawn as it opens, and its content reads the shell. One
    /// that cannot be opened is closed at once, as `opening.closed` says.
    pub(crate) fn open_aside(
        &mut self,
        opening: &Opening,
        content: impl FnOnce(WeakEntity<Shell>, &mut Window, &mut App) -> AnyView + 'static,
        cx: &mut Context<Self>,
    ) {
        if let Some(window) = self.chrome.asides.window(opening.name) {
            cx.defer(move |cx| {
                let _ = window.update(cx, |_, window, _| window.activate_window());
            });
            return;
        }
        if self.chrome.asides.has(opening.name) {
            return;
        }
        let placed = self.chrome.asides.places.get(opening.name).copied();
        let options = options(opening, placed, cx);
        let shell = cx.weak_entity();
        let made = Made {
            name: opening.name,
            closed: opening.closed,
            overlay: matches!(opening.kind, Kind::Overlay { .. }),
        };
        let _ = self.chrome.asides.open.borrow_mut().insert(made.name, None);
        cx.defer(move |cx| {
            let for_window = shell.clone();
            let opened = cx.open_window(options, move |window, cx| {
                let content = content(for_window.clone(), window, cx);
                cx.new(|cx| Aside::new(made, for_window, content, window, cx))
            });
            let opened = opened
                .map(AnyWindowHandle::from)
                .map_err(|error| error.to_string());
            let _ = shell.update(cx, |shell, cx| shell.aside_opened(made, opened, cx));
        });
    }

    /// The window `made` opened, or could not.
    fn aside_opened(
        &mut self,
        made: Made,
        opened: Result<AnyWindowHandle, String>,
        cx: &mut Context<Self>,
    ) {
        let asides = &mut self.chrome.asides;
        let still_wanted = asides.has(made.name);
        match opened {
            Ok(window) if still_wanted => {
                let _ = asides.open.borrow_mut().insert(made.name, Some(window));
                asides.watch_main(cx);
            }
            // Closed while it was being opened.
            Ok(window) => cx.defer(move |cx| {
                let _ = window.update(cx, |_, window, _| window.remove_window());
            }),
            Err(error) => {
                tracing::warn!(name = made.name, %error, "a window beside could not be opened");
                let _ = asides.forget(made.name);
                (made.closed)(self, cx);
            }
        }
    }

    /// Close the window `name`, if it is open; what was in it is the
    /// caller's to take back.
    pub(crate) fn close_aside(&mut self, name: &'static str, cx: &mut Context<Self>) {
        // Being opened: it is closed as soon as it is.
        let Some(window) = self.chrome.asides.forget(name) else {
            return;
        };
        // Put off: the close may come from inside that window.
        cx.defer(move |cx| {
            let _ = window.update(cx, |_, window, _| window.remove_window());
        });
    }

    /// Whether the window `name` is open.
    pub(crate) fn aside_open(&self, name: &str) -> bool {
        self.chrome.asides.has(name)
    }

    /// The window `name` was moved or resized: note where it is, and write
    /// it down once it has been left alone for a moment.
    pub(super) fn aside_moved(
        &mut self,
        name: &'static str,
        placed: Placed,
        cx: &mut Context<Self>,
    ) {
        let places = &mut self.chrome.asides.places;
        if places.get(name) == Some(&placed) {
            return;
        }
        let _ = places.insert(name.to_owned(), placed);
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(SETTLED).await;
            let _ = shell.update(cx, |shell, cx| {
                if shell.chrome.asides.places.get(name) == Some(&placed) {
                    shell.remember_settings(cx);
                }
            });
        })
        .detach();
    }
}

/// How the window for opening is made: where it was left, else where and
/// how large it first opens.
fn options(opening: &Opening, placed: Option<Placed>, cx: &App) -> WindowOptions {
    let normal = WindowOptions {
        window_bounds: Some(super::placed::opening_sized(placed, opening.first, cx)),
        titlebar: Some(TitlebarOptions {
            title: Some(opening.title.clone()),
            ..TitlebarOptions::default()
        }),
        kind: WindowKind::Normal,
        window_min_size: Some(size(px(opening.least.0), px(opening.least.1))),
        app_id: Some("fancy-mumble".to_owned()),
        ..WindowOptions::default()
    };
    match opening.kind {
        Kind::OnTop => WindowOptions {
            kind: WindowKind::Floating,
            ..normal
        },
        Kind::Overlay { at } => WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(at)),
            titlebar: None,
            focus: false,
            kind: WindowKind::Overlay,
            is_movable: false,
            is_resizable: false,
            is_minimizable: false,
            window_background: WindowBackgroundAppearance::Transparent,
            window_min_size: None,
            ..normal
        },
    }
}

/// Put a window beside, an overlay, at `bounds` on the screen. The one
/// place a window is moved: what GPUI gives for that is used here alone.
pub(crate) fn place(window: &mut Window, bounds: Bounds<Pixels>) {
    window.set_bounds(bounds);
}

/// What a window beside is, to its root.
#[derive(Clone, Copy)]
struct Made {
    name: &'static str,
    closed: Closed,
    overlay: bool,
}

/// The root of a window beside: its content, on the theme's ground, with
/// the keys every window has. An overlay's is its content alone.
struct Aside {
    made: Made,
    shell: WeakEntity<Shell>,
    content: AnyView,
    focus: FocusHandle,
    _moved: Option<Subscription>,
}

impl Aside {
    fn new(
        made: Made,
        shell: WeakEntity<Shell>,
        content: AnyView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let Made {
            name,
            closed,
            overlay,
        } = made;
        let moved = (!overlay).then(|| {
            cx.observe_window_bounds(window, |aside: &mut Self, window, cx| {
                let (name, placed) = (aside.made.name, Placed::of(window));
                let _ = aside
                    .shell
                    .update(cx, |shell, cx| shell.aside_moved(name, placed, cx));
            })
        });
        // Closed by the system: the shell takes back what was in it.
        let by_system = shell.clone();
        window.on_window_should_close(cx, move |_, cx| {
            let _ = by_system.update(cx, |shell, cx| {
                let _ = shell.chrome.asides.forget(name);
                closed(shell, cx);
            });
            true
        });
        let focus = cx.focus_handle();
        if !overlay {
            window.focus(&focus, cx);
        }
        Self {
            made,
            shell,
            content,
            focus,
            _moved: moved,
        }
    }

    /// Closed from inside: Escape.
    fn close(&mut self, cx: &mut Context<Self>) {
        let _ = self.shell.update(cx, self.made.closed);
    }
}

impl Focusable for Aside {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for Aside {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.made.overlay {
            return div().id("aside").size_full().child(self.content.clone());
        }
        let theme = ActiveTheme::get(cx);
        div()
            .id("aside")
            .debug_selector(|| "aside".to_owned())
            .track_focus(&self.focus)
            .size_full()
            .relative()
            .bg(theme.c.bg0)
            .text_color(theme.c.text)
            .font_family(theme.skin.font.clone())
            .font_weight(theme.skin.weight)
            .letter_spacing(theme.skin.track)
            .text_size(px(14.0))
            .line_height(relative(1.4))
            // Taken here before the main window's own keys hear them.
            .on_action(|_: &FocusNext, window, cx| walk(Way::Next, window, cx))
            .on_action(|_: &FocusBack, window, cx| walk(Way::Back, window, cx))
            .on_action(cx.listener(|aside, _: &Dismiss, _, cx| aside.close(cx)))
            .on_action(|_: &ToggleFullscreen, window, _| window.toggle_fullscreen())
            .child(self.content.clone())
    }
}
