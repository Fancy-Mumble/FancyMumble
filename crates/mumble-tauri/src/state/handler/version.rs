use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;

use super::{HandleMessage, HandlerContext};
use crate::state::types::ServerVersionInfo;

/// Payload for the `server-version` event used to keep the frontend's
/// cached `serverFancyVersion` in sync with the backend reactively.
#[derive(Serialize)]
struct ServerVersionPayload {
    fancy_version: Option<u64>,
}

impl HandleMessage for mumble_tcp::Version {
    fn handle(&self, ctx: &HandlerContext) {
        let fancy_version = {
            let Ok(mut state) = ctx.shared.lock() else {
                return;
            };
            // A Fancy server may announce its extension version in a
            // `Version` message that arrives separately from (and possibly
            // after) the standard one.  Never let a later message that
            // omits `fancy_version` erase a value we already learned,
            // otherwise the UI would wrongly gate Fancy-only features off
            // for the rest of the session.
            let fancy_version = self.fancy_version.or(state.server.fancy_version);
            state.server.fancy_version = fancy_version;
            state.server.version_info = ServerVersionInfo {
                release: self.release.clone(),
                os: self.os.clone(),
                os_version: self.os_version.clone(),
                version_v1: self.version_v1,
                version_v2: self.version_v2,
                fancy_version,
            };
            fancy_version
        };

        // Emit outside the lock so the frontend refreshes its cached
        // `serverFancyVersion` even when the Fancy version is learned after
        // the initial bootstrap read of `get_server_info`.
        ctx.emit("server-version", ServerVersionPayload { fancy_version });
    }
}
