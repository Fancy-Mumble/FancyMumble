use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::fancy;
use crate::state::ServerState;

/// Ask the server for the settings an operator may change at run time.
///
/// Epoch 0 broadcast them after `ServerSync` to whoever held root Write, so a
/// client never asked. The canon answers a question instead - the same shape
/// livery uses on the same service - and a client with no way to ask sees no
/// settings at all, which is what the administration screen reported for as
/// long as this command did not exist.
///
/// Refused unless this session holds `Write` on the root channel, silently:
/// the settings are what a server may be talked into doing, and the list of
/// them is an inventory of what to try.
#[derive(Debug, Default)]
pub struct RequestServerSettings;

impl CommandAction for RequestServerSettings {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyServerSettingsQuery(
                fancy::domain::ConfigQuery {},
            )],
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    #[test]
    fn the_question_names_nothing_because_the_answer_is_about_the_asker() {
        let output = RequestServerSettings.execute(&ServerState::default());
        match &output.tcp_messages[0] {
            ControlMessage::FancyServerSettingsQuery(_) => {}
            other => panic!("expected a settings query, got {other:?}"),
        }
    }
}
