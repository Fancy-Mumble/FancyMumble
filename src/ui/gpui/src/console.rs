//! The terminal a release build writes to, on Windows.
//!
//! A release build is a Windows program rather than a console one, so a
//! start from Explorer, a shortcut or the tray opens no console window.
//! Started from a terminal it writes there all the same: it attaches to the
//! terminal it was started from. Started with its output redirected (a
//! script that keeps what it says), it writes where it was sent and attaches
//! to nothing.

/// Attach to the terminal this program was started from, if it was started
/// from one and its output was not sent elsewhere.
#[cfg(all(windows, not(debug_assertions)))]
#[allow(
    unsafe_code,
    reason = "three console calls that take no pointers from this program"
)]
pub(crate) fn attach() {
    use windows::Win32::System::Console::{
        ATTACH_PARENT_PROCESS, AttachConsole, GetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE,
    };
    // SAFETY: asking for this process's own standard handles takes nothing
    // and changes nothing.
    let given = [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE]
        .into_iter()
        .any(|which| {
            unsafe { GetStdHandle(which) }
                .is_ok_and(|handle| !handle.is_invalid() && !handle.0.is_null())
        });
    if given {
        return;
    }
    // SAFETY: attaching to the parent's console, if it has one, is all this
    // does; a parent without one is an error that is ignored. The system
    // gives the attached console's handles to a process that had none.
    let _ = unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };
}

/// A console program, or not Windows: the terminal is there already.
#[cfg(not(all(windows, not(debug_assertions))))]
pub(crate) fn attach() {}
