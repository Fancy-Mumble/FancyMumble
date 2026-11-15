//! The card a link's message carries: a poster, as the web client's
//! `LinkPreviewCard` draws one, chosen by what the server said the link is
//! and by the shape of its picture.
//!
//! * a price makes a listing (`Shop`), or a row with a "from" price where
//!   there is no product shot or the page compares shops (`ShopRow`);
//! * no picture: a short full poster for a video, else a row on a tinted
//!   ground with a monogram;
//! * an article, a forum thread or a profile: the side-thumb row;
//! * a picture taller than wide is contained on a blurred bed of itself,
//!   one under 400 pixels across is shown at its own size on that bed,
//!   and anything else fills the poster.
//!
//! The pictures are the server's, as the card's always were: nothing here
//! reaches the site linked. A press anywhere on the poster follows the
//! link, asking first where its host is not trusted.

use std::sync::Arc;

use gpui::{
    AnyElement, Context, Div, Hsla, IntoElement, ParentElement, SharedString, Styled, div,
    prelude::*, px,
};

use super::Shell;
use super::kit::Reachable;
use super::kit::poster::{
    self, BAND, BARE_H, CUT_PAD, FULL_H, PAD, ROW_H, SHOP_H, TALL_H, THUMB,
};
use crate::engine::{Preview, PreviewPrice};
use crate::pictures::{Fit, shown};
use crate::theme::{Cut, Kind, Theme};
use crate::words::t;

/// Which poster a card draws.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Shape {
    Full,
    Contained,
    Native,
    Row,
    Shop,
    ShopRow,
}

/// The kinds the server classified as words rather than media.
const TEXT_KINDS: [&str; 3] = ["article", "forum", "profile"];

/// Which poster `preview` gets, its picture `size` across and down where
/// it has one, and whether it is a video.
pub(super) fn shape_of(preview: &Preview, size: Option<(u32, u32)>, video: bool) -> Shape {
    if let Some(_price) = &preview.details.price {
        let compares = size.is_none()
            || preview
                .details
                .facts
                .iter()
                .any(|(name, _)| name.as_ref() == "sellers");
        return if compares { Shape::ShopRow } else { Shape::Shop };
    }
    let Some((width, height)) = size else {
        return if video { Shape::Full } else { Shape::Row };
    };
    let kind = if video {
        "video"
    } else {
        preview.kind.as_ref().map_or("link", AsRef::as_ref)
    };
    if TEXT_KINDS.contains(&kind) {
        return Shape::Row;
    }
    #[expect(clippy::cast_precision_loss, reason = "a picture's size")]
    let ratio = if width > 0 && height > 0 {
        width as f32 / height as f32
    } else {
        0.0
    };
    if ratio > 0.0 && ratio < 0.9 {
        Shape::Contained
    } else if width > 0 && width < 400 {
        Shape::Native
    } else {
        Shape::Full
    }
}

/// Where this goes: the host, without `www.`.
pub(super) fn source_label(preview: &Preview) -> String {
    crate::embed::host_of(&preview.url).map_or_else(
        || {
            preview
                .site
                .as_ref()
                .map_or_else(|| preview.url.to_string(), ToString::to_string)
        },
        |host| host.trim_start_matches("www.").to_owned(),
    )
}

/// The description, unless it is the title or the source over again.
pub(super) fn context_of(preview: &Preview, label: &str) -> Option<SharedString> {
    let description = preview.description.as_ref()?.trim();
    let bare = |text: &str| {
        text.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect::<String>()
    };
    let said = bare(description);
    if said.is_empty() {
        return None;
    }
    let title = preview.title.as_ref().map_or("", AsRef::as_ref);
    for other in [title, label] {
        let known = bare(other);
        if !known.is_empty() && (said.starts_with(&known) || known.starts_with(&said)) {
            return None;
        }
    }
    Some(description.to_owned().into())
}

