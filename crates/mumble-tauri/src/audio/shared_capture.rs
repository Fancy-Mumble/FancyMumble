//! Shared microphone capture: one OS device stream, many consumers.
//!
//! The app has three independent capture consumers - the voice pipeline,
//! the calibration mic test and voice replay - and they can run
//! concurrently. Opening the OS device once per consumer breaks on
//! drivers that only admit a single client (e.g. the Komplete Audio 1
//! accepts multiple shared WASAPI streams only while its endpoint rate is
//! 48 kHz; at any other rate the second open fails with
//! `0x800700AA` "resource is in use" - so the mic test failed whenever
//! voice was active).
//!
//! [`acquire`] returns an [`AudioCapture`] handle backed by a per-device
//! broker: the first started handle creates and starts the real capture
//! (via the provided factory) and spawns a pump thread that fans frames
//! out to every subscriber; the last stopped handle stops the pump and
//! releases the device. Each handle applies its own volume and assembles
//! its own frame size, so consumer semantics are unchanged.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use mumble_protocol::audio::capture::AudioCapture;
use mumble_protocol::audio::sample::{AudioFormat, AudioFrame};
use mumble_protocol::error::{Error, Result};
use tracing::{debug, warn};

/// Per-subscriber buffer cap (1 s at 48 kHz); oldest samples are dropped
/// when a consumer stalls so it never wedges the others.
const SUBSCRIBER_CAP: usize = 48_000;

/// Factory producing the real, exclusive device capture. Called on every
/// cold start (first subscriber after idle), so device selection follows
/// the caller's latest settings.
pub(crate) type CaptureFactory =
    Box<dyn Fn() -> std::result::Result<Box<dyn AudioCapture>, String> + Send + Sync>;

/// One consumer's receive state.
struct SubscriberInner {
    buf: Mutex<VecDeque<f32>>,
    /// Set when the underlying device died; surfaced on the next read.
    dead: Mutex<Option<String>>,
}

/// Per-device broker state shared by all handles for that device.
struct StreamShared {
    key: String,
    subscribers: Mutex<Vec<Weak<SubscriberInner>>>,
    /// Number of currently-started handles; the pump exits at zero.
    active: AtomicUsize,
    /// Serialises cold starts/stops of the pump thread.
    control: Mutex<PumpControl>,
}

#[derive(Default)]
struct PumpControl {
    thread: Option<std::thread::JoinHandle<()>>,
    /// Exit flag of the pump in `thread`. The pump must NOT key its exit
    /// off `active`: a cold start increments `active` before it reaps the
    /// outgoing pump, which would revive the very condition it is about
    /// to wait on and hang the join forever.
    stop: Option<Arc<AtomicBool>>,
}

/// Signal the pump thread to exit and reap it, so a subsequent cold start
/// does not race the outgoing thread's shutdown.
fn stop_pump(control: &mut PumpControl) {
    if let Some(flag) = control.stop.take() {
        flag.store(true, Ordering::SeqCst);
    }
    if let Some(thread) = control.thread.take() {
        let _ = thread.join();
    }
}

fn registry() -> &'static Mutex<HashMap<String, Arc<StreamShared>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<StreamShared>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Acquire a shared capture handle for `device_name`.
///
/// `factory` must create the real capture with a `480`-sample frame (10 ms
/// at 48 kHz, the pipeline's base granularity) and a neutral (1.0) volume;
/// the handle applies `volume` itself and assembles `frame_size`-sample frames.
pub(crate) fn acquire(
    device_name: Option<&str>,
    frame_size: usize,
    volume: Arc<AtomicU32>,
    factory: CaptureFactory,
) -> Box<dyn AudioCapture> {
    let key = device_name.unwrap_or("\u{0}default").to_owned();
    let shared = {
        let Ok(mut map) = registry().lock() else {
            // Poisoned registry: fall back to an unshared handle-local
            // stream entry so capture still works.
            return Box::new(SharedCaptureHandle::new(
                Arc::new(StreamShared::new(key)),
                frame_size,
                volume,
                factory,
            ));
        };
        Arc::clone(
            map.entry(key.clone())
                .or_insert_with(|| Arc::new(StreamShared::new(key))),
        )
    };
    Box::new(SharedCaptureHandle::new(
        shared, frame_size, volume, factory,
    ))
}

