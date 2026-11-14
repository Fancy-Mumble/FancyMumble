//! The player on Windows: a `WebView2` web view drawn into a surface of the
//! window's own composition (GPUI's window composition), between what the
//! client draws under it and what floats over it.
//!
//! The web view is hosted visually (a composition controller): it has no
//! window of its own on screen, the system composes its visual with the
//! client's, and the client hands it the pointer when the pointer is over
//! it and nothing of the client's is. Menus, dialogs and toasts are drawn
//! on the composition's overlay, above it, so nothing has to hide it when
//! something is drawn over it; the wheel stays the client's, and scrolls
//! the conversation.
//!
//! It is made on the client's thread without waiting: the system answers
//! each step through the client's own message loop.

#![allow(
    unsafe_code,
    reason = "the WebView2 and window calls this module is for, each on objects it holds alive"
)]

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use gpui::{
    CompositionSurfaceId, DispatchEventResult, Modifiers, MouseButton, NavigationDirection,
    PlatformInput, Pixels, Point, Window, WindowCompositionSurface,
};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL, COREWEBVIEW2_MOUSE_EVENT_KIND,
    COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE, COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN,
    COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP, COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_DOWN,
    COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_UP, COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE,
    COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_DOWN, COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_UP,
    COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_DOWN, COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_UP,
    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_CONTROL,
    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON,
    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_MIDDLE_BUTTON,
    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_RIGHT_BUTTON,
    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_SHIFT, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_X_BUTTON1,
    COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_X_BUTTON2, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2,
    ICoreWebView2_19, ICoreWebView2CompositionController, ICoreWebView2Controller,
    ICoreWebView2Environment, ICoreWebView2Environment3, ICoreWebView2EnvironmentOptions,
};
use webview2_com::{
    AddScriptToExecuteOnDocumentCreatedCompletedHandler, CoreWebView2EnvironmentOptions,
    CreateCoreWebView2CompositionControllerCompletedHandler,
    CreateCoreWebView2EnvironmentCompletedHandler, WebMessageReceivedEventHandler,
    WebResourceRequestedEventHandler, take_pwstr,
};
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetFocus, SetFocus};
use windows::Win32::UI::Shell::SHCreateMemStream;
use windows::core::{HSTRING, IUnknown, Interface as _, PWSTR};

use super::page::ORIGIN;
use super::place::Rect;
use super::{Page, Placement, Said, Screen, Screens};

/// What the web view is started with: the network's and the sound's
/// processes run in its main one, one renderer serves the page and the
/// player it frames, and nothing is fetched that nobody asked for. The
/// graphics card keeps its own process: run in the main one, it no longer
/// decodes video, and the processor does it at twice the cost. Each was
/// measured alone (the report of the change that chose them has the
/// table). `FANCY_GPUI_PLAYER_ARGS` replaces them, for measuring.
const ARGUMENTS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,AudioServiceOutOfProcess,IsolateOrigins,site-per-process --enable-features=NetworkServiceInProcess2 --disable-site-isolation-trials --renderer-process-limit=1 --disable-extensions --disable-background-networking --disable-component-update --no-pings --autoplay-policy=no-user-gesture-required --disable-smooth-scrolling";

/// What the page is given to talk to the client with: `window.ipc`, as the
/// web client's web view gives it.
const IPC: &str = "Object.defineProperty(window,'ipc',{value:Object.freeze({postMessage:s=>window.chrome.webview.postMessage(s)})});";

/// Web views, one for each video played, in the window's composition.
#[derive(Debug, Default)]
pub(super) struct WebViews {
    /// The surfaces of players stopped, to be taken out of the composition
    /// when the window is next drawn.
    retired: Rc<RefCell<Vec<CompositionSurfaceId>>>,
}

impl Screens for WebViews {
    fn plays_in_place(&self) -> bool {
        true
    }

