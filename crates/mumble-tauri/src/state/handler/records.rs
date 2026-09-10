//! Answers from the account record store.
//!
//! Both bodies carry the `request_id` the ask was sent with, and every one of
//! them is proof the server has the store: a refusal is an answer too, and a
//! client that treated it as absence would make the next read wait out the
//! whole timeout again.

use mumble_protocol::proto::fancy;
use tracing::debug;

use super::{HandleMessage, HandlerContext};
use crate::state::records::RecordOutcome;

impl HandleMessage for fancy::domain::Record {
    fn handle(&self, ctx: &HandlerContext) {
        debug!(request_id = %self.request_id, found = self.found, "received a record");
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
