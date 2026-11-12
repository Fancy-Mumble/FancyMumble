//! Whether the local microphone is transmitting.
//!
//! `SharedState::audio::talking_sessions` holds only *remote* speakers - the
//! local user's talking goes straight to the view and is never recorded - so
//! anything that asks "is anyone talking" has to ask here as well.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

/// The local talking state, written by the outbound audio loop and read by
/// whatever polls for activity.
///
/// Atomics rather than a field on `SharedState` because the writer is the
/// audio loop, and taking that lock on an utterance edge is how the mixer
/// ends up dropping samples.
#[derive(Debug, Default)]
pub(crate) struct LocalTalking {
    talking: AtomicBool,
    /// Unix epoch milliseconds of the latest edge, zero before the first.
    ///
    /// The bool alone is not enough for anything that polls: "yes" is true
    /// only while a packet is in flight, and a two-word reply is over long
    /// before a half-second tick comes round to look. This is the edge that
    /// cannot be missed, so pollers ask how long ago rather than whether
    /// right now.
    changed_at_ms: AtomicU64,
}

impl LocalTalking {
    /// Record that the microphone started or stopped transmitting.
    ///
    /// Two relaxed stores, on the edges only, so the audio loop pays a few
    /// nanoseconds once per utterance and never a lock.
    pub(crate) fn set(&self, talking: bool) {
        self.talking.store(talking, Ordering::Relaxed);
        // Stamped on both edges: a poller that only ever sees "not talking
        // now" still has to be able to tell a moment ago from a minute ago.
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
        self.changed_at_ms.store(now_ms, Ordering::Relaxed);
    }

    /// Whether the microphone is transmitting right now.
    pub(crate) fn is_talking(&self) -> bool {
        self.talking.load(Ordering::Relaxed)
    }

    /// When it last started or stopped, in Unix epoch milliseconds; zero if
    /// it never has.
    #[cfg_attr(
        target_os = "android",
        allow(dead_code, reason = "asked only by the desktop overlay watcher")
    )]
    pub(crate) fn changed_at_ms(&self) -> u64 {
        self.changed_at_ms.load(Ordering::Relaxed)
    }
}
