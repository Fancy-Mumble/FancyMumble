use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Schedule a text message for future delivery to one or more channels.
///
/// The server stores the message and delivers it as a normal text message to
/// the target channel(s) at `deliver_at`, then acknowledges with a
/// `FancyScheduledMessageAck`.
#[derive(Debug)]
pub struct SendFancyScheduledMessage {
    /// Target channel ids (message posted to each).
    pub channel_ids: Vec<u32>,
    /// Target channel tree roots (message posted to the whole tree).
    pub tree_ids: Vec<u32>,
    /// Message body.
    pub message: String,
    /// Delivery time as Unix epoch milliseconds.
    pub deliver_at: u64,
}

impl CommandAction for SendFancyScheduledMessage {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        let msg = mumble_tcp::FancyScheduledMessage {
            channel_id: self.channel_ids.clone(),
            tree_id: self.tree_ids.clone(),
            message: Some(self.message.clone()),
            deliver_at: Some(self.deliver_at),
            ..Default::default()
        };
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyScheduledMessage(msg)],
            ..Default::default()
        }
    }
}

/// Request the caller's own pending scheduled messages.
#[derive(Debug)]
pub struct RequestFancyScheduledMessages;

impl CommandAction for RequestFancyScheduledMessages {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyScheduledMessageList(
                mumble_tcp::FancyScheduledMessageList {},
            )],
            ..Default::default()
        }
    }
}

/// Cancel a pending scheduled message by id.
#[derive(Debug)]
pub struct SendFancyScheduledMessageCancel {
    /// The schedule id to cancel.
    pub schedule_id: String,
}

impl CommandAction for SendFancyScheduledMessageCancel {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        let msg = mumble_tcp::FancyScheduledMessageCancel {
            schedule_id: Some(self.schedule_id.clone()),
        };
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyScheduledMessageCancel(msg)],
            ..Default::default()
        }
    }
}
