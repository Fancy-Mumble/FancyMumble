//! Inbound handlers for the self-service account settings messages.

use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;
use tracing::debug;

use super::{HandleMessage, HandlerContext};
use crate::state::types::{AccountAck, AccountDevice, AccountSettings};

#[derive(Serialize, Clone)]
struct AccountSettingsPayload {
    settings: AccountSettings,
}

impl HandleMessage for mumble_tcp::FancyAccountSettings {
    fn handle(&self, ctx: &HandlerContext) {
        let snapshot = AccountSettings {
            registered: self.registered.unwrap_or(false),
            user_id: self.user_id,
            name: self.name.clone(),
            email: self.email.clone(),
            has_password: self.has_password.unwrap_or(false),
            totp_enabled: self.totp_enabled.unwrap_or(false),
            cert_hash: self.cert_hash.clone(),
            cert_matches_session: self.cert_matches_session.unwrap_or(false),
            devices: self
                .devices
                .iter()
                .map(|device| AccountDevice {
                    id: device.id.clone().unwrap_or_default(),
                    name: device.name.clone().unwrap_or_default(),
                    added_at_ms: device.added_at_ms.unwrap_or_default(),
                    last_seen_ms: device.last_seen_ms.unwrap_or_default(),
                    online: device.online.unwrap_or(false),
                })
                .collect(),
            devices_locked: self.devices_locked.unwrap_or(false),
            this_device: self.this_device.clone().filter(|id| !id.is_empty()),
        };
        debug!(
            registered = snapshot.registered,
            has_password = snapshot.has_password,
            totp_enabled = snapshot.totp_enabled,
            "received FancyAccountSettings"
        );

        if let Ok(mut state) = ctx.shared.lock() {
            state.account_settings = Some(snapshot.clone());
        }

        ctx.emit(
            "account-settings",
            AccountSettingsPayload { settings: snapshot },
        );
    }
}

impl HandleMessage for mumble_tcp::FancyAccountAck {
    fn handle(&self, ctx: &HandlerContext) {
        let ack = AccountAck {
            action: self.action,
            ok: self.ok,
            error: self.error.clone(),
            totp_secret: self.totp_secret.clone(),
            totp_uri: self.totp_uri.clone(),
        };
        debug!(action = ack.action, ok = ack.ok, error = ?ack.error, "received FancyAccountAck");
        ctx.emit("account-ack", ack);
    }
}
