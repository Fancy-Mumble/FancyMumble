//! Screen sharing: one's own screen sent to the channel, the shares of
//! others watched, and drawing on a shared picture.
//!
//! The view reaches it through [`Media`], which an engine gives
//! ([`crate::engine::Engine::media`]): [`real::RealMedia`] over the web
//! client's own `fancy-screenshare` crate and the engine's connection, and
//! [`made_up::MadeUp`], which shares and shows a generated test pattern and
//! sends nothing anywhere, for the demo engine and the tests. Nothing of
//! capture or WebRTC exists until a share is started or watched.
//!
//! What a frame goes through, from the wire to the window: the viewer peer
//! (`fancy_screenshare::viewer`) hands over H.264, [`decode`] decodes it on
//! a thread of its own while it is in sight and makes a frame as large as it
//! is drawn and as often as the window wants one ([`frame::Wanted`]), the
//! [`frame::FrameSlot`] holds the newest (a frame the window did not take in
//! time is dropped), and the stage uploads its pixels into the texture the
//! stream already has (GPUI's dynamic textures, `Window::update_dynamic_texture`)
//! instead of making a picture a frame.
//!
//! # One user on several devices
//!
//! A server like Starling shows an account online from several devices to
//! everybody else as one user, under the first device's session id
//! (`presented_as`), and shows each device the others as itself. For a
//! share that means: when any device of a user shares, the others see one
//! user sharing, under that one id, and the server sends what they ask of
//! that id to the device that is actually sharing (`presenting_device` in
//! its `screenshare` service), so a viewer never knows or needs which
//! device it is. The user's other devices are told of the share as their
//! own session: a START from oneself while not sharing is a share of one's
//! own account from another device. It is shown as one's own, can be
//! watched like any other (the server routes the offer to the sharing
//! device), and is not stoppable from here, because a STOP from a device
//! that is not sharing would tell the channel the share ended while it goes
//! on. Nor is a second share started from here while it runs: the server
//! would have two shares under one id and route viewers to either. When the
//! sharing device leaves, the server ends the share and tells the channel;
//! when another device leaves, even the one whose id the user is shown by,
//! nothing changes for those watching. See [`announce`] for the one gap a
//! late sibling device leaves, and how it is closed.

pub(crate) mod announce;
pub(crate) mod audio;
pub(crate) mod convert;
pub(crate) mod decode;
pub(crate) mod fit;
pub(crate) mod frame;
pub(crate) mod made_up;
pub(crate) mod pattern;
// Android has no capture or peers yet (`fancy-screenshare` does not build
// there): a stand-in that knows of shares without making them.
#[cfg_attr(target_os = "android", path = "real_absent.rs")]
pub(crate) mod real;
pub(crate) mod replay;
pub(crate) mod shares;
pub(crate) mod signal;
pub(crate) mod source;
pub(crate) mod stroke;
pub(crate) mod tracks;
pub(crate) mod whereabouts;

use std::sync::Arc;

use gpui::SharedString;

use crate::engine::Session;

pub(crate) use fit::Fit;
pub(crate) use frame::{FrameSlot, Wanted};
pub(crate) use signal::{Signal, SignalKind};
pub(crate) use source::{Quality, Settings, Source, SourceKind};
pub(crate) use stroke::Stroke;
pub(crate) use tracks::Tracks;

/// Wakes the window when a stream has something new to draw.
#[derive(Debug, Clone)]
pub(crate) struct Wake(async_channel::Sender<()>);

impl Wake {
    /// A waker, and what the window waits on.
    pub(crate) fn new() -> (Self, async_channel::Receiver<()>) {
        let (wake, woken) = async_channel::bounded(1);
        (Self(wake), woken)
    }

    /// Wake it: once, however often this is said before it wakes.
    pub(crate) fn now(&self) {
        let _ = self.0.try_send(());
    }

    /// A waker nobody waits on.
    #[cfg(test)]
    pub(crate) fn nowhere() -> Self {
        Self::new().0
    }
}

/// How a peer of a share stands: the broadcaster, or a viewer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Standing {
    Connecting,
    Connected,
    Failed(String),
    Stopped,
}