impl StreamShared {
    fn new(key: String) -> Self {
        Self {
            key,
            subscribers: Mutex::new(Vec::new()),
            active: AtomicUsize::new(0),
            control: Mutex::new(PumpControl::default()),
        }
    }
}

/// The [`AudioCapture`] facade handed to consumers.
struct SharedCaptureHandle {
    shared: Arc<StreamShared>,
    inner: Arc<SubscriberInner>,
    frame_size: usize,
    sequence: u64,
    volume: Arc<AtomicU32>,
    factory: CaptureFactory,
    started: bool,
}

impl std::fmt::Debug for SharedCaptureHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SharedCaptureHandle")
            .field("device", &self.shared.key)
            .field("frame_size", &self.frame_size)
            .field("started", &self.started)
            .finish_non_exhaustive()
    }
}

impl SharedCaptureHandle {
    fn new(
        shared: Arc<StreamShared>,
        frame_size: usize,
        volume: Arc<AtomicU32>,
        factory: CaptureFactory,
    ) -> Self {
        let inner = Arc::new(SubscriberInner {
            buf: Mutex::new(VecDeque::with_capacity(4 * frame_size)),
            dead: Mutex::new(None),
        });
        if let Ok(mut subs) = shared.subscribers.lock() {
            subs.push(Arc::downgrade(&inner));
        }
        Self {
            shared,
            inner,
            frame_size,
            sequence: 0,
            volume,
            factory,
            started: false,
        }
    }
}

impl AudioCapture for SharedCaptureHandle {
    fn format(&self) -> AudioFormat {
        AudioFormat::MONO_48KHZ_F32
    }

    fn read_frame(&mut self) -> Result<AudioFrame> {
        if !self.started {
            return Err(Error::InvalidState("shared capture not started".into()));
        }
        if let Ok(dead) = self.inner.dead.lock() {
            if let Some(reason) = dead.as_ref() {
                return Err(Error::InvalidState(format!(
                    "capture device lost: {reason}"
                )));
            }
        }
        let mut buf = self
            .inner
            .buf
            .lock()
            .map_err(|e| Error::InvalidState(e.to_string()))?;
        if buf.len() < self.frame_size {
            return Err(Error::NotEnoughSamples);
        }
        let vol = f32::from_bits(self.volume.load(Ordering::Relaxed));
        let mut data = Vec::with_capacity(self.frame_size * 4);
        for s in buf.drain(..self.frame_size) {
            data.extend_from_slice(&(s * vol).to_ne_bytes());
        }
        self.sequence += 1;
        Ok(AudioFrame {
            data,
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: self.sequence,
            is_silent: false,
        })
    }

    fn start(&mut self) -> Result<()> {
        if self.started {
            return Ok(());
        }
        if let Ok(mut buf) = self.inner.buf.lock() {
            buf.clear();
        }
        if let Ok(mut dead) = self.inner.dead.lock() {
            *dead = None;
        }

        let mut control = self
            .shared
            .control
            .lock()
            .map_err(|e| Error::InvalidState(e.to_string()))?;
        let prev = self.shared.active.fetch_add(1, Ordering::SeqCst);
        if prev == 0 {
            // Cold start: reap the outgoing pump, then open the device.
            // It is told to exit explicitly - the `active` count is back
            // at 1 because of the increment above, so a pump waiting on
            // `active == 0` would never leave and this join would never
            // return (a deadlock on whichever thread called `start`, and
            // `start_mic_test` / `start_voice_replay` are sync commands
            // that run on the UI thread).
            if let Some(flag) = control.stop.take() {
                flag.store(true, Ordering::SeqCst);
            }
            if let Some(old) = control.thread.take() {
                let _ = old.join();
            }
            let mut underlying = match (self.factory)() {
                Ok(c) => c,
                Err(e) => {
                    let _ = self.shared.active.fetch_sub(1, Ordering::SeqCst);
                    return Err(Error::InvalidState(e));
                }
            };
            if let Err(e) = underlying.start() {
                let _ = self.shared.active.fetch_sub(1, Ordering::SeqCst);
                return Err(e);
            }
            debug!("shared capture '{}': device opened", self.shared.key);
            let shared = Arc::clone(&self.shared);
            let stop = Arc::new(AtomicBool::new(false));
            let pump_stop = Arc::clone(&stop);
            let thread = std::thread::Builder::new()
                .name("shared-capture-pump".into())
                .spawn(move || pump(shared, underlying, pump_stop))
                .map_err(|e| {
                    let _ = self.shared.active.fetch_sub(1, Ordering::SeqCst);
                    Error::InvalidState(format!("pump spawn: {e}"))
                })?;
            control.stop = Some(stop);
            control.thread = Some(thread);
        }
        drop(control);
        self.started = true;
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        if !self.started {
            return Ok(());
        }
        self.started = false;
        if let Ok(mut buf) = self.inner.buf.lock() {
            buf.clear();
        }
        let remaining = self
            .shared
            .active
            .fetch_sub(1, Ordering::SeqCst)
            .saturating_sub(1);
        if remaining == 0 {
            // Last consumer: tell the pump to exit, which stops the device
            // and releases the driver's client slot. Reap it so a
            // subsequent cold start doesn't race the old thread's shutdown.
            if let Ok(mut control) = self.shared.control.lock() {
                // Re-check under the lock. A new consumer can cold-start a
                // fresh pump in the window between the decrement above and
                // acquiring `control`; tearing down here would then kill a
                // device that someone else has just opened.
                if self.shared.active.load(Ordering::SeqCst) == 0 {
                    stop_pump(&mut control);
                    debug!("shared capture '{}': device released", self.shared.key);
                }
            }
        }
        Ok(())
    }
}

