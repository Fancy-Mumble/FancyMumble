//! The seam between the engine and the application that hosts it.
//!
//! Everything under `state/` reaches the outside world through a [`Host`],
//! which is assembled from one small trait per concern: [`EventSink`] for the
//! view, [`AppDirs`] for where data lives, [`Notifier`] for the user's
//! attention and [`BackgroundService`] for what keeps a voice connection
//! alive off screen. The desktop and mobile app supplies them all from one
//! object (see `crate::adapter`); a native view can bring its own event sink
//! and share the rest. Nothing in `state/` names a UI toolkit, and a test in
//! this module keeps it that way.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use serde_json::value::RawValue;

use super::AppState;

/// A change to the service that keeps a voice connection alive while the app
/// is in the background.
///
/// Only Android has such a service (a foreground service with a persistent
/// notification); every other host ignores these.
#[derive(Debug, Clone, Copy)]
#[cfg_attr(
    not(target_os = "android"),
    allow(dead_code, reason = "only the Android engine paths report these")
)]
pub(crate) enum VoiceService<'a> {
    /// A connection to `server` is up.
    Started {
        /// Host name of the server, as shown in the notification.
        server: &'a str,
    },
    /// The user is now in `channel` on `server`.
    ChannelChanged {
        /// Host name of the server.
        server: &'a str,
        /// Name of the channel the user is in.
        channel: &'a str,
    },
    /// The connection ended.
    Stopped,
}

/// Where the engine's events go: the view.
pub(crate) trait EventSink: Send + Sync + 'static {
    /// Deliver `event` to the view. `payload` is its JSON, already written
    /// out: the engine serialises each payload exactly once, and a sink that
    /// forwards JSON passes it on without parsing it again.
    ///
    /// Delivery is best effort. A view that is not listening, or not up yet,
    /// simply misses the event, exactly as a webview that has not mounted
    /// does.
    fn emit_json(&self, event: &str, payload: Box<RawValue>);
}

/// Where the application keeps its files.
pub(crate) trait AppDirs: Send + Sync + 'static {
    /// The directory certificates, identities and message keys live in.
    ///
    /// Callers want [`Host::data_dir`], which also honours the test override.
    fn app_data_dir(&self) -> Result<PathBuf, String>;

    /// A directory whose contents the system may delete, if there is one.
    fn cache_dir(&self) -> Option<PathBuf>;
}

/// How the application gets the user's attention while they look elsewhere.
pub(crate) trait Notifier: Send + Sync + 'static {
    /// Ask for attention without stealing focus (a flashing taskbar entry on
    /// Windows; nothing where the platform has no such cue).
    fn request_user_attention(&self);

    /// Show a system notification.
    ///
    /// `icon` is the sender's avatar and `channel_id` the channel the
    /// notification should open; implementations that cannot use them ignore
    /// them.
    fn show_notification(
        &self,
        title: &str,
        body: &str,
        icon: Option<&[u8]>,
        channel_id: Option<u32>,
    );
}

/// What keeps the engine reachable while the application is in the
/// background: the voice service and push notifications.
pub(crate) trait BackgroundService: Send + Sync + 'static {
    /// Report a change to the background voice service.
    fn voice_service(&self, change: VoiceService<'_>);

    /// The device's push-notification token, where the platform has one.
    fn push_token(&self) -> Option<String>;
}

/// How long-running engine work finds the engine again.
///
/// The loopback media origin and the audio loop outlive the call that started
/// them, so they cannot borrow the engine from their caller. This goes away
/// once the engine owns itself behind a shared pointer.
pub(crate) trait EngineLookup: Send + Sync + 'static {
    /// The engine this application runs; `None` while the application is
    /// still starting or already shutting down.
    fn app_state(&self) -> Option<&AppState>;
}

/// A [`Notifier`] for an application that has no notifications.
#[derive(Debug, Clone, Copy, Default)]
#[allow(dead_code, reason = "for views that bring no notifier of their own")]
pub(crate) struct NoNotifier;

impl Notifier for NoNotifier {
    fn request_user_attention(&self) {}

    fn show_notification(&self, _: &str, _: &str, _: Option<&[u8]>, _: Option<u32>) {}
}

/// A [`BackgroundService`] for platforms that never suspend the application.
#[derive(Debug, Clone, Copy, Default)]
#[allow(
    dead_code,
    reason = "for views on platforms without a background service"
)]
pub(crate) struct NoBackgroundService;

