use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;
use tracing::debug;

use super::{HandleMessage, HandlerContext};
use crate::state::core_event::CoreEvent;

#[derive(Serialize, Clone)]
pub(crate) struct TypingIndicatorPayload {
    pub session: u32,
    pub channel_id: u32,
}

impl HandleMessage for mumble_tcp::FancyTypingIndicator {
    fn handle(&self, ctx: &HandlerContext) {
        let session = self.actor.unwrap_or(0);
        let channel_id = self.channel_id.unwrap_or(0);

        debug!(
            session,
            channel_id,
            raw_actor = ?self.actor,
            raw_channel_id = ?self.channel_id,
            "typing indicator handler invoked"
        );

        if session == 0 {
            debug!("typing indicator dropped: actor is 0/None");
            return;
        }

        debug!(session, channel_id, "received typing indicator");

        ctx.send(CoreEvent::TypingIndicator(TypingIndicatorPayload {
            session,
            channel_id,
        }));
    }
}
