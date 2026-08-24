//! The presence service: binds a slot, accepts clients, and tracks whether
//! the real Discord client is around to forward to.

use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{broadcast, watch};
use tokio::task::JoinHandle;

use crate::slots;
use crate::store::{ConnectionId, PresenceEntry, PresenceStore};
use crate::transport::Listener;

/// Backlog of presence events kept for slow subscribers.
const EVENT_CAPACITY: usize = 128;

/// Pause after a failed accept, so a persistently broken listener cannot spin.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(500);

/// How the service is positioned relative to the real Discord client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeState {
    /// We hold slot 0 and Discord is not running. Every application talks to
    /// us and nothing is displaced.
    Standalone,
    /// We hold slot 0, Discord is running on a higher slot, and every frame
    /// is forwarded to it. Applications and Discord both behave normally.
    Bridged,
    /// We hold slot 0 and Discord is running, but forwarding is switched off,
    /// so Discord will not show any of this presence. Only reachable by
    /// setting [`PresenceConfig::bridge_to_discord`] to `false`.
    Intercepting,
    /// Discord (or another presence bridge) holds a lower slot, so clients
    /// reach it and never us. We observe nothing until the start order flips.
    ///
    /// The fix is start order, not force: taking the socket away from Discord
    /// is the one action here that would genuinely break another application.
    Blocked,
}

/// Something changed in the observed presence.
#[derive(Debug, Clone)]
pub enum PresenceEvent {
    /// An application published or changed its activity.
    Updated(Box<PresenceEntry>),
    /// An application cleared its activity or disconnected.
    Cleared(ConnectionId),
    /// The relationship with the Discord client changed.
    BridgeStateChanged(BridgeState),
}

/// How the service should behave.
#[derive(Debug, Clone)]
pub struct PresenceConfig {
    /// Forward every frame to the real Discord client when it is running.
    ///
    /// On by default, and should stay on: with it off we hold slot 0 and
    /// Discord silently stops showing anyone's rich presence.
    pub bridge_to_discord: bool,
    /// How often to check whether Discord has started or stopped.
    pub discord_poll_interval: Duration,
}

impl Default for PresenceConfig {
    fn default() -> Self {
        Self {
            bridge_to_discord: true,
            // Discord starting is a human-scale event; polling faster only
            // costs connect attempts against nine absent sockets.
            discord_poll_interval: Duration::from_secs(5),
        }
    }
}

/// Shared state every connection task needs.
pub(crate) struct Inner {
    pub(crate) config: PresenceConfig,
    pub(crate) store: Arc<PresenceStore>,
    pub(crate) events: broadcast::Sender<PresenceEvent>,
    /// Where the real Discord client is, if it is running.
    pub(crate) upstream: watch::Sender<Option<PathBuf>>,
    bridge: watch::Sender<BridgeState>,
    slot: u8,
    /// Only needed to unlink the socket file on the synchronous exit path,
    /// which is a Unix concern - Windows has nothing on disk to remove.
    #[cfg(unix)]
    address: PathBuf,
    next_id: AtomicU64,
}

impl std::fmt::Debug for Inner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Inner")
            .field("config", &self.config)
            .field("slot", &self.slot)
            .field("bridge", &*self.bridge.borrow())
            .finish_non_exhaustive()
    }
}

impl Inner {
    pub(crate) fn emit(&self, event: PresenceEvent) {
        // Fails only when nobody is subscribed, which is normal.
        let _ = self.events.send(event);
    }

    fn next_id(&self) -> ConnectionId {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn refresh_bridge_state(&self) {
        let discord_present = self.upstream.borrow().is_some();
        let state = match (self.slot, discord_present, self.config.bridge_to_discord) {
            (0, false, _) => BridgeState::Standalone,
            (0, true, true) => BridgeState::Bridged,
            (0, true, false) => BridgeState::Intercepting,
            _ => BridgeState::Blocked,
        };
        if *self.bridge.borrow() == state {
            return;
        }
        tracing::info!(?state, "presence bridge state changed");
        // `send` refuses to store the value when nobody is subscribed, and
        // most of the time nobody is: this channel exists to be *read*
        // through `borrow`, not awaited. `send_replace` always stores.
        let _previous = self.bridge.send_replace(state);
        self.emit(PresenceEvent::BridgeStateChanged(state));
    }
}

/// A running Discord Rich Presence listener.
///
/// Dropping it releases the IPC slot and stops every task, at which point a
/// Discord client that was sitting on a higher slot becomes reachable at
/// slot 0 again for newly started applications.
#[derive(Debug)]
pub struct PresenceService {
    inner: Arc<Inner>,
    shutdown: watch::Sender<bool>,
    tasks: Vec<JoinHandle<()>>,
}

impl PresenceService {
    /// Bind a slot and start listening.
    ///
    /// Fails only when no slot can be taken at all; landing on a slot above 0
    /// succeeds and reports [`BridgeState::Blocked`], because the service is
    /// still useful the moment Discord exits.
    pub async fn start(config: PresenceConfig) -> io::Result<Self> {
        let bound = slots::bind_first_free().await?;
        let (events, _) = broadcast::channel(EVENT_CAPACITY);
        let (upstream, _) = watch::channel(None);
        let initial = if bound.slot == 0 {
            BridgeState::Standalone
        } else {
            BridgeState::Blocked
        };
        let (bridge, _) = watch::channel(initial);

        let inner = Arc::new(Inner {
            config,
            store: Arc::new(PresenceStore::new()),
            events,
            upstream,
            bridge,
            slot: bound.slot,
            #[cfg(unix)]
            address: bound.listener.address().to_path_buf(),
            next_id: AtomicU64::new(1),
        });
        let (shutdown, _) = watch::channel(false);

        let tasks = vec![
            tokio::spawn(accept_loop(
                bound.listener,
                Arc::clone(&inner),
                shutdown.subscribe(),
            )),
            tokio::spawn(watch_for_discord(Arc::clone(&inner), shutdown.subscribe())),
        ];

        Ok(Self {
            inner,
            shutdown,
            tasks,
        })
    }

