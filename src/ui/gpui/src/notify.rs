//! System notifications.
//!
//! GPUI has no notification API, so this goes to the desktop's own: the
//! freedesktop notification service on Linux, by way of `notify-send` so no
//! D-Bus stack is linked for it. Other systems show nothing yet.

/// Show a notification titled `title` saying `body`. Best effort: a desktop
/// with no notification service simply shows nothing.
pub(crate) fn show(title: &str, body: &str) {
    #[cfg(target_os = "linux")]
    {
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
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (title, body);
    }
}