/// The page's own facts as a poster prints them, three at most.
pub(super) fn facts_of(preview: &Preview) -> Vec<SharedString> {
    let mut facts = Vec::new();
    for (name, value) in &preview.details.facts {
        if facts.len() == 3 {
            break;
        }
        let glyph = match name.as_ref() {
            "score" => Some("↑"),
            "comments" => Some("\u{1F4AC}"),
            "likes" => Some("♥"),
            "views" => Some("▶"),
            _ => None,
        };
        let fact = match (glyph, name.as_ref()) {
            (Some(glyph), _) => format!("{glyph} {value}").into(),
            (None, "sellers") => t!("{{value}} shops", value = value),
            (None, "shipping") => t!("{{value}} shipping", value = value),
            (None, "rating") => t!("★ {{value}}", value = value),
            (None, "content.rating") => {
                let mut letters = value.chars();
                letters.next().map_or_else(SharedString::default, |first| {
                    format!("{}{}", first.to_uppercase(), letters.as_str()).into()
                })
            }
            (None, "availability") => continue,
            (None, other) if other.starts_with("price.") => continue,
            (None, other) => format!("{other}: {value}").into(),
        };
        facts.push(fact);
    }
    facts
}

/// Whether the thing is there to buy, in words.
fn stock_of(price: &PreviewPrice) -> Option<SharedString> {
    let state: String = price
        .availability
        .to_lowercase()
        .chars()
        .filter(char::is_ascii_lowercase)
        .collect();
    if state.contains("preorder") {
        Some(t!("Pre-order"))
    } else if state.contains("outofstock") || state == "oos" {
        Some(t!("Out of stock"))
    } else if state.contains("instock") {
        Some(t!("In stock"))
    } else {
        None
    }
}

/// A price as the English of the web client's `Intl.NumberFormat` writes
/// it: "€89.99".
pub(super) fn money(amount: &str, currency: &str) -> SharedString {
    let Ok(number) = amount.trim().parse::<f64>() else {
        return amount.to_owned().into();
    };
    let digits = if currency == "JPY" { 0 } else { 2 };
    let figure = grouped(number, digits);
    let symbol = match currency {
        "EUR" => Some("€"),
        "USD" => Some("$"),
        "GBP" => Some("£"),
        "JPY" => Some("¥"),
        _ => None,
    };
    match (symbol, currency.is_empty()) {
        (Some(symbol), _) => format!("{symbol}{figure}").into(),
        (None, true) => grouped(number, 0.max(decimals(amount))).into(),
        (None, false) => format!("{currency}\u{a0}{figure}").into(),
    }
}

/// How many decimals `amount` was written with, three at most.
fn decimals(amount: &str) -> usize {
    amount
        .split_once('.')
        .map_or(0, |(_, after)| after.trim().len().min(3))
}

/// `number` with `digits` decimals and its thousands grouped by commas.
fn grouped(number: f64, digits: usize) -> String {
    let written = format!("{number:.digits$}");
    let (whole, part) = written.split_once('.').unwrap_or((&written, ""));
    let (sign, whole) = whole
        .strip_prefix('-')
        .map_or(("", whole), |rest| ("-", rest));
    let mut out = String::new();
    for (at, digit) in whole.chars().enumerate() {
        if at > 0 && (whole.len() - at) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    if part.is_empty() {
        format!("{sign}{out}")
    } else {
        format!("{sign}{out}.{part}")
    }
}

/// How much cheaper `amount` is than `was`, in whole percent.
pub(super) fn discount_of(amount: &str, was: &str) -> Option<u32> {
    let now: f64 = amount.trim().parse().ok()?;
    let before: f64 = was.trim().parse().ok()?;
    if !now.is_finite() || !before.is_finite() || before <= now {
        return None;
    }
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a percentage between 0 and 100"
    )]
    Some(((before - now) / before * 100.0).round() as u32)
}

/// When a page went out, as "3 years ago": the English of the web client's
/// `Intl.RelativeTimeFormat` with `numeric: "auto"`.
pub(super) fn ago(published: &str, now_seconds: i64) -> Option<SharedString> {
    let at = chrono::DateTime::parse_from_rfc3339(published.trim())
        .ok()?
        .timestamp();
    let seconds = at - now_seconds;
    let scale = [
        ("year", 31_536_000),
        ("month", 2_592_000),
        ("week", 604_800),
        ("day", 86_400),
        ("hour", 3600),
        ("minute", 60),
    ];
    for (unit, size) in scale {
        if seconds.abs() >= size {
            #[expect(clippy::cast_precision_loss, reason = "a span of time")]
            #[expect(clippy::cast_possible_truncation, reason = "rounded")]
            let count = (seconds as f64 / size as f64).round() as i64;
            return Some(spoken_span(count, unit).into());
        }
    }
    Some("this minute".into())
}

