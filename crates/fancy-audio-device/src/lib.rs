//! Shared cpal-based audio device backend for the Fancy Mumble clients.
//!
//! This crate implements the protocol library's
//! [`AudioCapture`](mumble_protocol::audio::capture::AudioCapture) trait
//! (microphone input) and a [`MixingPlayback`] device that reads decoded
//! samples from the per-speaker buffers filled by
//! [`AudioMixer`](mumble_protocol::audio::mixer::AudioMixer) and sums them
//! in the output callback.
//!
//! It was extracted from the Tauri desktop app so that any front-end
//! (Tauri, Qt, headless) can drive real hardware through the exact same,
//! well-tested code path.  It depends only on `mumble-protocol` and
//! `cpal`, never on a specific GUI toolkit.

mod capture;
mod playback;
#[cfg(target_os = "windows")]
pub mod wasapi;

pub use capture::CpalCapture;
pub use playback::{batch_drain_speakers, CpalMixingPlayback};
#[cfg(target_os = "windows")]
pub use wasapi::{capture_device_users, WasapiCapture};

// The `MixingPlayback` trait and `soft_clip` helper live in `mumble-protocol`
// (no cpal dependency) so every backend - cpal, rodio, oboe - shares one
// interface.  Re-exported here for convenience so callers that only pull in
// this crate still have them in scope.
pub use mumble_protocol::audio::playback::{soft_clip, MixingPlayback};
