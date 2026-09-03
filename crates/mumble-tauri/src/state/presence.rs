//! Discord Rich Presence integration.
//!
//! Owns the [`fancy_presence::PresenceService`] lifecycle, turns its events
//! into `rich-presence-changed` for the frontend, and resolves the parts of
//! an activity that only mean something to Discord: the application id (which
//! becomes a name) and the artwork keys (which become CDN URLs).
//!
//! Resolution is the only part that touches the network, so it is behind its
//! own preference. With it off the feature is purely local: the IPC endpoint
//! is served, activities are read, and nothing leaves the machine.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use fancy_presence::assets::{self, ImageSource};
use fancy_presence::{BridgeState, PresenceConfig, PresenceEntry, PresenceEvent, PresenceService};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Event carrying the full presence picture to the frontend.
pub(crate) const PRESENCE_EVENT: &str = "rich-presence-changed";

/// Artwork edge length requested from the CDN. Presence cards are small; the
/// next size up quadruples the bytes for no visible gain.
const ARTWORK_SIZE: u16 = 256;

/// Cap on a metadata lookup, so an unreachable CDN cannot wedge the pump.
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(10);

/// What an application id resolves to, once looked up.
#[derive(Debug, Default, Clone)]
struct ApplicationMetadata {
    /// The application's display name.
    name: Option<String>,
    /// Artwork key to asset id, for the keys this application registered.
    asset_ids: HashMap<String, String>,
}

/// One application's presence, ready for display.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresenceView {
    /// Everything the IPC connection told us.
    #[serde(flatten)]
    entry: PresenceEntry,
    /// Best available label, already resolved through the fallback chain.
    display_name: String,
    /// Resolved URL for the large artwork, if there is one and it resolved.
    large_image_url: Option<String>,
    /// Resolved URL for the small badge artwork.
    small_image_url: Option<String>,
}

/// Whether the listener is running and how it sits relative to Discord.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresenceStatus {
    /// Whether the listener is running at all.
    enabled: bool,
    /// How the listener relates to a running Discord client.
    bridge_state: Option<BridgeState>,
    /// Which IPC slot was taken. Anything but 0 means we see nothing.
    slot: Option<u8>,
}

/// The payload of every [`PRESENCE_EVENT`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresenceSnapshot {
    /// Current listener status.
    pub status: PresenceStatus,
    /// Every application currently advertising presence.
    pub entries: Vec<PresenceView>,
}

#[derive(Default)]
struct Shared {
    service: tokio::sync::Mutex<Option<PresenceService>>,
    metadata: Mutex<HashMap<String, ApplicationMetadata>>,
    pump: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    resolve_artwork: std::sync::atomic::AtomicBool,
}

/// Handle to the presence subsystem. Cheap to clone; all clones share state.
#[derive(Default, Clone)]
pub(crate) struct PresenceManager {
    shared: Arc<Shared>,
}

impl PresenceManager {
    /// Start or stop the listener, and report where it ended up.
    ///
    /// Safe to call repeatedly with the same value: enabling an already
    /// running listener only updates the artwork preference.
    pub(crate) async fn set_enabled(
        &self,
        app: &AppHandle,
        http: reqwest::Client,
        enabled: bool,
        resolve_artwork: bool,
    ) -> Result<PresenceStatus, String> {
        self.shared
            .resolve_artwork
            .store(resolve_artwork, std::sync::atomic::Ordering::Relaxed);

        let mut slot = self.shared.service.lock().await;
        match (enabled, slot.is_some()) {
            (true, false) => {
                let service = PresenceService::start(PresenceConfig::default())
                    .await
                    .map_err(|e| format!("could not start the presence listener: {e}"))?;
                self.spawn_pump(app.clone(), http, &service);
                tracing::info!(
                    slot = service.slot(),
                    state = ?service.bridge_state(),
                    "rich presence listener started"
                );
                *slot = Some(service);
            }
            (false, true) => {
                self.stop_pump();
                if let Some(service) = slot.take() {
                    // Awaited, not dropped: a re-enable moments later has to
                    // find slot 0 free or it silently observes nothing.
                    service.shutdown().await;
                }
                self.shared
                    .metadata
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .clear();
                tracing::info!("rich presence listener stopped");
            }
            _ => {}
        }

        let status = status_of(slot.as_ref());
        emit(
            app,
            PresenceSnapshot {
                status,
                entries: self.views(slot.as_ref()),
            },
        );
        Ok(status)
    }

