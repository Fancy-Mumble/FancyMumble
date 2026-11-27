//! Voice messages in the window: the microphone button and the take being
//! recorded in the composer, and the card a voice message is drawn as.
//!
//! As the web client has them (`useVoiceRecorder.ts`, `VoiceMessageCard`):
//! the button is there while nothing is typed, on a server that takes voice
//! messages, where the channel lets the user send one; the take stops
//! itself at the server's limit; one voice message plays at a time, and it
//! stops when its conversation is left. The recorder and the player are
//! asked of the engine the first time they are wanted, and not before.

use std::collections::{HashMap, VecDeque};
use std::time::Duration;

use gpui::{AnyElement, Context, IntoElement, SharedString, Styled, div, prelude::*, px};

use super::Shell;
use super::kit::{IconButton, NoteWords, Standing, TakeBar, TakeShown, VoiceNote};
use super::toasts::Kind;
use crate::engine::{Attachment, Conversation};
use crate::rights::Right;
use crate::voice::{Clip, Note, Playback, Player, Recorder, State};
use crate::words::t;

/// How often a take or a voice message playing is looked at again.
const TICK: Duration = Duration::from_millis(80);

/// The speeds a press on the speed button goes through, as the web's do.
const SPEEDS: [f32; 3] = [1.0, 1.5, 2.0];

/// Levels kept of a take: what its strip draws.
const LEVELS: usize = super::kit::LIVE_BARS;

/// A take being recorded.
#[derive(Debug, Default)]
struct Take {
    /// The server's limit, 0 for none.
    limit_ms: u32,
    elapsed_ms: u32,
    /// The latest levels, oldest first.
    levels: VecDeque<f32>,
    limit: bool,
    /// Whether it has been finished and is on its way.
    sending: bool,
}

/// Where the reader left a voice message, and how fast they play it.
#[derive(Debug, Clone, Copy, Default)]
struct Card {
    at_ms: u32,
    /// Which of [`SPEEDS`].
    speed: usize,
}

/// The view's voice messages: the recorder and the player once they are
/// wanted, the take under way, and each card's place and speed.
#[derive(Default)]
pub(super) struct VoiceMessages {
    recorder: Option<Box<dyn Recorder>>,
    take: Option<Take>,
    player: Option<Box<dyn Player>>,
    cards: HashMap<SharedString, Card>,
    /// Whether the take and the player are being looked at.
    ticking: bool,
}

impl VoiceMessages {
    /// What the player is doing, where there is one.
    fn now(&self) -> Option<Playback> {
        self.player.as_ref().map(|player| player.now())
    }

    /// Whether the recorder and the player have been made, for a test to
    /// see that neither was before it was wanted.
    #[cfg(test)]
    pub(super) fn made(&self) -> (bool, bool) {
        (self.recorder.is_some(), self.player.is_some())
    }

    /// How the take stands, for a test: how long, whether at the limit,
    /// whether on its way, and how many levels its strip draws.
    #[cfg(test)]
    pub(super) fn take(&self) -> Option<(u32, bool, bool, usize)> {
        self.take
            .as_ref()
            .map(|take| (take.elapsed_ms, take.limit, take.sending, take.levels.len()))
    }
}

impl Shell {
    /// The channel a voice message goes up to, and the user it is for
    /// where it is a direct message: one goes up to the channel the local
    /// user is in, as the web client sends it.
    fn voice_target(&self) -> Option<(u32, Option<u32>)> {
        match self.open? {
            Conversation::Channel(channel) => Some((channel, None)),
            Conversation::Direct(session) => Some((self.snapshot.current_channel?, Some(session))),
        }
    }

    /// Whether the microphone button is offered: on a server that takes
    /// voice messages, where the channel lets the user send one, while
    /// nothing is typed, answered or changed. Rights not yet known offer it;
    /// the server checks anyway.
    pub(super) fn voice_offered(&self, armed: bool) -> bool {
        let allowed = self
            .engine
            .voice_support()
            .is_some_and(|support| support.available);
        let permitted = self.voice_target().is_some_and(|(channel, _)| {
            self.snapshot
                .channels
                .iter()
                .find(|known| known.id == channel)
                .is_none_or(|known| known.rights.may(Right::SEND_VOICE_MESSAGE))
        });
        allowed
            && permitted
            && !armed
            && self.replying.is_none()
            && self.editing.is_none()
            && self.voice.take.is_none()
    }

