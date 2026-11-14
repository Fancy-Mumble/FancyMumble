//! A picture shared as a file, drawn as the web client draws one
//! (`FileAttachmentCard` with `bare`): the picture is the message. One
//! rounded card at the picture's own shape, held to 420 by 320; a picture
//! longer than three by four is framed instead, whole, on a blurred copy of
//! itself. Over its lower left a chip says what the file is (size, reach,
//! when it goes) with the flag that copies a public link; over its upper
//! right, under the pointer, Save, and Open where the file has a link. A
//! share that has expired is a card that says so.
//!
//! The picture drawn is the conversation's small copy (`Fit::Tile`); a
//! click opens the whole of it large (`lightbox_file`).

use std::sync::Arc;

use gpui::{
    AnyElement, Context, Global, IntoElement, ParentElement, SharedString, Styled, div, prelude::*,
    px,
};

use super::Shell;
use super::kit::icon;
use super::kit::over_picture::{FactsChip, OverButton};
use crate::engine::{Attachment, OpenTo};
use crate::theme::Theme;
use crate::words::t;

/// The most a picture is drawn at: `SINGLE_MAX_W` by `SINGLE_MAX_H`.
pub(crate) const MOST: (f32, f32) = (420.0, 320.0);
/// Longer than this shape, a picture is framed rather than shrunk.
const FRAME_RATIO: f32 = 3.0 / 4.0;
/// The frame's height; its width is the frame's shape of it.
const FRAME_HEIGHT: f32 = 400.0;
/// Beyond this an expiry is a date rather than a countdown.
const COUNTDOWN_HORIZON: u64 = 48 * 3600;
/// How long "Copied" stays after a link is copied.
const COPIED_FOR: std::time::Duration = std::time::Duration::from_millis(1600);

/// Seconds since the epoch, now.
pub(crate) fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

/// `23h`, `44m`, `2d`: the largest unit that still says something, rounded
/// down (`coarseCountdown`).
pub(crate) fn coarse(seconds: u64) -> String {
    match seconds {
        86_400.. => format!("{}d", seconds / 86_400),
        3_600.. => format!("{}h", seconds / 3_600),
        60.. => format!("{}m", seconds / 60),
        _ => format!("{}s", seconds.max(1)),
    }
}

/// `21/11`: the day an expiry lands on, with no year and no clock, as the
/// reader's dates are written (`formats`).
pub(crate) fn short_day(at: u64) -> String {
    use chrono::TimeZone as _;
    i64::try_from(at)
        .ok()
        .and_then(|at| chrono::Local.timestamp_opt(at, 0).single())
        .map_or_else(String::new, |when| {
            crate::formats::current()
                .date
                .day_and_month(when.date_naive(), crate::words::spoken())
        })
}

/// Whether `file` has expired by `now`.
pub(crate) fn expired(file: &Attachment, now: u64) -> bool {
    file.expires_at.is_some_and(|at| at <= now)
}

/// When `file` goes, as its chip says it: a countdown inside two days, a
/// date beyond; nothing for a file that does not expire or has.
pub(crate) fn expiry(file: &Attachment, now: u64) -> Option<SharedString> {
    let left = file.expires_at?.checked_sub(now).filter(|left| *left > 0)?;
    Some(if left < COUNTDOWN_HORIZON {
        t!("{{duration}} left", duration = coarse(left))
    } else {
        format!("{} {}", t!("expires"), short_day(file.expires_at?)).into()
    })
}

/// What the chip says of `file`: its size, its reach unless it is a public
/// link (the flag says that), and when it goes (`FileFacts`).
pub(crate) fn facts(file: &Attachment, now: u64) -> Vec<SharedString> {
    let reach = match file.open_to {
        OpenTo::Here => Some("session"),
        OpenTo::Password => Some("password"),
        OpenTo::Link => None,
    };
    file.size
        .map(|size| SharedString::from(super::size_in_words(size)))
        .into_iter()
        .chain(reach.map(SharedString::from))
        .chain(expiry(file, now))
        .collect()
}

/// The box a picture of `natural` size is drawn in, and whether it is
/// framed.
pub(crate) fn picture_box(natural: Option<(u32, u32)>) -> (f32, f32, bool) {
    let Some(natural) = natural.filter(|(width, height)| *width > 0 && *height > 0) else {
        return (MOST.0, MOST.1, false);
    };
    #[allow(
        clippy::cast_precision_loss,
        reason = "a picture's side in pixels is nowhere near 2^24"
    )]
    let ratio = natural.0 as f32 / natural.1 as f32;
    if ratio < FRAME_RATIO {
        return (FRAME_HEIGHT * FRAME_RATIO, FRAME_HEIGHT, true);
    }
    let (width, height) = crate::picture::fitted(natural, MOST);
    (width, height, false)
}