fn spoken_span(count: i64, unit: &str) -> String {
    match (count, unit) {
        (-1, "day") => "yesterday".into(),
        (1, "day") => "tomorrow".into(),
        (-1, "year" | "month" | "week") => format!("last {unit}"),
        (1, "year" | "month" | "week") => format!("next {unit}"),
        (count, unit) if count < 0 => {
            let count = -count;
            let plural = if count == 1 { "" } else { "s" };
            format!("{count} {unit}{plural} ago")
        }
        (count, unit) => {
            let plural = if count == 1 { "" } else { "s" };
            format!("in {count} {unit}{plural}")
        }
    }
}

/// What a poster is drawn from: the preview, and what was worked out of it.
struct Drawn<'a> {
    preview: &'a Preview,
    picture: Option<&'a Arc<gpui::Image>>,
    /// The picture's own size, measured off its bytes.
    size: Option<(u32, u32)>,
    shape: Shape,
    label: String,
    title: SharedString,
    facts: Vec<SharedString>,
    context: Option<SharedString>,
    /// The insets on the leading and trailing side of the bottom.
    pads: (f32, f32),
}

impl Shell {
    /// Whether a message with `body` is drawn as its link's poster alone:
    /// it is that link and nothing else, the server has said what is
    /// behind it, and messages are drawn as bubbles, which the poster takes
    /// the place of (the web's `embedsInBubble && bodyIsTheLink`).
    pub(super) fn link_is_the_message(&self, body: &super::conversation::DrawnBody) -> bool {
        self.panels.settings.look.carded()
            && body.only_links()
            && body
                .first_link()
                .is_some_and(|link| matches!(self.previews.get(&link), Some(Some(_))))
    }

    /// The poster for the first link of message `index`, once the server
    /// has said what is behind it.
    pub(super) fn link_card(
        &self,
        index: usize,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let url = self.bodies.get(&index)?.first_link()?;
        let preview = Arc::clone(self.previews.get(&url)?.as_ref()?);
        let follow = url.clone();
        let frame = div()
            .id(("preview", index))
            .debug_selector(move || format!("preview-{index}"))
            .cursor_pointer()
            .on_click(cx.listener(move |shell, _, _, cx| shell.follow_link(follow.clone(), cx)));
        let drawn = drawn(&preview, theme);
        let poster = poster(frame, &drawn, theme, behind(theme));
        Some(
            Reachable::new(("preview", index), poster)
                .corner(px(0.0))
                .into_any_element(),
        )
    }
}

/// Everything a poster for `preview` is drawn from.
fn drawn<'a>(preview: &'a Preview, theme: &Theme) -> Drawn<'a> {
    let picture = preview.picture.as_ref();
    let size = picture
        .and_then(|picture| crate::picture::dimensions(picture.bytes()))
        .or(picture.and(preview.details.picture_size));
    let video = preview.kind.as_ref().is_some_and(|kind| kind.as_ref() == "video");
    let shape = shape_of(preview, size, video);
    let label = source_label(preview);
    let title = preview
        .title
        .clone()
        .unwrap_or_else(|| label.clone().into());
    let context = context_of(preview, &label);
    let cut = cut_side(theme);
    Drawn {
        preview,
        picture,
        size,
        shape,
        facts: facts_of(preview),
        context,
        title,
        label,
        pads: (
            if cut == Some(Side::Leading) { CUT_PAD } else { PAD },
            if cut == Some(Side::Trailing) { CUT_PAD } else { PAD },
        ),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    Leading,
    Trailing,
}

/// Which bottom corner the theme's bubble cut takes, if either: the one
/// the words keep clear of. A theme that cuts nothing takes neither, though
/// the poster still cuts its own corner.
fn cut_side(theme: &Theme) -> Option<Side> {
    let cut = theme.skin.cuts.of(Kind::Card)?;
    let bounds = gpui::Bounds::new(
        gpui::point(px(0.0), px(0.0)),
        gpui::size(px(100.0), px(100.0)),
    );
    let corners = cut.points(bounds);
    let reaches = |x: f32, y: f32| {
        corners
            .iter()
            .any(|at| (f32::from(at.x) - x).abs() < 0.5 && (f32::from(at.y) - y).abs() < 0.5)
    };
    if !reaches(0.0, 100.0) {
        Some(Side::Leading)
    } else if !reaches(100.0, 100.0) {
        Some(Side::Trailing)
    } else {
        None
    }
}