    /// Start a take.
    fn start_voice(&mut self, cx: &mut Context<Self>) {
        let limit_ms = self
            .engine
            .voice_support()
            .map_or(0, crate::voice::Support::limit_ms);
        let engine = std::sync::Arc::clone(&self.engine);
        let recorder = self.voice.recorder.get_or_insert_with(|| engine.recorder());
        match recorder.start(limit_ms) {
            Ok(()) => {
                self.voice.take = Some(Take {
                    limit_ms,
                    ..Take::default()
                });
                self.keep_voice_ticking(cx);
            }
            Err(error) => self.voice_failed(&error, cx),
        }
        cx.notify();
    }

    /// Throw the take away.
    fn cancel_voice(&mut self, cx: &mut Context<Self>) {
        if self.voice.take.take().is_some()
            && let Some(recorder) = &mut self.voice.recorder
        {
            recorder.cancel();
        }
        cx.notify();
    }

    /// Finish the take and send it.
    fn send_voice(&mut self, cx: &mut Context<Self>) {
        let (Some(take), Some(recorder)) = (&mut self.voice.take, &mut self.voice.recorder) else {
            return;
        };
        if take.sending {
            return;
        }
        take.sending = true;
        let finished = recorder.finish();
        cx.spawn(async move |shell, cx| {
            let clip = finished
                .recv()
                .await
                .unwrap_or_else(|_| Err("the recorder stopped unexpectedly".to_owned()));
            let _ = shell.update(cx, |shell, cx| shell.voice_finished(clip, cx));
        })
        .detach();
        cx.notify();
    }

    /// The take is finished: send it where the conversation on screen is,
    /// unless it is larger than the server takes.
    fn voice_finished(&mut self, clip: Result<Clip, String>, cx: &mut Context<Self>) {
        self.voice.take = None;
        let max_bytes = self
            .engine
            .voice_support()
            .map_or(0, |support| support.max_bytes);
        match (clip, self.open) {
            (Ok(clip), Some(conversation)) if max_bytes == 0 || clip.size <= max_bytes => {
                self.engine.send_voice(conversation, clip);
            }
            (Ok(clip), open) => {
                if let Some(recorder) = &mut self.voice.recorder {
                    recorder.discard(&clip);
                }
                if open.is_some() {
                    let said = t!("The voice message is larger than this server allows");
                    self.voice_failed(&said, cx);
                }
            }
            (Err(error), _) => self.voice_failed(&error, cx),
        }
        cx.notify();
    }

    fn voice_failed(&mut self, detail: &str, cx: &mut Context<Self>) {
        let said = t!("Voice message failed: {{detail}}", detail = detail);
        self.toast(said, Kind::Told, cx);
    }

    /// Look at the take and the player every [`TICK`] for as long as
    /// either is going.
    fn keep_voice_ticking(&mut self, cx: &mut Context<Self>) {
        if self.voice.ticking {
            return;
        }
        self.voice.ticking = true;
        cx.spawn(async move |shell, cx| {
            loop {
                cx.background_executor().timer(TICK).await;
                let going = shell.update(cx, Shell::voice_tick);
                if !matches!(going, Ok(true)) {
                    break;
                }
            }
        })
        .detach();
    }

    /// Take in how the take and the player are going; whether to go on
    /// looking.
    fn voice_tick(&mut self, cx: &mut Context<Self>) -> bool {
        let progress = self
            .voice
            .recorder
            .as_ref()
            .filter(|_| self.voice.take.is_some())
            .map(|recorder| recorder.progress());
        if let Some(progress) = progress {
            if let Some(failed) = progress.failed {
                self.voice.take = None;
                self.voice_failed(&failed, cx);
            } else if let Some(take) = &mut self.voice.take
                && !take.limit
            {
                take.elapsed_ms = progress.elapsed_ms;
                take.limit = progress.limit;
                take.levels.push_back(progress.level);
                while take.levels.len() > LEVELS {
                    let _ = take.levels.pop_front();
                }
            }
        }
        let playing = self.voice.now().is_some_and(|now| {
            if now.state == State::Ended
                && let Some(key) = &now.key
            {
                self.voice.cards.entry(key.clone()).or_default().at_ms = 0;
            }
            matches!(now.state, State::Playing | State::Loading)
        });
        cx.notify();
        let going = self.voice.take.is_some() || playing;
        self.voice.ticking = going;
        going
    }

