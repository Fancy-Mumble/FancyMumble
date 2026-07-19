use mumble_protocol::proto::mumble_tcp;
use tracing::debug;

use super::{HandleMessage, HandlerContext};
use crate::state::types::WebRtcSignalPayload;

impl HandleMessage for mumble_tcp::WebRtcSignal {
    fn handle(&self, ctx: &HandlerContext) {
        debug!(
            sender = ?self.sender_session,
            target = ?self.target_session,
            signal_type = ?self.signal_type,
            "webrtc signal received"
        );

        // When the Rust broadcaster is waiting for the SFU's answer, that
        // answer belongs to it, not to the webview's viewer dispatcher.
        #[cfg(not(target_os = "android"))]
        if crate::commands::screenshare::try_intercept_answer(
            self.signal_type.unwrap_or(0),
            self.payload.as_deref().unwrap_or(""),
        ) {
            return;
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
            self.sender_session,
            self.signal_type.unwrap_or(0),
            self.payload.as_deref().unwrap_or(""),
        ) {
            return;
        }

        ctx.emit(
            "webrtc-signal",
            WebRtcSignalPayload {
                sender_session: self.sender_session,
                target_session: self.target_session,
                signal_type: self.signal_type.unwrap_or(0),
                payload: self.payload.clone().unwrap_or_default(),
            },
        );
    }
}
