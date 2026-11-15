//! Hears the client's window being minimised, so that what plays in it
//! pauses (`ui::playing`). The system tells of it on the client's own
//! message loop, where the players live: nothing polls. Every player of
//! the thread shares one hook, made with the first and let go of with the
//! last.

#![allow(
    unsafe_code,
    reason = "asks the system to tell this thread of one kind of event in this process"
)]

use std::cell::RefCell;

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows::Win32::UI::WindowsAndMessaging::{EVENT_SYSTEM_MINIMIZESTART, WINEVENT_OUTOFCONTEXT};

use super::Said;

thread_local! {
    /// The players of this thread listening, and the hook while any does.
    static LISTENERS: RefCell<Listeners> = RefCell::new(Listeners::default());
}

/// Who listens for minimising on this thread.
#[derive(Debug, Default)]
struct Listeners {
    hook: Option<HWINEVENTHOOK>,
    /// The number the next listener is known by.
    next: u64,
    listening: Vec<Listener>,
}

/// One player, listening for one window.
#[derive(Debug)]
struct Listener {
    number: u64,
    window: isize,
    said: async_channel::Sender<Said>,
}

impl Listeners {
    fn add(&mut self, window: HWND, said: async_channel::Sender<Said>) -> u64 {
        if self.hook.is_none() {
            self.hook = hook();
        }
        self.next += 1;
        self.listening.push(Listener {
            number: self.next,
            window: window.0 as isize,
            said,
        });
        self.next
    }

    fn remove(&mut self, number: u64) {
        self.listening.retain(|listener| listener.number != number);
        if self.listening.is_empty()
            && let Some(hook) = self.hook.take()
        {
            // SAFETY: the hook this thread made, let go of once.
            let _ = unsafe { UnhookWinEvent(hook) };
        }
    }

    /// `window` was minimised: tell whoever listens for it.
    fn heard(&self, window: isize) {
        for listener in self.listening.iter().filter(|listener| listener.window == window) {
            let _ = listener.said.try_send(Said::Minimised);
        }
    }
}

/// One player listening for its window being minimised, for as long as
/// it is kept.
#[derive(Debug)]
pub(super) struct Minimising(u64);

impl Minimising {
    /// Tell `said` when `window` is minimised.
    pub(super) fn watch(window: HWND, said: async_channel::Sender<Said>) -> Self {
        Self(LISTENERS.with_borrow_mut(|listeners| listeners.add(window, said)))
    }
}

impl Drop for Minimising {
    fn drop(&mut self) {
        LISTENERS.with_borrow_mut(|listeners| listeners.remove(self.0));
    }
}

/// A hook on this process alone, told on this thread's own loop.
fn hook() -> Option<HWINEVENTHOOK> {
    // SAFETY: out of context, so `heard` runs on this thread's loop and
    // touches only this thread's state.
    let hook = unsafe {
        SetWinEventHook(
            EVENT_SYSTEM_MINIMIZESTART,
            EVENT_SYSTEM_MINIMIZESTART,
            None,
            Some(heard),
            windows::Win32::System::Threading::GetCurrentProcessId(),
            0,
            WINEVENT_OUTOFCONTEXT,
        )
    };
    if std::env::var_os("FANCY_GPUI_PLAYER_TIMES").is_some() {
        eprintln!("player: watching for minimising: {}", !hook.is_invalid());
    }
    (!hook.is_invalid()).then_some(hook)
}

/// A window of this process was minimised.
unsafe extern "system" fn heard(
    _hook: HWINEVENTHOOK,
    _event: u32,
    window: HWND,
    _object: i32,
    _child: i32,
    _thread: u32,
    _at: u32,
) {
    if std::env::var_os("FANCY_GPUI_PLAYER_TIMES").is_some() {
        eprintln!("player: a window was minimised");
    }
    LISTENERS.with_borrow(|listeners| listeners.heard(window.0 as isize));
}
