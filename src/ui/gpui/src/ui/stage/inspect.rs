//! Parts of the stage opened by `FANCY_GPUI_OPEN=share:<what>`, for
//! looking at them where nothing can click: on the demo engine, whose
//! shares are the test pattern. Each waits a moment for the demo's shares
//! to be on the stage first.
//!
//! - `share:popout`: the feed shown large, in its own window;
//! - `share:overlay`: one's own share of the pattern's first screen, with
//!   the overlay where `FANCY_GPUI_SHARE_PATTERN_AT` puts it;
//! - `share:camera`: the camera beside a screen, shown large;
//! - `share:actual`: the feed shown pixel for pixel, moved off the middle.

use std::time::Duration;

use gpui::Context;

use super::super::Shell;
use crate::share::Fit;

/// How long the demo's shares take to be on the stage.
const SETTLED: Duration = Duration::from_millis(1500);

impl Shell {
    /// Open `what` of the stage, once the demo's shares are on it.
    pub(in crate::ui) fn open_share_for_inspection(&mut self, what: &str, cx: &mut Context<Self>) {
        let what = what.to_owned();
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(SETTLED).await;
            let _ = shell.update(cx, |shell, cx| shell.inspect_share(&what, cx));
        })
        .detach();
    }

    fn inspect_share(&mut self, what: &str, cx: &mut Context<Self>) {
        match what {
            "popout" => self.pop_out(cx),
            "camera" => {
                if let Some(feed) = self.stage_feeds().into_iter().find(|feed| feed.camera) {
                    self.show_large(feed.session(), true);
                }
            }
            "actual" => {
                self.lay_large(Fit::Actual);
                // Drawn once, so that how far it can move is known.
                cx.spawn(async move |shell, cx| {
                    cx.background_executor().timer(SETTLED).await;
                    let _ = shell.update(cx, |shell, cx| shell.pan_by((-260.0, -140.0), cx));
                })
                .detach();
            }
            "overlay" => self.share_pattern_with_overlay(cx),
            _ => {}
        }
        cx.notify();
    }

    /// Share the pattern's first screen, and open the overlay over it once
    /// the share is going.
    fn share_pattern_with_overlay(&mut self, cx: &mut Context<Self>) {
        let media = std::sync::Arc::clone(self.stage.media());
        let listed = cx
            .background_executor()
            .spawn(async move { media.sources() });
        cx.spawn(async move |shell, cx| {
            let Ok(sources) = listed.await else {
                return;
            };
            let first = sources
                .into_iter()
                .find(|source| source.kind == crate::share::SourceKind::Screen);
            let _ = shell.update(cx, |shell, cx| {
                if let Some(first) = first {
                    shell.start_share(vec![first], crate::share::Settings::default(), cx);
                }
            });
            cx.background_executor().timer(SETTLED).await;
            let _ = shell.update(cx, |shell, cx| {
                // Drawn on by Rin, as a viewer would.
                shell.toggle_overlay(cx);
            });
        })
        .detach();
    }
}
