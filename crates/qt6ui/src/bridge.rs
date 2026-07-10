//! The `Backend` QObject bridged to QML via cxx-qt.
//!
//! This is a thin adapter: every method delegates to [`AppCore`], which owns
//! the tokio runtime and all `mumble-protocol` logic.  Properties and signals
//! are the only state QML ever touches.

use core::pin::Pin;
use std::sync::Arc;

use cxx_qt::Threading; // brings `qt_thread()` into scope
use cxx_qt_lib::QString;

use crate::app::AppCore;

#[cxx_qt::bridge]
pub mod qobject {
    /// One decorated range within a line of markdown editor text,
    /// in UTF-16 code units (QString indices). `flags` is a bitwise OR
    /// of `fancy_utils::markdown::flags` constants.
    #[derive(Debug, Clone, Copy)]
    struct MdSpan {
        start: i32,
        len: i32,
        flags: u16,
    }

    extern "Rust" {
        /// Parse one line of editor text into decorated spans for the
        /// C++ `MarkdownHighlighter` (see `cpp/markdown_highlighter.cpp`).
        /// `in_fence` is the fenced-code block state entering this line;
        /// `out_fence` receives the state for the next line.
        fn md_line_spans(line: &str, in_fence: bool, out_fence: &mut bool) -> Vec<MdSpan>;
    }

    unsafe extern "C++" {
        include!("cxx-qt-lib/qstring.h");
        /// Qt's UTF-16 string type (from cxx-qt-lib).
        type QString = cxx_qt_lib::QString;
    }

    extern "RustQt" {
        /// The single QML-facing object.  Registered as `Backend` in the
        /// `com.fancymumble.qt6ui` module.
        #[qobject]
        #[qml_element]
        #[qproperty(QString, status)]
        #[qproperty(QString, channels_json)]
        #[qproperty(i32, self_channel)]
        #[qproperty(i32, default_port)]
        // hide_empty_channels: "hide empty channels" (web client parity),
        // loaded from and persisted to the shared preferences store - use
        // persist_hide_empty_channels() to change it, not a raw write.
        #[qproperty(bool, hide_empty_channels)]
        // saved_servers_json: the shared saved-server list (servers.json),
        // same entries the full client shows: [{id, label, host, port,
        // username, cert_label, favorite}, ...] newest first.
        #[qproperty(QString, saved_servers_json)]
        type Backend = super::BackendRust;

        /// Translate a namespaced key from the shared locale bundles
        /// ("server.fields.host"). See `src/i18n.rs`. Named `t` (i18next
        /// convention) because `tr` would clash with the static
        /// `QObject::tr` that the Q_OBJECT macro injects.
        #[qinvokable]
        fn t(self: &Backend, key: &QString) -> QString;

        /// Plural-aware translate (i18next `_one`/`_other` convention);
        /// replaces `{{count}}` in the resolved string.
        #[qinvokable]
        fn tr_n(self: &Backend, key: &QString, count: i32) -> QString;

        /// Connect to a Mumble server and authenticate as `username`.
        #[qinvokable]
        fn connect_to_server(
            self: Pin<&mut Backend>,
            host: &QString,
            port: i32,
            username: &QString,
            password: &QString,
        );

        /// Disconnect from the current server and stop all audio.
        #[qinvokable]
        fn disconnect_from_server(self: Pin<&mut Backend>);

        /// Send a chat text message to the current channel.
        #[qinvokable]
        fn send_message(self: Pin<&mut Backend>, text: &QString);

        /// Move ourselves into the channel with the given id.
        #[qinvokable]
        fn join_channel(self: Pin<&mut Backend>, channel_id: i32);

        /// Enable (un-mute/un-deafen + start mic) or disable voice.
        #[qinvokable]
        fn set_voice_enabled(self: Pin<&mut Backend>, enabled: bool);

        /// Persist the `full` ui-mode marker and start the full (Tauri)
        /// client. Returns `true` when the full client was spawned - the
        /// QML side should then `Qt.quit()`. On `false` this client keeps
        /// running (marker unwritable or full binary not found).
        #[qinvokable]
        fn switch_to_full_mode(self: Pin<&mut Backend>) -> bool;

        /// Connect to a saved server by id: uses its stored username,
        /// password (passwords.json) and TLS identity (`cert_label`).
        #[qinvokable]
        fn connect_saved(self: Pin<&mut Backend>, id: &QString);

        /// Persist a new saved server (shared servers.json; the password,
        /// when `save_password`, goes to passwords.json). Returns the new
        /// entry's id, or an empty string on failure.
        #[qinvokable]
        fn save_server(
            self: Pin<&mut Backend>,
            label: &QString,
            host: &QString,
            port: i32,
            username: &QString,
            password: &QString,
            save_password: bool,
        ) -> QString;

        /// Toggle a saved server's favourite flag and refresh the list.
        #[qinvokable]
        fn toggle_favorite(self: Pin<&mut Backend>, id: &QString);

        /// Set + persist the hide-empty-channels preference (shared with
        /// the full client's Settings). Named distinctly because cxx-qt
        /// already generates `set_hide_empty_channels` for the property.
        #[qinvokable]
        fn persist_hide_empty_channels(self: Pin<&mut Backend>, enabled: bool);

        /// Emitted when a chat message arrives (or is echoed back).
        #[qsignal]
        fn chat_message(self: Pin<&mut Backend>, channel: QString, sender: QString, text: QString);

        /// Emitted for user-facing log/diagnostic lines.
        #[qsignal]
        fn log_message(self: Pin<&mut Backend>, line: QString);
    }

    impl cxx_qt::Threading for Backend {}
}