/// The link copied last, and when: what its flag says for a moment.
struct Copied {
    link: SharedString,
    at: std::time::Instant,
}

impl Global for Copied {}

/// Whether `link` was copied a moment ago.
fn just_copied(link: &str, cx: &gpui::App) -> bool {
    cx.try_global::<Copied>()
        .is_some_and(|copied| copied.link == link && copied.at.elapsed() < COPIED_FOR)
}

impl Shell {
    /// The card for `file` of message `index`, `at` among its files, drawn
    /// from `picture`, the small copy fetched for it.
    pub(super) fn picture_card(
        &self,
        file: &Attachment,
        picture: &Arc<gpui::Image>,
        (index, at): (usize, usize),
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        use crate::pictures::{Fit, shown};
        let natural = file
            .pixels
            .or_else(|| crate::picture::dimensions(picture.bytes()));
        let (width, height, framed) = picture_box(natural);
        let opened = Arc::clone(picture);
        let opened_file = file.clone();
        let group = SharedString::from(format!("shared-picture-{index}-{at}"));
        div()
            .id(("shared-picture", index * 16 + at))
            .debug_selector(move || format!("shared-picture-{index}-{at}"))
            .group(group.clone())
            .relative()
            .flex_none()
            .w(px(width))
            .h(px(height))
            .rounded(theme.skin.radius_lg)
            .overflow_hidden()
            .bg(theme.c.card2)
            .cursor_pointer()
            .on_click(cx.listener(move |shell, _, _, cx| {
                shell.open_shared_large(&opened_file, &opened, cx);
            }))
            .when(framed, |card| {
                // The picture again, blurred and dimmed, filling the frame.
                card.child(
                    gpui::img(shown(picture, Fit::Wall(22)))
                        .absolute()
                        .size_full()
                        .rounded(theme.skin.radius_lg)
                        .object_fit(gpui::ObjectFit::Cover),
                )
                // `brightness(0.62)`: black at 38 percent over it.
                .child(
                    div()
                        .absolute()
                        .size_full()
                        .rounded(theme.skin.radius_lg)
                        .bg(gpui::rgba(0x0000_0061)),
                )
            })
            .child(
                gpui::img(shown(picture, Fit::Tile))
                    .absolute()
                    .size_full()
                    // A picture is not cut by the card's corners: its own.
                    .rounded(theme.skin.radius_lg)
                    .object_fit(gpui::ObjectFit::Contain),
            )
            .child(
                div()
                    .absolute()
                    .left(px(8.0))
                    .bottom(px(8.0))
                    .max_w(px(width - 16.0))
                    .child(
                        FactsChip::new(facts(file, now_secs())).extra(self.reach_flag(
                            file,
                            (index, at),
                            false,
                            cx,
                        )),
                    ),
            )
            .child(
                div()
                    .absolute()
                    .top(px(8.0))
                    .right(px(8.0))
                    .flex()
                    .gap(px(5.6))
                    .opacity(0.0)
                    .group_hover(group, |strip| strip.opacity(1.0))
                    .children(self.picture_actions(file, (index, at), cx)),
            )
            .into_any_element()
    }

