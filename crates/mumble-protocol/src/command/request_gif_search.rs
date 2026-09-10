use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::fancy;
use crate::state::ServerState;

/// Ask the server to search its GIF provider.
///
/// The server holds the API key, so this is the only path that works on a
/// server the user has no key of their own for - which is almost every user.
/// The picker falls back to a personal key only when the server answers
/// `UNAVAILABLE`; see `ControlMessage::FancyGifRefused`.
#[derive(Debug)]
pub struct RequestGifSearch {
    /// What to search for. Empty asks for trending, which is what a picker
    /// shows before anybody has typed.
    pub query: String,
    /// 1-based, as the provider counts.
    pub page: u32,
    /// Client-chosen correlation id, so an answer to a query somebody has
    /// already typed past can be discarded rather than rendered.
    pub request_id: String,
}

impl CommandAction for RequestGifSearch {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyGifQuery(fancy::media::GifQuery {
                request_id: self.request_id.clone(),
                query: self.query.clone(),
                page: self.page,
            })],
            ..Default::default()
        }
    }
}
