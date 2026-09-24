use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::fancy::invites::{InvitesEnvelope, invites_envelope};
use crate::state::ServerState;

/// Ask the invites service something: what this session may do, to mint an
/// invite, to list them, or to revoke one.
///
/// Every arm carries a client-chosen `request_id` that the answer echoes. A
/// server that predates invites never answers at all, so the caller times out
/// rather than waits - see `ControlMessage::FancyInvitesRequest`.
#[derive(Debug)]
pub struct SendInvites {
    /// The request arm.
    pub body: invites_envelope::Body,
}

impl CommandAction for SendInvites {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyInvitesRequest(InvitesEnvelope {
                body: Some(self.body.clone()),
            })],
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::fancy::invites::InviteRevoke;

    #[test]
    fn sends_the_request_it_was_given() {
        let cmd = SendInvites {
            body: invites_envelope::Body::Revoke(InviteRevoke {
                request_id: "i-1".to_owned(),
                code: "abcdefghjkmn".to_owned(),
            }),
        };
        match cmd.execute(&ServerState::default()).tcp_messages.as_slice() {
            [ControlMessage::FancyInvitesRequest(envelope)] => {
                assert_eq!(envelope.body, Some(cmd.body.clone()));
            }
            other => panic!("expected one invites request, got {other:?}"),
        }
    }
}
