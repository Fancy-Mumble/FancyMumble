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

        include!("cxx-qt-lib/qimage.h");
        /// Qt's image type (from cxx-qt-lib); decode/scale are exposed by
        /// the wrapper, the encode leaves below come from cpp/image_codec.
        type QImage = cxx_qt_lib::QImage;

        include!("image_codec.h");
        /// Encode `img` as JPEG at `quality` (1-100); raw base64, no
        /// `data:` prefix. Empty when encoding fails.
        pub fn image_to_jpeg_base64(img: &QImage, quality: i32) -> QString;
        /// Base64-encode raw bytes (pass-through image path).
        pub fn bytes_to_base64(bytes: &[u8]) -> QString;
        /// Persist a data URL's payload into the per-process spill dir and
        /// return the file path (empty on failure). See media::spill_images.
        pub fn data_url_to_spill_file(data_url: &QString) -> QString;
        /// Save an image to a file (format from the extension); used for
        /// the on-disk thumbnails of large spilled images.
        pub fn qimage_save_file(img: &QImage, path: &QString, quality: i32) -> bool;
        /// Local path for the clipboard's image (copied file path or a
        /// temp PNG of raster data); empty when none. GUI thread only.
        pub fn clipboard_image_path() -> QString;
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

        /// Send staged image files (`paths_json`: JSON array of local file
        /// paths) as one gallery, captioned by `caption` (markdown).
        /// `compressed` picks the smaller per-image byte budget - the same
        /// Full quality / Compressed toggle as the web client's tray.
        #[qinvokable]
        fn send_images(
            self: Pin<&mut Backend>,
            paths_json: &QString,
            caption: &QString,
            compressed: bool,
        );

        /// Local path for an image on the clipboard (empty when none);
        /// backs Ctrl+V image paste in the composer.
        #[qinvokable]
        fn paste_image_path(self: Pin<&mut Backend>) -> QString;

        /// Ask the server for a user's stats; the answer arrives via the
        /// `user_stats` signal (hover card's online/idle pills).
        #[qinvokable]
        fn request_user_stats(self: Pin<&mut Backend>, session: i32);

        /// Set our avatar from a local image file (empty path clears it).
        #[qinvokable]
        fn set_avatar(self: Pin<&mut Backend>, path: &QString);

        /// Publish our Fancy profile (settings page): status line, banner
        /// color/image (local file path, "" = none) and bio (markdown).
        /// Unedited profile fields are preserved.
        #[qinvokable]
        fn save_profile(
            self: Pin<&mut Backend>,
            status: &QString,
            banner_color: &QString,
            banner_image_path: &QString,
            bio: &QString,
        );

        /// Move ourselves into the channel with the given id.
        #[qinvokable]
        fn join_channel(self: Pin<&mut Backend>, channel_id: i32);

        /// Enable (un-mute/un-deafen + start mic) or disable voice.
        #[qinvokable]
        fn set_voice_enabled(self: Pin<&mut Backend>, enabled: bool);

        /// Start the env-gated e2e control channel (see `src/e2e.rs`).
        /// Called once from QML `Component.onCompleted`; a no-op unless
        /// `FANCY_QT6UI_E2E_PORT` is set.
        #[qinvokable]
        fn e2e_start(self: Pin<&mut Backend>);

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
        /// `images` is a JSON array of displayable image sources
        /// (data:/http(s) URLs) extracted from the HTML body.
        #[qsignal]
        fn chat_message(
            self: Pin<&mut Backend>,
            channel: QString,
            sender: QString,
            text: QString,
            images: QString,
        );

        /// Emitted for user-facing log/diagnostic lines.
        #[qsignal]
        fn log_message(self: Pin<&mut Backend>, line: QString);

        /// A user's server stats (seconds; -1 = unknown), answering
        /// `request_user_stats`.
        #[qsignal]
        fn user_stats(
            self: Pin<&mut Backend>,
            session: i32,
            onlinesecs: i32,
            idlesecs: i32,
        );
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
    /// `pub(crate)` so the e2e control channel drives the same code path.
    pub(crate) fn connect_to_server(
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

    /// `pub(crate)` so the e2e control channel drives the same code path.
    pub(crate) fn disconnect_from_server(self: Pin<&mut Self>) {
        self.core.clone().disconnect();
    }

    /// Start the e2e control channel (no-op without `FANCY_QT6UI_E2E_PORT`).
    fn e2e_start(self: Pin<&mut Self>) {
        crate::e2e::maybe_start(self.qt_thread());
    }

    fn send_message(self: Pin<&mut Self>, text: &QString) {
        let text = text.to_string();
        if !text.trim().is_empty() {
            self.core.clone().send_message(text);
        }
    }

    fn send_images(
        self: Pin<&mut Self>,
        paths_json: &QString,
        caption: &QString,
        compressed: bool,
    ) {
        let paths: Vec<String> =
            serde_json::from_str(&paths_json.to_string()).unwrap_or_default();
        if !paths.is_empty() {
            self.core.clone().send_images(paths, caption.to_string(), compressed);
        }
    }

    fn paste_image_path(self: Pin<&mut Self>) -> QString {
        qobject::clipboard_image_path()
    }

    fn request_user_stats(self: Pin<&mut Self>, session: i32) {
        if session >= 0 {
            self.core.clone().request_user_stats(session as u32);
        }
    }

    fn set_avatar(self: Pin<&mut Self>, path: &QString) {
        self.core.clone().set_avatar(path.to_string());
    }

    fn save_profile(
        self: Pin<&mut Self>,
        status: &QString,
        banner_color: &QString,
        banner_image_path: &QString,
        bio: &QString,
    ) {
        self.core.clone().save_profile(
            status.to_string(),
            banner_color.to_string(),
            banner_image_path.to_string(),
            bio.to_string(),
        );
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
        // Update the property synchronously (this drives the UI) but persist
        // off the Qt thread: writing preferences.json (read + parse +
        // serialize + write) must never block the toggle. store's write lock
        // keeps concurrent toggles from racing the file.
        self.as_mut().set_hide_empty_channels(enabled);
        std::thread::spawn(move || crate::store::set_hide_empty_channels(enabled));
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