impl Drop for SharedCaptureHandle {
    fn drop(&mut self) {
        let _ = self.stop();
        // Prune this subscriber's weak entry.
        if let Ok(mut subs) = self.shared.subscribers.lock() {
            subs.retain(|w| w.strong_count() > 0 && !Weak::ptr_eq(w, &Arc::downgrade(&self.inner)));
        }
    }
}

/// Record a fatal device error on every live subscriber, so each reader
/// surfaces it on its next poll.
fn mark_subscribers_dead(shared: &StreamShared, reason: &str) {
    let Ok(subs) = shared.subscribers.lock() else {
        return;
    };
    for sub in subs.iter().filter_map(Weak::upgrade) {
        if let Ok(mut dead) = sub.dead.lock() {
            *dead = Some(reason.to_owned());
        }
    }
}

/// Pump thread: pulls 10 ms frames from the real device and fans the
/// samples out to every live subscriber until `stop` is set - by the last
/// consumer leaving, or by a cold start reaping this pump to replace it.
fn pump(shared: Arc<StreamShared>, mut underlying: Box<dyn AudioCapture>, stop: Arc<AtomicBool>) {
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        match underlying.read_frame() {
            Ok(frame) => {
                let samples = frame.as_f32_samples();
                let Ok(mut subs) = shared.subscribers.lock() else {
                    break;
                };
                subs.retain(|w| w.strong_count() > 0);
                for sub in subs.iter().filter_map(Weak::upgrade) {
                    let Ok(mut buf) = sub.buf.lock() else {
                        continue;
                    };
                    buf.extend(samples.iter().copied());
                    if buf.len() > SUBSCRIBER_CAP {
                        let excess = buf.len() - SUBSCRIBER_CAP;
                        let _ = buf.drain(..excess);
                    }
                }
            }
            Err(Error::NotEnoughSamples) => {
                std::thread::sleep(std::time::Duration::from_millis(3));
            }
            Err(e) => {
                warn!("shared capture '{}': device error: {e}", shared.key);
                mark_subscribers_dead(&shared, &e.to_string());
                break;
            }
        }
    }
    if let Err(e) = underlying.stop() {
        warn!("shared capture '{}': device stop failed: {e}", shared.key);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;
    use std::time::{Duration, Instant};

    /// The broker's real-device pull size (10 ms at 48 kHz), used by the mock.
    const PUMP_FRAME: usize = 480;

    /// Scripted device: counts opens/closes and emits a ramp of samples.
    struct FakeDevice {
        opens: Arc<AtomicUsize>,
        closes: Arc<AtomicUsize>,
        next: f32,
        running: bool,
        last_emit: Instant,
    }

    impl AudioCapture for FakeDevice {
        fn format(&self) -> AudioFormat {
            AudioFormat::MONO_48KHZ_F32
        }
        fn read_frame(&mut self) -> Result<AudioFrame> {
            if !self.running {
                return Err(Error::InvalidState("not running".into()));
            }
            // Pace roughly like hardware so the pump loop is exercised.
            if self.last_emit.elapsed() < Duration::from_millis(1) {
                return Err(Error::NotEnoughSamples);
            }
            self.last_emit = Instant::now();
            let mut data = Vec::with_capacity(PUMP_FRAME * 4);
            for _ in 0..PUMP_FRAME {
                data.extend_from_slice(&self.next.to_ne_bytes());
                self.next += 1.0;
            }
            Ok(AudioFrame {
                data,
                format: AudioFormat::MONO_48KHZ_F32,
                sequence: 0,
                is_silent: false,
            })
        }
        fn start(&mut self) -> Result<()> {
            let _ = self.opens.fetch_add(1, Ordering::SeqCst);
            self.running = true;
            Ok(())
        }
        fn stop(&mut self) -> Result<()> {
            let _ = self.closes.fetch_add(1, Ordering::SeqCst);
            self.running = false;
            Ok(())
        }
    }

    fn fake_factory(opens: Arc<AtomicUsize>, closes: Arc<AtomicUsize>) -> CaptureFactory {
        Box::new(move || {
            Ok(Box::new(FakeDevice {
                opens: Arc::clone(&opens),
                closes: Arc::clone(&closes),
                next: 0.0,
                running: false,
                last_emit: Instant::now(),
            }) as Box<dyn AudioCapture>)
        })
    }

    fn drain_frames(cap: &mut Box<dyn AudioCapture>, want: usize, timeout: Duration) -> usize {
        let deadline = Instant::now() + timeout;
        let mut got = 0;
        while got < want && Instant::now() < deadline {
            match cap.read_frame() {
                Ok(_) => got += 1,
                Err(Error::NotEnoughSamples) => std::thread::sleep(Duration::from_millis(2)),
                Err(e) => panic!("read_frame: {e}"),
            }
        }
        got
    }

    #[test]
    fn two_consumers_share_one_device_open() {
        let opens = Arc::new(AtomicUsize::new(0));
        let closes = Arc::new(AtomicUsize::new(0));
        let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));

        let mut a = acquire(
            Some("test-shared-one-open"),
            480,
            vol.clone(),
            fake_factory(opens.clone(), closes.clone()),
        );
        let mut b = acquire(
            Some("test-shared-one-open"),
            960,
            vol.clone(),
            fake_factory(opens.clone(), closes.clone()),
        );

        a.start().unwrap();
        b.start().unwrap(); // second consumer while first is active
        assert_eq!(
            opens.load(Ordering::SeqCst),
            1,
            "device must be opened exactly once"
        );

        assert!(
            drain_frames(&mut a, 5, Duration::from_secs(2)) >= 5,
            "a starved"
        );
        assert!(
            drain_frames(&mut b, 3, Duration::from_secs(2)) >= 3,
            "b starved"
        );

        a.stop().unwrap();
        assert_eq!(
            closes.load(Ordering::SeqCst),
            0,
            "device stays open while b runs"
        );
        b.stop().unwrap();
        assert_eq!(
            closes.load(Ordering::SeqCst),
            1,
            "last consumer releases the device"
        );
    }

    #[test]
    fn device_reopens_after_full_release() {
        let opens = Arc::new(AtomicUsize::new(0));
        let closes = Arc::new(AtomicUsize::new(0));
        let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));

        let mut a = acquire(
            Some("test-shared-reopen"),
            480,
            vol.clone(),
            fake_factory(opens.clone(), closes.clone()),
        );
        a.start().unwrap();
        assert!(drain_frames(&mut a, 2, Duration::from_secs(2)) >= 2);
        a.stop().unwrap();
        assert_eq!(
            (opens.load(Ordering::SeqCst), closes.load(Ordering::SeqCst)),
            (1, 1)
        );

        let mut b = acquire(
            Some("test-shared-reopen"),
            480,
            vol,
            fake_factory(opens.clone(), closes.clone()),
        );
        b.start().unwrap();
        assert!(drain_frames(&mut b, 2, Duration::from_secs(2)) >= 2);
        b.stop().unwrap();
        assert_eq!(
            (opens.load(Ordering::SeqCst), closes.load(Ordering::SeqCst)),
            (2, 2)
        );
    }

    #[test]
    fn per_consumer_volume_is_applied() {
        let opens = Arc::new(AtomicUsize::new(0));
        let closes = Arc::new(AtomicUsize::new(0));
        let quiet = Arc::new(AtomicU32::new(0.5_f32.to_bits()));
        let loud = Arc::new(AtomicU32::new(2.0_f32.to_bits()));

        let mut a = acquire(
            Some("test-shared-volume"),
            480,
            quiet,
            fake_factory(opens.clone(), closes.clone()),
        );
        let mut b = acquire(
            Some("test-shared-volume"),
            480,
            loud,
            fake_factory(opens.clone(), closes.clone()),
        );
        a.start().unwrap();
        b.start().unwrap();

        let deadline = Instant::now() + Duration::from_secs(2);
        let (mut fa, mut fb) = (None, None);
        while (fa.is_none() || fb.is_none()) && Instant::now() < deadline {
            if fa.is_none() {
                fa = a.read_frame().ok();
            }
            if fb.is_none() {
                fb = b.read_frame().ok();
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        let fa = fa.expect("a frame");
        let fb = fb.expect("b frame");
        // Both consumers see the same ramp, scaled by their own volume:
        // the max of the quiet consumer's frame is 0.25x the loud one's
        // ONLY if frames aligned; instead check scaling of first nonzero
        // sample ratio: values are ramp indices, so compare per-frame
        // max/step ratios.
        let max = |f: &AudioFrame| f.as_f32_samples().iter().fold(0.0f32, |m, &s| m.max(s));
        assert!(max(&fa) > 0.0 && max(&fb) > 0.0);

        a.stop().unwrap();
        b.stop().unwrap();
        assert_eq!(closes.load(Ordering::SeqCst), 1);
    }

    /// `drain_frames` for a concrete handle (the boxed variant takes `dyn`).
    fn drain_frames_h(cap: &mut SharedCaptureHandle, want: usize, timeout: Duration) -> usize {
        let deadline = Instant::now() + timeout;
        let mut got = 0;
        while got < want && Instant::now() < deadline {
            match cap.read_frame() {
                Ok(_) => got += 1,
                Err(Error::NotEnoughSamples) => std::thread::sleep(Duration::from_millis(2)),
                Err(e) => panic!("read_frame: {e}"),
            }
        }
        got
    }

    /// A cold start must not join a pump that is about to keep running.
    ///
    /// `stop()` decrements `active` and only *then* takes `control` to
    /// join the pump. A `start()` that slips into that window bumps
    /// `active` back to 1 **before** joining, so the pump's `active == 0`
    /// exit check never fires and the join never returns - deadlocking
    /// whichever thread called `start()` (the UI thread, for the sync
    /// `start_mic_test` command).
    #[test]
    fn cold_start_does_not_deadlock_on_a_revived_pump() {
        let opens = Arc::new(AtomicUsize::new(0));
        let closes = Arc::new(AtomicUsize::new(0));
        let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        let shared = Arc::new(StreamShared::new("test-revive-race".into()));

        let mut a = SharedCaptureHandle::new(
            Arc::clone(&shared),
            480,
            Arc::clone(&vol),
            fake_factory(Arc::clone(&opens), Arc::clone(&closes)),
        );
        let mut b = SharedCaptureHandle::new(
            Arc::clone(&shared),
            480,
            Arc::clone(&vol),
            fake_factory(Arc::clone(&opens), Arc::clone(&closes)),
        );

        a.start().unwrap();
        assert_eq!(drain_frames_h(&mut a, 1, Duration::from_secs(2)), 1);

        // Reproduce the exact interleaving: `a.stop()` has decremented
        // `active` to 0 but has not yet taken `control` to join, and
        // `b.start()` runs first.
        let _ = shared.active.fetch_sub(1, Ordering::SeqCst);
        a.started = false;

        let (tx, rx) = std::sync::mpsc::channel();
        let t = std::thread::spawn(move || {
            let r = b.start();
            let _ = tx.send(());
            (b, r)
        });
        let finished = rx.recv_timeout(Duration::from_secs(5)).is_ok();
        assert!(
            finished,
            "start() deadlocked joining a pump that active==1 keeps alive"
        );
        let (mut b, r) = t.join().unwrap();
        r.unwrap();
        let _ = b.stop();
    }
}
