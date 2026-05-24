use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Announce a new poll in a channel.  Server validates the sender,
/// stamps `creator_session`, and relays to every other Fancy client
/// currently in the channel.
#[derive(Debug)]
pub struct SendFancyPoll {
    /// Channel to announce the poll in.
    pub channel_id: u32,
    /// Client-generated unique poll identifier (UUID v4 recommended).
    pub poll_id: String,
    /// Poll question.
    pub question: String,
    /// Answer options, presented in the order given.
    pub options: Vec<String>,
    /// Whether voters may pick multiple options.
    pub multiple: bool,
    /// ISO-8601 timestamp the client created the poll at.
    pub created_at: String,
}

impl CommandAction for SendFancyPoll {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyPoll(mumble_tcp::FancyPoll {
                channel_id: Some(self.channel_id),
                poll_id: Some(self.poll_id.clone()),
                question: Some(self.question.clone()),
                options: self.options.clone(),
                multiple: Some(self.multiple),
                creator_session: None,
                creator_name: None,
                created_at: Some(self.created_at.clone()),
            })],
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "unwrap/expect are idiomatic in tests"
    )]
    use super::*;
    use crate::transport::codec::{decode, encode};
    use bytes::BytesMut;

    #[test]
    fn fancy_poll_encodes_with_native_message_type() {
        let cmd = SendFancyPoll {
            channel_id: 7,
            poll_id: "abc-123".into(),
            question: "Lunch?".into(),
            options: vec!["Pizza".into(), "Salad".into()],
            multiple: false,
            created_at: "2025-01-01T00:00:00Z".into(),
        };
        let out = cmd.execute(&ServerState::new());
        let msg = out.tcp_messages.first().expect("one tcp message");
        let bytes = encode(msg).expect("encode succeeds");
        let mut buf = BytesMut::from(&bytes[..]);
        let decoded = decode(&mut buf)
            .expect("decode succeeds")
            .expect("frame complete");
        match decoded {
            ControlMessage::FancyPoll(p) => {
                assert_eq!(p.channel_id, Some(7));
                assert_eq!(p.poll_id.as_deref(), Some("abc-123"));
                assert_eq!(p.question.as_deref(), Some("Lunch?"));
                assert_eq!(p.options, vec!["Pizza".to_string(), "Salad".to_string()]);
                assert_eq!(p.multiple, Some(false));
                assert!(p.creator_session.is_none(), "server stamps creator_session");
            }
            other => panic!("expected FancyPoll, got {other:?}"),
        }
    }
}