    /// The live presence of every connected application.
    #[must_use]
    pub fn snapshot(&self) -> Vec<PresenceEntry> {
        self.inner.store.snapshot()
    }

    /// The shared store, for embedders that want to annotate entries (see
    /// [`PresenceStore::set_application_name`]).
    #[must_use]
    pub fn store(&self) -> &Arc<PresenceStore> {
        &self.inner.store
    }

    /// Subscribe to presence changes.
    ///
    /// A slow subscriber that overflows the backlog receives
    /// [`broadcast::error::RecvError::Lagged`]; recover by taking a fresh
    /// [`PresenceService::snapshot`].
    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<PresenceEvent> {
        self.inner.events.subscribe()
    }

    /// How the service currently sits relative to Discord.
    #[must_use]
    pub fn bridge_state(&self) -> BridgeState {
        *self.inner.bridge.borrow()
    }

    /// Which IPC slot was taken. Anything other than 0 means client libraries
    /// reach a lower slot first and we see nothing.
    #[must_use]
    pub fn slot(&self) -> u8 {
        self.inner.slot
    }

    /// Remove this service's socket without going through the async
    /// shutdown, for use on a process-exit path that cannot await anything.
    ///
    /// Only the filesystem entries are cleaned up; the tasks die with the
    /// process. A no-op on Windows, where closing the process releases the
    /// pipe name and there is nothing on disk to remove.
    ///
    /// Skipping this is survivable - client libraries that fail to connect to
    /// a dead socket move on to the next slot, and the next run reclaims it
    /// as stale - but it leaves less debris behind.
    pub fn release_slot_files(&self) {
        #[cfg(unix)]
        {
            let _ = std::fs::remove_file(&self.inner.address);
            for mirror in slots::mirror_addresses(self.inner.slot) {
                let _ = std::fs::remove_file(mirror);
            }
        }
    }

    /// Stop and wait until the IPC slot has actually been released.
    ///
    /// Prefer this over just dropping the service whenever another
    /// [`PresenceService::start`] may follow - toggling the feature off and
    /// on again, for instance. Dropping only *signals* the tasks, so a
    /// restart that close behind can find its own not-yet-released socket
    /// still bound and land on slot 1, where it sees nothing.
    pub async fn shutdown(mut self) {
        let _previous = self.shutdown.send_replace(true);
        for task in std::mem::take(&mut self.tasks) {
            // The accept loop releases the listener as it unwinds; awaiting
            // it is what makes the slot free by the time this returns.
            let _joined = task.await;
        }
    }
}

impl Drop for PresenceService {
    fn drop(&mut self) {
        let _previous = self.shutdown.send_replace(true);
        for task in &self.tasks {
            task.abort();
        }
    }
}

async fn accept_loop(
    mut listener: Listener,
    inner: Arc<Inner>,
    mut shutdown: watch::Receiver<bool>,
) {
    // Cloned up front: `shutdown` itself is borrowed by the select below, so
    // it cannot also be read inside a branch body.
    let child_shutdown = shutdown.clone();
    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            accepted = listener.accept() => match accepted {
                Ok(endpoint) => {
                    let id = inner.next_id();
                    let _task = tokio::spawn(crate::connection::serve(
                        endpoint,
                        id,
                        Arc::clone(&inner),
                        child_shutdown.clone(),
                    ));
                }
                Err(e) => {
                    tracing::warn!(error = %e, "presence accept failed");
                    tokio::time::sleep(ACCEPT_BACKOFF).await;
                }
            },
        }
    }
    tracing::debug!("presence accept loop stopped");
}

/// Poll for the Discord client appearing or disappearing.
///
/// Polling rather than watching the filesystem: the Windows named-pipe
/// namespace has no usable change notification, and one connect attempt
/// against a handful of absent endpoints every few seconds is cheaper than
/// maintaining two platform-specific watchers.
async fn watch_for_discord(inner: Arc<Inner>, mut shutdown: watch::Receiver<bool>) {
    let mut ticker = tokio::time::interval(inner.config.discord_poll_interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            _ = ticker.tick() => {}
        }

        let found = slots::find_peer(inner.slot).await;
        if *inner.upstream.borrow() == found {
            continue;
        }
        match found.as_deref() {
            Some(path) => tracing::info!(path = %path.display(), "Discord IPC endpoint appeared"),
            None => tracing::info!("Discord IPC endpoint went away"),
        }
        // `send_replace`, not `send`: with no client connected there are no
        // subscribers, and `send` would drop the update on the floor.
        let _previous = inner.upstream.send_replace(found);
        inner.refresh_bridge_state();
    }
    tracing::debug!("Discord watcher stopped");
}
