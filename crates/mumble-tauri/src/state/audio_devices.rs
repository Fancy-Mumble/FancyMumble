//! Which microphones and speakers there are, and putting a change of audio
//! settings into effect.
//!
//! Part of the engine rather than of any one view: every view's settings
//! offer the same devices and apply a change the same way.

use super::AppState;
use super::types::{AudioDevice, AudioSettings};
use crate::audio;

/// The microphones the system offers.
///
/// Blocking: device enumeration can stall on a driver for hundreds of
/// milliseconds, so call it from the blocking pool, never from a runtime
/// worker or a view's own thread.
#[cfg(not(target_os = "android"))]
pub(crate) fn inputs() -> Vec<AudioDevice> {
    #[cfg(target_os = "linux")]
    if audio::pipewire::available() {
        return pipewire_devices(audio::pipewire::Kind::Source);
    }
    audio::devices::inputs()
        .into_iter()
        .map(|d| AudioDevice {
            name: d.name,
            is_default: d.is_default,
        })
        .collect()
}

/// The speakers the system offers. Blocking, like [`inputs`].
#[cfg(not(target_os = "android"))]
pub(crate) fn outputs() -> Vec<AudioDevice> {
    #[cfg(target_os = "linux")]
    if audio::pipewire::available() {
        return pipewire_devices(audio::pipewire::Kind::Sink);
    }
    audio::devices::outputs()
        .into_iter()
        .map(|d| AudioDevice {
            name: d.name,
            is_default: d.is_default,
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn pipewire_devices(kind: audio::pipewire::Kind) -> Vec<AudioDevice> {
    audio::pipewire::nodes(kind)
        .into_iter()
        .map(|n| AudioDevice {
            name: n.name,
            is_default: n.is_default,
        })
        .collect()
}

impl AppState {
    /// Take `settings` as the audio settings and restart whichever pipelines
    /// the change touches.
    ///
    /// # Errors
    ///
    /// When a pipeline could not be restarted, for instance because the
    /// newly chosen device cannot be opened.
    pub fn apply_audio_settings(&self, settings: AudioSettings) -> Result<(), String> {
        let state = self;
        let force_tcp = settings.force_tcp_audio;
        // Apply the exclusive-input selection before any pipeline restart below
        // so the (re)opened capture uses the new mode.
        audio::set_exclusive_input(settings.exclusive_input);
        let (needs_outbound, needs_inbound, force_tcp_changed) = state
            .set_audio_settings(settings)
            .unwrap_or((false, false, false));

        if needs_outbound {
            state.restart_outbound()?;
        }
        if needs_inbound {
            state.restart_inbound()?;
        }
        if force_tcp_changed
            && let Ok(inner) = state.inner.snapshot().lock()
            && let Some(ref handle) = inner.conn.client_handle
        {
            handle.set_force_tcp(force_tcp);
        }

        Ok(())
    }
}
