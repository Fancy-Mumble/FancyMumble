//! Observe the Discord Rich Presence that other applications on this machine
//! are already publishing, without displacing Discord.
//!
//! # How this works at all
//!
//! Applications that show rich presence never talk to Discord's servers
//! directly. They talk to a local IPC endpoint the Discord desktop client
//! hosts - a Unix socket at `$XDG_RUNTIME_DIR/discord-ipc-{0..9}`, or a named
//! pipe at `\\.\pipe\discord-ipc-{0..9}`. Every client library walks those
//! ten slots in order and stops at the first that answers a handshake.
//!
//! So "listening to rich presence" means hosting that endpoint. This crate
//! implements the server side of the protocol: an 8-byte header
//! ([`codec`]) wrapping JSON commands ([`protocol`]), of which `SET_ACTIVITY`
//! is the one that carries presence.
//!
//! # Not stepping on Discord
//!
//! Because clients stop at the *first* live slot, who binds slot 0 decides
//! who receives everything. That gives three situations, and the whole design
//! follows from them ([`BridgeState`]):
//!
//! * **Discord is not running.** We take slot 0 and answer handshakes
//!   ourselves with a synthetic `READY`. Nothing to interfere with.
//! * **We started first, Discord starts later.** Discord finds slot 0 taken
//!   and moves to slot 1, exactly as a client would. We become a transparent
//!   proxy: each client connection gets a matching connection to Discord,
//!   frames are forwarded verbatim in both directions, and we read
//!   `SET_ACTIVITY` in passing. Discord still displays everything and the
//!   application cannot tell the difference.
//! * **Discord started first.** It holds slot 0, we land on slot 1, and no
//!   client ever reaches us. We report [`BridgeState::Blocked`] and do
//!   nothing about it. Unlinking Discord's socket would work and is exactly
//!   the interference this design exists to avoid; the real fix is launch
//!   order.
//!
//! # Using it
//!
//! ```no_run
//! # async fn example() -> std::io::Result<()> {
//! use fancy_presence::{PresenceConfig, PresenceEvent, PresenceService};
//!
//! let service = PresenceService::start(PresenceConfig::default()).await?;
//! let mut events = service.subscribe();
//!
//! while let Ok(event) = events.recv().await {
//!     if let PresenceEvent::Updated(entry) = event {
//!         println!("{}: {:?}", entry.display_name(), entry.activity.details);
//!     }
//! }
//! # Ok(())
//! # }
//! ```
//!
//! # What this crate does not do
//!
//! No network access. Activity artwork arrives as opaque keys that have to be
//! resolved through Discord's public CDN, and application ids likewise resolve
//! to names over HTTP; [`assets`] builds those URLs but the embedder fetches
//! and caches them, since it already owns an HTTP client and the policy
//! decision about whether this feature may touch the network.
//!
//! The WebSocket transport on ports 6463-6472, used by browser games and a
//! few libraries, is not implemented. Those clients fall back to the IPC
//! socket where they can.

pub mod assets;
pub mod codec;
mod connection;
pub mod process;
pub mod protocol;
pub mod service;
pub mod slots;
pub mod store;
pub mod transport;

// Every use of `tempfile` is inside a test that is itself `cfg(not(windows))` -
// the ones that bind real sockets - so on Windows this crate links the
// dev-dependency without ever naming it, and `unused_crate_dependencies` (a
// workspace lint, denied in CI) fires on a target that builds there.
#[cfg(all(test, windows))]
mod _dev_deps {
    use tempfile as _;
}

pub use protocol::{Activity, Assets, Button, Party, Timestamps};
pub use service::{BridgeState, PresenceConfig, PresenceEvent, PresenceService};
pub use store::{ConnectionId, PresenceEntry, PresenceStore};