/// The cut a poster takes: the theme's bubble cut, or none, where the
/// poster cuts its own corner (`poster::outside`).
fn poster_cut(theme: &Theme) -> Option<Cut> {
    theme.skin.cuts.of(Kind::Card)
}

/// What shows where a poster is cut away: the bubble it is drawn in.
fn behind(theme: &Theme) -> Hsla {
    let ground = theme.c.bg0;
    let over = theme.c.card;
    let mix = |under: f32, top: f32| top.mul_add(over.a, under * (1.0 - over.a));
    let (ground, top) = (ground.to_rgb(), over.to_rgb());
    gpui::Rgba {
        r: mix(ground.r, top.r),
        g: mix(ground.g, top.g),
        b: mix(ground.b, top.b),
        a: 1.0,
    }
    .into()
}

/// The poster `drawn` describes, on `frame`.
fn poster(
    frame: gpui::Stateful<Div>,
    drawn: &Drawn<'_>,
    theme: &Theme,
    behind: Hsla,
) -> gpui::Stateful<Div> {
    let shape = drawn.shape;
    let mut frame = frame
        .relative()
        .w_full()
        .max_w(px(BAND))
        .flex()
        .overflow_hidden()
        .bg(poster::poster_ground());
    frame = match shape {
        Shape::Row => frame.min_h(px(if drawn.picture.is_some() {
            ROW_H
        } else {
            BARE_H
        })),
        Shape::ShopRow => frame.min_h(px(BARE_H)),
        Shape::Shop => frame.h(px(SHOP_H)),
        Shape::Contained => frame.h(px(TALL_H)),
        Shape::Native => {
            let height = drawn.size.map_or(0.0, |(_, height)| height as f32);
            frame.h(px((height + 92.0).max(FULL_H - 40.0).min(TALL_H)))
        }
        Shape::Full => match drawn.size {
            Some((width, height)) if width > 0 && height > 0 => {
                #[expect(clippy::cast_precision_loss, reason = "a picture's size")]
                let ratio = (width as f32 / height as f32).clamp(4.0 / 3.0, 2.6);
                frame.style().aspect_ratio = Some(ratio);
                frame.max_h(px(TALL_H))
            }
            _ => frame.h(px(FULL_H - 52.0)),
        },
    };
    frame
        .children(ground(drawn))
        .children(subject(drawn))
        .child(poster::layer(match shape {
            Shape::Row | Shape::ShopRow => &poster::SCRIM_ACROSS,
            Shape::Full | Shape::Shop => &poster::SCRIM,
            Shape::Contained | Shape::Native => &poster::SCRIM_CONTAINED,
        }))
        .children(words(drawn, theme))
        .when(!matches!(shape, Shape::Row | Shape::ShopRow), |frame| {
            frame.child(poster::source_chip(
                drawn.preview.icon.as_ref(),
                &drawn.label,
                chip_note(drawn).as_deref(),
            ))
        })
        .when_some(drawn.preview.details.duration.clone(), |frame, clock| {
            frame.child(poster::duration_badge(clock))
        })
        .child(poster::outside(poster_cut(theme), behind))
}

/// What the chip says after the source: the author on a full poster, the
/// original's size on a piece of art.
fn chip_note(drawn: &Drawn<'_>) -> Option<String> {
    match drawn.shape {
        Shape::Full => drawn.preview.details.author.as_ref().map(ToString::to_string),
        Shape::Contained | Shape::Native => {
            let (width, height) = drawn
                .preview
                .details
                .picture_size
                .filter(|(width, height)| *width > 0 && *height > 0)
                .or(drawn.size)?;
            Some(format!("{width}×{height}"))
        }
        _ => None,
    }
}

