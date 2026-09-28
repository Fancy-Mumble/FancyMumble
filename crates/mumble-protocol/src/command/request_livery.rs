use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::fancy;
use crate::state::ServerState;

/// Ask the server what it looks like, naming the artwork already held.
///
/// `have_keys` are content hashes from a previous document. The server replies
/// with the whole document but only the images whose key is not named here, so
/// an operator editing a motto costs a few hundred bytes rather than the banner
/// again. That is the entire reason a livery carries content keys instead of
/// bytes, and sending an empty list asks for everything.
#[derive(Debug, Default)]
pub struct RequestLivery {
    /// Content keys this client already has cached.
    pub have_keys: Vec<String>,
}

impl CommandAction for RequestLivery {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyLiveryQuery(
                fancy::domain::LiveryQuery {
                    have_keys: self.have_keys.clone(),
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
    fn asks_for_everything_when_nothing_is_cached() {
        let output = RequestLivery::default().execute(&ServerState::default());
        match &output.tcp_messages[0] {
            ControlMessage::FancyLiveryQuery(query) => assert!(query.have_keys.is_empty()),
            other => panic!("expected a livery query, got {other:?}"),
        }
    }

    #[test]
    fn names_what_it_already_holds_so_the_reply_can_leave_it_out() {
        let cmd = RequestLivery {
            have_keys: vec!["aa".to_owned(), "bb".to_owned()],
        };
        match &cmd.execute(&ServerState::default()).tcp_messages[0] {
            ControlMessage::FancyLiveryQuery(query) => {
                assert_eq!(query.have_keys, vec!["aa".to_owned(), "bb".to_owned()]);
            }
            other => panic!("expected a livery query, got {other:?}"),
        }
    }
}
