//! A made-up recorder and player, for the demo engine and for tests: they
//! hear no microphone and make no sound, keep time by a clock a test can
//! move, and write down what they were asked to do.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Instant;

use gpui::SharedString;

use super::{Clip, Finished, Playback, Player, Progress, Recorder, State, Support};

/// What the made-up recorder and player were asked to do, in order.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Done {
    Started(u32),
    Cancelled,
    Finished,
    Discarded,
    Fetched(SharedString),
    Played(SharedString),
    Paused,
    Sought(u32),
    Speed(u32),
    Stopped,
}

/// Where the made-up machinery is: its clock, what it did, and what the
/// made-up server allows.
#[derive(Debug)]
struct Bench {
    /// What a test has moved the clock to; `None` where it follows the
    /// wall clock, from `began`.
    set_ms: Option<u64>,
    began: Instant,
    done: Vec<Done>,
    support: Option<Support>,
    /// Why the next take will not start, where it will not.
    refusal: Option<String>,
}

/// The made-up machinery, shared by the demo engine and what it hands out.
#[derive(Debug, Clone)]
pub(crate) struct Studio(Arc<Mutex<Bench>>);

impl Default for Studio {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Bench {
            // Under test the clock moves only when it is moved.
            set_ms: cfg!(test).then_some(0),
            began: Instant::now(),
            done: Vec::new(),
            // Said by whoever sets the made-up server up: a server that
            // has said nothing takes none.
            support: None,
            refusal: None,
        })))
    }
}

impl Studio {
    fn bench(&self) -> MutexGuard<'_, Bench> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The made-up clock, in milliseconds: what a test has moved it to,
    /// or the wall clock's time since the studio was made.
    pub(crate) fn now_ms(&self) -> u64 {
        let bench = self.bench();
        bench
            .set_ms
            .unwrap_or_else(|| u64::try_from(bench.began.elapsed().as_millis()).unwrap_or(u64::MAX))
    }

    fn note(&self, done: Done) {
        self.bench().done.push(done);
    }

    /// What the made-up server allows of voice messages.
    pub(crate) fn support(&self) -> Option<Support> {
        self.bench().support
    }

    /// Have the made-up server allow `support`, or say nothing of it.
    pub(crate) fn allow(&self, support: Option<Support>) {
        self.bench().support = support;
    }

    /// Move the clock on by `ms`.
    #[cfg(test)]
    pub(crate) fn advance(&self, ms: u64) {
        let mut bench = self.bench();
        bench.set_ms = Some(bench.set_ms.unwrap_or_default() + ms);
    }

    /// What was asked so far, in order.
    #[cfg(test)]
    pub(crate) fn done(&self) -> Vec<Done> {
        self.bench().done.clone()
    }

    /// Have the next take refuse to start, saying `why`.
    #[cfg(test)]
    pub(crate) fn refuse_next(&self, why: &str) {
        self.bench().refusal = Some(why.to_owned());
    }

    /// A recorder that writes down what it is asked.
    pub(crate) fn recorder(&self) -> MadeUpRecorder {
        MadeUpRecorder {
            studio: self.clone(),
            take: None,
        }
    }

    /// A player that writes down what it is asked.
    pub(crate) fn player(&self) -> MadeUpPlayer {
        MadeUpPlayer {
            studio: self.clone(),
            held: None,
        }
    }
}

/// A take of the made-up recorder: when it started, and how long it may be.
#[derive(Debug, Clone, Copy)]
struct Take {
    from_ms: u64,
    limit_ms: u32,
}

impl Take {
    fn elapsed(self, now_ms: u64) -> u32 {
        let ran = u32::try_from(now_ms.saturating_sub(self.from_ms)).unwrap_or(u32::MAX);
        match self.limit_ms {
            0 => ran,
            limit => ran.min(limit),
        }
    }
}

/// How loud the made-up voice is `ms` into a take: it rises and falls, as
/// loud as speech into a microphone is (a few hundredths of full scale).
fn level_at(ms: u32) -> f32 {
    let swing = (f64::from(ms) / 230.0).sin();
    (LEVEL_LOW + (LEVEL_HIGH - LEVEL_LOW) * swing * swing) as f32
}

/// The quietest and the loudest the made-up voice is.
const LEVEL_LOW: f64 = 0.005;
const LEVEL_HIGH: f64 = 0.15;

/// Records nothing, at the pace of the clock.
#[derive(Debug)]
pub(crate) struct MadeUpRecorder {
    studio: Studio,
    take: Option<Take>,
}

impl Recorder for MadeUpRecorder {
    fn start(&mut self, limit_ms: u32) -> Result<(), String> {
        if let Some(why) = self.studio.bench().refusal.take() {
            return Err(why);
        }
        self.studio.note(Done::Started(limit_ms));
        self.take = Some(Take {
            from_ms: self.studio.now_ms(),
            limit_ms,
        });
        Ok(())
    }

