use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;

use super::{HandleMessage, HandlerContext};
use crate::state::types::ServerVersionInfo;

/// Payload for the `server-version` event used to keep the frontend's
/// cached `serverFancyVersion` in sync with the backend reactively.
#[derive(Serialize)]
struct ServerVersionPayload {
    fancy_version: Option<u64>,
    fancy_protocol: Option<u32>,
}

impl HandleMessage for mumble_tcp::Version {
    fn handle(&self, ctx: &HandlerContext) {
        let (fancy_version, fancy_protocol) = {
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
            // Held for the same reason and by the same rule as the version
            // above. It is *not* interchangeable with it: the epoch says which
            // numbering is on the wire, the version says which features exist,
            // and a server may announce either without the other. Starling
            // announces this and deliberately no version at all, so a feature
            // gated only on the version is a feature Starling can never offer.
            let fancy_protocol = self.fancy_protocol.or(state.server.fancy_protocol);
            state.server.fancy_protocol = fancy_protocol;
            state.server.version_info = ServerVersionInfo {
                release: self.release.clone(),
                os: self.os.clone(),
                os_version: self.os_version.clone(),
                version_v1: self.version_v1,
                version_v2: self.version_v2,
                fancy_version,
                fancy_protocol,
            };
            (fancy_version, fancy_protocol)
        };

        // Emit outside the lock so the frontend refreshes its cached
        // `serverFancyVersion` even when the Fancy version is learned after
        // the initial bootstrap read of `get_server_info`.
        ctx.emit(
            "server-version",
            ServerVersionPayload {
                fancy_version,
                fancy_protocol,
            },
        );
    }
}
