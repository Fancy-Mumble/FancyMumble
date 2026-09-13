//! Inbound handler for a short-lived operator ticket.
//!
//! Nothing here is cached: unlike livery, a ticket is single-use and expires
//! in minutes, so there is no reconnect or reload it is worth surviving for.
//! Each request gets exactly one reply, emitted as an event the page listens
//! for, and handed to backend code that asked through [`TicketWaiters`].

use mumble_protocol::proto::fancy;
use serde::Serialize;
use tokio::sync::oneshot;

use super::{HandleMessage, HandlerContext};

/// Backend code waiting on a ticket.
///
/// A reply carries no request id, so it goes to the oldest waiter whose
/// requested scopes it grants, and a denial, which grants nothing, to the
/// oldest waiter. The page's own requests register nothing here, so a livery
/// ticket that arrives while plugin administration waits is left to the page.
#[derive(Debug, Default)]
pub(crate) struct TicketWaiters {
    waiting: Vec<(Vec<String>, oneshot::Sender<OperatorTicket>)>,
}

impl TicketWaiters {
    pub(crate) fn expect(&mut self, scopes: Vec<String>) -> oneshot::Receiver<OperatorTicket> {
        // A caller that timed out dropped its receiver.
        self.waiting.retain(|(_, waiter)| !waiter.is_closed());
        let (waiter, receiver) = oneshot::channel();
        self.waiting.push((scopes, waiter));
        receiver
    }

    fn deliver(&mut self, ticket: &OperatorTicket) {
        let position = if ticket.granted_scopes.is_empty() {
            (!self.waiting.is_empty()).then_some(0)
        } else {
            self.waiting.iter().position(|(scopes, _)| {
                ticket
                    .granted_scopes
                    .iter()
                    .any(|granted| scopes.contains(granted))
            })
        };
        if let Some(position) = position {
            let (_, waiter) = self.waiting.remove(position);
            let _ = waiter.send(ticket.clone());
        }
    }
}

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
        let ticket = OperatorTicket {
            token: self.token.clone(),
            granted_scopes: self.granted_scopes.clone(),
            expires_at_ms: self.expires_at_ms,
            base_url: self.base_url.clone(),
            denied_reason: self.denied_reason.clone(),
        };
        if let Ok(mut shared) = ctx.shared.lock() {
            shared.operator_tickets.deliver(&ticket);
        }
        ctx.emit("operator-ticket", OperatorTicketPayload { ticket });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ticket(granted: &[&str]) -> OperatorTicket {
        OperatorTicket {
            token: "t".to_owned(),
            granted_scopes: granted.iter().map(|scope| (*scope).to_owned()).collect(),
            expires_at_ms: 0,
            base_url: String::new(),
            denied_reason: String::new(),
        }
    }

    #[test]
    fn a_ticket_goes_to_the_waiter_whose_scopes_it_grants() {
        let mut waiters = TicketWaiters::default();
        let mut livery = waiters.expect(vec!["server-config:write".to_owned()]);
        let mut plugins = waiters.expect(vec!["plugins:read".to_owned()]);

        waiters.deliver(&ticket(&["plugins:read"]));
        assert_eq!(plugins.try_recv().expect("delivered").granted_scopes, ["plugins:read"]);
        assert!(livery.try_recv().is_err(), "not a livery ticket");

        // A denial grants nothing to match on, so the oldest waiter hears it.
        waiters.deliver(&ticket(&[]));
        assert!(livery.try_recv().is_ok());
    }

    #[test]
    fn a_ticket_nobody_in_the_backend_asked_for_is_left_to_the_page() {
        let mut waiters = TicketWaiters::default();
        let mut plugins = waiters.expect(vec!["plugins:read".to_owned()]);
        waiters.deliver(&ticket(&["server-config:write"]));
        assert!(plugins.try_recv().is_err());
    }
}
