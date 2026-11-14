use mumble_protocol::proto::mumble_tcp;
use tracing::debug;

use super::{HandleMessage, HandlerContext};
use crate::state::core_event::CoreEvent;
use crate::state::types::WebRtcSignalPayload;

impl HandleMessage for mumble_tcp::WebRtcSignal {
    fn handle(&self, ctx: &HandlerContext) {
        debug!(
            sender = ?self.sender_session,
            target = ?self.target_session,
            signal_type = ?self.signal_type,
            "webrtc signal received"
        );

        // A native broadcaster or viewer waiting for this answer gets it; the
        // view's own dispatcher must then not see it as well.
        if ctx.claim_webrtc_signal(
            self.sender_session,
            self.signal_type.unwrap_or(0),
            self.payload.as_deref().unwrap_or(""),
        ) {
            return;
        }

        ctx.send(CoreEvent::WebRtcSignal(WebRtcSignalPayload {
            sender_session: self.sender_session,
            target_session: self.target_session,
            signal_type: self.signal_type.unwrap_or(0),
            payload: self.payload.clone().unwrap_or_default(),
        }));
    }
}
