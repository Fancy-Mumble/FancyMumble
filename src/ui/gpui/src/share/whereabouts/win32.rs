//! The system calls that say where a monitor or a window lies, by the id
//! the capture crate gives it (the handle, as 32 bits).

use std::ffi::c_void;

use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{ClientToScreen, GetMonitorInfoW, HMONITOR, MONITORINFO};
use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, IsIconic, IsWindow};

use super::{Area, Lies};

/// A handle from its 32 bits: handles are sign-extended to the pointer's
/// width.
fn handle(id: u32) -> *mut c_void {
    #[expect(
        clippy::cast_possible_wrap,
        reason = "the bits of a handle, sign-extended as Windows does"
    )]
    let signed = id as i32;
    signed as isize as *mut c_void
}

fn area(rect: RECT) -> Area {
    Area {
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
    }
}

/// Where the monitor `id` lies.
#[allow(
    unsafe_code,
    reason = "one call that reads a monitor's place into a struct it is given"
)]
pub(super) fn screen(id: u32) -> Lies {
    let mut info = MONITORINFO {
        cbSize: u32::try_from(size_of::<MONITORINFO>()).unwrap_or(u32::MAX),
        ..MONITORINFO::default()
    };
    // SAFETY: `info` is sized as the call asks and lives through it; a
    // monitor that is gone is said to be, not read.
    let read = unsafe { GetMonitorInfoW(HMONITOR(handle(id)), &raw mut info) };
    if read.as_bool() {
        Lies::At(area(info.rcMonitor))
    } else {
        Lies::Gone
    }
}

/// Where the inside of the window `id` lies.
#[allow(
    unsafe_code,
    reason = "four calls that only read a window's state into values they are given"
)]
pub(super) fn window(id: u32) -> Lies {
    let window = HWND(handle(id));
    // SAFETY: each call is asked of a handle that is checked to be a window
    // first, and writes only into the locals it is given.
    unsafe {
        if !IsWindow(Some(window)).as_bool() {
            return Lies::Gone;
        }
        if IsIconic(window).as_bool() {
            return Lies::Hidden;
        }
        let mut inside = RECT::default();
        let mut origin = POINT::default();
        if GetClientRect(window, &raw mut inside).is_err()
            || !ClientToScreen(window, &raw mut origin).as_bool()
        {
            return Lies::Gone;
        }
        Lies::At(Area {
            x: origin.x,
            y: origin.y,
            ..area(inside)
        })
    }
}