    /// The flag that says a file reaches past the channel, and copies its
    /// link (`AttachmentVisibilityBadge`, overlaid); nothing for a file
    /// shared with those here.
    /// `compact` keeps the button and drops the words, as on an album's
    /// tile: the album says the reach once above its tiles.
    pub(super) fn reach_flag(
        &self,
        file: &Attachment,
        (index, at): (usize, usize),
        compact: bool,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let label = match file.open_to {
            OpenTo::Here => return None,
            OpenTo::Link => t!("Public link"),
            OpenTo::Password => t!("Password protected"),
        };
        let gone = expired(file, now_secs());
        let link = file.url.clone().filter(|_| !gone);
        let copied = link.as_ref().is_some_and(|link| just_copied(link, cx));
        let glyph = match (copied, file.open_to) {
            (true, _) => "check",
            (false, OpenTo::Password) => "lock",
            (false, _) => "link-2",
        };
        let words = if gone {
            t!("Link expired")
        } else if copied {
            t!("Copied")
        } else {
            label.clone()
        };
        let content = div()
            .flex()
            .items_center()
            .gap(px(5.0))
            .text_size(px(10.5))
            .child(icon(glyph, 11.0, gpui::white()))
            .when(!compact, |flag| {
                flag.child(div().min_w_0().truncate().child(words))
            })
            .when(link.is_some() && !copied, |flag| {
                flag.child(div().opacity(0.7).child(icon("copy", 10.0, gpui::white())))
            });
        let Some(link) = link else {
            return Some(
                div()
                    .id(("reach-flag", index * 16 + at))
                    .child(content)
                    .tooltip(super::kit::keyed_tip(
                        if gone {
                            t!("This link has expired")
                        } else {
                            label
                        },
                        None::<&str>,
                    ))
                    .into_any_element(),
            );
        };
        let tip = if copied {
            t!("Copied")
        } else {
            t!("Copy link")
        };
        Some(
            OverButton::new(("copy-link", index * 16 + at), content)
                .named(format!("copy-link-{index}-{at}"))
                .tip(tip)
                .on_click(cx.listener(move |_, _, _, cx| {
                    cx.write_to_clipboard(gpui::ClipboardItem::new_string(link.to_string()));
                    cx.set_global(Copied {
                        link: link.clone(),
                        at: std::time::Instant::now(),
                    });
                    cx.notify();
                    // Back to the flag once the moment has passed.
                    cx.spawn(async move |shell, cx| {
                        cx.background_executor().timer(COPIED_FOR).await;
                        let _ = shell.update(cx, |_, cx| cx.notify());
                    })
                    .detach();
                }))
                .into_any_element(),
        )
    }

    /// Save, and Open where the file has a link a browser can follow.
    fn picture_actions(
        &self,
        file: &Attachment,
        (index, at): (usize, usize),
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let mut actions = Vec::new();
        if let Some(key) = file
            .key
            .clone()
            .filter(|_| file.open_to != OpenTo::Password)
        {
            let name = file.name.clone();
            actions.push(
                OverButton::new(("save-picture", index * 16 + at), t!("Save"))
                    .named(format!("save-picture-{index}-{at}"))
                    .tip(t!("Download to disk"))
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        shell.save_attachment(key.clone(), &name, cx);
                    }))
                    .into_any_element(),
            );
        }
        let openable =
            matches!(file.open_to, OpenTo::Link | OpenTo::Password) && !expired(file, now_secs());
        if let Some(url) = file.url.clone().filter(|_| openable) {
            actions.push(
                OverButton::new(("open-picture", index * 16 + at), t!("Open"))
                    .named(format!("open-picture-{index}-{at}"))
                    .tip(t!("Open in browser"))
                    .on_click(move |_, _, cx| cx.open_url(&url))
                    .into_any_element(),
            );
        }
        actions
    }

    /// The card a shared file that has expired is: the clock, its name,
    /// that it has expired, and when it did.
    pub(super) fn expired_card(
        &self,
        file: &Attachment,
        (index, at): (usize, usize),
        theme: &Theme,
    ) -> AnyElement {
        let when = file
            .expires_at
            .map(|at| SharedString::from(format!("{} {}", t!("expired"), short_day(at))));
        let line: Vec<SharedString> = file
            .size
            .map(|size| SharedString::from(super::size_in_words(size)))
            .into_iter()
            .chain(match file.open_to {
                OpenTo::Here => Some("session".into()),
                OpenTo::Password => Some("password".into()),
                OpenTo::Link => None,
            })
            .chain(when)
            .collect();
        div()
            .id(("expired-file", index * 16 + at))
            .debug_selector(move || format!("expired-file-{index}-{at}"))
            .max_w(px(MOST.0))
            .flex()
            .items_center()
            .gap(px(10.0))
            .px(px(12.0))
            .py(px(9.0))
            .rounded(theme.skin.radius_md)
            .bg(theme.c.card)
            .border_1()
            .border_color(theme.c.line2)
            .opacity(0.75)
            .child(icon("clock", 28.0, theme.c.dim))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .truncate()
                            .text_size(px(13.0))
                            .child(file.name.clone()),
                    )
                    .child(
                        div()
                            .text_size(px(12.0))
                            .text_color(theme.c.muted)
                            .child(t!(
                                "This download link has expired and is no longer available."
                            )),
                    )
                    .child(
                        div().text_size(px(11.0)).text_color(theme.c.dim).child(
                            SharedString::from(
                                line.iter()
                                    .map(SharedString::as_ref)
                                    .collect::<Vec<_>>()
                                    .join(" · "),
                            ),
                        ),
                    ),
            )
            .into_any_element()
    }
}