    fn open(
        &self,
        page: &Page,
        window: &mut Window,
        said: async_channel::Sender<Said>,
    ) -> Result<Box<dyn Screen>, String> {
        let hwnd = window_of(window)?;
        let composition = window
            .enable_window_composition()
            .map_err(|error| error.to_string())?;
        let surface = composition
            .create_native_surface()
            .map_err(|error| error.to_string())?;
        let visual = surface
            .platform_surface()
            .and_then(|platform| platform.platform_handle())
            .map_err(|error| error.to_string())?
            .downcast::<IUnknown>()
            .map_err(|_| "the surface is not a composition visual".to_owned())?;
        let shared = Rc::new(Shared {
            hwnd,
            surface,
            view: RefCell::new(None),
            wanted: Cell::new(Wanted::default()),
            scale: Cell::new(window.scale_factor()),
            overlay: composition.overlay_surface(),
            said,
        });
        shared.platform_visible(false);
        let input = Rc::downgrade(&shared);
        composition
            .on_input(shared.surface.id(), move |event| {
                input
                    .upgrade()
                    .map_or_else(pass_on, |shared| shared.input(event))
            })
            .map_err(|error| error.to_string())?;
        make(page, hwnd, *visual, Rc::downgrade(&shared)).map_err(|error| error.to_string())?;
        Ok(Box::new(Composed {
            shared,
            retired: Rc::clone(&self.retired),
        }))
    }

    fn unsettled(&self) -> bool {
        !self.retired.borrow().is_empty()
    }

    fn settle(&self, window: &mut Window) {
        let retired = std::mem::take(&mut *self.retired.borrow_mut());
        if retired.is_empty() {
            return;
        }
        if let Ok(composition) = window.enable_window_composition() {
            for surface in retired {
                if let Err(error) = composition.remove_surface(surface) {
                    tracing::debug!(%error, "a player's surface was not taken out");
                }
            }
        }
    }
}

/// The client's window, by its handle.
fn window_of(window: &Window) -> Result<HWND, String> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    match HasWindowHandle::window_handle(window).map(|handle| handle.as_raw()) {
        Ok(RawWindowHandle::Win32(handle)) => Ok(HWND(handle.hwnd.get() as _)),
        _ => Err("not a Windows window".to_owned()),
    }
}

/// What the client has asked of the player, kept until the web view is
/// there to do it, and done again whenever it changes.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Wanted {
    placement: Placement,
    started: bool,
    resting: bool,
}

/// The web view, once made.
struct View {
    composition: ICoreWebView2CompositionController,
    controller: ICoreWebView2Controller,
    webview: ICoreWebView2,
    /// Whether the page has been asked for.
    loaded: bool,
}

/// What the player's handle and the system's answers share.
struct Shared {
    hwnd: HWND,
    surface: WindowCompositionSurface,
    view: RefCell<Option<View>>,
    wanted: Cell<Wanted>,
    /// Device pixels to each of the window's, as of the last placement.
    scale: Cell<f32>,
    /// What is drawn over the web view.
    overlay: CompositionSurfaceId,
    said: async_channel::Sender<Said>,
}

impl Shared {
    /// Ask for `wanted`, and do it if the web view is there.
    fn want(&self, wanted: Wanted) {
        self.wanted.set(wanted);
        self.apply();
    }

