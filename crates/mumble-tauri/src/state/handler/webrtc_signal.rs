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
