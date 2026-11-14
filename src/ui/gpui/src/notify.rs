//! System notifications.
//!
//! GPUI has no notification API, so this goes to the desktop's own: the
//! freedesktop notification service on Linux, by way of `notify-send` so no
//! D-Bus stack is linked for it; the notification centre on Windows and
//! macOS.

/// Whether notifications are shown at all: the user's switch on the
/// Notifications page. Read on whichever thread the engine tells from;
/// under test, each test's thread has its own.
#[cfg(not(test))]
static ALLOWED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

#[cfg(test)]
thread_local! {
    static ALLOWED_HERE: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
}

/// Show notifications, or none.
pub(crate) fn allow(shown: bool) {
    #[cfg(not(test))]
    ALLOWED.store(shown, std::sync::atomic::Ordering::Relaxed);
    #[cfg(test)]
    ALLOWED_HERE.set(shown);
}

/// Whether notifications are shown.
pub(crate) fn allowed() -> bool {
    #[cfg(not(test))]
    return ALLOWED.load(std::sync::atomic::Ordering::Relaxed);
    #[cfg(test)]
    ALLOWED_HERE.get()
}

/// Show a notification titled `title` saying `body`. Best effort: a desktop
/// with no notification service simply shows nothing.
pub(crate) fn show(title: &str, body: &str) {
    if !allowed() {
        return;
    }
    // Not under test: a test run must not put messages on the desktop of
    // whoever is running it. It counts what it would have shown instead.
    if cfg!(test) {
        #[cfg(test)]
        WOULD_SHOW.set(WOULD_SHOW.get() + 1);
        return;
    }
    deliver(title, body);
}

#[cfg(test)]
thread_local! {
    /// How many notifications this thread would have shown.
    static WOULD_SHOW: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// How many notifications this thread would have shown, under test.
#[cfg(test)]
pub(crate) fn would_show() -> usize {
    WOULD_SHOW.get()
}

/// Hand the notification to the desktop.
#[cfg(target_os = "linux")]
fn deliver(title: &str, body: &str) {
    // Spawned and not waited for: the call can take a moment, and this
    // runs on an engine thread that has messages to deliver. The child
    // is reaped by a short-lived thread so it does not linger as a
    // zombie for the life of the application.
    let spawned = std::process::Command::new("notify-send")
        .args(["--app-name", "Fancy Mumble", "--"])
        .arg(title)
        .arg(body)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
    if let Ok(mut child) = spawned {
        drop(std::thread::spawn(move || {
            let _ = child.wait();
        }));
    }
}

/// Hand the notification to the desktop.
///
/// On Windows it is filed under whichever application the system knows
/// this process as; until an installer registers Fancy Mumble's own name,
/// that is the one the system falls back to.
#[cfg(any(windows, target_os = "macos"))]
fn deliver(title: &str, body: &str) {
    let (title, body) = (title.to_owned(), body.to_owned());
    // On a thread of its own: the call talks to the system and can take a
    // moment, and this runs on an engine thread with messages to deliver.
    drop(std::thread::spawn(move || {
        let shown = notify_rust::Notification::new()
            .appname("Fancy Mumble")
            .summary(&title)
            .body(&body)
            .show();
        if let Err(error) = shown {
            eprintln!("a notification could not be shown: {error}");
        }
    }));
}

/// No notification service known for this system.
#[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
fn deliver(title: &str, body: &str) {
    let _ = (title, body);
}