    /// Do what is wanted. The surface is placed and shown as asked even
    /// before the web view is there.
    fn apply(&self) {
        let wanted = self.wanted.get();
        let shown = match wanted.placement {
            Placement::Hidden => None,
            Placement::Shown { frame, shows } => Some((frame, shows.unwrap_or(Rect {
                x: 0,
                y: 0,
                ..frame
            }))),
        };
        if let Some((frame, seen)) = shown
            && let Ok(platform) = self.surface.platform_surface()
        {
            let at = gpui::Bounds::new(
                gpui::point(
                    gpui::DevicePixels(frame.x + seen.x),
                    gpui::DevicePixels(frame.y + seen.y),
                ),
                gpui::size(gpui::DevicePixels(seen.width), gpui::DevicePixels(seen.height)),
            );
            let _ = platform.set_bounds(at);
        }
        self.platform_visible(shown.is_some());
        let mut view = self.view.borrow_mut();
        let Some(view) = view.as_mut() else {
            return;
        };
        // SAFETY: the controller and web view are alive while `view` is.
        unsafe {
            if let Some((frame, seen)) = shown {
                // The web view lies over the whole frame; the surface shows
                // only the part of it that is seen.
                let _ = view.controller.SetBounds(RECT {
                    left: -seen.x,
                    top: -seen.y,
                    right: frame.width - seen.x,
                    bottom: frame.height - seen.y,
                });
            }
            let _ = view.controller.SetIsVisible(shown.is_some());
            if wanted.started && !view.loaded {
                view.loaded = true;
                let _ = view.webview.Navigate(&HSTRING::from(format!("{ORIGIN}/")));
            }
            if let Ok(webview) = view.webview.cast::<ICoreWebView2_19>() {
                let level = COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL(i32::from(wanted.resting));
                let _ = webview.SetMemoryUsageTargetLevel(level);
            }
        }
    }

    fn platform_visible(&self, visible: bool) {
        if let Ok(platform) = self.surface.platform_surface() {
            let _ = platform.set_visible(visible);
        }
    }

    /// The pointer over the player, where nothing of the client's is.
    fn input(&self, event: &PlatformInput) -> DispatchEventResult {
        let Placement::Shown { frame, .. } = self.wanted.get().placement else {
            return pass_on();
        };
        let view = self.view.borrow();
        let Some(view) = view.as_ref() else {
            return pass_on();
        };
        let scale = self.scale.get();
        let to = |position: Point<Pixels>| POINT {
            x: device(position.x, scale) - frame.x,
            y: device(position.y, scale) - frame.y,
        };
        let (kind, button, modifiers, position) = match event {
            PlatformInput::MouseDown(down) => {
                if down.button == MouseButton::Left {
                    // SAFETY: the controller is alive while `view` is.
                    let _ = unsafe {
                        view.controller
                            .MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)
                    };
                }
                (pressed(down.button, true), Some(down.button), down.modifiers, down.position)
            }
            PlatformInput::MouseUp(up) => (pressed(up.button, false), None, up.modifiers, up.position),
            PlatformInput::MouseMove(moved) => (
                COREWEBVIEW2_MOUSE_EVENT_KIND_MOVE,
                moved.pressed_button,
                moved.modifiers,
                moved.position,
            ),
            PlatformInput::MouseExited(exited) => (
                COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE,
                exited.pressed_button,
                exited.modifiers,
                exited.position,
            ),
            // The wheel is the client's: it scrolls the conversation.
            PlatformInput::Scroll(_) => return pass_on(),
            _ => return pass_on(),
        };
        let data = match event {
            PlatformInput::MouseDown(down) => extra(down.button),
            PlatformInput::MouseUp(up) => extra(up.button),
            _ => 0,
        };
        // SAFETY: the controller is alive while `view` is.
        let _ = unsafe {
            view.composition
                .SendMouseInput(kind, keys(button, modifiers), data, to(position))
        };
        DispatchEventResult {
            propagate: false,
            default_prevented: false,
        }
    }

    /// Give the keyboard back to the client's window, if the player has it.
    fn release_keys(&self) {
        // SAFETY: two calls about this thread's own windows.
        unsafe {
            if GetFocus() != self.hwnd {
                let _ = SetFocus(Some(self.hwnd));
            }
        }
    }
}

/// t in the window's device pixels.
#[expect(clippy::cast_possible_truncation, reason = "a point in a window")]
fn device(at: Pixels, scale: f32) -> i32 {
    (f32::from(at) * scale).round() as i32
}

/// What the client does with an event the player does not take.
fn pass_on() -> DispatchEventResult {
    DispatchEventResult {
        propagate: true,
        default_prevented: false,
    }
}

