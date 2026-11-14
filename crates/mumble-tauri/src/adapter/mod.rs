//! Tauri's side of the engine seam.
//!
//! The engine under `state/` knows nothing about the toolkit that draws its
//! view; it asks a [`Host`] for what it needs. This module is that host
//! for the Tauri application: events become webview events, paths come from
//! Tauri's path resolver, and notifications and the Android foreground service
//! go through the plugins registered at startup.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};
#[cfg(not(target_os = "linux"))]
use tauri_plugin_notification::NotificationExt;

use crate::state::AppState;
use crate::state::host::{
    AppDirs, BackgroundService, EventSink, Host, Notifier, SignalInterceptor, VoiceService,
};

/// The engine's host when the view is a Tauri webview.
pub(crate) struct TauriHost {
    app: AppHandle,
}

impl TauriHost {
    /// Connect `state` to the running application: from here on the engine
    /// emits to this app's webviews and spawns onto Tauri's runtime.
    pub(crate) fn attach(app: &AppHandle, state: &AppState) {
        crate::state::runtime::adopt(tauri::async_runtime::handle().inner().clone());
        state.set_host(Host::from_single(Self { app: app.clone() }));
    }
}

impl EventSink for TauriHost {
    fn emit(&self, event: crate::state::core_event::Event) {
        // The webview listens for names and JSON, so every event is written
        // out in the shape its frontend has always received.
        match event.into_wire() {
            Ok((name, payload)) => {
                let _ = self.app.emit(name, payload);
            }
            Err(error) => tracing::warn!("an event could not be written out as JSON: {error}"),
        }
    }
}

impl SignalInterceptor for TauriHost {
    fn claim_webrtc_signal(
        &self,
        sender_session: Option<u32>,
        signal_type: i32,
        payload: &str,
    ) -> bool {
        // When the Rust broadcaster is waiting for the SFU's answer, that
        // answer belongs to it, not to the webview's viewer dispatcher.
        #[cfg(not(target_os = "android"))]
        if crate::commands::screenshare::try_intercept_answer(signal_type, payload) {
            return true;
        }

        // Native viewer peers (always on Linux, where the webview has no
        // WebRTC; opt-in on Windows via the viewer-strategy setting): their
        // answers are claimed here as well. Ordering matters: the
        // broadcaster's (all-recvonly) answer was already taken above, and
        // this only claims answers carrying sendonly m-lines - so it can
        // never swallow a broadcaster answer even when both await at once
        // (the loopback preview case, where both arrive with sender = self).
        // With no native viewers running (the Windows default) the registry
        // is empty and this claims nothing.
        #[cfg(native_stream_viewer)]
        if crate::commands::stream_view::try_intercept_viewer_answer(
            sender_session,
            signal_type,
            payload,
        ) {
            return true;
        }

        let _ = (sender_session, signal_type, payload);
        false
    }
}

impl AppDirs for TauriHost {
    fn app_data_dir(&self) -> Result<PathBuf, String> {
        self.app.path().app_data_dir().map_err(|e| e.to_string())
    }

    fn cache_dir(&self) -> Option<PathBuf> {
        self.app.path().cache_dir().ok()
    }
}

impl Notifier for TauriHost {
    fn request_user_attention(&self) {
        #[cfg(target_os = "windows")]
        if let Some(window) = self.app.get_webview_window("main") {
            let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
        }
    }

    fn show_notification(
        &self,
        title: &str,
        body: &str,
        icon: Option<&[u8]>,
        channel_id: Option<u32>,
    ) {
        show_desktop_notification(&self.app, title, body, icon, channel_id);
    }
}

impl BackgroundService for TauriHost {
    #[cfg(target_os = "android")]
    fn voice_service(&self, change: VoiceService<'_>) {
        use crate::platform::android::connection_service::{self, ConnectionServiceHandle};
        let Some(handle) = self.app.try_state::<ConnectionServiceHandle>() else {
            return;
        };
        match change {
            VoiceService::Started { server } => connection_service::start_service(&handle, server),
            VoiceService::ChannelChanged { server, channel } => {
                connection_service::update_service_channel(&handle, server, channel);
            }
            VoiceService::Stopped => connection_service::stop_service(&handle),
        }
    }

    #[cfg(not(target_os = "android"))]
    fn voice_service(&self, change: VoiceService<'_>) {
        let _ = change;
    }

    fn push_token(&self) -> Option<String> {
        #[cfg(target_os = "android")]
        {
            use crate::platform::android::fcm_service::{self, FcmPluginHandle};
            let Some(fcm) = self.app.try_state::<FcmPluginHandle>() else {
                tracing::info!("FCM: FcmPluginHandle not available (not Android?)");
                return None;
            };
            tracing::info!("FCM: FcmPluginHandle found, requesting device token");
            fcm_service::get_token(&fcm)
        }
        #[cfg(not(target_os = "android"))]
        None
    }
}

/// Show a desktop notification through the platform-appropriate channel.
///
/// Shared by the engine's host above and the `show_desktop_notification`
/// command (the webview's calendar reminders), so every caller gets the same
/// platform routing - in particular the Linux branch, which nothing may
/// bypass.
pub(crate) fn show_desktop_notification(
    app: &AppHandle,
    title: &str,
    body: &str,
    icon: Option<&[u8]>,
    channel_id: Option<u32>,
) {
    // On Android, route through our ConnectionServicePlugin so we can
    // decode the sender avatar as a Bitmap for the notification large-icon.
    #[cfg(target_os = "android")]
    {
        if let Some(cs_handle) =
            app.try_state::<crate::platform::android::connection_service::ConnectionServiceHandle>()
        {
            crate::platform::android::connection_service::show_chat_notification(
                &cs_handle, title, body, icon, channel_id,
            );
            return;
        }
    }
    // Non-Android fallback: standard Tauri notification API (no avatar).
    let _ = icon;
    let _ = channel_id;
    // On Linux, NOT the notification plugin: its show() spawns notify-rust's
    // BLOCKING zbus call onto the tokio runtime (async_runtime::spawn in the
    // plugin's desktop.rs), where zbus's tokio flavor (forced by ashpd)
    // block_on's a private runtime and panics "Cannot start a runtime from
    // within a runtime" - with panic=abort that kills the app whenever a
    // notification fires. Drive notify-rust from a blocking thread.
    #[cfg(target_os = "linux")]
    {
        let _ = app;
        let title = title.to_owned();
        let body = body.to_owned();
        // Dropped, not awaited: `spawn_blocking` runs the closure to
        // completion whether or not anyone holds the handle, and nothing here
        // has a use for its result.
        drop(tauri::async_runtime::spawn_blocking(move || {
            let _ = notify_rust::Notification::new()
                .summary(&title)
                .body(&body)
                .show();
        }));
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app
            .notification()
            .builder()
            .channel_id("messages")
            .title(title)
            .body(body)
            .show();
    }
}
