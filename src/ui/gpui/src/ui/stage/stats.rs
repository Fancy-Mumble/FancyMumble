//! "Stats for Nerds" (`StreamStatsPanel.tsx`): how the share shown large
//! arrives, and, while sharing, what the uplink does.

use std::time::Instant;

use gpui::{AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::IconButton;
use crate::share::{FeedStats, Uplink};
use crate::theme::Theme;
use crate::words::t;

/// Two samples a second apart: how fast frames and bytes come.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Sampled {
    pub now: FeedStats,
    pub fps: Option<f32>,
    pub kbps: Option<f32>,
    at: Option<Instant>,
}

impl Sampled {
    /// The sample after this one, taken at `at`.
    pub(crate) fn next(&self, now: FeedStats, at: Instant) -> Self {
        let rates = self.at.map(|before| {
            let secs = at.duration_since(before).as_secs_f32().max(0.001);
            let frames = now.decoded.saturating_sub(self.now.decoded) as f32;
            let bytes = now.bytes.saturating_sub(self.now.bytes) as f32;
            (frames / secs, bytes * 8.0 / 1000.0 / secs)
        });
        Self {
            fps: rates.map(|(fps, _)| fps),
            kbps: rates.map(|(_, kbps)| kbps),
            now,
            at: Some(at),
        }
    }
}

/// What is not known yet.
const NONE: &str = "–";

/// The rows of the panel: what each says, and its value.
pub(super) fn rows(
    sampled: Option<&Sampled>,
    frames: (u64, u64),
    viewport: Option<(u32, u32)>,
    uplink: Option<&Uplink>,
) -> Vec<(SharedString, String)> {
    let stats = sampled.map(|sampled| &sampled.now);
    let or_none = |value: Option<String>| value.unwrap_or_else(|| NONE.to_owned());
    let mut rows = vec![
        (
            t!("Viewport / Frames"),
            format!(
                "{} / {}",
                viewport.map_or_else(|| NONE.to_owned(), |(w, h)| format!("{w}×{h}")),
                t!("{{dropped}} dropped of {{total}}", dropped = frames.1, total = frames.0)
            ),
        ),
        (t!("FPS"), or_none(sampled.and_then(|s| s.fps).map(|fps| format!("{fps:.1} fps")))),
        (
            t!("Connection"),
            or_none(stats.map(|s| match &s.ice {
                Some(path) => format!("{} ({path})", s.connection),
                None => s.connection.clone(),
            })),
        ),
        (
            t!("Connection Speed"),
            or_none(sampled.and_then(|s| s.kbps).map(|kbps| format!("{kbps:.0} kbps"))),
        ),
        (t!("Latency (RTT)"), or_none(stats.and_then(|s| s.rtt_ms).map(|ms| format!("{ms:.0} ms")))),
        (
            t!("Packet Loss"),
            or_none(stats.map(|s| {
                let pct = if s.packets + s.lost == 0 {
                    0.0
                } else {
                    s.lost as f64 * 100.0 / (s.packets + s.lost) as f64
                };
                format!("{pct:.1}% ({} total)", s.lost)
            })),
        ),
        (
            t!("Current Res"),
            or_none(stats.and_then(|s| s.sent).map(|(w, h)| format!("{w}×{h}"))),
        ),
        (t!("Codec"), "H264".to_owned()),
        (
            "Decoder".into(),
            or_none(stats.and_then(|s| s.busy_ms).map(|ms| format!("openh264 · SW · {ms:.1} ms/frame"))),
        ),
        (t!("Jitter"), or_none(stats.and_then(|s| s.jitter_ms).map(|ms| format!("{ms:.1} ms")))),
    ];
    if let Some(uplink) = uplink {
        rows.push((
            t!("Send target"),
            format!("{} / {} kbps", uplink.target_kbps, uplink.ceiling_kbps),
        ));
        rows.push((t!("Uplink loss"), format!("{:.1} %", uplink.loss * 100.0)));
        rows.push((
            t!("Uplink RTT"),
            uplink.rtt_ms.map_or_else(|| "-".to_owned(), |ms| format!("{ms} ms")),
        ));
    }
    rows
}

/// The panel, over the stage's top left.
pub(super) fn render(rows: Vec<(SharedString, String)>, theme: &Theme, cx: &mut Context<Shell>) -> AnyElement {
    div()
        .id("stage-stats")
        .debug_selector(|| "stage-stats".to_owned())
        .absolute()
        .top(px(8.0))
        .left(px(8.0))
        .min_w(px(340.0))
        .max_w(px(480.0))
        .p(px(8.0))
        .rounded(theme.skin.radius_md)
        .bg(gpui::hsla(0.0, 0.0, 0.05, 0.82))
        .text_color(gpui::hsla(0.0, 0.0, 0.92, 1.0))
        .text_size(px(11.0))
        .font_family("Consolas")
        .occlude()
        .child(
            div()
                .flex()
                .items_center()
                .child(div().flex_1().child(t!("Stats for Nerds")))
                .child(
                    IconButton::new("stage-stats-close", "x")
                        .size(20.0)
                        .glyph_size(11.0)
                        .tip(t!("Close stats"))
                        .on_click(cx.listener(|shell, _, _, cx| {
                            shell.stage.stats_open = false;
                            cx.notify();
                        })),
                ),
        )
        .children(rows.into_iter().map(|(label, value)| {
            div()
                .flex()
                .child(div().w(px(172.0)).flex_none().child(label))
                .child(div().min_w_0().child(value))
        }))
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_and_bits_a_second_come_from_two_samples() {
        let start = Instant::now();
        let first = Sampled::default().next(
            FeedStats {
                decoded: 10,
                bytes: 1000,
                ..FeedStats::default()
            },
            start,
        );
        assert_eq!(first.fps, None, "one sample says nothing of a rate");
        let second = first.next(
            FeedStats {
                decoded: 40,
                bytes: 126_000,
                ..FeedStats::default()
            },
            start + std::time::Duration::from_secs(1),
        );
        assert_eq!(second.fps, Some(30.0));
        assert_eq!(second.kbps, Some(1000.0));
    }

    #[test]
    fn the_rows_say_what_is_not_known_yet() {
        let rows = rows(None, (0, 0), None, None);
        let fps = rows.iter().find(|(label, _)| label == "FPS").expect("a row");
        assert_eq!(fps.1, "–");
        let with_uplink = super::rows(
            None,
            (3, 1),
            Some((640, 360)),
            Some(&Uplink {
                target_kbps: 2500,
                ceiling_kbps: 6000,
                loss: 0.01,
                rtt_ms: Some(40),
            }),
        );
        assert!(with_uplink.iter().any(|(_, value)| value == "2500 / 6000 kbps"));
        assert!(with_uplink[0].1.starts_with("640×360 / 1 dropped of 3"));
    }
}
