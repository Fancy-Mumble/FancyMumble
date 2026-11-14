//! The real engine's player: a voice message fetched from the server when
//! it is first played, decoded as it is heard, and let go of when it ends.
//!
//! What is held between plays is the file as it was sent (Opus: a few
//! kilobytes a second), of the one voice message last played. What is
//! decoded is a frame at a time, and none of it outlives the playing.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use gpui::SharedString;
use mumble_tauri_lib::engine_api::EngineHandle;
use rodio::Source as _;

use super::clip_source::{ClipSource, Dial};
use super::output::Output;
use super::{Playback, Player, State};

/// The voice message being played: the player, the way out, and what
/// its speed is set with and its place read from.
struct Out {
    player: rodio::Player,
    output: Output,
    dial: Arc<Dial>,
}

/// What the player holds, shared with the fetch under way.
#[derive(Default)]
struct Held {
    key: Option<SharedString>,
    state: State,
    length_ms: u32,
    speed: f32,
    /// Where to start from, while nothing is playing.
    at_ms: u32,
    /// The file of the one held, once fetched.
    file: Option<Arc<[u8]>>,
    out: Option<Out>,
    /// Counts what was asked for: a fetch for something asked before the
    /// last ask is too late, and is dropped.
    asked: u64,
}

impl Held {
    /// Start playing the file held, from `at_ms`, on a new way out.
    fn start(&mut self, silent: bool) {
        let Some(file) = self.file.clone() else {
            return;
        };
        let mut source = match ClipSource::new(&file, self.speed) {
            Ok(source) => source,
            Err(error) => {
                tracing::debug!(%error, "a voice message could not be read");
                self.state = State::Failed;
                return;
            }
        };
        self.length_ms = source.length_ms();
        let _ = source.try_seek(Duration::from_millis(u64::from(self.at_ms)));
        let dial = source.dial();
        let (player, out) = rodio::Player::new();
        player.append(source);
        self.out = Some(Out {
            player,
            output: Output::open(out, silent),
            dial,
        });
        self.state = State::Playing;
    }

    /// Where it is, and whether it has ended or failed since last asked.
    fn look(&mut self) {
        let Some(out) = &self.out else {
            return;
        };
        if out.output.failed() {
            self.out = None;
            self.state = State::Failed;
        } else if out.player.empty() {
            // Played to its end: what was decoded goes, the file stays.
            self.out = None;
            self.at_ms = 0;
            self.state = State::Ended;
        } else {
            self.at_ms = out.dial.heard_ms();
        }
    }
}

/// Plays through the engine.
pub(crate) struct EnginePlayer {
    engine: EngineHandle,
    runtime: tokio::runtime::Handle,
    /// Whether nothing is to be heard.
    silent: bool,
    held: Arc<Mutex<Held>>,
}

impl EnginePlayer {
    pub(crate) fn new(engine: EngineHandle, runtime: tokio::runtime::Handle, silent: bool) -> Self {
        Self {
            engine,
            runtime,
            silent,
            held: Arc::default(),
        }
    }

    fn held(&self) -> MutexGuard<'_, Held> {
        self.held.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Fetch the voice message under `key`, and play it once it is here
    /// if it is still what is asked for.
    fn fetch(&self, key: SharedString, asked: u64) {
        let (engine, held, silent) = (self.engine.clone(), Arc::clone(&self.held), self.silent);
        drop(self.runtime.spawn(async move {
            let file = fetched(&engine, &key).await;
            let mut held = held.lock().unwrap_or_else(PoisonError::into_inner);
            if held.asked != asked {
                return;
            }
            match file {
                Some(file) => {
                    held.file = Some(file);
                    held.start(silent);
                }
                None => held.state = State::Failed,
            }
        }));
    }
}

/// The file kept under `key`, by way of a file of its own, read and
/// removed at once: how the engine hands shared files over.
async fn fetched(engine: &EngineHandle, key: &str) -> Option<Arc<[u8]>> {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nth = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let to = std::env::temp_dir().join(format!("fancy-gpui-voice-{}-{nth}", std::process::id()));
    let saved = engine.save_shared_file(key, &to).await;
    let file = saved.ok().and_then(|_| std::fs::read(&to).ok());
    let _ = std::fs::remove_file(&to);
    file.map(Into::into)
}

