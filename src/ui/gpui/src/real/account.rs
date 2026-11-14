//! The local user's account, asked of the real engine: each change sent,
//! a change that could not be sent said on its own row as a refusal, and
//! the offer of the account to a new device answered with its link.

use std::sync::Arc;

use super::RealEngine;
use crate::engine::{AccountAction, AccountNews, EngineEvent};

impl RealEngine {
    /// Send `action`, proved with `password`.
    pub(super) fn send_account(&self, action: AccountAction, password: Option<String>) {
        let shared = Arc::clone(&self.shared);
        drop(self.runtime.spawn(async move {
            let id = action.clone();
            if let Err(reason) = shared.engine.update_account(action, password).await {
                shared.tell(EngineEvent::Account(AccountNews::not_sent(&id, reason)));
            }
        }));
    }

    /// Offer the account to a new device; the link, or why there is none,
    /// is told when it is made.
    pub(super) fn offer_link(&self, password: Option<String>) {
        let shared = Arc::clone(&self.shared);
        drop(self.runtime.spawn(async move {
            let link = shared.engine.begin_device_link(password).await;
            shared.tell(EngineEvent::Account(AccountNews::Link(link)));
        }));
    }

    /// Withdraw the offer that would become `device`.
    pub(super) fn withdraw_link(&self, device: String) {
        let engine = self.shared.engine.clone();
        self.spawn(async move { engine.cancel_device_link(device).await });
    }
}
