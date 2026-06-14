//! Inbound handler for the editable server-settings schema broadcast.

use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;
use tracing::debug;

use super::{HandleMessage, HandlerContext};
use crate::state::types::{ServerSetting, ServerSettingsSnapshot};

#[derive(Serialize, Clone)]
struct ServerSettingsPayload {
    settings: ServerSettingsSnapshot,
}

impl HandleMessage for mumble_tcp::FancyServerSettings {
    fn handle(&self, ctx: &HandlerContext) {
        let snapshot = decode(self);
        debug!(
            count = snapshot.settings.len(),
            revision = snapshot.revision,
            "received FancyServerSettings"
        );

        if let Ok(mut state) = ctx.shared.lock() {
            // Only accept newer (or equal) revisions so a stale broadcast can't
            // clobber a fresher local view that just followed an admin edit.
            let accept = state
                .server_settings
                .as_ref()
                .is_none_or(|prev| snapshot.revision >= prev.revision);
            if !accept {
                return;
            }
            state.server_settings = Some(snapshot.clone());
        }

        ctx.emit("server-settings", ServerSettingsPayload { settings: snapshot });
    }
}

fn decode(proto: &mumble_tcp::FancyServerSettings) -> ServerSettingsSnapshot {
    ServerSettingsSnapshot {
        revision: proto.revision.unwrap_or(0),
        settings: proto.settings.iter().map(decode_setting).collect(),
    }
}

fn decode_setting(p: &mumble_tcp::Setting) -> ServerSetting {
    ServerSetting {
        key: p.key.clone().unwrap_or_default(),
        r#type: p.r#type.clone().unwrap_or_else(|| "string".to_owned()),
        group: p.group.clone().unwrap_or_default(),
        label: p.label.clone().unwrap_or_default(),
        value: p.value.clone(),
        options: p.options.clone(),
        secret: p.secret.unwrap_or(false),
        help: p.help.clone(),
    }
}
