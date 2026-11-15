use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;

use super::{HandleMessage, HandlerContext};
use crate::state::core_event::CoreEvent;

/// A scheduled message as delivered to the frontend.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScheduledMessagePayload {
    pub schedule_id: String,
    pub channel_ids: Vec<u32>,
    pub tree_ids: Vec<u32>,
    pub message: Option<String>,
    pub deliver_at: Option<u64>,
    pub creator_session: Option<u32>,
    pub creator_hash: Option<String>,
    pub creator_name: Option<String>,
    pub created_at: Option<u64>,
    /// Raw `FancyScheduledStatus` enum value (0=pending,1=delivered,2=cancelled,3=rejected).
    pub status: i32,
}

impl From<&mumble_tcp::FancyScheduledMessage> for ScheduledMessagePayload {
    fn from(m: &mumble_tcp::FancyScheduledMessage) -> Self {
        ScheduledMessagePayload {
            schedule_id: m.schedule_id.clone().unwrap_or_default(),
            channel_ids: m.channel_id.clone(),
            tree_ids: m.tree_id.clone(),
            message: m.message.clone(),
            deliver_at: m.deliver_at,
            creator_session: m.creator_session,
            creator_hash: m.creator_hash.clone(),
            creator_name: m.creator_name.clone(),
            created_at: m.created_at,
            status: m.status.unwrap_or(0),
        }
    }
}

impl HandleMessage for mumble_tcp::FancyScheduledMessageListResponse {
    fn handle(&self, ctx: &HandlerContext) {
        ctx.send(CoreEvent::ScheduledMessages(
            self.messages
                .iter()
                .map(ScheduledMessagePayload::from)
                .collect(),
        ));
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScheduledMessageAckPayload {
    pub schedule_id: Option<String>,
    pub status: i32,
    pub reason: Option<String>,
}

impl HandleMessage for mumble_tcp::FancyScheduledMessageAck {
    fn handle(&self, ctx: &HandlerContext) {
        ctx.send(CoreEvent::ScheduledMessageAck(ScheduledMessageAckPayload {
            schedule_id: self.schedule_id.clone(),
            status: self.status.unwrap_or(0),
            reason: self.reason.clone(),
        }));
    }
}