/// What the view hears of sharing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Heard {
    /// A share began or ended in the channel.
    Signal(Signal),
    /// A stroke drawn on a share, or a clearing.
    Stroke(Stroke),
    /// How the local user's own share stands.
    Broadcast(Standing),
    /// How the viewer of `session`'s share stands.
    Watch { session: Session, standing: Standing },
}

/// A share to start.
#[derive(Debug, Clone)]
pub(crate) struct Start {
    /// The server it is on: its signalling goes there, whatever is on
    /// screen later.
    pub server: Option<SharedString>,
    pub sources: Vec<Source>,
    pub settings: Settings,
}

/// A share to watch, and where its frames go.
#[derive(Debug, Clone)]
pub(crate) struct Watch {
    pub server: Option<SharedString>,
    pub session: Session,
    /// The local user's own share (its preview), or their account's on
    /// another device: what is heard of it is never played.
    pub own: bool,
    /// The tracks shown: the screen, and a camera beside it where there is
    /// one. Each is decoded only while it is drawn.
    pub tracks: Vec<WatchTrack>,
    pub wake: Wake,
    /// Where what the share's computer plays goes.
    pub ear: Arc<audio::Ear>,
}

/// One track of a watched share, and where its frames go.
#[derive(Debug, Clone)]
pub(crate) struct WatchTrack {
    pub mid: String,
    pub wanted: Arc<Wanted>,
    pub slot: FrameSlot,
}

/// What the sharer's uplink is doing.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Uplink {
    pub target_kbps: u32,
    pub ceiling_kbps: u32,
    pub loss: f32,
    pub rtt_ms: Option<u32>,
}

/// What is known of a watched share, for the stage's caption and the
/// statistics.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct FeedStats {
    pub connection: String,
    pub rtt_ms: Option<f64>,
    pub ice: Option<String>,
    /// The size it is sent at.
    pub sent: Option<(u32, u32)>,
    pub decoded: u64,
    pub skipped: u64,
    pub failed: u64,
    /// Average decode and colour work, per frame decoded.
    pub busy_ms: Option<f64>,
    pub packets: u64,
    pub bytes: u64,
    pub lost: u64,
    pub jitter_ms: Option<f64>,
    pub audio: bool,
}

/// One's own share, running.
pub(crate) trait Broadcast: Send {
    /// What the uplink is doing.
    fn uplink(&self) -> Option<Uplink>;
    /// Stop it. Blocks for as long as capture takes to let go: off the
    /// window's thread.
    fn stop(self: Box<Self>);
}

/// A share being watched.
pub(crate) trait Feed: Send {
    /// Ask how it goes. Blocks up to two seconds: off the window's thread.
    fn stats(&self) -> FeedStats;
    /// Stop watching. Blocks while the peer closes: off the window's thread.
    fn stop(self: Box<Self>);
}

/// Everything sharing needs of an engine.
pub(crate) trait Media: Send + Sync {
    /// What can be shared. Slow: off the window's thread.
    ///
    /// # Errors
    ///
    /// When the system would not say.
    fn sources(&self) -> Result<Vec<Source>, String>;
    /// A small picture of `source`, for the picker. Slow, as above.
    fn thumbnail(&self, source: &Source) -> Option<Arc<gpui::Image>>;
    /// Start sharing. The START must have been said first. Slow, as above.
    ///
    /// # Errors
    ///
    /// When a source is gone or the peer could not be made.
    fn broadcast(&self, start: Start) -> Result<Box<dyn Broadcast>, String>;
    /// Watch a share. Slow, as above.
    ///
    /// # Errors
    ///
    /// When the peer could not be made.
    fn watch(&self, watch: Watch) -> Result<Box<dyn Feed>, String>;
    /// Say START or STOP to the local user's channel on `server`.
    fn announce(&self, server: Option<SharedString>, kind: SignalKind, payload: String);
    /// Send one packet of a stroke.
    fn stroke(&self, stroke: Stroke);
    /// Whether the server on screen relays shares (it has an SFU).
    fn relays(&self) -> bool;
    /// Whether what is offered to share is the test pattern, and not this
    /// computer's screens.
    fn made_up(&self) -> bool;
    /// Where what a watched share's computer plays is heard.
    fn hearing(&self) -> Arc<dyn audio::Hearing>;
    /// Where what is shared lies on this computer's screens.
    fn whereabouts(&self) -> Arc<dyn whereabouts::Whereabouts>;
}
