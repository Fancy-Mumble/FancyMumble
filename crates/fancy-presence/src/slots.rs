//! Where the Discord IPC endpoints live, and how to take one without
//! displacing Discord.
//!
//! Discord exposes ten numbered slots, `discord-ipc-0` through
//! `discord-ipc-9`. Every client library walks them in order and stops at the
//! first that answers, so **whoever holds slot 0 receives all traffic**. That
//! single fact drives the whole coexistence design:
//!
//! * We take the lowest free slot. If Discord is not running we get slot 0
//!   and see everything; when Discord starts afterwards it walks past us to
//!   slot 1 exactly as a client would, and [`crate::service`] forwards to it.
//! * If Discord already holds slot 0 we land on slot 1 and see nothing. We
//!   report that ([`crate::BridgeState::Blocked`]) rather than fixing it:
//!   unlinking Discord's socket is the one action here that actually breaks
//!   another application.

use std::io;
use std::path::PathBuf;

use crate::transport::Listener;

/// Number of IPC slots Discord defines.
pub const SLOT_COUNT: u8 = 10;

/// Prefix shared by every slot address.
const SLOT_PREFIX: &str = "discord-ipc-";

/// Runtime directories that sandboxed clients look in, relative to the base
/// directory. A Flatpak or Snap application sees its own private runtime
/// directory, so the host socket has to be reachable from these too.
///
/// Unix only; the Windows pipe namespace is already global.
#[cfg(not(windows))]
const SANDBOX_SUBDIRS: &[&str] = &[
    "app/com.discordapp.Discord",
    "app/com.discordapp.DiscordCanary",
    "app/dev.vencord.Vesktop",
    "snap.discord",
];

/// The directory holding the IPC sockets on this system.
///
/// Mirrors the lookup order baked into Discord's own client library: the
/// first environment variable that is *set*, not the first that exists.
/// Diverging here would put our socket somewhere clients never look.
#[must_use]
pub fn base_dir() -> PathBuf {
    for key in ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"] {
        match std::env::var(key) {
            Ok(value) if !value.trim().is_empty() => return PathBuf::from(value),
            _ => {}
        }
    }
    PathBuf::from("/tmp")
}

/// The address of one slot.
#[must_use]
pub fn slot_address(slot: u8) -> PathBuf {
    #[cfg(windows)]
    {
        PathBuf::from(format!(r"\\.\pipe\{SLOT_PREFIX}{slot}"))
    }
    #[cfg(not(windows))]
    {
        base_dir().join(format!("{SLOT_PREFIX}{slot}"))
    }
}

/// Sandbox paths that should also resolve to `slot`.
///
/// Empty on Windows, where the pipe namespace is already global.
#[must_use]
pub fn mirror_addresses(slot: u8) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let _ = slot;
        Vec::new()
    }
    #[cfg(not(windows))]
    {
        let base = base_dir();
        SANDBOX_SUBDIRS
            .iter()
            .map(|sub| base.join(sub).join(format!("{SLOT_PREFIX}{slot}")))
            .collect()
    }
}

/// A slot we successfully took.
#[derive(Debug)]
pub struct BoundSlot {
    /// The bound listener. Unbinds and cleans up its socket when dropped.
    pub listener: Listener,
    /// Which slot number it holds.
    pub slot: u8,
}

/// Take the lowest free slot, publishing sandbox mirrors for it.
///
/// Returns [`io::ErrorKind::AddrInUse`] when all ten slots are live, which in
/// practice means something is very wrong rather than that Discord is busy.
pub async fn bind_first_free() -> io::Result<BoundSlot> {
    let mut last_error = None;
    for slot in 0..SLOT_COUNT {
        let address = slot_address(slot);
        match Listener::bind(&address).await {
            Ok(mut listener) => {
                publish_mirrors(&mut listener, slot);
                tracing::info!(slot, path = %address.display(), "bound Discord IPC slot");
                return Ok(BoundSlot { listener, slot });
            }
            Err(e) => {
                tracing::debug!(slot, error = %e, "IPC slot unavailable");
                last_error = Some(e);
            }
        }
    }
    Err(last_error.unwrap_or_else(|| {
        io::Error::new(io::ErrorKind::AddrInUse, "every Discord IPC slot is taken")
    }))
}

fn publish_mirrors(listener: &mut Listener, slot: u8) {
    for mirror in mirror_addresses(slot) {
        // A mirror we cannot create only costs us clients inside that one
        // sandbox, so log and carry on rather than failing the bind.
        if let Err(e) = listener.mirror_to(&mirror) {
            tracing::debug!(path = %mirror.display(), error = %e, "could not publish sandbox mirror");
        }
    }
}

/// Look for another live IPC server - in practice, the real Discord client.
///
/// Scans every slot except `own_slot` and returns the first that accepts a
/// connection. A live endpoint is only *presumed* to be Discord; another
/// presence bridge on the machine would look identical, and forwarding to it
/// is still the right behaviour.
pub async fn find_peer(own_slot: u8) -> Option<PathBuf> {
    for slot in 0..SLOT_COUNT {
        if slot == own_slot {
            continue;
        }
        let address = slot_address(slot);
        if is_live(&address).await {
            return Some(address);
        }
    }
    None
}

/// Whether an endpoint currently accepts connections.
///
/// Connecting is the only reliable test on Unix - the socket file outlives
/// the process that created it. The connection is dropped immediately;
/// Discord treats a connect-then-disconnect as a client that changed its
/// mind, which is exactly what every scanning client library does anyway.
pub async fn is_live(address: &std::path::Path) -> bool {
    match crate::transport::connect(address).await {
        Ok(endpoint) => {
            drop(endpoint);
            true
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_addresses_use_the_names_clients_scan_for() {
        let address = slot_address(3);
        assert!(address
            .to_string_lossy()
            .ends_with(&format!("{SLOT_PREFIX}3")));
    }

    #[test]
    fn every_slot_has_a_distinct_address() {
        let addresses: std::collections::HashSet<_> =
            (0..SLOT_COUNT).map(slot_address).collect();
        assert_eq!(addresses.len(), usize::from(SLOT_COUNT));
    }

    #[cfg(not(windows))]
    #[test]
    fn mirrors_target_the_sandbox_runtime_directories() {
        let mirrors = mirror_addresses(0);
        assert_eq!(mirrors.len(), SANDBOX_SUBDIRS.len());
        assert!(mirrors
            .iter()
            .any(|p| p.to_string_lossy().contains("com.discordapp.Discord")));
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn a_path_with_nothing_behind_it_is_not_live() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(!is_live(&dir.path().join("absent")).await);
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn a_bound_listener_reads_as_live() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ipc-0");
        let _listener = Listener::bind(&path).await.expect("bind");
        assert!(is_live(&path).await);
    }
}
