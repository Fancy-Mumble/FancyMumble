//! What a watched share's computer plays: heard with voice, through the
//! output the client uses for voice, at a volume of its own, and muted on
//! the stage, as the web client's viewer does (`stream_audio.rs` in the
//! engine, the volume control of `ScreenShareViewer.tsx`).
//!
//! The viewer decodes the share's Opus to 20 ms of stereo at 48 kHz
//! (`fancy_screenshare::viewer`). That goes to a [`Hearing`]: the engine's
//! voice mixer, which sums it with voice under an id of its own, so voice is
//! not ducked or delayed and the output device is the voice one; or, in a
//! silent run, nowhere ([`Unheard`]), where it is only counted. Nothing is
//! heard of one's own share (it would be captured again), and nothing at all
//! while voice is off: there is no output open to mix into.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use crate::engine::Session;

/// Where a watched share's sound goes.
pub(crate) trait Hearing: Send + Sync + std::fmt::Debug {
    /// 20 ms of `session`'s share's sound: interleaved stereo at 48 kHz.
    fn hear(&self, session: Session, stereo: &[f32]);
    /// How loud `session`'s share is played: 1 as sent, 0 not at all.
    fn set_volume(&self, session: Session, volume: f32);
    /// `session`'s share is no longer watched: what is queued of it goes.
    fn stop(&self, session: Session);
}

/// How each watched share's sound is set, and whether it has any: what the
/// stage's control shows, kept apart from where the sound goes.
#[derive(Debug, Default)]
pub(crate) struct Loudness {
    set: Mutex<HashMap<Session, Set>>,
}

/// One share's volume, whether it is muted, and when it was last heard.
#[derive(Debug, Clone, Copy)]
struct Set {
    volume: f32,
    muted: bool,
    heard: Option<Instant>,
}

impl Default for Set {
    fn default() -> Self {
        Self {
            volume: 1.0,
            muted: false,
            heard: None,
        }
    }
}

/// A share not heard from for this long has no sound to control.
const QUIET_FOR: Duration = Duration::from_secs(3);

impl Loudness {
    fn with<R>(&self, session: Session, change: impl FnOnce(&mut Set) -> R) -> R {
        let mut set = self.set.lock().unwrap_or_else(PoisonError::into_inner);
        change(set.entry(session).or_default())
    }

    /// `session`'s share was heard just now.
    pub(crate) fn heard(&self, session: Session) {
        self.with(session, |set| set.heard = Some(Instant::now()));
    }

    /// Whether `session`'s share has sound to control.
    pub(crate) fn has_sound(&self, session: Session) -> bool {
        self.with(session, |set| set.heard.is_some_and(|at| at.elapsed() < QUIET_FOR))
    }

    /// Its volume, 0 to 1, and whether it is muted.
    pub(crate) fn of(&self, session: Session) -> (f32, bool) {
        self.with(session, |set| (set.volume, set.muted))
    }

    /// What it is played at: its volume, or nothing when muted.
    #[cfg(test)]
    pub(crate) fn gain(&self, session: Session) -> f32 {
        self.with(session, |set| if set.muted { 0.0 } else { set.volume })
    }

    /// Set its volume. Raised above nothing, a muted share is unmuted, as
    /// the web client's slider does.
    pub(crate) fn set_volume(&self, session: Session, volume: f32) -> f32 {
        self.with(session, |set| {
            set.volume = volume.clamp(0.0, 1.0);
            set.muted = set.volume == 0.0;
            if set.muted { 0.0 } else { set.volume }
        })
    }

    /// Mute it, or unmute it at the volume it had.
    pub(crate) fn toggle_mute(&self, session: Session) -> f32 {
        self.with(session, |set| {
            set.muted = !set.muted;
            if set.muted { 0.0 } else { set.volume.max(0.05) }
        })
    }

    /// Forget it: the share is no longer watched.
    pub(crate) fn forget(&self, session: Session) {
        let _ = self
            .set
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&session);
    }
}

/// A hearing that plays nothing: what a silent run, and every test, hears
/// through. It keeps what it was given, scaled as it would be played, so a
/// test can read it back.
#[derive(Debug, Default)]
pub(crate) struct Unheard {
    heard: Mutex<HashMap<Session, Vec<f32>>>,
    volumes: Mutex<HashMap<Session, f32>>,
}

/// How much of each share is kept by an [`Unheard`]: two seconds.
const KEPT: usize = 48_000 * 2 * 2;

impl Unheard {
    /// What `session`'s share would have played, scaled by its volume.
    #[cfg(test)]
    pub(crate) fn played(&self, session: Session) -> Vec<f32> {
        self.heard
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&session)
            .cloned()
            .unwrap_or_default()
    }
}

impl Hearing for Unheard {
    fn hear(&self, session: Session, stereo: &[f32]) {
        let gain = self
            .volumes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&session)
            .copied()
            .unwrap_or(1.0);
        let mut heard = self.heard.lock().unwrap_or_else(PoisonError::into_inner);
        let kept = heard.entry(session).or_default();
        kept.extend(stereo.iter().map(|sample| sample * gain));
        let over = kept.len().saturating_sub(KEPT);
        drop(kept.drain(..over));
    }

    fn set_volume(&self, session: Session, volume: f32) {
        let _ = self
            .volumes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(session, volume);
    }

    fn stop(&self, session: Session) {
        let _ = self
            .heard
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&session);
    }
}

/// What a share's sound goes through before it is heard: noted as heard,
/// for the stage's control, and dropped where it is one's own.
#[derive(Debug)]
pub(crate) struct Ear {
    pub hearing: Arc<dyn Hearing>,
    pub loudness: Arc<Loudness>,
}

impl Ear {
    /// 20 ms of `session`'s share's sound.
    pub(crate) fn hear(&self, session: Session, own: bool, stereo: &[f32]) {
        self.loudness.heard(session);
        if !own {
            self.hearing.hear(session, stereo);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_share_starts_at_full_volume_and_mute_keeps_the_volume_to_come_back_to() {
        let loudness = Loudness::default();
        assert_eq!(loudness.of(7), (1.0, false));
        assert!(!loudness.has_sound(7), "nothing heard yet");
        loudness.heard(7);
        assert!(loudness.has_sound(7));
        assert_eq!(loudness.set_volume(7, 0.4), 0.4);
        assert_eq!(loudness.toggle_mute(7), 0.0);
        assert_eq!(loudness.gain(7), 0.0);
        assert_eq!(loudness.toggle_mute(7), 0.4, "back at the volume it had");
        assert_eq!(loudness.set_volume(7, 0.0), 0.0);
        assert!(loudness.of(7).1, "nothing is muted");
        assert_eq!(loudness.set_volume(7, 0.6), 0.6, "raised: unmuted");
        assert_eq!(loudness.of(7), (0.6, false));
        loudness.forget(7);
        assert_eq!(loudness.of(7), (1.0, false));
    }

    #[test]
    fn nothing_is_heard_of_ones_own_share_and_what_is_heard_is_scaled() {
        let unheard = Arc::new(Unheard::default());
        let ear = Ear {
            hearing: unheard.clone(),
            loudness: Arc::default(),
        };
        ear.hear(1, true, &[0.5; 1920]);
        assert!(unheard.played(1).is_empty(), "one's own is never played");
        assert!(ear.loudness.has_sound(1), "but its control shows");
        unheard.set_volume(2, 0.5);
        ear.hear(2, false, &[0.5; 1920]);
        assert!(unheard.played(2).iter().all(|sample| (*sample - 0.25).abs() < 1e-6));
        unheard.stop(2);
        assert!(unheard.played(2).is_empty());
    }
}