/// The ground under the subject: a blurred bed of the picture, a tinted
/// ground where there is none, or a listing's lit stage.
fn ground(drawn: &Drawn<'_>) -> Option<AnyElement> {
    match (drawn.shape, drawn.picture) {
        (Shape::Shop | Shape::ShopRow, _) => {
            Some(poster::layer(&poster::STAGE).into_any_element())
        }
        (Shape::Full, _) if drawn.picture.is_some() => None,
        (_, Some(picture)) => {
            let row = drawn.shape == Shape::Row;
            let (blur, dark) = if row { (24, 0.58) } else { (26, 0.4) };
            Some(
                div()
                    .absolute()
                    .top_0()
                    .left_0()
                    .size_full()
                    .child(
                        gpui::img(shown(picture, Fit::Wall(blur)))
                            .absolute()
                            .left(px(-24.0))
                            .top(px(-24.0))
                            .right(px(-24.0))
                            .bottom(px(-24.0))
                            .object_fit(gpui::ObjectFit::Cover),
                    )
                    .child(
                        div()
                            .absolute()
                            .top_0()
                            .left_0()
                            .size_full()
                            .bg(gpui::black().opacity(dark)),
                    )
                    .into_any_element(),
            )
        }
        (_, None) => Some(poster::layer(&poster::TINTED).into_any_element()),
    }
}

/// The picture itself, where the poster shows it over its ground.
fn subject(drawn: &Drawn<'_>) -> Option<AnyElement> {
    let picture = drawn.picture?;
    let (width, height) = drawn.size.map_or((0.0, 0.0), |(width, height)| {
        #[expect(clippy::cast_precision_loss, reason = "a picture's size")]
        (width as f32, height as f32)
    });
    let centred = || {
        div()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
    };
    match drawn.shape {
        Shape::Full => Some(
            gpui::img(shown(picture, Fit::Tile))
                .absolute()
                .top_0()
                .left_0()
                .size_full()
                .object_fit(gpui::ObjectFit::Cover)
                .into_any_element(),
        ),
        Shape::Contained if height > 0.0 => {
            // Contained, never enlarged.
            let shown_height = height.min(TALL_H);
            let shown_width = (shown_height * width / height).min(BAND);
            Some(
                centred()
                    .child(
                        gpui::img(shown(picture, Fit::Tile))
                            .w(px(shown_width))
                            .h(px(shown_height))
                            .object_fit(gpui::ObjectFit::Contain),
                    )
                    .into_any_element(),
            )
        }
        Shape::Native if height > 0.0 => {
            // Its own pixels, shrunk only to fit 88% across and 76% down.
            let frame_height = (height + 92.0).max(FULL_H - 40.0).min(TALL_H);
            let scale = (BAND * 0.88 / width).min(frame_height * 0.76 / height).min(1.0);
            Some(
                centred()
                    .child(
                        gpui::img(shown(picture, Fit::Tile))
                            .w(px(width * scale))
                            .h(px(height * scale))
                            .shadow(vec![gpui::BoxShadow {
                                color: gpui::black().opacity(0.55),
                                offset: gpui::point(px(0.0), px(6.0)),
                                blur_radius: px(11.0),
                                spread_radius: px(0.0),
                                inset: false,
                            }]),
                    )
                    .into_any_element(),
            )
        }
        _ => None,
    }
}

