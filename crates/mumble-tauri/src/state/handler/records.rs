//! Answers from the account record store.
//!
//! Both bodies carry the `request_id` the ask was sent with, and every one of
//! them is proof the server has the store: a refusal is an answer too, and a
//! client that treated it as absence would make the next read wait out the
//! whole timeout again.

use mumble_protocol::proto::fancy;
use tracing::debug;

use super::{HandleMessage, HandlerContext};
use crate::state::read_sync::{self, Read};
use crate::state::records::RecordOutcome;
use crate::state::types::{DmUnreadPayload, UnreadPayload};

/// A record another device of this account changed, as the frontend hears of
/// it. Settings and the saved-server list listen for their own keys.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RecordChanged {
    key: String,
    /// UTF-8, or `None` for bytes that are not; every record this client keeps
    /// is a JSON document.
    value: Option<String>,
    found: bool,
    updated_at_ms: u64,
}

impl HandleMessage for fancy::domain::Record {
    fn handle(&self, ctx: &HandlerContext) {
        debug!(request_id = %self.request_id, found = self.found, "received a record");
        // Unasked: another session of this account changed it.
        if self.request_id.is_empty() {
            changed_elsewhere(self, ctx);
            return;
        }
        let outcome = match self.refused.as_ref() {
            Some(refusal) => RecordOutcome::Refused(reason_of(refusal)),
            None => RecordOutcome::Record(Box::new(self.clone())),
        };
        if let Ok(mut state) = ctx.shared.lock() {
            state.records.set_available(true);
            state.records.resolve(&self.request_id, outcome);
        }
    }
}

impl HandleMessage for fancy::domain::RecordKeys {
    fn handle(&self, ctx: &HandlerContext) {
        debug!(request_id = %self.request_id, keys = self.keys.len(), "received record keys");
        let outcome = match self.refused.as_ref() {
            Some(refusal) => RecordOutcome::Refused(reason_of(refusal)),
            None => RecordOutcome::Keys(self.keys.clone()),
        };
        if let Ok(mut state) = ctx.shared.lock() {
            state.records.set_available(true);
            state.records.resolve(&self.request_id, outcome);
        }
    }
}

/// A record another of this account's devices wrote.
///
/// A read marker is applied here, where the unread counts live; anything else
/// goes to the frontend, which owns settings and the saved-server list.
fn changed_elsewhere(record: &fancy::domain::Record, ctx: &HandlerContext) {
    if let Some(read) = Read::from_key(&record.key) {
        let cleared = ctx.shared.lock().ok().and_then(|mut state| {
            read_sync::apply(&mut state, read).map(|read| {
                let unreads = (
                    state.msgs.channel_unread.clone(),
                    state.msgs.dm_unread.clone(),
                );
                (read, unreads)
            })
        });
        match cleared {
            Some((Read::Channel(_), (channel, _))) => {
                ctx.emit("unread-changed", UnreadPayload { unreads: channel });
            }
            Some((Read::Direct(_), (_, direct))) => {
                ctx.emit("dm-unread-changed", DmUnreadPayload { unreads: direct });
            }
            None => {}
        }
        return;
    }
    ctx.emit(
        "account-record-changed",
        RecordChanged {
            key: record.key.clone(),
            value: String::from_utf8(record.value.clone()).ok(),
            found: record.found,
            updated_at_ms: record.updated_at_ms,
        },
    );
}

/// The sentence to show for a refusal.
///
/// The server's own detail wherever there is one: it names the ceiling a value
/// missed, or says that records belong to accounts and this connection is a
/// guest, and both are more use than any word this side could invent.
fn reason_of(refusal: &fancy::wire::Refusal) -> String {
    if refusal.detail.is_empty() {
        "the server refused the record".to_owned()
    } else {
        refusal.detail.clone()
    }
}