impl BackgroundService for NoBackgroundService {
    fn voice_service(&self, _: VoiceService<'_>) {}

    fn push_token(&self) -> Option<String> {
        None
    }
}

/// Everything the engine needs from the application that hosts it, one part
/// per concern.
///
/// Each part is its own trait object so a view picks them independently: its
/// own [`EventSink`], say, next to a notifier and directories shared with
/// every other native view.
pub(crate) struct HostParts {
    /// Where events go.
    pub events: Arc<dyn EventSink>,
    /// Where files live.
    pub dirs: Arc<dyn AppDirs>,
    /// How to reach the user.
    pub notifier: Arc<dyn Notifier>,
    /// What runs while the app is in the background.
    pub background: Arc<dyn BackgroundService>,
    /// How detached engine work finds the engine.
    pub engine: Arc<dyn EngineLookup>,
}

/// A shared handle to the application hosting the engine.
///
/// Cheap to clone (one reference count) and safe to call from any thread: the
/// engine uses it from its protocol loop and from audio tasks.
#[derive(Clone)]
pub(crate) struct Host(Arc<HostParts>);

impl Host {
    /// Assemble a host from its parts.
    pub(crate) fn new(parts: HostParts) -> Self {
        Self(Arc::new(parts))
    }

    /// A host whose every part is the same object.
    pub(crate) fn from_single<H>(host: H) -> Self
    where
        H: EventSink + AppDirs + Notifier + BackgroundService + EngineLookup,
    {
        let host = Arc::new(host);
        Self::new(HostParts {
            events: host.clone(),
            dirs: host.clone(),
            notifier: host.clone(),
            background: host.clone(),
            engine: host,
        })
    }

    /// Serialise `payload` and deliver it to the view as `event`.
    ///
    /// # Errors
    ///
    /// When `payload` cannot be represented as JSON. Delivery itself is best
    /// effort and never fails.
    pub(crate) fn emit<S: Serialize>(
        &self,
        event: &str,
        payload: S,
    ) -> Result<(), serde_json::Error> {
        self.0
            .events
            .emit_json(event, serde_json::value::to_raw_value(&payload)?);
        Ok(())
    }

    /// The directory certificates, identities and message keys live in.
    ///
    /// Honours the `FANCY_E2E_DATA_DIR` override, so every end-to-end test
    /// client gets an identity root of its own.
    ///
    /// # Errors
    ///
    /// When the application cannot resolve its data directory.
    pub(crate) fn data_dir(&self) -> Result<PathBuf, String> {
        data_dir_override().map_or_else(|| self.0.dirs.app_data_dir(), Ok)
    }

    /// A directory whose contents the system may delete, if there is one.
    pub(crate) fn cache_dir(&self) -> Option<PathBuf> {
        self.0.dirs.cache_dir()
    }

    /// Ask for the user's attention without stealing focus.
    pub(crate) fn request_user_attention(&self) {
        self.0.notifier.request_user_attention();
    }

    /// Show a system notification; see [`Notifier::show_notification`].
    pub(crate) fn show_notification(
        &self,
        title: &str,
        body: &str,
        icon: Option<&[u8]>,
        channel_id: Option<u32>,
    ) {
        self.0
            .notifier
            .show_notification(title, body, icon, channel_id);
    }

    /// Report a change to the background voice service.
    #[cfg_attr(
        not(target_os = "android"),
        allow(dead_code, reason = "only the Android engine paths report these")
    )]
    pub(crate) fn voice_service(&self, change: VoiceService<'_>) {
        self.0.background.voice_service(change);
    }

    /// The device's push-notification token, where the platform has one.
    #[cfg_attr(
        not(target_os = "android"),
        allow(dead_code, reason = "only the Android engine paths register for push")
    )]
    pub(crate) fn push_token(&self) -> Option<String> {
        self.0.background.push_token()
    }

    /// The engine this application runs; see [`EngineLookup`].
    pub(crate) fn app_state(&self) -> Option<&AppState> {
        self.0.engine.app_state()
    }
}

impl std::fmt::Debug for Host {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Host")
    }
}

/// The data directory an end-to-end test asked for, if it asked for one.
pub(crate) fn data_dir_override() -> Option<PathBuf> {
    std::env::var(crate::constants::ENV_E2E_DATA_DIR)
        .ok()
        .filter(|dir| !dir.trim().is_empty())
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    /// Code tokens that tie a file to one UI toolkit.
    const TOOLKIT_TOKENS: &[&str] = &["tauri::", "tauri_plugin_", "AppHandle"];

    fn offending_lines(dir: &Path, root: &Path, found: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                offending_lines(&path, root, found);
                continue;
            }
            if path.extension().is_none_or(|ext| ext != "rs") {
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            if relative == "host.rs" {
                continue;
            }
            let Ok(source) = std::fs::read_to_string(&path) else {
                continue;
            };
            for (number, line) in source.lines().enumerate() {
                let code = line.trim_start();
                if code.starts_with("//") {
                    continue;
                }
                if TOOLKIT_TOKENS.iter().any(|token| code.contains(token)) {
                    found.push(format!("{relative}:{}: {}", number + 1, code));
                }
            }
        }
    }

    /// The engine must not name a UI toolkit: that is what lets more than one
    /// view sit on top of it. Reach the outside world through `Host`.
    #[test]
    fn state_layer_names_no_ui_toolkit() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("state");
        let mut found = Vec::new();
        offending_lines(&root, &root, &mut found);
        assert!(
            found.is_empty(),
            "state/ must stay independent of the UI toolkit; go through `Host` instead:\n{}",
            found.join("\n")
        );
    }
}
