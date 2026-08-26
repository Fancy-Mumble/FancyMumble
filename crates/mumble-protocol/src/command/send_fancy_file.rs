//! The client's half of the file handshake: three asks, no bytes.
//!
//! Every command here is a *request for a URL*. The object itself never
//! crosses the control connection - that is the whole point of outer type
//! 1009, because a hundred-megabyte upload framed as a control message would
//! head-of-line block every ping, mute and text message behind it.
//!
//! Each carries a `request_id` the caller mints, because more than one upload
//! can be in flight and the server's answers arrive as unordered pushes: the
//! id is what says which `Grant` belongs to which file.

use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::fancy;
use crate::state::ServerState;

/// Ask for a URL to write one file to.
///
/// The size is stated up front so the server can refuse before a byte moves,
/// rather than after: an upload cut off at the ceiling has already cost the
/// user the whole transfer.
#[derive(Debug)]
pub struct SendFancyFileUpload {
    /// Correlates the answer. Minted by the caller.
    pub request_id: String,
    /// Where the file is being shared.
    pub channel_id: u32,
    /// The name as the user knows it. The server derives the stored key.
    pub filename: String,
    /// What the file is, as the client sniffed it; stored and served back.
    pub content_type: String,
    /// How many bytes are coming. Checked against the grant at `PUT` time.
    pub size: u64,
}

impl CommandAction for SendFancyFileUpload {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyFileUpload(
                fancy::files::UploadRequest {
                    request_id: self.request_id.clone(),
                    channel: self.channel_id,
                    filename: self.filename.clone(),
                    content_type: self.content_type.clone(),
                    size: self.size,
                    // Left empty: this client does not hash before uploading, and
                    // sending a digest it did not compute would be a claim the
                    // server would be right to check and find wrong.
                    sha256: Vec::new(),
                },
            )],
            ..Default::default()
        }
    }
}

/// Ask for a URL to read one object from.
#[derive(Debug)]
pub struct SendFancyFileDownload {
    /// Correlates the answer. Minted by the caller.
    pub request_id: String,
    /// The stored key, as it arrived on a `Share` or in a listing.
    pub key: String,
}

impl CommandAction for SendFancyFileDownload {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyFileDownload(
                fancy::files::DownloadRequest {
                    request_id: self.request_id.clone(),
                    key: self.key.clone(),
                },
            )],
            ..Default::default()
        }
    }
}

/// Ask what has been shared in a channel.
///
/// Also how this client finds out whether the server does files at all: a
/// server without the service never answers, and one with it answers even for
/// an empty channel.
#[derive(Debug)]
pub struct SendFancyFileList {
    /// Whose shared files to list.
    pub channel_id: u32,
    /// How many to return. The server caps this whatever is asked.
    pub limit: u32,
}

impl CommandAction for SendFancyFileList {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyFileList(fancy::files::ListRequest {
                channel: self.channel_id,
                limit: self.limit,
                before_key: String::new(),
            })],
            ..Default::default()
        }
    }
}
