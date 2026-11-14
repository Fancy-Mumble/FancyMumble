//! Sharing on Android, until it exists there: the web client's capture and
//! WebRTC crate (`fancy-screenshare`) does not build for Android (its
//! capture library, xcap, has no Android support, and its viewer is built
//! for Linux and Windows only), so this stands in for [`RealMedia`] of
//! `real.rs`. Shares in the channel are still heard of and shown as going
//! on, strokes still come and go, and starting or watching a share says
//! that this device cannot yet. Owed: watching (the viewer on Android) and
//! sharing (MediaProjection).

use std::sync::Arc;

use gpui::SharedString;
use mumble_tauri_lib::engine_api::EngineHandle;

use super::{Broadcast, Feed, Heard, Media, SignalKind, Source, Start, Stroke, Watch};
use crate::engine::EngineEvent;

/// What this device says when asked to share or watch.
const NOT_HERE: &str = "Screen sharing is not available on Android yet";

/// Sharing over the engine, without capture or peers.
pub(crate) struct RealMedia {
    engine: EngineHandle,
    runtime: tokio::runtime::Handle,
}

impl std::fmt::Debug for RealMedia {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RealMedia").finish_non_exhaustive()
    }
}

impl RealMedia {
    pub(crate) fn new(
        engine: EngineHandle,
        runtime: tokio::runtime::Handle,
        _events: async_channel::Sender<EngineEvent>,
    ) -> Self {
        Self { engine, runtime }
    }

    /// What the view is to hear of a signal that came: a START or STOP;
    /// the rest is for peers this device does not make.
    pub(crate) fn heard(
        &self,
        signal: mumble_tauri_lib::engine_api::media::SignalInfo,
    ) -> Option<Heard> {
        let kind = SignalKind::of(signal.kind)?;
        matches!(kind, SignalKind::Start | SignalKind::Stop).then(|| {
            Heard::Signal(super::Signal {
                server: signal.server.map(Into::into),
                sender: signal.sender,
                kind,
                payload: signal.payload,
            })
        })
    }
}

impl Media for RealMedia {
    fn sources(&self) -> Result<Vec<Source>, String> {
        Ok(Vec::new())
    }

    fn thumbnail(&self, _source: &Source) -> Option<Arc<gpui::Image>> {
        None
    }

    fn broadcast(&self, _start: Start) -> Result<Box<dyn Broadcast>, String> {
        Err(NOT_HERE.to_owned())
    }

    fn watch(&self, _watch: Watch) -> Result<Box<dyn Feed>, String> {
        Err(NOT_HERE.to_owned())
    }

    fn announce(&self, server: Option<SharedString>, kind: SignalKind, payload: String) {
        let engine = self.engine.clone();
        let server = server.map(|server| server.to_string());
        drop(self.runtime.spawn(async move {
            if let Err(error) = engine.send_webrtc_signal(0, kind.wire(), payload, server).await {
                tracing::warn!(%error, ?kind, "share: a signal was not sent");
            }
        }));
    }

    fn stroke(&self, stroke: Stroke) {
        let engine = self.engine.clone();
        drop(self.runtime.spawn(async move {
            let sent = engine
                .send_draw_stroke(mumble_tauri_lib::engine_api::media::StrokeInfo {
                    sender: stroke.sender,
                    channel: stroke.channel,
                    id: stroke.id,
                    colour: stroke.colour,
                    width: stroke.width,
                    width_frac: stroke.width_frac,
                    points: stroke.points,
                    end: stroke.end,
                    clear: stroke.clear,
                    clear_all: stroke.clear_all,
                })
                .await;
            if let Err(error) = sent {
                tracing::warn!(%error, "share: a stroke was not sent");
            }
        }));
    }

    fn relays(&self) -> bool {
        self.engine.relays_media()
    }

    fn made_up(&self) -> bool {
        false
    }

    fn hearing(&self) -> Arc<dyn super::audio::Hearing> {
        Arc::new(super::audio::Unheard::default())
    }

    fn whereabouts(&self) -> Arc<dyn super::whereabouts::Whereabouts> {
        Arc::new(super::whereabouts::System)
    }
}

/// What the view is to hear of a stroke that came.
pub(crate) fn heard_stroke(stroke: mumble_tauri_lib::engine_api::media::StrokeInfo) -> Heard {
    Heard::Stroke(Stroke {
        sender: stroke.sender,
        channel: stroke.channel,
        id: stroke.id,
        colour: stroke.colour,
        width: stroke.width,
        width_frac: stroke.width_frac,
        points: stroke.points,
        end: stroke.end,
        clear: stroke.clear,
        clear_all: stroke.clear_all,
    })
}