/// What is printed on the poster: the words at its bottom, a row's
/// column, or a listing's price block.
fn words(drawn: &Drawn<'_>, theme: &Theme) -> Option<AnyElement> {
    let (lead, trail) = drawn.pads;
    let bottom = || {
        div()
            .absolute()
            .left(px(lead))
            .right(px(trail))
            .bottom(px(12.0))
            .flex()
            .flex_col()
            .gap(px(8.0))
    };
    let icon = drawn.preview.icon.as_ref();
    match drawn.shape {
        Shape::Full | Shape::Contained | Shape::Native => {
            let under = if drawn.shape == Shape::Native {
                Some(poster::sub(t!("Thumbnail only · open for full size")))
            } else {
                poster::fact_line(&meta(drawn))
            };
            Some(
                bottom()
                    .child(poster::title(drawn.title.clone(), 18.0))
                    .children(under)
                    .into_any_element(),
            )
        }
        Shape::Row => {
            let thumb = match drawn.picture {
                Some(picture) => gpui::img(shown(picture, Fit::Tile))
                    .flex_none()
                    .w(px(THUMB.0))
                    .h(px(THUMB.1))
                    .bg(gpui::rgb(0x0010_151f))
                    .object_fit(gpui::ObjectFit::Cover)
                    .into_any_element(),
                None => poster::monogram(&drawn.label, false).into_any_element(),
            };
            let under = if drawn.facts.is_empty() {
                drawn.context.clone().map(|context| poster::sub(context))
            } else {
                poster::fact_line(&drawn.facts)
            };
            Some(
                row(lead, trail)
                    .child(thumb)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(4.0))
                            .child(poster::caps(icon, &drawn.label))
                            .child(poster::title(drawn.title.clone(), 15.5))
                            .children(under),
                    )
                    .into_any_element(),
            )
        }
        Shape::ShopRow => {
            let price = drawn.preview.details.price.as_ref()?;
            let tile = match drawn.picture {
                Some(picture) => div()
                    .flex_none()
                    .size(px(64.0))
                    .bg(gpui::white())
                    .overflow_hidden()
                    .child(
                        gpui::img(shown(picture, Fit::Tile))
                            .size_full()
                            .object_fit(gpui::ObjectFit::Contain),
                    )
                    .into_any_element(),
                None => poster::monogram(&drawn.label, true).into_any_element(),
            };
            Some(
                row(lead, trail)
                    .child(tile)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(3.0))
                            .child(poster::caps(icon, &drawn.label))
                            .child(poster::title(drawn.title.clone(), 15.0))
                            .child(
                                div()
                                    .flex()
                                    .items_baseline()
                                    .gap(px(8.0))
                                    .child(
                                        div()
                                            .text_size(px(16.0))
                                            .font_weight(gpui::FontWeight::BOLD)
                                            .text_color(theme.c.ok)
                                            .child(t!(
                                                "from {{price}}",
                                                price = money(&price.amount, &price.currency)
                                            )),
                                    )
                                    .children(poster::fact_line(&drawn.facts)),
                            ),
                    )
                    .into_any_element(),
            )
        }
        Shape::Shop => {
            let price = drawn.preview.details.price.as_ref()?;
            let was = (!price.was.trim().is_empty()).then(|| money(&price.was, &price.currency));
            let mut stated: Vec<SharedString> = stock_of(price).into_iter().collect();
            stated.extend(drawn.facts.iter().cloned());
            let product = drawn.picture.map(|picture| {
                div()
                    .absolute()
                    .right(px(16.0))
                    .top(px(14.0))
                    .w(px(132.0))
                    .h(px(104.0))
                    .bg(gpui::white())
                    .overflow_hidden()
                    .child(
                        gpui::img(shown(picture, Fit::Tile))
                            .size_full()
                            .object_fit(gpui::ObjectFit::Contain),
                    )
            });
            Some(
                div()
                    .absolute()
                    .top_0()
                    .left_0()
                    .size_full()
                    .children(product)
                    .child(
                        bottom()
                            .child(
                                div()
                                    .max_w(px(200.0))
                                    .child(poster::title(drawn.title.clone(), 16.5)),
                            )
                            .child(poster::price_line(
                                money(&price.amount, &price.currency),
                                was,
                                discount_of(&price.amount, &price.was),
                                theme.c.ok,
                            ))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(10.0))
                                    .child(poster::action_pill(
                                        None,
                                        poster::action_tag(&t!("View deal")).into_any_element(),
                                    ))
                                    .children(poster::fact_line(&stated)),
                            ),
                    )
                    .into_any_element(),
            )
        }
    }
}

/// The in-flow row a side-thumb poster reads across.
fn row(lead: f32, trail: f32) -> Div {
    div()
        .relative()
        .flex_1()
        .min_w_0()
        .flex()
        .items_center()
        .gap(px(12.0))
        .pt(px(12.0))
        .pb(px(12.0))
        .pl(px(lead))
        .pr(px(trail))
}