    fn progress(&self) -> Progress {
        let Some(take) = self.take else {
            return Progress::default();
        };
        let elapsed_ms = take.elapsed(self.studio.now_ms());
        Progress {
            elapsed_ms,
            level: level_at(elapsed_ms),
            limit: take.limit_ms > 0 && elapsed_ms >= take.limit_ms,
            failed: None,
        }
    }

    fn finish(&mut self) -> Finished {
        let (tell, told) = async_channel::bounded(1);
        let clip = match self.take.take() {
            Some(take) => {
                self.studio.note(Done::Finished);
                let duration_ms = take.elapsed(self.studio.now_ms());
                if duration_ms == 0 {
                    Err("nothing was recorded".to_owned())
                } else {
                    Ok(Clip {
                        path: std::env::temp_dir().join("made-up-voice-message.ogg"),
                        duration_ms,
                        size: u64::from(duration_ms) * 4,
                        waveform: (0..48).map(|bar| bar_at(bar, duration_ms)).collect(),
                    })
                }
            }
            None => Err("Not recording a voice message".to_owned()),
        };
        let _ = tell.try_send(clip);
        told
    }

    fn cancel(&mut self) {
        if self.take.take().is_some() {
            self.studio.note(Done::Cancelled);
        }
    }

    fn discard(&mut self, _: &Clip) {
        self.studio.note(Done::Discarded);
    }
}

/// The `bar`th of 48 bars of a made-up take `duration_ms` long, 0 to 100.
fn bar_at(bar: u32, duration_ms: u32) -> u8 {
    let ms = u32::try_from(u64::from(duration_ms) * u64::from(bar) / 48).unwrap_or(0);
    (f64::from(level_at(ms)) / LEVEL_HIGH * 100.0).round().min(100.0) as u8
}

/// The voice message the made-up player holds.
#[derive(Debug, Clone)]
struct Holding {
    key: SharedString,
    state: State,
    length_ms: u32,
    speed: f32,
    /// Where it was when the clock read `since_ms`.
    at_ms: u32,
    since_ms: u64,
}

impl Holding {
    /// Where it is at `now_ms`.
    fn at(&self, now_ms: u64) -> u32 {
        if self.state != State::Playing {
            return self.at_ms;
        }
        let ran = now_ms.saturating_sub(self.since_ms);
        let moved = (ran as f64 * f64::from(self.speed)) as u32;
        self.at_ms.saturating_add(moved)
    }
}

/// Plays nothing, at the pace of the clock.
#[derive(Debug)]
pub(crate) struct MadeUpPlayer {
    studio: Studio,
    held: Option<Holding>,
}

impl MadeUpPlayer {
    /// Note where the one held is now, from now on.
    fn settle(&mut self) {
        let now = self.studio.now_ms();
        if let Some(held) = &mut self.held {
            held.at_ms = held.at(now);
            held.since_ms = now;
        }
    }
}

impl Player for MadeUpPlayer {
    fn play(&mut self, key: &SharedString, length_ms: u32, at_ms: u32, speed: f32) {
        let now = self.studio.now_ms();
        if self.held.as_ref().is_none_or(|held| held.key != *key) {
            self.studio.note(Done::Fetched(key.clone()));
            self.held = Some(Holding {
                key: key.clone(),
                state: State::Playing,
                length_ms,
                speed,
                at_ms,
                since_ms: now,
            });
        } else if let Some(held) = &mut self.held {
            // Played to its end, it starts again where it is asked to.
            if held.at(now) >= held.length_ms {
                held.at_ms = at_ms;
            }
            held.state = State::Playing;
            held.speed = speed;
            held.since_ms = now;
        }
        self.studio.note(Done::Played(key.clone()));
    }

    fn pause(&mut self) {
        self.settle();
        if let Some(held) = &mut self.held {
            held.state = State::Paused;
            self.studio.note(Done::Paused);
        }
    }

    fn seek(&mut self, at_ms: u32) {
        self.settle();
        if let Some(held) = &mut self.held {
            held.at_ms = at_ms.min(held.length_ms);
            self.studio.note(Done::Sought(at_ms));
        }
    }

    fn set_speed(&mut self, speed: f32) {
        self.settle();
        if let Some(held) = &mut self.held {
            held.speed = speed;
        }
        self.studio
            .note(Done::Speed((speed * 100.0).round() as u32));
    }

    fn stop(&mut self) {
        if self.held.take().is_some() {
            self.studio.note(Done::Stopped);
        }
    }

    fn now(&self) -> Playback {
        let Some(held) = &self.held else {
            return Playback::default();
        };
        let at_ms = held.at(self.studio.now_ms());
        let ended = held.state == State::Playing && at_ms >= held.length_ms;
        Playback {
            key: Some(held.key.clone()),
            state: if ended { State::Ended } else { held.state },
            at_ms: if ended { 0 } else { at_ms },
            length_ms: held.length_ms,
        }
    }
}