/// The Rust data backing the `Backend` QObject.
pub struct BackendRust {
    status: QString,
    channels_json: QString,
    self_channel: i32,
    default_port: i32,
    hide_empty_channels: bool,
    saved_servers_json: QString,
    core: Arc<AppCore>,
}

impl Default for BackendRust {
    fn default() -> Self {
        Self {
            status: QString::from("disconnected"),
            channels_json: QString::from("[]"),
            self_channel: -1,
            default_port: i32::from(crate::constants::DEFAULT_SERVER_PORT),
            hide_empty_channels: crate::store::hide_empty_channels(),
            saved_servers_json: QString::from(crate::store::saved_servers().to_string().as_str()),
            core: Arc::new(AppCore::new()),
        }
    }
}

impl qobject::Backend {
    /// Delegate: start connecting.  Captures a `CxxQtThread` handle so the
    /// background tasks can push UI updates back onto the Qt thread.
    fn connect_to_server(
        self: Pin<&mut Self>,
        host: &QString,
        port: i32,
        username: &QString,
        password: &QString,
    ) {
        let thread = self.qt_thread();
        let password = password.to_string();
        let password = if password.is_empty() { None } else { Some(password) };
        self.core.clone().connect(
            thread,
            host.to_string(),
            port.clamp(1, 65_535) as u16,
            username.to_string(),
            password,
            None,
        );
    }

    fn disconnect_from_server(self: Pin<&mut Self>) {
        self.core.clone().disconnect();
    }

    fn send_message(self: Pin<&mut Self>, text: &QString) {
        let text = text.to_string();
        if !text.trim().is_empty() {
            self.core.clone().send_message(text);
        }
    }

    fn join_channel(self: Pin<&mut Self>, channel_id: i32) {
        if channel_id >= 0 {
            self.core.clone().join_channel(channel_id as u32);
        }
    }

    fn set_voice_enabled(self: Pin<&mut Self>, enabled: bool) {
        self.core.clone().set_voice_enabled(enabled);
    }

    fn switch_to_full_mode(self: Pin<&mut Self>) -> bool {
        crate::mode::switch_to_full_mode()
    }

    /// Connect to a saved server by id (stored username/password/identity).
    fn connect_saved(self: Pin<&mut Self>, id: &QString) {
        let id = id.to_string();
        let Some(entry) = crate::store::saved_server(&id) else {
            tracing::warn!("connect_saved: no saved server with id {id}");
            return;
        };
        let host = entry["host"].as_str().unwrap_or_default().to_owned();
        let port = entry["port"].as_u64().unwrap_or(0).clamp(1, 65_535) as u16;
        let username = entry["username"].as_str().unwrap_or_default().to_owned();
        if host.is_empty() || username.is_empty() {
            tracing::warn!("connect_saved: entry {id} is missing host/username");
            return;
        }
        let password = crate::store::server_password(&id);
        let cert_pems = entry["cert_label"]
            .as_str()
            .and_then(crate::store::identity_pems);
        let thread = self.qt_thread();
        self.core.clone().connect(thread, host, port, username, password, cert_pems);
    }

    fn save_server(
        self: Pin<&mut Self>,
        label: &QString,
        host: &QString,
        port: i32,
        username: &QString,
        password: &QString,
        save_password: bool,
    ) -> QString {
        let password = password.to_string();
        let password = if save_password && !password.is_empty() {
            Some(password)
        } else {
            None
        };
        match crate::store::add_server(
            &label.to_string(),
            &host.to_string(),
            port.clamp(1, 65_535) as u16,
            &username.to_string(),
            password.as_deref(),
        ) {
            Ok(id) => {
                self.refresh_saved_servers();
                QString::from(id.as_str())
            }
            Err(e) => {
                tracing::error!("failed to save server: {e}");
                QString::from("")
            }
        }
    }

    fn toggle_favorite(self: Pin<&mut Self>, id: &QString) {
        if let Err(e) = crate::store::toggle_favorite(&id.to_string()) {
            tracing::error!("failed to toggle favourite: {e}");
        }
        self.refresh_saved_servers();
    }

    fn persist_hide_empty_channels(mut self: Pin<&mut Self>, enabled: bool) {
        self.as_mut().set_hide_empty_channels(enabled);
        crate::store::set_hide_empty_channels(enabled);
    }

    /// Reload the shared saved-server list into the QML-facing property
    /// (after adds/favourite toggles).
    fn refresh_saved_servers(self: Pin<&mut Self>) {
        let json = crate::store::saved_servers().to_string();
        self.set_saved_servers_json(QString::from(json.as_str()));
    }

    fn t(&self, key: &QString) -> QString {
        QString::from(crate::i18n::tr(&key.to_string()).as_str())
    }

    fn tr_n(&self, key: &QString, count: i32) -> QString {
        QString::from(crate::i18n::tr_n(&key.to_string(), i64::from(count)).as_str())
    }
}

/// Parse a line of markdown and convert the byte-offset spans from
/// `fancy_utils::markdown` into UTF-16 offsets for `QString::setFormat`.
pub fn md_line_spans(
    line: &str,
    in_fence: bool,
    out_fence: &mut bool,
) -> Vec<qobject::MdSpan> {
    let (spans, next_fence) = fancy_utils::markdown::line_spans(line, in_fence);
    *out_fence = next_fence;
    spans
        .iter()
        .map(|s| {
            let start16 = line[..s.start].encode_utf16().count();
            let len16 = line[s.start..s.start + s.len].encode_utf16().count();
            qobject::MdSpan {
                start: start16 as i32,
                len: len16 as i32,
                flags: s.flags,
            }
        })
        .collect()
}
