//! A video playing in place, over its card: starting it, telling the
//! player's window where the card was painted, and stopping it when the
//! card goes.
//!
//! One plays at a time. It stops when its close control is pressed, when
//! the conversation it is in is left, when its message goes, when the
//! connection does, and once it has been paused or over for
//! [`KEPT_PAUSED`]: the card then shows its still again, and everything
//! the player held is given back.

use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

use gpui::{
    AnyElement, Context, Corners, DispatchPhase, IntoElement, MouseDownEvent, ParentElement,
    SharedString, Styled, Task, Window, canvas, div, prelude::*, px,
};

use super::Shell;
use super::kit::{Button, Emphasis, Size};
use crate::embed::youtube;
use crate::engine::{Connection, Conversation};
use crate::player::{Page, Said, Stage};

/// How long a video that is paused or over keeps its player.
const KEPT_PAUSED: Duration = Duration::from_secs(5 * 60);

/// How long a video that is paused or over stays in sight before its
/// player is put away behind the still: `YouTube`'s page keeps working
/// while it is seen, paused or not, and stops once hidden.
const SEEN_PAUSED: Duration = Duration::from_secs(10);

/// Which message a video plays on: by its name where the server gave it
/// one, so that earlier messages arriving do not move it.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Key {
    Named(SharedString),
    At(usize),
}

/// The video playing, and its player.
pub(super) struct Playing {
    /// The video's eleven-letter name.
    id: SharedString,
    conversation: Option<Conversation>,
    message: Key,
    stage: Rc<RefCell<Stage>>,
    /// Shown over the whole window rather than on its card.
    large: bool,
    /// Paused long enough to be put away: the card shows its still, and a
    /// press on it plays on.
    tucked: bool,
    /// Lets the player go once it has rested long enough; dropped, it
    /// does not.
    resting: Option<Task<()>>,
    /// Hears what the page says, for as long as the player lives.
    _hearing: Task<()>,
}

impl Shell {
    /// Play the video `id` of message `index` on its card: in place where
    /// the reader has let `YouTube` in, else after asking; in the browser
    /// where nothing plays in place.
    pub(super) fn play_video(
        &mut self,
        index: usize,
        id: SharedString,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let trusted = self.trusts_youtube();
        let embeds = &mut self.panels.embeds;
        if !embeds.screens.plays_in_place() {
            self.follow_link(youtube::watch(&id).into(), cx);
            return;
        }
        if !embeds.lets_in_video(&id, trusted) {
            embeds.asking_play = Some(index);
            cx.notify();
            return;
        }
        embeds.asking_play = None;
        if embeds
            .playing
            .as_ref()
            .is_some_and(|playing| playing.id == id)
        {
            return;
        }
        self.stop_video(cx);
        let (tell, told) = async_channel::unbounded();
        let screen = match self
            .panels
            .embeds
            .screens
            .open(&Page::of(&id), window, tell)
        {
            Ok(screen) => screen,
            Err(error) => {
                tracing::warn!(%error, "the video cannot play here");
                self.follow_link(youtube::watch(&id).into(), cx);
                return;
            }
        };
        let mut stage = Stage::new(screen);
        // The keyboard stays with the client until the player is clicked.
        stage.release_keys();
        let hearing = cx.spawn(async move |shell, cx| {
            while let Ok(said) = told.recv().await {
                let heard = shell.update(cx, |shell, cx| shell.heard(said, cx));
                if heard.is_err() {
                    break;
                }
            }
        });
        let message = match self
            .messages
            .get(index)
            .and_then(|message| message.id.clone())
        {
            Some(name) => Key::Named(name),
            None => Key::At(index),
        };
        self.panels.embeds.playing = Some(Playing {
            id,
            conversation: self.open,
            message,
            stage: Rc::new(RefCell::new(stage)),
            large: false,
            tucked: false,
            resting: None,
            _hearing: hearing,
        });
        cx.notify();
    }

    /// Whether `YouTube`'s host is trusted.
    pub(super) fn trusts_youtube(&self) -> bool {
        self.panels
            .links
            .trusted
            .iter()
            .any(|host| host == "www.youtube.com")
    }

    /// Stop the video playing, if one is, and give back what it held.
    pub(super) fn stop_video(&mut self, cx: &mut Context<Self>) {
        if let Some(playing) = self.panels.embeds.playing.take() {
            playing.stage.borrow_mut().release_keys();
            drop(playing);
            crate::trim::soon(cx);
            cx.notify();
        }
    }

    /// Show the video over the whole window, or back on its card.
    pub(super) fn enlarge_video(&mut self, large: bool, cx: &mut Context<Self>) {
        if let Some(playing) = self.panels.embeds.playing.as_mut() {
            playing.large = large;
            cx.notify();
        }
    }

    /// Shrink the enlarged video back onto its card; whether there was one.
    pub(crate) fn shrink_video(&mut self, cx: &mut Context<Self>) -> bool {
        let large = self
            .panels
            .embeds
            .playing
            .as_ref()
            .is_some_and(|playing| playing.large);
        if large {
            self.enlarge_video(false, cx);
        }
        large
    }

