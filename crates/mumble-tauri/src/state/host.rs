//! The seam between the engine and the application that hosts it.
//!
//! Everything under `state/` reaches the outside world through a [`Host`],
//! which is assembled from one small trait per concern: [`EventSink`] for the
//! view, [`AppDirs`] for where data lives, [`Notifier`] for the user's
//! attention, [`BackgroundService`] for what keeps a voice connection alive
//! off screen and [`SignalInterceptor`] for native media peers. The desktop and mobile app supplies them all from one
//! object (see `crate::adapter`); a native view can bring its own event sink
//! and share the rest. Nothing in `state/` names a UI toolkit, and a test in
//! this module keeps it that way.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::SharedState;
use super::core_event::{CoreEvent, Event};
use super::sessions::ServerId;

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
    /// Deliver `event` to the view.
    ///
    /// A native view matches on [`Event::kind`] and takes the payload as the
    /// value it is; a view that speaks JSON calls [`Event::into_wire`].
    ///
    /// Delivery is best effort. A view that is not listening, or not up yet,
    /// simply misses the event, exactly as a webview that has not mounted
    /// does.
    fn emit(&self, event: Event);
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

/// Native media peers that answer WebRTC signalling themselves.
pub(crate) trait SignalInterceptor: Send + Sync + 'static {
    /// Whether a native peer took this signal for itself, in which case the
    /// view must not see it.
    ///
    /// Runs on the protocol's receive thread, so it must never block: an
    /// implementation that cannot decide at once leaves the signal unclaimed.
    fn claim_webrtc_signal(
        &self,
        sender_session: Option<u32>,
        signal_type: i32,
        payload: &str,
    ) -> bool;
}

/// A [`BackgroundService`] for platforms that never suspend the application.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct NoBackgroundService;

impl BackgroundService for NoBackgroundService {
    fn voice_service(&self, _: VoiceService<'_>) {}

    fn push_token(&self) -> Option<String> {
        None
    }
}

/// A [`SignalInterceptor`] for an application whose view does all its own
/// WebRTC.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct NoSignalInterceptor;

impl SignalInterceptor for NoSignalInterceptor {
    fn claim_webrtc_signal(&self, _: Option<u32>, _: i32, _: &str) -> bool {
        false
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
    /// Who else may answer WebRTC signalling.
    pub signals: Arc<dyn SignalInterceptor>,
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
        H: EventSink + AppDirs + Notifier + BackgroundService + SignalInterceptor,
    {
        let host = Arc::new(host);
        Self::new(HostParts {
            events: host.clone(),
            dirs: host.clone(),
            notifier: host.clone(),
            background: host.clone(),
            signals: host,
        })
    }

    /// Tell the view that `event` happened.
    pub(crate) fn send(&self, event: CoreEvent) {
        self.0.events.emit(Event {
            server: None,
            kind: event,
        });
    }

    /// Tell the view that `event` happened on the session `server`.
    pub(crate) fn send_for(&self, server: Option<ServerId>, event: CoreEvent) {
        self.0.events.emit(Event {
            server,
            kind: event,
        });
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

    /// Whether a native media peer took this WebRTC signal for itself; see
    /// [`SignalInterceptor`].
    pub(crate) fn claim_webrtc_signal(
        &self,
        sender_session: Option<u32>,
        signal_type: i32,
        payload: &str,
    ) -> bool {
        self.0
            .signals
            .claim_webrtc_signal(sender_session, signal_type, payload)
    }
}

impl std::fmt::Debug for Host {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Host")
    }
}

/// The host of the session behind `shared`.
///
/// Takes the session lock only to read the handle, so the caller emits with
/// the lock released: a view may call straight back into the engine.
pub(crate) fn host_of(shared: &Mutex<SharedState>) -> Option<Host> {
    shared.lock().ok().and_then(|state| state.conn.host.clone())
}

/// Tell the view of the session behind `shared` that `event` happened, if it
/// has one.
pub(crate) fn tell_view_of(shared: &Mutex<SharedState>, event: CoreEvent) {
    if let Some(host) = host_of(shared) {
        host.send(event);
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

    /// Modules of this crate that belong to the Tauri view. The engine may not
    /// reach into them, or it could not be built without that view.
    const VIEW_MODULES: &[&str] = &[
        "crate::adapter",
        "crate::app::",
        "crate::commands",
        "crate::logging",
        "crate::platform",
        "crate::ui_mode",
        "crate::updater",
        "crate::view_state",
    ];

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
                if TOOLKIT_TOKENS
                    .iter()
                    .chain(VIEW_MODULES)
                    .any(|token| code.contains(token))
                {
                    found.push(format!("{relative}:{}: {}", number + 1, code));
                }
            }
        }
    }

    /// The engine must not name a UI toolkit or reach into this view's
    /// modules: that is what lets more than one view sit on top of it. Reach
    /// the outside world through `Host`.
    #[test]
    fn engine_names_no_ui_toolkit_and_no_view_module() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut found = Vec::new();
        // `state/` is scanned relative to itself so `host.rs`, which has to
        // name the things it forbids, can be told apart.
        let state = src.join("state");
        offending_lines(&state, &state, &mut found);
        for module in ["audio", "media"] {
            offending_lines(&src.join(module), &src, &mut found);
        }
        assert!(
            found.is_empty(),
            "the engine must stay independent of the UI toolkit and of this view's modules; go through `Host` instead:\n{}",
            found.join("\n")
        );
    }
}
