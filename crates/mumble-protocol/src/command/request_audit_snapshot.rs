use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::fancy;
use crate::state::ServerState;

/// Ask for the avatar or comment an `audit.profile` entry kept.
///
/// Authorised server-side like every audit read, by `Write` on the root
/// channel; an unauthorised ask is answered with silence.
#[derive(Debug, Default)]
pub struct RequestAuditSnapshot {
    /// The entry's id, as the server named it.
    pub entry_id: String,
    /// Echoed on the reply.
    pub query_id: String,
}

impl CommandAction for RequestAuditSnapshot {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyAuditSnapshotQuery(
                fancy::feature::SnapshotQuery {
                    entry_id: self.entry_id.clone(),
                    query_id: self.query_id.clone(),
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
    fn names_the_entry_and_the_correlation_id() {
        let cmd = RequestAuditSnapshot {
            entry_id: "0192-abc".to_owned(),
            query_id: "s-1".to_owned(),
        };
        match &cmd.execute(&ServerState::default()).tcp_messages[0] {
            ControlMessage::FancyAuditSnapshotQuery(query) => {
                assert_eq!(query.entry_id, "0192-abc");
                assert_eq!(query.query_id, "s-1");
            }
            other => panic!("expected a snapshot query, got {other:?}"),
        }
    }
}
