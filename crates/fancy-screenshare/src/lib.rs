//! Frontend-agnostic screen-sharing core for Fancy Mumble.
//!
//! This crate is the *model* layer of screen sharing: everything that is not
//! UI and not tied to a particular frontend framework lives here, so the
//! Tauri client and the minimal Qt client can share one implementation.
//!
//! * [`sources`] - enumerate capturable screens, windows and cameras and
//!   produce thumbnail previews for a source-picker UI.
//! * [`encode`] - the [`encode::VideoEncoder`] abstraction and the default
//!   H.264 (openh264) implementation, plus RGBA to I420 conversion.
//! * [`broadcast`] - [`broadcast::ScreenBroadcaster`], which captures the
//!   selected sources (screen/window and/or camera, one video track each),
//!   encodes them, and streams them to the Mumble server's WebRTC SFU as
//!   the broadcaster peer.
//!
//! Signaling stays with the embedder: the broadcaster emits SDP offers and
//! ICE candidates through the [`broadcast::SignalSink`] trait and is fed the
//! server's SDP answer back through [`broadcast::ScreenBroadcaster::accept_answer`].
//! How those travel (Mumble `WebRtcSignal` messages over the frontend's
//! connection) is the embedder's concern - this crate never touches the
//! Mumble protocol.

pub mod broadcast;
mod camera;
#[cfg(windows)]
mod camera_directshow;
pub mod encode;
#[cfg(all(windows, feature = "gpu"))]
mod gpu_windows;
#[cfg(all(windows, feature = "gpu"))]
mod gpu_windows_d3d12;
#[cfg(all(target_os = "linux", feature = "gpu"))]
mod linux;
mod pipeline;
pub mod sources;

pub use broadcast::{BroadcastSource, BroadcastState, ScreenBroadcaster, SignalSink};
pub use sources::{CaptureSource, SourceKind};
