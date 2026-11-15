//! The client's half of the account record store: read, write, list.
//!
//! Records are what an account keeps on the server for itself and nobody
//! else - a document library, a citation list, a calendar. They ride outer
//! type 1003 beside the account self-service surface, for the same reason
//! that surface names no account: the server answers about whoever sent the
//! frame, so a client cannot ask after somebody else's.
//!
//! Each carries a `request_id` the caller mints. The server's answers arrive
//! as unordered pushes, and a client that opens its library and its calendar
//! at once has two in flight; the id is what says which answer is which.

use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::fancy;
use crate::state::ServerState;

/// Ask for one stored record.
#[derive(Debug)]
pub struct SendFancyRecordGet {
    /// Correlates the answer. Minted by the caller.
    pub request_id: String,
    /// Which record, in the caller's own namespace.
    pub key: String,
}

impl CommandAction for SendFancyRecordGet {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyAccountRecordGet(
                fancy::domain::RecordGet {
                    request_id: self.request_id.clone(),
                    key: self.key.clone(),
                },
            )],
            ..Default::default()
        }
    }
}

/// Store one record, or remove it.
#[derive(Debug)]
pub struct SendFancyRecordPut {
    /// Correlates the answer. Minted by the caller.
    pub request_id: String,
    /// Which record.
    pub key: String,
    /// The bytes to store. Ignored when `remove` is set.
    pub value: Vec<u8>,
    /// Remove the record rather than write it.
    ///
    /// Explicit, because an empty value is a legitimate thing to store: a
    /// library the user has just emptied is not the same as one that was
    /// never there, and the difference decides what the next read means.
    pub remove: bool,
}

impl CommandAction for SendFancyRecordPut {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyAccountRecordPut(
                fancy::domain::RecordPut {
                    request_id: self.request_id.clone(),
                    key: self.key.clone(),
                    value: self.value.clone(),
                    remove: self.remove,
                },
            )],
            ..Default::default()
        }
    }
}

/// Ask which records exist under a prefix.
#[derive(Debug)]
pub struct SendFancyRecordList {
    /// Correlates the answer. Minted by the caller.
    pub request_id: String,
    /// The prefix. Empty lists everything this account has stored.
    pub prefix: String,
}

impl CommandAction for SendFancyRecordList {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyAccountRecordList(
                fancy::domain::RecordList {
                    request_id: self.request_id.clone(),
                    prefix: self.prefix.clone(),
                },
            )],
            ..Default::default()
        }
    }
}
