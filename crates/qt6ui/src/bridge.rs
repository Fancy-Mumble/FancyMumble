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
        type Backend = super::BackendRust;

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
    core: Arc<AppCore>,
}

impl Default for BackendRust {
    fn default() -> Self {
        Self {
            status: QString::from("disconnected"),
            channels_json: QString::from("[]"),
            self_channel: -1,
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