    /// The current status and entry list.
    pub(crate) async fn snapshot(&self) -> PresenceSnapshot {
        let slot = self.shared.service.lock().await;
        PresenceSnapshot {
            status: status_of(slot.as_ref()),
            entries: self.views(slot.as_ref()),
        }
    }

    /// Process ids currently advertising that they are playing something.
    ///
    /// The game overlay's strongest single signal: a process that tells
    /// Discord it is playing a game has classified itself, which is what
    /// Discord's own detection increasingly relies on in place of its
    /// executable list. Activity type 0 is "playing"; an absent type means the
    /// same thing, since that is the protocol's default.
    ///
    /// Returns nothing at all when the presence listener is off, which is its
    /// default - so this signal is a bonus, never a requirement.
    pub(crate) async fn playing_pids(&self) -> Vec<u32> {
        let Ok(slot) = self.shared.service.try_lock() else {
            return Vec::new();
        };
        let Some(service) = slot.as_ref() else {
            return Vec::new();
        };
        service
            .snapshot()
            .into_iter()
            .filter(|entry| entry.activity.activity_type.is_none_or(|kind| kind == 0))
            .filter_map(|entry| entry.pid)
            .collect()
    }

    /// Best-effort cleanup from the process-exit handler, which runs on the
    /// main thread and must not block on the async runtime.
    pub(crate) fn release_slot_files(&self) {
        if let Ok(slot) = self.shared.service.try_lock() {
            if let Some(service) = slot.as_ref() {
                service.release_slot_files();
            }
        }
    }

    fn views(&self, service: Option<&PresenceService>) -> Vec<PresenceView> {
        let Some(service) = service else {
            return Vec::new();
        };
        let metadata = self
            .shared
            .metadata
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        service
            .snapshot()
            .into_iter()
            .map(|entry| view_of(entry, &metadata))
            .collect()
    }

    fn spawn_pump(&self, app: AppHandle, http: reqwest::Client, service: &PresenceService) {
        let events = service.subscribe();
        let manager = self.clone();
        let handle = tauri::async_runtime::spawn(async move {
            manager.run_pump(app, http, events).await;
        });
        let mut pump = self
            .shared
            .pump
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if let Some(previous) = pump.replace(handle) {
            previous.abort();
        }
    }

    fn stop_pump(&self) {
        let handle = self
            .shared
            .pump
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(handle) = handle {
            handle.abort();
        }
    }

    async fn run_pump(
        self,
        app: AppHandle,
        http: reqwest::Client,
        mut events: tokio::sync::broadcast::Receiver<PresenceEvent>,
    ) {
        loop {
            match events.recv().await {
                Ok(event) => {
                    if let PresenceEvent::Updated(entry) = &event {
                        self.ensure_metadata(&http, &entry.application_id).await;
                    }
                    emit(&app, self.snapshot().await);
                }
                // A burst overflowed the backlog; the next snapshot is still
                // authoritative, so re-emit rather than give up.
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::debug!(skipped, "presence event backlog overflowed");
                    emit(&app, self.snapshot().await);
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    }

    /// Look up an application's name and artwork keys, once per application.
    async fn ensure_metadata(&self, http: &reqwest::Client, application_id: &str) {
        if !self
            .shared
            .resolve_artwork
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            return;
        }
        {
            let metadata = self
                .shared
                .metadata
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            if metadata.contains_key(application_id) {
                return;
            }
        }

        let resolved = resolve_application(http, application_id).await;
        let name = resolved.name.clone();
        let _previous = self
            .shared
            .metadata
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(application_id.to_owned(), resolved);

        // Push the name into the store so it survives later activity updates.
        if let (Some(name), Some(service)) = (name, self.shared.service.lock().await.as_ref()) {
            for entry in service.snapshot() {
                if entry.application_id == application_id {
                    let _changed = service.store().set_application_name(entry.id, &name);
                }
            }
        }
    }
}

impl crate::state::AppState {
    /// Start or stop the Rich Presence listener.
    pub(crate) async fn set_presence_enabled(
        &self,
        app: &AppHandle,
        enabled: bool,
        resolve_artwork: bool,
    ) -> Result<PresenceStatus, String> {
        let manager = self.presence.clone();
        let http = self.http_client.clone();
        manager
            .set_enabled(app, http, enabled, resolve_artwork)
            .await
    }

