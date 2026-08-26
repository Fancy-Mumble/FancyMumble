//! Inbound handlers for the canon file service.
//!
//! Two kinds of message arrive here. A `Grant` or a `Refused` is the answer to
//! something this client asked for, and goes back to whichever upload is
//! waiting on it - see [`crate::state::starling_files`] for why the transfer
//! itself never leaves the backend. A `Share` or a `Listing` is news: a file
//! exists in a channel, and everyone in it is told, including the person who
//! uploaded it.
//!
//! The uploader hearing its own share is not redundant. It is how the client
//! learns the final key and the size that actually arrived, rather than the
//! ones it hoped for.

use mumble_protocol::proto::fancy;
use serde::Serialize;
use tracing::debug;

use super::{HandleMessage, HandlerContext};
use crate::state::starling_files::GrantOutcome;

/// One shared file, as the frontend needs it.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct SharedFile {
    /// The stored key. What a download is asked for by.
    pub key: String,
    #[serde(rename = "channelId")]
    pub channel_id: u32,
    /// Session of whoever shared it.
    pub owner: u32,
    pub filename: String,
    /// Size as stored, which is the size that arrived rather than the size
    /// the uploader claimed before sending it.
    pub size: u64,
    #[serde(rename = "sharedAtMs")]
    pub shared_at_ms: u64,
    /// Whether the link works for anyone who has it.
    pub public: bool,
}

impl From<&fancy::files::Share> for SharedFile {
    fn from(share: &fancy::files::Share) -> Self {
        Self {
            key: share.key.clone(),
            channel_id: share.channel,
            owner: share.owner,
            filename: share.filename.clone(),
            size: share.size,
            shared_at_ms: share.shared_at_ms,
            public: share.public,
        }
    }
}

/// The files in one channel, as one event.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct ChannelFiles {
    #[serde(rename = "channelId")]
    pub channel_id: u32,
    pub files: Vec<SharedFile>,
}

impl HandleMessage for fancy::files::Grant {
    fn handle(&self, ctx: &HandlerContext) {
        debug!(request_id = %self.request_id, "received a file grant");
        if let Ok(mut state) = ctx.shared.lock() {
            state.starling_files.set_available(true);
            state.starling_files.resolve(
                &self.request_id,
                GrantOutcome::Granted(Box::new(self.clone())),
            );
        }
    }
}

impl HandleMessage for fancy::files::Refused {
    fn handle(&self, ctx: &HandlerContext) {
        // A refusal is still proof the service is there, and a refused upload
        // must not leave the composer waiting out a timeout for a URL that is
        // never coming.
        let reason = self
            .refusal
            .as_ref()
            .map_or_else(|| "the server refused the file".to_owned(), reason_of);
        debug!(request_id = %self.request_id, %reason, "a file request was refused");
        if let Ok(mut state) = ctx.shared.lock() {
            state.starling_files.set_available(true);
            state
                .starling_files
                .resolve(&self.request_id, GrantOutcome::Refused(reason));
        }
    }
}

impl HandleMessage for fancy::files::Share {
    fn handle(&self, ctx: &HandlerContext) {
        if let Ok(mut state) = ctx.shared.lock() {
            state.starling_files.set_available(true);
        }
        ctx.emit("starling-file-shared", SharedFile::from(self));
    }
}

impl HandleMessage for fancy::files::Listing {
    fn handle(&self, ctx: &HandlerContext) {
        // The probe's answer. An empty listing still says yes: the question was
        // whether the server does files, not whether this channel has any.
        if let Ok(mut state) = ctx.shared.lock() {
            state.starling_files.set_available(true);
        }
        ctx.emit(
            "starling-file-listing",
            ChannelFiles {
                channel_id: self.channel,
                files: self.files.iter().map(SharedFile::from).collect(),
            },
        );
    }
}

/// A refusal as a sentence, preferring the server's own words.
///
/// The kind is the fallback rather than the answer: it exists so a client can
/// decide whether retrying is worth it, and "LIMIT" on its own tells a person
/// nothing about which limit they hit.
fn reason_of(refusal: &fancy::wire::Refusal) -> String {
    if !refusal.detail.is_empty() {
        return refusal.detail.clone();
    }
    match fancy::wire::refusal::Kind::try_from(refusal.kind) {
        Ok(fancy::wire::refusal::Kind::Permission) => {
            "you are not allowed to share files here".to_owned()
        }
        Ok(fancy::wire::refusal::Kind::Limit) => "the file is too large for this server".to_owned(),
        Ok(fancy::wire::refusal::Kind::Invalid) => {
            "the server could not read the request".to_owned()
        }
        Ok(fancy::wire::refusal::Kind::RateLimited) => {
            "too many uploads at once; try again shortly".to_owned()
        }
        _ => "the server refused the file".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_refusal_says_the_servers_own_words_when_it_has_any() {
        assert_eq!(
            reason_of(&fancy::wire::Refusal {
                kind: fancy::wire::refusal::Kind::Limit as i32,
                detail: "files over 1024 bytes are not accepted here".to_owned(),
                retry_after_ms: 0,
            }),
            "files over 1024 bytes are not accepted here"
        );
    }

    #[test]
    fn a_bare_kind_still_becomes_a_sentence() {
        // "LIMIT" in a toast tells nobody which limit they hit, and an empty
        // string tells them less.
        let sentence = reason_of(&fancy::wire::Refusal {
            kind: fancy::wire::refusal::Kind::Permission as i32,
            detail: String::new(),
            retry_after_ms: 0,
        });
        assert!(sentence.contains("not allowed"), "got {sentence}");
    }
}