    /// Play the voice message under `key`, `length_ms` long, or pause it
    /// where it is playing. Whatever else was playing stops.
    fn toggle_voice(&mut self, key: &SharedString, length_ms: u32, cx: &mut Context<Self>) {
        let now = self.voice.now().unwrap_or_default();
        let held = now.key.as_ref() == Some(key);
        if held && matches!(now.state, State::Playing | State::Loading) {
            self.voice.cards.entry(key.clone()).or_default().at_ms = now.at_ms;
            if let Some(player) = &mut self.voice.player {
                player.pause();
            }
            cx.notify();
            return;
        }
        // The one that was playing keeps its place.
        if let Some(other) = now.key.filter(|_| !held) {
            self.voice.cards.entry(other).or_default().at_ms = now.at_ms;
        }
        let card = self.voice.cards.get(key).copied().unwrap_or_default();
        let engine = std::sync::Arc::clone(&self.engine);
        let player = self
            .voice
            .player
            .get_or_insert_with(|| engine.voice_player());
        player.play(key, length_ms, card.at_ms, SPEEDS[card.speed]);
        self.keep_voice_ticking(cx);
        cx.notify();
    }

    /// Go to `at_ms` in the voice message under `key`; playing it does
    /// not start.
    fn seek_voice(&mut self, key: &SharedString, at_ms: u32, cx: &mut Context<Self>) {
        self.voice.cards.entry(key.clone()).or_default().at_ms = at_ms;
        let held = self
            .voice
            .now()
            .is_some_and(|now| now.key.as_ref() == Some(key) && now.state != State::Ended);
        if held && let Some(player) = &mut self.voice.player {
            player.seek(at_ms);
        }
        cx.notify();
    }

    /// Play the voice message under `key` at the next speed.
    fn next_voice_speed(&mut self, key: &SharedString, cx: &mut Context<Self>) {
        let card = self.voice.cards.entry(key.clone()).or_default();
        card.speed = (card.speed + 1) % SPEEDS.len();
        let speed = SPEEDS[card.speed];
        let held = self
            .voice
            .now()
            .is_some_and(|now| now.key.as_ref() == Some(key));
        if held && let Some(player) = &mut self.voice.player {
            player.set_speed(speed);
        }
        cx.notify();
    }

    /// The conversation on screen is left: what plays stops, and what was
    /// played is let go of.
    pub(super) fn leave_voice_messages(&mut self) {
        if let Some(player) = &mut self.voice.player {
            player.stop();
        }
        self.voice.cards.clear();
    }

    /// Where the voice message under `key`, `length_ms` long as its
    /// message says, stands now: for a test.
    #[cfg(test)]
    pub(super) fn voice_standing(&self, key: &str, length_ms: u32) -> Standing {
        let note = Note {
            duration_ms: length_ms,
            ..Note::default()
        };
        let now = self.voice.now();
        self.standing(
            Some(&SharedString::from(key.to_owned())),
            &note,
            now.as_ref(),
        )
    }

    /// Where the voice message under `key` stands, as `now` has it.
    fn standing(
        &self,
        key: Option<&SharedString>,
        note: &Note,
        now: Option<&Playback>,
    ) -> Standing {
        let card = key
            .and_then(|key| self.voice.cards.get(key))
            .copied()
            .unwrap_or_default();
        let mut standing = Standing {
            playing: false,
            at_ms: card.at_ms,
            length_ms: note.duration_ms,
            speed: SPEEDS[card.speed],
        };
        if let Some(now) = now.filter(|now| key.is_some() && now.key.as_ref() == key) {
            standing.playing = matches!(now.state, State::Playing | State::Loading);
            if matches!(now.state, State::Playing | State::Paused) {
                standing.at_ms = now.at_ms;
            }
            if now.length_ms > 0 {
                standing.length_ms = now.length_ms;
            }
        }
        standing
    }

