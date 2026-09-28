use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::fancy;
use crate::state::ServerState;

/// Change the server's livery from this connection.
///
/// Only the fields named are written, because the server merges field-wise:
/// sending the whole document would let two admins editing different halves of
/// the branding overwrite each other.
///
/// No credential travels with this. The server authorises it against the
/// session the frame arrives on — `Write` on the root channel, murmur's rule
/// for every administrative write — so an admin who is connected is already
/// carrying an identity the server established at the handshake.
///
/// Artwork is not here. A banner is up to half a megabyte and the control
/// channel is the wrong pipe for it; images go through the operator API until
/// they move to the files plane.
#[derive(Debug, Default)]
pub struct UpdateLivery {
    /// Field names, as the operator API spells them.
    pub fields: Vec<String>,
    /// The document those fields are read out of. Anything not named above is
    /// ignored, so a caller may send the whole draft.
    pub values: fancy::domain::LiveryDoc,
}

impl CommandAction for UpdateLivery {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyLiveryUpdate(
                fancy::domain::LiveryUpdate {
                    fields: self.fields.clone(),
                    values: Some(self.values.clone()),
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
    fn carries_only_the_fields_it_was_given() {
        let cmd = UpdateLivery {
            fields: vec!["tagline".to_owned()],
            values: fancy::domain::LiveryDoc {
                tagline: "cozy corner".to_owned(),
                ..Default::default()
            },
        };
        match &cmd.execute(&ServerState::default()).tcp_messages[0] {
            ControlMessage::FancyLiveryUpdate(update) => {
                assert_eq!(update.fields, vec!["tagline".to_owned()]);
                assert_eq!(update.values.as_ref().unwrap().tagline, "cozy corner");
            }
            other => panic!("expected a livery update, got {other:?}"),
        }
    }

    #[test]
    fn never_carries_artwork_bytes() {
        // The document has nowhere to put them, and this is the assertion that
        // keeps it that way if somebody later adds a field that does.
        let cmd = UpdateLivery {
            fields: vec!["banner_key".to_owned()],
            values: fancy::domain::LiveryDoc {
                banner_key: "abc".to_owned(),
                ..Default::default()
            },
        };
        match &cmd.execute(&ServerState::default()).tcp_messages[0] {
            ControlMessage::FancyLiveryUpdate(update) => {
                assert!(update.values.as_ref().unwrap().art.is_empty());
            }
            other => panic!("expected a livery update, got {other:?}"),
        }
    }
}
