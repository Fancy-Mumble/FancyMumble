use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Announce a live-doc to channel peers.  The server validates the
/// sender, stamps `opener_session`, and relays to every other Fancy
/// client in the channel.
#[derive(Debug)]
pub struct SendFancyLiveDocAnnounce {
    /// Channel to announce in.
    pub channel_id: u32,
    /// URL-safe slug identifying the document.
    pub slug: String,
    /// Human-readable title.
    pub title: String,
}

impl CommandAction for SendFancyLiveDocAnnounce {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyLiveDocAnnounce(
                mumble_tcp::FancyLiveDocAnnounce {
                    channel_id: Some(self.channel_id),
                    slug: Some(self.slug.clone()),
                    title: Some(self.title.clone()),
                    opener_session: None,
                    opener_name: None,
                },
            )],
            ..Default::default()
        }
    }
}
