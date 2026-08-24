//! Inbound handler for a short-lived operator ticket.
//!
//! Nothing here is cached: unlike livery, a ticket is single-use and expires
//! in minutes, so there is no reconnect or reload it is worth surviving for.
//! Each request gets exactly one reply, emitted as an event the requester is
//! already listening for.

use mumble_protocol::proto::fancy;
use serde::Serialize;

use super::{HandleMessage, HandlerContext};

/// An operator ticket as the frontend receives it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct OperatorTicket {
    /// Empty when nothing was granted; see `denied_reason`.
    pub token: String,
    #[serde(rename = "grantedScopes")]
    pub granted_scopes: Vec<String>,
    #[serde(rename = "expiresAtMs")]
    pub expires_at_ms: u64,
    /// Where to present the token. Empty when this deployment has not named
    /// one, even where scopes were granted.
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "deniedReason", skip_serializing_if = "String::is_empty")]
    pub denied_reason: String,
}

#[derive(Serialize)]
struct OperatorTicketPayload {
    ticket: OperatorTicket,
}

impl HandleMessage for fancy::domain::OperatorTicketReply {
    fn handle(&self, ctx: &HandlerContext) {
        ctx.emit(
            "operator-ticket",
            OperatorTicketPayload {
                ticket: OperatorTicket {
                    token: self.token.clone(),
                    granted_scopes: self.granted_scopes.clone(),
                    expires_at_ms: self.expires_at_ms,
                    base_url: self.base_url.clone(),
                    denied_reason: self.denied_reason.clone(),
                },
            },
        );
    }
}
