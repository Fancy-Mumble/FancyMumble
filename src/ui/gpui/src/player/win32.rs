//! The system calls the player needs and nothing in Rust wraps: its
//! thread's message loop, waking that loop, naming the client's window to
//! it, and cutting its window down to what shows.
//!
//! The web view runs on a thread of its own because making one runs a
//! message loop of its own until it is made, and on the client's thread
//! that loop would run the client's work while the client is in the middle
//! of other work.

use std::num::NonZeroIsize;

use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::Graphics::Gdi::{CreateRectRgn, SetWindowRgn};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, MSG, PM_NOREMOVE, PeekMessageW, PostThreadMessageW,
    TranslateMessage, WM_APP,
};
use wry::WebViewExtWindows as _;
use wry::raw_window_handle::{
    HandleError, HasWindowHandle, RawWindowHandle, Win32WindowHandle, WindowHandle,
};

use super::place::Rect;

/// The message that wakes the player's thread to read its orders.
const ORDERS: u32 = WM_APP + 1;

/// The client's window, by its handle, for the web view to be a child of.
#[derive(Debug, Clone, Copy)]
pub(super) struct Parent(pub(super) NonZeroIsize);

impl HasWindowHandle for Parent {
    #[allow(
        unsafe_code,
        reason = "names the client's window, which outlives the player: the player is stopped before it closes"
    )]
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let raw = RawWindowHandle::Win32(Win32WindowHandle::new(self.0));
        // SAFETY: the client's window is open for as long as a player is,
        // and the handle is only used while this borrow lasts.
        Ok(unsafe { WindowHandle::borrow_raw(raw) })
    }
}

/// This thread, made ready to be woken: its message queue exists from now.
#[allow(
    unsafe_code,
    reason = "two calls that only read this thread's own state"
)]
pub(super) fn this_thread() -> u32 {
    let mut msg = MSG::default();
    // SAFETY: peeking without removing creates the queue; `msg` outlives it.
    let _ = unsafe { PeekMessageW(&raw mut msg, None, 0, 0, PM_NOREMOVE) };
    // SAFETY: no arguments.
    unsafe { GetCurrentThreadId() }
}

/// Wake the player's `thread` to read its orders.
#[allow(unsafe_code, reason = "posts a message with no pointers in it")]
pub(super) fn wake(thread: u32) {
    // SAFETY: a message of this program's own, carrying two zeros.
    let _ = unsafe { PostThreadMessageW(thread, ORDERS, WPARAM(0), LPARAM(0)) };
}

/// Run this thread's messages until `step` says to stop: it is called
/// with `None` each time the thread is woken for its orders, and with each
/// other message before that is handled.
#[allow(
    unsafe_code,
    reason = "the message loop, over messages the system hands it"
)]
pub(super) fn run(mut step: impl FnMut(Option<&MSG>) -> bool) {
    let mut msg = MSG::default();
    loop {
        // SAFETY: `msg` outlives each call; the loop ends on WM_QUIT or an
        // error (0 or -1).
        if unsafe { GetMessageW(&raw mut msg, None, 0, 0) }.0 <= 0 {
            return;
        }
        if msg.hwnd.is_invalid() && msg.message == ORDERS {
            if !step(None) {
                return;
            }
            continue;
        }
        let _ = step(Some(&msg));
        // SAFETY: a message just taken from this thread's queue.
        unsafe {
            let _ = TranslateMessage(&raw const msg);
            let _ = DispatchMessageW(&raw const msg);
        }
    }
}

/// Show only `shows` of `view`'s window, in the window's own coordinates;
/// all of it for `None`.
#[allow(
    unsafe_code,
    reason = "two calls on the web view's own window, and a region handed straight to it"
)]
pub(super) fn cut(view: &wry::WebView, shows: Option<Rect>) {
    let Some(window) = window_of(view) else {
        return;
    };
    // SAFETY: a region made from four numbers; once set, the window owns
    // it and frees it, so it is not used or freed here again.
    let region = shows.map(|rect| unsafe {
        CreateRectRgn(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height)
    });
    // SAFETY: `window` is the web view's own, alive while `view` is.
    let _ = unsafe { SetWindowRgn(window, region, true) };
}

/// The window `view` lives in: what the client places, and cuts.
#[allow(unsafe_code, reason = "asks the web view's controller for one handle")]
fn window_of(view: &wry::WebView) -> Option<HWND> {
    let controller = view.controller();
    let mut window = HWND::default();
    // SAFETY: the controller is alive while `view` is, and writes one
    // handle to a place that outlives the call.
    match unsafe { controller.ParentWindow(&raw mut window) } {
        Ok(()) => Some(window),
        Err(error) => {
            tracing::debug!(%error, "the player's window was not found");
            None
        }
    }
}
