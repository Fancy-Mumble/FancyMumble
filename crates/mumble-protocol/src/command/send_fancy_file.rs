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
    /// Who should be able to reach the file once it is up.
    pub visibility: fancy::files::Visibility,
    /// How long the share should last, in seconds. `0` means never expires.
    pub ttl_seconds: u64,
    /// The password for a password share, and empty for the other two.
    ///
    /// Sent once and never again: the server keeps a hash to check guesses
    /// against and derives the file's encryption key from the same secret, so
    /// nothing here can be asked for a second time.
    pub password: String,
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
                    visibility: self.visibility as i32,
                    ttl_seconds: self.ttl_seconds,
                    password: self.password.clone(),
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

/// Ask for the caller's own uploads, or for every one of them.
///
/// One command for both because they are the same question asked with a
/// different reach: what a person may manage. The server decides which of the
/// two the asker may have.
#[derive(Debug)]
pub struct SendFancyFileManage {
    /// Correlates the answer. Minted by the caller.
    pub request_id: String,
    /// Whose files, as the canon's `Audience`.
    pub audience: fancy::files::Audience,
    /// How many to return. The server caps this whatever is asked.
    pub limit: u32,
}

impl CommandAction for SendFancyFileManage {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyFileManage(
                fancy::files::ManageRequest {
                    request_id: self.request_id.clone(),
                    audience: self.audience as i32,
                    limit: self.limit,
                },
            )],
            ..Default::default()
        }
    }
}

/// Ask for one stored file to be removed.
#[derive(Debug)]
pub struct SendFancyFileForget {
    /// Correlates the answer. Minted by the caller.
    pub request_id: String,
    /// The stored key, as it arrived in a listing.
    pub key: String,
}

impl CommandAction for SendFancyFileForget {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyFileForget(
                fancy::files::ForgetRequest {
                    request_id: self.request_id.clone(),
                    key: self.key.clone(),
                },
            )],
            ..Default::default()
        }
    }
}