    /// The current listener status and advertised activities.
    pub(crate) async fn presence_snapshot(&self) -> PresenceSnapshot {
        self.presence.clone().snapshot().await
    }
}

fn status_of(service: Option<&PresenceService>) -> PresenceStatus {
    match service {
        Some(service) => PresenceStatus {
            enabled: true,
            bridge_state: Some(service.bridge_state()),
            slot: Some(service.slot()),
        },
        None => PresenceStatus {
            enabled: false,
            bridge_state: None,
            slot: None,
        },
    }
}

fn view_of(entry: PresenceEntry, metadata: &HashMap<String, ApplicationMetadata>) -> PresenceView {
    let application_metadata = metadata.get(&entry.application_id);
    let display_name = application_metadata
        .and_then(|m| m.name.clone())
        .unwrap_or_else(|| entry.display_name().to_owned());
    let assets = entry.activity.assets.clone().unwrap_or_default();
    PresenceView {
        large_image_url: image_url(
            &entry.application_id,
            assets.large_image.as_deref(),
            application_metadata,
        ),
        small_image_url: image_url(
            &entry.application_id,
            assets.small_image.as_deref(),
            application_metadata,
        ),
        display_name,
        entry,
    }
}

fn image_url(
    application_id: &str,
    key: Option<&str>,
    metadata: Option<&ApplicationMetadata>,
) -> Option<String> {
    match assets::resolve_image(application_id, key?)? {
        ImageSource::Url(url) => Some(url),
        // An opaque key is meaningless without the application's asset table,
        // so an unresolved application simply has no artwork.
        ImageSource::AssetKey {
            application_id,
            key,
        } => {
            let asset_id = metadata?.asset_ids.get(&key)?;
            Some(assets::asset_url(&application_id, asset_id, ARTWORK_SIZE))
        }
    }
}

async fn resolve_application(http: &reqwest::Client, application_id: &str) -> ApplicationMetadata {
    ApplicationMetadata {
        name: fetch_json(http, &assets::application_rpc_url(application_id))
            .await
            .and_then(|value| {
                value
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .map(ToOwned::to_owned)
            }),
        asset_ids: fetch_json(http, &assets::application_assets_url(application_id))
            .await
            .map(|value| parse_asset_table(&value))
            .unwrap_or_default(),
    }
}

/// Turn Discord's `[{ id, name, type }]` asset list into a key lookup.
fn parse_asset_table(value: &serde_json::Value) -> HashMap<String, String> {
    let Some(items) = value.as_array() else {
        return HashMap::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let name = item.get("name")?.as_str()?.to_owned();
            let id = item.get("id")?.as_str()?.to_owned();
            Some((name, id))
        })
        .collect()
}

async fn fetch_json(http: &reqwest::Client, url: &str) -> Option<serde_json::Value> {
    let response = match http.get(url).timeout(RESOLVE_TIMEOUT).send().await {
        Ok(response) => response,
        Err(e) => {
            tracing::debug!(url, error = %e, "presence metadata lookup failed");
            return None;
        }
    };
    if !response.status().is_success() {
        tracing::debug!(url, status = %response.status(), "presence metadata unavailable");
        return None;
    }
    response.json().await.ok()
}

fn emit(app: &AppHandle, snapshot: PresenceSnapshot) {
    let _ = app.emit(PRESENCE_EVENT, snapshot);
}