fn pressed(button: MouseButton, down: bool) -> COREWEBVIEW2_MOUSE_EVENT_KIND {
    match (button, down) {
        (MouseButton::Left, true) => COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_DOWN,
        (MouseButton::Left, false) => COREWEBVIEW2_MOUSE_EVENT_KIND_LEFT_BUTTON_UP,
        (MouseButton::Right, true) => COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_DOWN,
        (MouseButton::Right, false) => COREWEBVIEW2_MOUSE_EVENT_KIND_RIGHT_BUTTON_UP,
        (MouseButton::Middle, true) => COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_DOWN,
        (MouseButton::Middle, false) => COREWEBVIEW2_MOUSE_EVENT_KIND_MIDDLE_BUTTON_UP,
        (MouseButton::Navigate(_), true) => COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_DOWN,
        (MouseButton::Navigate(_), false) => COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_UP,
    }
}

/// Which of the side buttons, for a press or release of one.
fn extra(button: MouseButton) -> u32 {
    match button {
        MouseButton::Navigate(NavigationDirection::Back) => 1,
        MouseButton::Navigate(NavigationDirection::Forward) => 2,
        _ => 0,
    }
}

fn keys(button: Option<MouseButton>, modifiers: Modifiers) -> COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS {
    let mut keys = COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE;
    if modifiers.control {
        keys |= COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_CONTROL;
    }
    if modifiers.shift {
        keys |= COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_SHIFT;
    }
    if let Some(button) = button {
        keys |= match button {
            MouseButton::Left => COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_LEFT_BUTTON,
            MouseButton::Right => COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_RIGHT_BUTTON,
            MouseButton::Middle => COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_MIDDLE_BUTTON,
            MouseButton::Navigate(NavigationDirection::Back) => {
                COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_X_BUTTON1
            }
            MouseButton::Navigate(NavigationDirection::Forward) => {
                COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_X_BUTTON2
            }
        };
    }
    keys
}

/// Make the web view for `page` in `hwnd`, drawn into `visual`, and hand it
/// to `shared` once it is there. Nothing waits: the system answers through
/// the window's message loop.
fn make(page: &Page, hwnd: HWND, visual: IUnknown, shared: Weak<Shared>) -> windows::core::Result<()> {
    // The client's own, made now: nothing of the web view's exists before
    // a video is played.
    let folder = crate::paths::data_dir().join("cache").join("web-view");
    let framing = page.framing().into_bytes();
    let options = CoreWebView2EnvironmentOptions::default();
    let arguments = std::env::var("FANCY_GPUI_PLAYER_ARGS").unwrap_or_else(|_| ARGUMENTS.to_owned());
    // SAFETY: setting a string on options this function owns.
    unsafe { options.set_additional_browser_arguments(arguments) };
    let made = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
        move |result, environment| {
            result?;
            let Some(environment) = environment else {
                return Ok(());
            };
            let environment3 = environment.cast::<ICoreWebView2Environment3>()?;
            let ready = CreateCoreWebView2CompositionControllerCompletedHandler::create(Box::new(
                move |result, composition| {
                    let Some(shared) = shared.upgrade() else {
                        // Stopped while it was being made.
                        if let Some(composition) = composition
                            && let Ok(controller) = composition.cast::<ICoreWebView2Controller>()
                        {
                            // SAFETY: a controller just handed over.
                            let _ = unsafe { controller.Close() };
                        }
                        return Ok(());
                    };
                    let made = result.and_then(|()| {
                        let composition = composition.ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_POINTER))?;
                        // SAFETY: the objects just handed over, and `visual`, which the surface in `shared` keeps.
                        unsafe { configure(&environment, composition, &visual, framing, &shared) }
                    });
                    if let Err(error) = made {
                        tracing::warn!(%error, "no web view to play in");
                        let _ = shared.said.try_send(Said::Failed);
                    }
                    Ok(())
                },
            ));
            // SAFETY: the window is the client's, open while a player is.
            unsafe { environment3.CreateCoreWebView2CompositionController(hwnd, &ready) }
        },
    ));
    // SAFETY: arguments that outlive the call; the answer comes later.
    unsafe {
        CreateCoreWebView2EnvironmentWithOptions(
            windows::core::PCWSTR::null(),
            &HSTRING::from(folder.as_os_str()),
            &ICoreWebView2EnvironmentOptions::from(options),
            &made,
        )
    }
}

