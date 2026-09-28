use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::fancy;
use crate::state::ServerState;

/// Ask the server for a short-lived operator credential.
///
/// No credential travels with this either, for the same reason
/// [`super::UpdateLivery`] carries none: the server authorises the request
/// against the session this frame arrives on, granting each requested scope
/// only where that session's live permission already covers the equivalent
/// control-channel action. The reply may grant fewer scopes than were asked
/// for, or none at all.
#[derive(Debug, Default)]
pub struct RequestOperatorTicket {
    /// Scopes as the operator API names them, e.g. `server-config:write`.
    pub scopes: Vec<String>,
}

impl CommandAction for RequestOperatorTicket {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyOperatorTicketRequest(
                fancy::domain::OperatorTicketRequest {
                    scopes: self.scopes.clone(),
                },
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
    fn carries_the_requested_scopes_and_nothing_else() {
        let cmd = RequestOperatorTicket {
            scopes: vec!["server-config:write".to_owned()],
        };
        match &cmd.execute(&ServerState::default()).tcp_messages[0] {
            ControlMessage::FancyOperatorTicketRequest(request) => {
                assert_eq!(request.scopes, vec!["server-config:write".to_owned()]);
            }
            other => panic!("expected a ticket request, got {other:?}"),
        }
    }
}
