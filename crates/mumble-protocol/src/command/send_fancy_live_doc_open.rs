use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Request the server's live-doc plugin to open (or re-attach to) a
/// collaborative document in a channel.  The server replies with a
/// [`mumble_tcp::FancyLiveDocInvite`].
#[derive(Debug)]
pub struct SendFancyLiveDocOpen {
    /// Channel the document belongs to.
    pub channel_id: u32,
    /// URL-safe slug identifying the document inside the channel.
    pub slug: String,
    /// Human-readable title.
    pub title: String,
}

impl CommandAction for SendFancyLiveDocOpen {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyLiveDocOpen(
                mumble_tcp::FancyLiveDocOpen {
                    channel_id: Some(self.channel_id),
                    slug: Some(self.slug.clone()),
                    title: Some(self.title.clone()),
                },
            )],
            ..Default::default()
        }
    }
}
