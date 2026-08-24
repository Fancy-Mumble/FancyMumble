use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;

use super::{HandleMessage, HandlerContext};

/// A scheduled message as delivered to the frontend.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScheduledMessagePayload {
    schedule_id: String,
    channel_ids: Vec<u32>,
    tree_ids: Vec<u32>,
    message: Option<String>,
    deliver_at: Option<u64>,
    creator_session: Option<u32>,
    creator_hash: Option<String>,
    creator_name: Option<String>,
    created_at: Option<u64>,
    /// Raw `FancyScheduledStatus` enum value (0=pending,1=delivered,2=cancelled,3=rejected).
    status: i32,
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScheduledMessageListPayload {
    messages: Vec<ScheduledMessagePayload>,
}

impl HandleMessage for mumble_tcp::FancyScheduledMessageListResponse {
    fn handle(&self, ctx: &HandlerContext) {
        ctx.emit(
            "fancy-scheduled-message-list",
            ScheduledMessageListPayload {
                messages: self
                    .messages
                    .iter()
                    .map(ScheduledMessagePayload::from)
                    .collect(),
            },
        );
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScheduledMessageAckPayload {
    schedule_id: Option<String>,
    status: i32,
    reason: Option<String>,
}

impl HandleMessage for mumble_tcp::FancyScheduledMessageAck {
    fn handle(&self, ctx: &HandlerContext) {
        ctx.emit(
            "fancy-scheduled-message-ack",
            ScheduledMessageAckPayload {
                schedule_id: self.schedule_id.clone(),
                status: self.status.unwrap_or(0),
                reason: self.reason.clone(),
            },
        );
    }
}