/// The one line under a picture poster's title: who made it, where the
/// chip has not named them, what the page counted, and when it went out;
/// or, where it published none of that, its own blurb.
fn meta(drawn: &Drawn<'_>) -> Vec<SharedString> {
    let details = &drawn.preview.details;
    let named_in_chip = drawn.shape == Shape::Full && details.author.is_some();
    let mut stated: Vec<SharedString> = details
        .author
        .as_ref()
        .filter(|_| !named_in_chip)
        .map(|author| t!("by {{author}}", author = author))
        .into_iter()
        .collect();
    stated.extend(drawn.facts.iter().cloned());
    let now = chrono::Utc::now().timestamp();
    if stated.len() < 3
        && let Some(when) = details
            .published
            .as_ref()
            .and_then(|published| ago(published, now))
    {
        stated.push(when);
    }
    if stated.is_empty() {
        drawn.context.clone().into_iter().collect()
    } else {
        stated
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::PreviewDetails;

    fn preview(kind: &str) -> Preview {
        Preview {
            url: "https://www.example.org/page".into(),
            title: Some("A page".into()),
            kind: Some(kind.to_owned().into()),
            ..Preview::default()
        }
    }

    #[test]
    fn the_picture_and_the_kind_choose_the_poster() {
        let link = preview("link");
        assert_eq!(shape_of(&link, Some((1200, 630)), false), Shape::Full);
        assert_eq!(shape_of(&link, Some((600, 850)), false), Shape::Contained);
        assert_eq!(shape_of(&link, Some((360, 253)), false), Shape::Native);
        assert_eq!(shape_of(&link, None, false), Shape::Row);
        assert_eq!(shape_of(&link, None, true), Shape::Full, "a video");
        assert_eq!(shape_of(&preview("article"), Some((1200, 630)), false), Shape::Row);
        let mut listing = preview("product");
        listing.details.price = Some(PreviewPrice {
            amount: "89.99".into(),
            ..PreviewPrice::default()
        });
        assert_eq!(shape_of(&listing, Some((600, 600)), false), Shape::Shop);
        assert_eq!(shape_of(&listing, None, false), Shape::ShopRow);
        listing.details.facts = vec![("sellers".into(), "14".into())];
        assert_eq!(shape_of(&listing, Some((600, 600)), false), Shape::ShopRow);
    }

    #[test]
    fn a_card_says_where_it_goes_and_not_the_same_thing_twice() {
        let mut page = preview("link");
        assert_eq!(source_label(&page), "example.org");
        page.description = Some("A page, and more about it.".into());
        assert_eq!(context_of(&page, "example.org"), None, "the title again");
        page.description = Some("Something else.".into());
        assert_eq!(
            context_of(&page, "example.org").map(|said| said.to_string()),
            Some("Something else.".to_owned())
        );
    }

    #[test]
    fn facts_are_printed_as_the_web_prints_them() {
        let mut page = preview("link");
        page.details = PreviewDetails {
            facts: vec![
                ("score".into(), "120".into()),
                ("availability".into(), "instock".into()),
                ("sellers".into(), "14".into()),
                ("Pages".into(), "320".into()),
                ("likes".into(), "9".into()),
            ],
            ..PreviewDetails::default()
        };
        let facts: Vec<String> = facts_of(&page).iter().map(ToString::to_string).collect();
        assert_eq!(facts, ["↑ 120", "14 shops", "Pages: 320"]);
    }

    #[test]
    fn prices_and_their_savings_read_as_the_web_writes_them() {
        assert_eq!(money("89.99", "EUR").as_ref(), "€89.99");
        assert_eq!(money("149", "EUR").as_ref(), "€149.00");
        assert_eq!(money("1299.5", "USD").as_ref(), "$1,299.50");
        assert_eq!(money("12", "CHF").as_ref(), "CHF\u{a0}12.00");
        assert_eq!(money("free", "EUR").as_ref(), "free");
        assert_eq!(discount_of("89.99", "129.99"), Some(31));
        assert_eq!(discount_of("10", "5"), None);
    }

    #[test]
    fn a_date_reads_as_how_long_ago() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-14T12:00:00Z")
            .expect("a date")
            .timestamp();
        let said = |at: &str| ago(at, now).map(|said| said.to_string());
        assert_eq!(said("2023-11-14T12:00:00Z").as_deref(), Some("3 years ago"));
        assert_eq!(said("2026-11-13T12:00:00Z").as_deref(), Some("yesterday"));
        assert_eq!(said("2026-11-14T11:58:00Z").as_deref(), Some("2 minutes ago"));
        assert_eq!(said("last Tuesday"), None);
    }
}
