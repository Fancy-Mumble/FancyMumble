#![allow(
    unsafe_code,
    reason = "Win32 window and shell queries need raw FFI; every unsafe \
              block carries a SAFETY note and only calls read-only APIs."
)]

use super::{RawWindow, Rect, ShellState};
use windows_sys::Win32::Foundation::{CloseHandle, HWND, MAX_PATH, RECT};
use windows_sys::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows_sys::Win32::UI::Shell::{
    QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN, SHQueryUserNotificationState,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GWL_STYLE, GetClassNameW, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect,
    GetWindowThreadProcessId, IsWindowVisible, WS_CAPTION, WS_THICKFRAME,
};

/// Read the foreground window, or `None` when there is nothing to judge.
pub(crate) fn foreground_window(own_pid: u32) -> Option<RawWindow> {
    // SAFETY: GetForegroundWindow takes no arguments and returns null when
    // no window is in the foreground.
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return None;
    }
    // SAFETY: IsWindowVisible accepts any HWND and validates it.
    if unsafe { IsWindowVisible(hwnd) } == 0 {
        return None;
    }
    if is_cloaked(hwnd) {
        return None;
    }

    let mut pid: u32 = 0;
    // SAFETY: pid is a writable u32; the OS fills it in.
    let _thread = unsafe { GetWindowThreadProcessId(hwnd, &raw mut pid) };
    if pid == 0 || pid == own_pid {
        return None;
    }

    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    // SAFETY: rect is a writable RECT; failure leaves it untouched and we bail.
    if unsafe { GetWindowRect(hwnd, &raw mut rect) } == 0 {
        return None;
    }

    // SAFETY: GWL_STYLE is a documented index; the call cannot fail
    // meaningfully for a valid HWND.
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } as u32;

    Some(RawWindow {
        hwnd: hwnd as isize,
        pid,
        class: class_name(hwnd),
        has_caption: style & WS_CAPTION == WS_CAPTION,
        has_thickframe: style & WS_THICKFRAME == WS_THICKFRAME,
        rect: Rect {
            x: rect.left,
            y: rect.top,
            w: rect.right - rect.left,
            h: rect.bottom - rect.top,
        },
        monitor_rect: monitor_rect(hwnd),
    })
}

/// A cloaked window is one DWM is not drawing - a background UWP app, or
/// a window on another virtual desktop. It is not what the user sees.
fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked: u32 = 0;
    // SAFETY: the out-buffer matches the DWORD size DWMWA_CLOAKED writes.
    let hr = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED as u32,
            (&raw mut cloaked).cast(),
            u32::try_from(size_of::<u32>()).unwrap_or(4),
        )
    };
    hr == 0 && cloaked != 0
}

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    // SAFETY: buf is a writable u16 array and we pass its true length.
    let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

fn monitor_rect(hwnd: HWND) -> Rect {
    // SAFETY: MONITOR_DEFAULTTONEAREST always yields a valid monitor.
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
    info.cbSize = u32::try_from(size_of::<MONITORINFO>()).unwrap_or(40);
    // SAFETY: info is a correctly sized, writable MONITORINFO.
    if unsafe { GetMonitorInfoW(monitor, &raw mut info) } == 0 {
        return Rect::default();
    }
    Rect {
        x: info.rcMonitor.left,
        y: info.rcMonitor.top,
        w: info.rcMonitor.right - info.rcMonitor.left,
        h: info.rcMonitor.bottom - info.rcMonitor.top,
    }
}

/// Turn a pid into a full executable path.
///
/// `PROCESS_QUERY_LIMITED_INFORMATION` is the weakest access right that
/// answers this question, and the only one anti-cheat-protected processes
/// grant. Asking for more is exactly the tell we must not give.
pub(crate) fn exe_path_of(pid: u32) -> Option<String> {
    // SAFETY: OpenProcess returns null on failure, which we check.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return None;
    }
    let mut buf = [0u16; MAX_PATH as usize];
    let mut len = u32::try_from(buf.len()).unwrap_or(260);
    // SAFETY: buf is writable and len is its true capacity; the OS writes
    // the used length back into len.
    let ok = unsafe { QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &raw mut len) };
    // SAFETY: handle came from OpenProcess and is not used again.
    let _closed = unsafe { CloseHandle(handle) };
    if ok == 0 || len == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..len as usize]))
}

/// Ask the shell whether anything should be popping up right now.
pub(crate) fn shell_state() -> ShellState {
    let mut state = 0i32;
    // SAFETY: state is a writable i32; the call fills it on success.
    let hr = unsafe { SHQueryUserNotificationState(&raw mut state) };
    if hr != 0 {
        return ShellState::Unknown;
    }
    match state {
        s if s == QUNS_RUNNING_D3D_FULL_SCREEN => ShellState::ExclusiveFullscreen,
        s if s == QUNS_PRESENTATION_MODE => ShellState::Presenting,
        s if s == QUNS_BUSY => ShellState::Busy,
        _ => ShellState::Normal,
    }
}

/// Windows can always answer, so there is never anything to report.
pub(crate) fn note() -> super::ProbeNote {
    super::ProbeNote::Ok
}
