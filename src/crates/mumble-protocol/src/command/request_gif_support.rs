use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::fancy;
use crate::state::ServerState;

/// Ask the server whether it searches GIFs, and where its proxied media lives.
///
/// Sent once per connection, before the first search. A server that predates
/// the question never answers it, so the caller treats a timeout as "no" -
/// see `ControlMessage::FancyGifSupportQuery`.
#[derive(Debug)]
pub struct RequestGifSupport {
    /// Client-chosen correlation id, echoed on the `GifSupport` answer.
    pub request_id: String,
}

impl CommandAction for RequestGifSupport {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyGifSupportQuery(
                fancy::media::GifSupportQuery {
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
        let cmd = RequestGifSupport {
            request_id: "g-1".to_owned(),
        };
        match cmd.execute(&ServerState::default()).tcp_messages.as_slice() {
            [ControlMessage::FancyGifSupportQuery(query)] => {
                assert_eq!(query.request_id, "g-1");
            }
            other => panic!("expected one gif support query, got {other:?}"),
        }
    }
}
