//! A `YouTube` video's card: its still, its title, the play mark, and
//! what else can be done with it. While it plays in place, the player's
//! window lies over the still.

use std::sync::Arc;

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::embeds::{Asking, ROOM, Showing, Want, gate};
use super::kit::{Button, PlayMark, Size};
use super::widgets::EMPHASIS;
use crate::embed::youtube;
use crate::engine::Preview;
use crate::theme::Theme;

/// How tall a video's still is on its card: 16 by 9 of the card's width.
const STAGE_HEIGHT: f32 = 236.0;

/// What a card shows of its video.
struct Video {
    index: usize,
    id: SharedString,
    still: Option<Arc<gpui::Image>>,
    title: SharedString,
    /// On the card, over the whole window, or not playing.
    playing: Option<bool>,
    /// Paused, and its player put away behind the still.
    tucked: bool,
}

impl Shell {
    /// The card of the video `id`, the first link of message `index`. The
    /// server's still and title where it sent them; else `YouTube`'s, once
    /// let in.
    pub(super) fn video_card(
        &mut self,
        index: usize,
        id: &SharedString,
        preview: Option<Arc<Preview>>,
        trusted: bool,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let (still_at, about_at) = (
            SharedString::from(youtube::still(id)),
            SharedString::from(youtube::about(id)),
        );
        let sent = preview.as_ref().and_then(|preview| preview.picture.clone());
        if sent.is_none() && self.panels.embeds.wants(&still_at, trusted) {
            self.fetch_embed(still_at.clone(), Want::Picture, cx);
            self.fetch_embed(about_at.clone(), Want::Title, cx);
        }
        let fetched = match self.panels.embeds.showing(&still_at, trusted) {
            Showing::Picture(still) => Some(still),
            _ => None,
        };
        let video = Video {
            index,
            id: id.clone(),
            still: sent.or(fetched),
            title: preview
                .and_then(|preview| preview.title.clone())
                .or_else(|| self.panels.embeds.title(&about_at))
                .unwrap_or_else(|| "YouTube video".into()),
            playing: self.video_at(index),
            tucked: self.video_tucked(index),
        };
        let let_in = self.panels.embeds.lets_in_video(id, trusted);
        let asks =
            !let_in && (video.still.is_none() || self.panels.embeds.asking_play == Some(index));
        let card = self.video(&video, theme, cx);
        if !asks {
            return card;
        }
        let asking = Asking {
            index,
            what: "YouTube".to_owned(),
            host: "YouTube",
        };
        let urls = vec![still_at, about_at];
        let id = id.clone();
        let question = gate(&asking, theme, cx, move |shell, window, cx| {
            shell.load_embeds(urls.clone(), cx);
            if shell.panels.embeds.asking_play == Some(index) {
                shell.play_video(index, id.clone(), window, cx);
            }
        });
        div()
            .flex()
            .flex_col()
            .gap(px(6.0))
            .child(card)
            .child(question)
            .into_any_element()
    }

    /// The card itself.
    fn video(&self, video: &Video, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let index = video.index;
        div()
            .id(("embed-youtube", index))
            .debug_selector(move || format!("embed-youtube-{index}"))
            // Its own width, whatever else the message holds: the player
            // is laid over it at the size it is drawn.
            .w(px(ROOM.0))
            .max_w_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .rounded(theme.skin.radius_md)
            .bg(theme.c.card)
            .border_1()
            .border_color(theme.c.line2)
            .child(self.video_still(video, cx))
            .child(
                div()
                    .px(px(12.0))
                    .pt(px(9.0))
                    .pb(px(4.0))
                    .flex()
                    .flex_col()
                    .gap(px(2.0))
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.c.muted)
                            .child("YouTube"),
                    )
                    .child(
                        div()
                            .truncate()
                            .text_size(px(13.0))
                            .font_weight(EMPHASIS)
                            .text_color(theme.c.accent_text)
                            .child(video.title.clone()),
                    ),
            )
            .child(video_actions(video, cx))
            .into_any_element()
    }

    /// The still, with the play mark over it; or, while the video plays
    /// on this card, the place its player lies over. Put away while
    /// paused, the still is back, and a press plays on.
    fn video_still(&self, video: &Video, cx: &mut Context<Self>) -> AnyElement {
        let (index, id) = (video.index, video.id.clone());
        let on_card = video.playing == Some(false) && !video.tucked;
        div()
            .id(("embed-play", index))
            .debug_selector(move || format!("embed-play-{index}"))
            .relative()
            .w_full()
            .h(px(STAGE_HEIGHT))
            .bg(gpui::rgb(0x000a_0d14))
            .when_some(video.still.clone(), |stage, still| {
                stage.child(
                    gpui::img(crate::pictures::shown(&still, crate::pictures::Fit::Tile))
                        .absolute()
                        .size_full()
                        .object_fit(gpui::ObjectFit::Cover),
                )
            })
            .when(video.playing.is_none(), |stage| {
                stage
                    .cursor_pointer()
                    .on_click(cx.listener(move |shell, _, window, cx| {
                        shell.play_video(index, id.clone(), window, cx);
                    }))
                    .child(PlayMark)
            })
            .when(video.tucked, |stage| {
                stage
                    .cursor_pointer()
                    .on_click(cx.listener(|shell, _, _, cx| shell.play_on(cx)))
                    .child(PlayMark)
            })
            .when(on_card, |stage| stage.children(self.video_stage()))
            .into_any_element()
    }
}

/// What can be done with a video beside playing it: stop it and enlarge
/// it while it plays, and open it in the browser.
fn video_actions(video: &Video, cx: &mut Context<Shell>) -> impl IntoElement {
    let index = video.index;
    let watch = SharedString::from(youtube::watch(&video.id));
    let playing = video.playing.is_some();
    div()
        .px(px(4.0))
        .pb(px(4.0))
        .flex()
        .gap(px(2.0))
        .when(playing, |actions| {
            actions
                .child(
                    Button::new("video-stop", "Stop")
                        .selector(format!("video-stop-{index}"))
                        .size(Size::Small)
                        .on_click(cx.listener(|shell, _, _, cx| shell.stop_video(cx))),
                )
                .child(
                    Button::new("video-enlarge", "Enlarge")
                        .selector(format!("video-enlarge-{index}"))
                        .size(Size::Small)
                        .on_click(cx.listener(|shell, _, _, cx| shell.enlarge_video(true, cx))),
                )
        })
        .child(
            Button::new("video-browser", "Open in browser")
                .selector(format!("video-browser-{index}"))
                .size(Size::Small)
                .on_click(cx.listener(move |shell, _, _, cx| shell.follow_link(watch.clone(), cx))),
        )
}