    /// The page said how the video stands. Paused or over, the player
    /// holds less, and is let go of if it stays so.
    fn heard(&mut self, said: Said, cx: &mut Context<Self>) {
        let Some(playing) = self.panels.embeds.playing.as_mut() else {
            return;
        };
        match said {
            Said::Failed => {
                let watch = youtube::watch(&playing.id);
                self.stop_video(cx);
                self.follow_link(watch.into(), cx);
                return;
            }
            // Enlarged, there is no conversation under it to scroll.
            Said::Wheel(_) if playing.large => return,
            #[expect(clippy::cast_precision_loss, reason = "a few hundred pixels")]
            Said::Wheel(down) => {
                self.rows.scroll_by(px(down as f32));
                cx.notify();
                return;
            }
            Said::Playing | Said::Paused | Said::Ended => {}
        }
        let resting = said != Said::Playing;
        playing.stage.borrow_mut().rest(resting);
        playing.tucked &= resting;
        playing.resting = resting.then(|| {
            let executor = cx.background_executor().clone();
            cx.spawn(async move |shell, cx| {
                executor.timer(SEEN_PAUSED).await;
                let _ = shell.update(cx, Self::tuck_video);
                executor.timer(KEPT_PAUSED.saturating_sub(SEEN_PAUSED)).await;
                let _ = shell.update(cx, Self::stop_video);
            })
        });
    }

    /// Put the paused player away behind its card's still.
    fn tuck_video(&mut self, cx: &mut Context<Self>) {
        if let Some(playing) = self.panels.embeds.playing.as_mut() {
            playing.tucked = true;
            playing.large = false;
            cx.notify();
        }
    }

    /// Bring the put-away player back and play on.
    pub(super) fn play_on(&mut self, cx: &mut Context<Self>) {
        if let Some(playing) = self.panels.embeds.playing.as_mut() {
            playing.tucked = false;
            playing.stage.borrow_mut().play_on();
            cx.notify();
        }
    }

    /// Whether the video on message `index` is put away behind its still.
    pub(super) fn video_tucked(&self, index: usize) -> bool {
        self.panels
            .embeds
            .playing
            .as_ref()
            .is_some_and(|playing| playing.tucked && self.playing_index(playing) == Some(index))
    }

    /// Whether the video plays on message `index`'s card, and over the
    /// whole window or not.
    pub(super) fn video_at(&self, index: usize) -> Option<bool> {
        let playing = self.panels.embeds.playing.as_ref()?;
        (self.playing_index(playing) == Some(index)).then_some(playing.large)
    }

    /// The index of the message `playing` plays on, while it is there.
    fn playing_index(&self, playing: &Playing) -> Option<usize> {
        match &playing.message {
            Key::Named(name) => self
                .messages
                .iter()
                .position(|message| message.id.as_ref() == Some(name)),
            // Without a name, it is the message at that place while that
            // message still links the video.
            Key::At(index) => self
                .messages
                .get(*index)
                .is_some_and(|message| message.html.contains(playing.id.as_ref()))
                .then_some(*index),
        }
    }

    /// Where the player goes, drawn on its stage: a still covered by the
    /// player's window, which is put where this was painted once the
    /// frame is done.
    pub(super) fn video_stage(&self) -> Option<AnyElement> {
        let stage = Rc::clone(&self.panels.embeds.playing.as_ref()?.stage);
        Some(
            canvas(
                |_, _, _| {},
                move |bounds, (), window, _| {
                    let mark = window.paint_mark();
                    stage
                        .borrow_mut()
                        .seen(bounds, window.content_mask().bounds, mark);
                    // A screen rendering off screen is drawn here, by the
                    // client; a window of its own lies over this instead.
                    if let Some(frame) = stage.borrow_mut().frame() {
                        let _ = window.paint_image(bounds, Corners::default(), frame, 0, false);
                    }
                    // A press anywhere in the client gives it the keyboard
                    // back from the player.
                    let keys = Rc::clone(&stage);
                    window.on_mouse_event(move |_: &MouseDownEvent, phase, _, _| {
                        if phase == DispatchPhase::Capture {
                            keys.borrow_mut().release_keys();
                        }
                    });
                },
            )
            .absolute()
            .size_full()
            .into_any_element(),
        )
    }

    /// What stands over the window for the video: the watch that places
    /// its player once each frame is painted, and the video enlarged.
    /// Stops it first if its card is gone for good.
    pub(super) fn video_layer(&mut self, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let gone = self.panels.embeds.playing.as_ref().is_some_and(|playing| {
            playing.conversation != self.open
                || self.snapshot.connection != Connection::Connected
                || self.playing_index(playing).is_none()
        });
        if gone {
            self.stop_video(cx);
        }
        let Some(playing) = self.panels.embeds.playing.as_ref() else {
            return Vec::new();
        };
        let stage = Rc::clone(&playing.stage);
        let watch = canvas(
            |_, _, _| {},
            move |_, (), window, _| {
                let stage = Rc::clone(&stage);
                window.on_frame_painted(move |window, _| stage.borrow_mut().settle(window));
            },
        )
        .absolute()
        .size_0()
        .into_any_element();
        let large = playing.large.then(|| self.large_video(cx));
        [watch].into_iter().chain(large).collect()
    }

    /// The video over the whole window, with the way back.
    fn large_video(&self, cx: &mut Context<Self>) -> AnyElement {
        div()
            .id("video-large")
            .debug_selector(|| "video-large".to_owned())
            .absolute()
            .inset_0()
            .occlude()
            .bg(gpui::black().opacity(0.9))
            .flex()
            .flex_col()
            .p(px(16.0))
            .gap(px(10.0))
            .child(
                div().flex().justify_end().child(
                    Button::new("video-shrink", "Back to the conversation")
                        .size(Size::Small)
                        .emphasis(Emphasis::Contained)
                        .on_click(cx.listener(|shell, _, _, cx| shell.enlarge_video(false, cx))),
                ),
            )
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .relative()
                    .bg(gpui::black())
                    .children(self.video_stage()),
            )
            .into_any_element()
    }

    /// The video playing, for the tests.
    #[cfg(test)]
    pub(super) fn video_playing(&self) -> Option<&str> {
        Some(self.panels.embeds.playing.as_ref()?.id.as_ref())
    }
}
