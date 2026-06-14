use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Cast a vote on an existing poll.  Server validates the sender,
/// stamps `voter_session`, and relays to every other Fancy client in
/// the channel.
#[derive(Debug)]
pub struct SendFancyPollVote {
    /// Channel the poll lives in.
    pub channel_id: u32,
    /// Poll identifier to vote on.
    pub poll_id: String,
    /// Zero-based indices into the poll's option list.
    pub selected: Vec<u32>,
}

impl CommandAction for SendFancyPollVote {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyPollVote(
                mumble_tcp::FancyPollVote {
                    channel_id: Some(self.channel_id),
                    poll_id: Some(self.poll_id.clone()),
                    selected: self.selected.clone(),
                    voter_session: None,
                    voter_name: None,
                },
            )],
            ..Default::default()
        }
    }
}
