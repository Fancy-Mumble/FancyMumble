use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Move self to a different channel.
#[derive(Debug)]
pub struct JoinChannel {
    /// The channel to move into.
    pub channel_id: u32,
    /// Optional password for entering a password-protected channel.
    /// Sent as `temporary_access_tokens` in the `UserState` message.
    pub password: Option<String>,
}

impl CommandAction for JoinChannel {
    fn execute(&self, state: &ServerState) -> CommandOutput {
        let temporary_access_tokens = self
            .password
            .iter()
            .filter(|p| !p.is_empty())
            .cloned()
            .collect();
        let msg = mumble_tcp::UserState {
            session: state.own_session(),
            channel_id: Some(self.channel_id),
            temporary_access_tokens,
            ..Default::default()
        };
        CommandOutput {
            tcp_messages: vec![ControlMessage::UserState(msg)],
            ..Default::default()
        }
    }
}