/// Set the made web view up: drawn into `visual`, serving the framing page
/// at its address, passing on what the page says, and doing what is wanted.
unsafe fn configure(
    environment: &ICoreWebView2Environment,
    composition: ICoreWebView2CompositionController,
    visual: &IUnknown,
    framing: Vec<u8>,
    shared: &Rc<Shared>,
) -> windows::core::Result<()> {
    // SAFETY: the caller's objects are alive for the calls.
    unsafe {
        composition.SetRootVisualTarget(visual)?;
        let controller = composition.cast::<ICoreWebView2Controller>()?;
        controller.SetIsVisible(false)?;
        let webview = controller.CoreWebView2()?;
        let filter = HSTRING::from(format!("{ORIGIN}/*"));
        webview.AddWebResourceRequestedFilter(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?;
        let serving = environment.clone();
        let mut token = 0;
        webview.add_WebResourceRequested(
            &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut uri = PWSTR::null();
                args.Request()?.Uri(&mut uri)?;
                // Only the page: anything else at the address is not there.
                let page = url::Url::parse(&take_pwstr(uri)).is_ok_and(|uri| uri.path() == "/");
                let (status, reason, body) = if page { (200, "OK", Some(framing.as_slice())) } else { (404, "Not Found", None) };
                let stream = body.and_then(|body| SHCreateMemStream(Some(body)));
                let response = serving.CreateWebResourceResponse(
                    stream.as_ref(),
                    status,
                    &HSTRING::from(reason),
                    &HSTRING::from("Content-Type: text/html; charset=utf-8"),
                )?;
                args.SetResponse(&response)
            })),
            &mut token,
        )?;
        let said = shared.said.clone();
        webview.add_WebMessageReceived(
            &WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut message = PWSTR::null();
                if args.TryGetWebMessageAsString(&mut message).is_ok()
                    && let Ok(state) = take_pwstr(message).parse()
                {
                    let _ = said.try_send(state);
                }
                Ok(())
            })),
            &mut token,
        )?;
        webview.AddScriptToExecuteOnDocumentCreated(
            &HSTRING::from(IPC),
            &AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(|_, _| Ok(()))),
        )?;
        *shared.view.borrow_mut() = Some(View {
            composition,
            controller,
            webview,
            loaded: false,
        });
    }
    shared.apply();
    Ok(())
}

/// The player, from the client's side.
struct Composed {
    shared: Rc<Shared>,
    retired: Rc<RefCell<Vec<CompositionSurfaceId>>>,
}

impl Screen for Composed {
    fn start(&mut self) {
        self.shared.want(Wanted {
            started: true,
            ..self.shared.wanted.get()
        });
    }

    fn place(&mut self, placement: Placement) {
        self.shared.want(Wanted {
            placement,
            ..self.shared.wanted.get()
        });
    }

    fn scale(&mut self, scale: f32) {
        self.shared.scale.set(scale);
    }

    fn release_keys(&mut self) {
        self.shared.release_keys();
    }

    fn overlay(&self) -> Option<CompositionSurfaceId> {
        Some(self.shared.overlay)
    }

    fn rest(&mut self, resting: bool) {
        self.shared.want(Wanted {
            resting,
            ..self.shared.wanted.get()
        });
    }
}

impl Drop for Composed {
    /// The web view closes at once; its surface leaves the composition when
    /// the window is next drawn.
    fn drop(&mut self) {
        self.shared.platform_visible(false);
        if let Some(view) = self.shared.view.borrow_mut().take() {
            // SAFETY: a controller this player made and still holds.
            let _ = unsafe { view.controller.Close() };
        }
        self.shared.release_keys();
        self.retired.borrow_mut().push(self.shared.surface.id());
    }
}
