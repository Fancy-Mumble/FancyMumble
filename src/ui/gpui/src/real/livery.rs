//! The real engine's side of server liveries: the ping's digest, the
//! livery of each server it is on, and asking a server without joining it.

use std::sync::Arc;

use mumble_tauri_lib::engine_api::{Connection, EngineHandle, PingInfo};

use super::Shared;
use crate::engine::EngineEvent;
use crate::livery::{Livery, Pinged};

/// What a ping said of a server's livery.
pub(super) fn pinged(ping: &PingInfo) -> Pinged {
    if ping.online {
        Pinged::Up {
            digest: ping.livery_digest.clone().map(Into::into),
        }
    } else {
        Pinged::Down
    }
}

impl Shared {
    /// Read again the livery of every server the engine is on, and say so.
    /// On the runtime: the pictures are read back from what the engine
    /// holds.
    pub(super) fn read_liveries(self: &Arc<Self>, runtime: &tokio::runtime::Handle) {
        let shared = Arc::clone(self);
        drop(runtime.spawn(async move {
            let sessions = shared
                .engine
                .sessions()
                .into_iter()
                // A session that has ended has no livery to show any more.
                .filter(|session| session.connection == Connection::Connected)
                .map(|session| {
                    let livery = shared.engine.livery(&session.id).map(Livery::from);
                    let key = format!("{}:{}", session.host, session.port);
                    (session.id, key, livery)
                })
                .collect();
            shared.liveries.hold(sessions);
            shared.tell(EngineEvent::LiveryChanged);
        }));
    }

    /// Ask the server at `host:port` for its livery, and say what came back.
    pub(super) fn probe_livery(
        self: &Arc<Self>,
        runtime: &tokio::runtime::Handle,
        host: &str,
        port: u16,
    ) {
        let shared = Arc::clone(self);
        let host = host.to_owned();
        drop(runtime.spawn(async move {
            let livery = match EngineHandle::probe_livery(&host, port).await {
                Ok(answer) => answer.map(|info| Arc::new(Livery::from(info))),
                Err(error) => {
                    tracing::debug!(%error, "the livery of {host}:{port} was not had");
                    None
                }
            };
            shared.tell(EngineEvent::LiveryProbed {
                key: format!("{host}:{port}").into(),
                livery,
            });
        }));
    }
}