    /// The card the voice message `file` is drawn as, the `at`th file of
    /// the message at `index`: from what its message says, nothing fetched.
    pub(super) fn voice_card(
        &self,
        (index, at): (usize, usize),
        file: &Attachment,
        note: &Note,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let now = self.voice.now();
        let key = file.key.clone();
        let failed = now
            .as_ref()
            .is_some_and(|now| now.state == State::Failed && now.key == key);
        if failed {
            let theme = crate::theme::ActiveTheme::get(cx);
            return div()
                .text_size(px(13.0))
                .text_color(theme.c.text.opacity(0.7))
                .child(t!("This voice message can no longer be played."))
                .into_any_element();
        }
        let standing = self.standing(key.as_ref(), note, now.as_ref());
        let words = NoteWords {
            play: t!("Play voice message"),
            pause: t!("Pause voice message"),
            speed: t!("Playback speed"),
        };
        let card = VoiceNote::new(index * 16 + at, note.waveform.clone(), standing, words);
        let Some(key) = key else {
            return card.into_any_element();
        };
        let length_ms = standing.length_ms;
        let shell = cx.weak_entity();
        let (toggled, sought, sped) = (key.clone(), key.clone(), key);
        let (for_seek, for_speed) = (shell.clone(), shell.clone());
        card.on_toggle(move |_, cx| {
            let _ = shell.update(cx, |shell, cx| shell.toggle_voice(&toggled, length_ms, cx));
        })
        .on_seek(move |at_ms, _, cx| {
            let _ = for_seek.update(cx, |shell, cx| shell.seek_voice(&sought, at_ms, cx));
        })
        .on_speed(move |_, cx| {
            let _ = for_speed.update(cx, |shell, cx| shell.next_voice_speed(&sped, cx));
        })
        .into_any_element()
    }

    /// The strip the composer shows in place of its field while a take is
    /// recorded.
    pub(super) fn voice_take_bar(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let take = self.voice.take.as_ref()?;
        let said = if take.sending {
            Some(t!("Sending…"))
        } else {
            take.limit.then(|| t!("Maximum length reached"))
        };
        let shown = TakeShown {
            elapsed_ms: take.elapsed_ms,
            limit_ms: take.limit_ms,
            levels: take.levels.iter().copied().collect(),
            said,
        };
        let bar = TakeBar::new(shown, t!("Discard voice message"));
        let bar = if take.sending {
            bar
        } else {
            let shell = cx.weak_entity();
            bar.on_discard(move |_, cx| {
                let _ = shell.update(cx, Shell::cancel_voice);
            })
        };
        Some(bar.into_any_element())
    }

    /// The composer's button where it is about a voice message: the
    /// microphone while one is offered, send while one is recorded. Round,
    /// or on Send's plate where the theme plates the composer (`plates`), as
    /// the web UI's drawn skin has it.
    pub(super) fn voice_button(
        &self,
        armed: bool,
        plates: bool,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        use super::kit::{Corner, SendPlate, Variant};
        type OnClick = Box<dyn Fn(&gpui::ClickEvent, &mut gpui::Window, &mut gpui::App)>;
        // Unlit where it has no click: a take that is already going.
        let button =
            |id: &'static str, glyph: &'static str, tip: SharedString, click: Option<OnClick>| {
                let lit = click.is_some();
                if plates {
                    let plate = if glyph == "send" {
                        SendPlate::new(id, t!("Send"))
                    } else {
                        SendPlate::glyph_only(id, glyph)
                    };
                    let plate = plate.ready(lit).tip(tip);
                    match click {
                        Some(click) => plate.on_click(click).into_any_element(),
                        None => plate.into_any_element(),
                    }
                } else {
                    let round = IconButton::new(id, glyph)
                        .tip(tip)
                        .size(32.0)
                        .corner(Corner::Pill)
                        .variant(Variant::Solid)
                        .faded(!lit);
                    match click {
                        Some(click) => round.on_click(click).into_any_element(),
                        None => round.into_any_element(),
                    }
                }
            };
        if let Some(take) = &self.voice.take {
            let click: Option<OnClick> = (!take.sending)
                .then(|| Box::new(cx.listener(|shell, _, _, cx| shell.send_voice(cx))) as OnClick);
            return Some(button(
                "voice-send",
                "send",
                t!("Send voice message"),
                click,
            ));
        }
        self.voice_offered(armed).then(|| {
            let click = Box::new(cx.listener(|shell, _, _, cx| shell.start_voice(cx))) as OnClick;
            button(
                "voice-record",
                "mic",
                t!("Record a voice message"),
                Some(click),
            )
        })
    }
}
