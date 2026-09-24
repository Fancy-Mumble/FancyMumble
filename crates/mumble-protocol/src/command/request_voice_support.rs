use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::fancy;
use crate::state::ServerState;

/// Ask the server whether it takes voice messages, and how long and large one
/// may be.
///
/// Sent once per connection. A server that predates voice messages never
/// answers, so no answer is "no" - see `ControlMessage::FancyVoiceSupportQuery`.
#[derive(Debug)]
pub struct RequestVoiceSupport {
    /// Client-chosen correlation id, echoed on the `VoiceSupport` answer.
    pub request_id: String,
}

impl CommandAction for RequestVoiceSupport {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyVoiceSupportQuery(
                fancy::files::VoiceSupportQuery {
                    request_id: self.request_id.clone(),
                },
            )],
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn carries_the_correlation_id() {
        let cmd = RequestVoiceSupport {
            request_id: "v-1".to_owned(),
        };
        match cmd.execute(&ServerState::default()).tcp_messages.as_slice() {
            [ControlMessage::FancyVoiceSupportQuery(query)] => {
                assert_eq!(query.request_id, "v-1");
            }
            other => panic!("expected one voice support query, got {other:?}"),
        }
    }
}
