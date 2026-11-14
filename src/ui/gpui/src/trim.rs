//! Giving back the memory that is not in use.
//!
//! Reading a picture touches a great deal of memory once: the file, the
//! picture as it comes out of it, the copies made on the way to the small
//! one that is kept. All of that is let go of, and the system still counts
//! it against this program until something else wants the room. Measured
//! on a conversation of thirteen pictures: eighty megabytes counted, nine
//! of them needed to scroll through all of it again.
//!
//! So once things have been quiet for a moment, the system is asked to take
//! back every page that is not in use. What is used again comes back as it
//! is touched, at the cost of a fault that reads nothing from disk. It is
//! what a browser does for a window nobody is looking at.

use std::time::Duration;

use gpui::{App, Global};

/// How long things are quiet before memory is given back: long enough that
/// a burst of pictures arriving is over, and one opened large is closed.
const QUIET: Duration = Duration::from_secs(8);

/// How often giving memory back has been asked for: only the last asking
/// of a burst does it.
#[derive(Debug, Default)]
struct Asked(u64);

impl Global for Asked {}

/// Give back what is not in use once things have been quiet for a moment.
/// Asked for again before then, it waits again from there.
pub(crate) fn soon(cx: &mut App) {
    let asked = cx.default_global::<Asked>();
    asked.0 += 1;
    let this = asked.0;
    let quiet = cx.background_executor().timer(QUIET);
    cx.spawn(async move |cx| {
        quiet.await;
        let _ = cx.update(|cx| {
            if cx.default_global::<Asked>().0 == this {
                settle();
            }
        });
    })
    .detach();
}

/// Give back every page this program is not using right now.
fn settle() {
    // Not under test: a test measures nothing by it.
    if cfg!(test) {
        return;
    }
    release();
}

#[cfg(windows)]
#[allow(
    unsafe_code,
    reason = "the system call that trims a working set; it takes no pointers"
)]
fn release() {
    use windows::Win32::System::Threading::{GetCurrentProcess, SetProcessWorkingSetSize};
    // SAFETY: the handle is this process's own, which is always valid, and
    // the two sizes are the documented way of asking for all of it back.
    let trimmed = unsafe { SetProcessWorkingSetSize(GetCurrentProcess(), usize::MAX, usize::MAX) };
    if let Err(error) = trimmed {
        tracing::debug!(%error, "memory not in use was not given back");
    }
}

/// Elsewhere the system takes back what is not in use by itself.
#[cfg(not(windows))]
fn release() {}