impl Player for EnginePlayer {
    fn play(&mut self, key: &SharedString, length_ms: u32, at_ms: u32, speed: f32) {
        let silent = self.silent;
        let mut held = self.held();
        held.speed = speed;
        if held.key.as_ref() == Some(key) && held.file.is_some() {
            match &held.out {
                Some(out) => {
                    out.dial.set_speed(speed);
                    out.player.play();
                    held.state = State::Playing;
                }
                None => {
                    held.at_ms = at_ms;
                    held.start(silent);
                }
            }
            return;
        }
        held.asked += 1;
        let asked = held.asked;
        *held = Held {
            key: Some(key.clone()),
            state: State::Loading,
            length_ms,
            speed,
            at_ms,
            asked,
            ..Held::default()
        };
        drop(held);
        self.fetch(key.clone(), asked);
    }

    fn pause(&mut self) {
        let mut held = self.held();
        held.look();
        if let Some(out) = &held.out {
            out.player.pause();
            held.state = State::Paused;
        }
    }

    fn seek(&mut self, at_ms: u32) {
        let mut held = self.held();
        held.at_ms = at_ms;
        if let Some(out) = &held.out {
            out.dial.seek(at_ms);
        }
    }

    fn set_speed(&mut self, speed: f32) {
        let mut held = self.held();
        held.speed = speed;
        if let Some(out) = &held.out {
            out.dial.set_speed(speed);
        }
    }

    fn stop(&mut self) {
        let mut held = self.held();
        let asked = held.asked + 1;
        *held = Held {
            asked,
            ..Held::default()
        };
    }

    fn now(&self) -> Playback {
        let mut held = self.held();
        held.look();
        Playback {
            key: held.key.clone(),
            state: held.state,
            at_ms: held.at_ms,
            length_ms: held.length_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A held voice message of `seconds`, its file read and nothing playing.
    fn holding(seconds: u32, speed: f32, at_ms: u32) -> Held {
        let (dir, clip) = super::super::clip_source::made_clip(seconds);
        let file = std::fs::read(&clip.path).expect("the file");
        let _ = std::fs::remove_dir_all(dir);
        Held {
            file: Some(file.into()),
            speed,
            at_ms,
            ..Held::default()
        }
    }

    /// Look until it has ended, at most `within`; how long that took.
    fn until_ended(held: &mut Held, within: Duration) -> Duration {
        let began = std::time::Instant::now();
        while began.elapsed() < within {
            held.look();
            if held.state == State::Ended {
                return began.elapsed();
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("still {:?} at {} ms", held.state, held.at_ms);
    }

    #[test]
    fn a_voice_message_plays_silently_at_its_pace_and_lets_go_at_its_end() {
        let mut held = holding(1, 1.0, 0);
        held.start(true);
        assert_eq!((held.state, held.length_ms), (State::Playing, 1000));
        std::thread::sleep(Duration::from_millis(300));
        held.look();
        assert!(
            held.at_ms > 100 && held.at_ms < 900,
            "moving: {}",
            held.at_ms
        );
        let took = until_ended(&mut held, Duration::from_secs(3));
        assert!(
            took >= Duration::from_millis(500),
            "heard at its pace: {took:?}"
        );
        assert!(held.out.is_none(), "nothing decoded is kept");
        assert!(held.file.is_some(), "the file is, to play again");
        assert_eq!(held.at_ms, 0, "and again from the start");
    }

    #[test]
    fn faster_and_from_further_on_it_ends_sooner() {
        let mut held = holding(2, 2.0, 1000);
        held.start(true);
        let took = until_ended(&mut held, Duration::from_secs(3));
        // One second left, twice as fast: half a second, where the whole
        // of it as it is would take two. Loose: a busy machine is slow.
        assert!(took < Duration::from_millis(1_600), "{took:?}");
    }

    #[test]
    fn what_is_not_a_voice_message_fails_to_play() {
        let mut held = Held {
            file: Some(b"not Ogg".to_vec().into()),
            ..Held::default()
        };
        held.start(true);
        assert_eq!(held.state, State::Failed);
        assert!(held.out.is_none());
    }
}
