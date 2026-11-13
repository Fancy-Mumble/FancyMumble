//! The conversation: the channel's header, its messages and the composer.

use std::ops::Range;
use std::sync::Arc;

use gpui::{
    AnyElement, Context, HighlightStyle, Hsla, InteractiveText, IntoElement, ParentElement,
    SharedString, Styled, StyledText, div, linear_color_stop, linear_gradient, list, prelude::*,
    px,
};

use super::Shell;
use super::widgets::{EMPHASIS, avatar, clock, icon, label};
use crate::engine::{Conversation, Message};
use crate::rich::Rich;
use crate::theme::{Fill, Theme};

/// One row of the conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Row {
    /// The rule that starts a day, with what to call it.
    Day(SharedString),
    /// The message at this index.
    Message(usize),
}

/// The local calendar day `at_ms` falls on, counted from the epoch, for a
/// clock `offset_secs` east of UTC.
fn day_of(at_ms: u64, offset_secs: i64) -> i64 {
    let seconds = i64::try_from(at_ms / 1000).unwrap_or(i64::MAX);
    seconds.saturating_add(offset_secs).div_euclid(86_400)
}

/// What to call `day`, seen from `today`.
fn day_label(day: i64, today: i64) -> String {
    match today - day {
        0 => "Today".to_owned(),
        1 => "Yesterday".to_owned(),
        _ => chrono::DateTime::from_timestamp(day.saturating_mul(86_400), 0)
            .map(|date| date.format("%-d %B %Y").to_string())
            .unwrap_or_default(),
    }
}

/// `messages` as rows: each message, with a rule before the first of every
/// day. A message that carries no time belongs to the day of the one before
/// it, or to today when there is none.
pub(super) fn rows(messages: &[Message], now_ms: u64, offset_secs: i64) -> Vec<Row> {
    let today = day_of(now_ms, offset_secs);
    let mut rows = Vec::with_capacity(messages.len() + 1);
    let mut current = None;
    for (index, message) in messages.iter().enumerate() {
        let day = message
            .sent_at_ms
            .map(|at| day_of(at, offset_secs))
            .or(current)
            .unwrap_or(today);
        if current != Some(day) {
            current = Some(day);
            rows.push(Row::Day(day_label(day, today).into()));
        }
        rows.push(Row::Message(index));
    }
    rows
}

pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    div()
        .flex_1()
        .min_w_0()
        .h_full()
        .flex()
        .flex_col()
        .child(header(shell, theme, cx))
        .child(
            div()
                .flex_1()
                .min_h_0()
                .flex()
                .flex_col()
                // 165deg in the web UI: near enough top to bottom that two
                // stops down the column read the same.
                .bg(linear_gradient(
                    165.0,
                    linear_color_stop(theme.c.canvas_a, 0.0),
                    linear_color_stop(theme.c.canvas_b, 1.0),
                ))
                .when_some(shell.welcome_to_show(), |column, welcome| {
                    column.child(welcome_card(&welcome, theme, cx))
                })
                .child(
                    list(
                        shell.rows.clone(),
                        cx.processor(|shell, row: usize, _, cx| shell.render_row(row, cx)),
                    )
                    .flex_1()
                    .min_h_0(),
                )
                .when_some(shell.notice.clone(), |column, notice| {
                    column.child(notice_strip(notice, theme, cx))
                })
                .child(composer(shell, theme, cx)),
        )
}

fn header(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let (glyph, name, about, people) = match shell.open {
        Some(Conversation::Channel(id)) => {
            let name = shell
                .snapshot
                .channels
                .iter()
                .find(|channel| channel.id == id)
                .map_or_else(SharedString::default, |channel| channel.name.clone());
            let people = shell.occupants(id).len();
            ("hash", name, format!("{people} in voice"), Some(people))
        }
        Some(Conversation::Direct(session)) => {
            let name = shell
                .snapshot
                .users
                .iter()
                .find(|user| user.session == session)
                .map_or_else(SharedString::default, |user| user.name.clone());
            ("at-sign", name, "Direct message".to_owned(), None)
        }
        None => ("hash", "No channel".into(), String::new(), None),
    };
    // Reading a channel the user is not in: offer the way in.
    let joinable = match shell.open {
        Some(Conversation::Channel(id)) if shell.snapshot.current_channel != Some(id) => Some(id),
        _ => None,
    };
    div()
        .flex_none()
        .h(theme.skin.header_height)
        .flex()
        .items_center()
        .gap(px(14.0))
        .pl(px(28.0))
        // A theme with no band floats the window's controls over this corner.
        .pr(px(if theme.skin.band { 28.0 } else { 150.0 }))
        .bg(theme.c.header)
        .border_b_1()
        .border_color(theme.c.line)
        .child(icon(glyph, 16.0, theme.c.dim))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    div()
                        .truncate()
                        .font_weight(EMPHASIS)
                        .text_size(px(15.0))
                        .child(label(&name, theme)),
                )
                .child(
                    div()
                        .text_size(px(11.5))
                        .text_color(theme.c.muted)
                        .child(about),
                ),
        )
        .when_some(joinable, |header, channel| {
            header.child(
                div()
                    .id("join")
                    .debug_selector(|| "join".to_owned())
                    .px(px(14.0))
                    .py(px(5.0))
                    .rounded(theme.skin.radius_pill)
                    .bg(theme.c.accent)
                    .text_color(theme.c.on_accent)
                    .text_size(px(12.5))
                    .font_weight(EMPHASIS)
                    .cursor_pointer()
                    .hover(|style| style.opacity(0.9))
                    .on_click(cx.listener(move |shell, _, _, _| shell.engine.join_channel(channel)))
                    .child(label("Join", theme)),
            )
        })
        .when_some(people, |header, people| {
            header.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.0))
                    .child(icon("users", 15.0, theme.c.muted))
                    .child(
                        div()
                            .font_weight(EMPHASIS)
                            .text_size(px(12.0))
                            .child(SharedString::from(people.to_string())),
                    ),
            )
        })
}

/// The server's welcome message, at the head of the conversation until it
/// is dismissed.
fn welcome_card(
    welcome: &DrawnBody,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    div().flex_none().px(px(10.0)).pt(px(10.0)).child(
        div()
            .flex()
            .items_start()
            .gap(px(10.0))
            .px(px(14.0))
            .py(px(10.0))
            .rounded(theme.skin.radius_md)
            .bg(theme.c.card)
            .border_1()
            .border_color(theme.c.line2)
            .text_size(px(13.0))
            .child(div().flex_1().min_w_0().child(body_text(
                welcome,
                usize::MAX,
                theme.c.accent_text,
                theme,
            )))
            .child(
                div()
                    .id("dismiss-welcome")
                    .debug_selector(|| "dismiss-welcome".to_owned())
                    .cursor_pointer()
                    .on_click(cx.listener(|shell, _, _, cx| {
                        shell.welcome_dismissed = true;
                        cx.notify();
                    }))
                    .child(icon("x", 13.0, theme.c.muted)),
            ),
    )
}

/// What the engine had to say, above the composer, until it is dismissed.
fn notice_strip(
    notice: SharedString,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let mut soft = theme.c.bad;
    soft.a = 0.14;
    let mut edge = theme.c.bad;
    edge.a = 0.45;
    div().flex_none().px(px(10.0)).pt(px(8.0)).child(
        div()
            .flex()
            .items_center()
            .gap(px(10.0))
            .px(px(14.0))
            .py(px(8.0))
            .rounded(theme.skin.radius_md)
            .bg(soft)
            .border_1()
            .border_color(edge)
            .text_size(px(12.5))
            .child(div().flex_1().min_w_0().child(notice))
            .child(
                div()
                    .id("dismiss-notice")
                    .debug_selector(|| "dismiss-notice".to_owned())
                    .cursor_pointer()
                    .on_click(cx.listener(|shell, _, _, cx| {
                        shell.notice = None;
                        cx.notify();
                    }))
                    .child(icon("x", 13.0, theme.c.muted)),
            ),
    )
}

fn composer(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    div().flex_none().p(px(10.0)).child(
        div()
            .h(px(54.0))
            .flex()
            .items_center()
            .gap(px(10.0))
            .pl(px(20.0))
            .pr(px(14.0))
            .rounded(theme.skin.radius_lg)
            .bg(theme.c.input)
            .border_1()
            .border_color(theme.c.line2)
            .text_size(px(15.0))
            .child(shell.composer.clone())
            .child(
                div()
                    .id("send")
                    .debug_selector(|| "send".to_owned())
                    .flex_none()
                    .size(px(32.0))
                    .rounded(theme.skin.radius_pill)
                    .bg(theme.c.card2)
                    .flex()
                    .items_center()
                    .justify_center()
                    .cursor_pointer()
                    .hover(|style| style.opacity(0.8))
                    .on_click(cx.listener(|shell, _, _, cx| shell.send_composed(cx)))
                    .child(icon("send", 15.0, theme.c.muted)),
            ),
    )
}

impl Shell {
    /// One row of the conversation. Called only for rows near the viewport.
    fn render_row(&mut self, row: usize, cx: &mut Context<Self>) -> AnyElement {
        let theme = crate::theme::ActiveTheme::get(cx);
        let index = match self.row_model.get(row) {
            Some(Row::Day(name)) => {
                return row_frame().child(day_rule(name, &theme)).into_any_element();
            }
            Some(Row::Message(index)) => *index,
            None => return div().into_any_element(),
        };
        let body = self.drawn_body(index);
        let Some(message) = self.messages.get(index) else {
            return div().into_any_element();
        };
        // A run is one person talking: the name and picture are said once.
        // A new day starts a new run, since a rule sits between the two.
        let continues = row
            .checked_sub(1)
            .and_then(|above| match self.row_model.get(above) {
                Some(Row::Message(previous)) => self.messages.get(*previous),
                _ => None,
            })
            .is_some_and(|previous| {
                previous.sender == message.sender
                    && previous.sender_name == message.sender_name
                    && previous.own == message.own
            });
        let gap = if continues {
            theme.skin.message_run_gap
        } else {
            theme.skin.message_gap
        };
        let body = if message.own {
            own_message(message, &body, row, self.utc_offset, &theme).into_any_element()
        } else {
            {
                let picture = message.sender.and_then(|session| {
                    self.snapshot
                        .users
                        .iter()
                        .find(|user| user.session == session)
                        .and_then(|user| user.avatar.clone())
                });
                their_message(
                    message,
                    &body,
                    row,
                    picture.as_ref(),
                    continues,
                    self.utc_offset,
                    &theme,
                )
                .into_any_element()
            }
        };
        row_frame().pt(gap).child(body).into_any_element()
    }
}

/// A message's body, read once and kept: its runs of text, and its pictures
/// as GPUI holds them.
#[derive(Debug)]
pub(super) struct DrawnBody {
    rich: Rich,
    pictures: Vec<Arc<gpui::Image>>,
}

impl DrawnBody {
    /// Read `html`.
    pub(super) fn read(html: &str) -> Self {
        let mut rich = Rich::parse(html);
        let pictures = std::mem::take(&mut rich.images)
            .into_iter()
            .filter_map(crate::picture::picture)
            .map(Arc::new)
            .collect();
        Self { rich, pictures }
    }

    /// Whether there is nothing in it to show.
    pub(super) fn is_empty(&self) -> bool {
        self.rich.text.is_empty() && self.pictures.is_empty()
    }
}

impl Shell {
    /// The body of message `index`, read from its HTML the first time it is
    /// drawn. Only rows near the viewport are ever asked for.
    fn drawn_body(&mut self, index: usize) -> Arc<DrawnBody> {
        if let Some(drawn) = self.bodies.get(&index) {
            return Arc::clone(drawn);
        }
        let html = self
            .messages
            .get(index)
            .map_or("", |message| message.html.as_ref());
        let drawn = Arc::new(DrawnBody::read(html));
        let _ = self.bodies.insert(index, Arc::clone(&drawn));
        drawn
    }
}

/// How each stretch of `rich` is drawn: its emphasis, and its links in
/// `link_ink`. The stretches come out in order and never overlap, which is
/// what the text element requires.
fn highlights(
    rich: &Rich,
    link_ink: Hsla,
    code_ground: Hsla,
) -> Vec<(Range<usize>, HighlightStyle)> {
    let mut cuts: Vec<usize> = rich
        .spans
        .iter()
        .map(|(range, _)| range)
        .chain(rich.links.iter().map(|(range, _)| range))
        .flat_map(|range| [range.start, range.end])
        .collect();
    cuts.sort_unstable();
    cuts.dedup();
    cuts.windows(2)
        .filter_map(|cut| {
            let range = cut[0]..cut[1];
            let inside =
                |other: &Range<usize>| other.start <= range.start && range.end <= other.end;
            let style = rich
                .spans
                .iter()
                .find(|(span, _)| inside(span))
                .map(|(_, style)| *style);
            let link = rich.links.iter().any(|(link, _)| inside(link));
            if style.is_none() && !link {
                return None;
            }
            let style = style.unwrap_or_default();
            let line = |color| gpui::UnderlineStyle {
                thickness: px(1.0),
                color,
                wavy: false,
            };
            Some((
                range,
                HighlightStyle {
                    color: link.then_some(link_ink),
                    font_weight: style.bold.then_some(EMPHASIS),
                    font_style: style.italic.then_some(gpui::FontStyle::Italic),
                    background_color: style.code.then_some(code_ground),
                    underline: (link || style.underline).then(|| line(link.then_some(link_ink))),
                    strikethrough: style.strike.then(|| gpui::StrikethroughStyle {
                        thickness: px(1.0),
                        color: None,
                    }),
                    fade_out: None,
                },
            ))
        })
        .collect()
}

/// A message's text, with its links live, and its pictures under it.
pub(super) fn body_text(
    body: &DrawnBody,
    row: usize,
    link_ink: Hsla,
    theme: &Theme,
) -> impl IntoElement + use<> {
    let rich = &body.rich;
    let text = StyledText::new(rich.text.clone()).with_highlights(highlights(
        rich,
        link_ink,
        theme.c.card2,
    ));
    let (ranges, addresses): (Vec<_>, Vec<_>) = rich.links.iter().cloned().unzip();
    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .when(!rich.text.is_empty(), |column| {
            column.child(InteractiveText::new(("message", row), text).on_click(
                ranges,
                move |link, _, cx| {
                    if let Some(address) = addresses.get(link) {
                        cx.open_url(address);
                    }
                },
            ))
        })
        .children(body.pictures.iter().map(|picture| {
            gpui::img(Arc::clone(picture))
                .max_w(px(420.0))
                .max_h(px(320.0))
                .rounded(theme.skin.radius_md)
                .object_fit(gpui::ObjectFit::Contain)
        }))
}

/// A conversation row: the full width of the column, inset from its edges.
fn row_frame() -> gpui::Div {
    div().w_full().pl(px(10.0)).pr(px(20.0))
}

/// The rule that starts a day, with the day on a pill in the middle.
fn day_rule(name: &SharedString, theme: &Theme) -> impl IntoElement + use<> {
    let rule = || div().flex_1().h(theme.skin.line_width).bg(theme.c.line);
    div()
        .w_full()
        .pt(px(26.0))
        .flex()
        .items_center()
        .gap(px(12.0))
        .child(rule())
        .child(
            div()
                .px(px(11.0))
                .py(px(3.0))
                .rounded(theme.skin.radius_pill)
                .bg(theme.c.card)
                .border_1()
                .border_color(theme.c.line)
                .text_size(px(11.5))
                .text_color(theme.c.muted)
                .child(label(name, theme)),
        )
        .child(rule())
}

fn bubble(theme: &Theme) -> gpui::Div {
    div()
        .max_w(px(620.0))
        .px(px(14.0))
        .py(px(9.0))
        .rounded(theme.skin.radius_lg)
        .text_size(px(15.0))
}

#[allow(
    clippy::too_many_arguments,
    reason = "one message, and everything it is drawn from"
)]
fn their_message(
    message: &Message,
    body: &DrawnBody,
    row: usize,
    picture: Option<&Arc<gpui::Image>>,
    continues: bool,
    utc_offset: i64,
    theme: &Theme,
) -> impl IntoElement + use<> {
    let time = SharedString::from(clock(message.sent_at_ms, utc_offset));
    div()
        .flex()
        .items_start()
        .gap(px(12.0))
        .child(
            // The picture column keeps its width through a run, so the
            // bubbles of one person line up.
            div()
                .flex_none()
                .w(px(38.0))
                .flex()
                .flex_col()
                .items_center()
                .gap(px(4.0))
                .when(!continues, |column| {
                    column
                        .child(avatar(&message.sender_name, picture, 38.0, theme))
                        .child(
                            div()
                                .text_size(px(10.0))
                                .text_color(theme.c.dim)
                                .child(time.clone()),
                        )
                }),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .items_start()
                .gap(px(5.0))
                .when(!continues, |column| {
                    column.child(
                        div()
                            .flex()
                            .items_baseline()
                            .gap(px(8.0))
                            .child(
                                div()
                                    .font_weight(EMPHASIS)
                                    .child(message.sender_name.clone()),
                            )
                            .child(
                                div()
                                    .text_size(px(11.0))
                                    .text_color(theme.c.dim)
                                    .child(time),
                            ),
                    )
                })
                .child(
                    bubble(theme)
                        .bg(theme.c.card)
                        .border_1()
                        .border_color(theme.c.line2)
                        .child(body_text(body, row, theme.c.accent_text, theme)),
                ),
        )
}

fn own_message(
    message: &Message,
    body: &DrawnBody,
    row: usize,
    utc_offset: i64,
    theme: &Theme,
) -> impl IntoElement + use<> {
    // On a filled bubble the accent is the ground, so a link there is drawn
    // in the bubble's own ink.
    let link_ink = match theme.skin.bubble_own {
        Fill::Solid => theme.c.on_accent,
        Fill::Wash => theme.c.accent_text,
    };
    let plate = match theme.skin.bubble_own {
        Fill::Solid => bubble(theme)
            .bg(theme.c.accent)
            .text_color(theme.c.on_accent),
        Fill::Wash => bubble(theme)
            .bg(theme.c.accent_soft)
            .border_1()
            .border_color(theme.c.accent_line),
    };
    div()
        .flex()
        .flex_col()
        .items_end()
        .gap(px(5.0))
        .child(plate.child(body_text(body, row, link_ink, theme)))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .text_size(px(11.0))
                .text_color(theme.c.dim)
                .child(SharedString::from(clock(message.sent_at_ms, utc_offset)))
                .child(icon("check", 12.0, theme.c.dim)),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY_MS: u64 = 86_400_000;

    fn at(sent_at_ms: Option<u64>) -> Message {
        Message {
            sender: Some(1),
            sender_name: "Alex".into(),
            body: "hi".into(),
            html: "hi".into(),
            sent_at_ms,
            own: true,
        }
    }

    fn day(name: &str) -> Row {
        Row::Day(name.to_owned().into())
    }

    #[test]
    fn stretches_are_cut_where_a_span_or_a_link_starts_or_ends() {
        let ink = gpui::red();
        let ground = gpui::blue();
        // "a bold link" with the last five characters also a link.
        let rich = Rich::parse(r#"a <b>bold <a href="https://x.example">link</a></b>!"#);
        assert_eq!(rich.text, "a bold link!");
        let drawn = highlights(&rich, ink, ground);
        let ranges: Vec<_> = drawn.iter().map(|(range, _)| range.clone()).collect();
        assert_eq!(ranges, [2..7, 7..11], "in order, not overlapping");
        assert!(drawn[0].1.font_weight.is_some() && drawn[0].1.color.is_none());
        assert!(drawn[1].1.font_weight.is_some(), "the link is still bold");
        assert_eq!(drawn[1].1.color, Some(ink));
        assert!(drawn[1].1.underline.is_some());
        assert!(highlights(&Rich::parse("plain"), ink, ground).is_empty());
    }

    #[test]
    fn an_empty_channel_has_no_rows() {
        assert!(rows(&[], 0, 0).is_empty());
    }

    #[test]
    fn a_rule_starts_each_day() {
        let now = 20 * DAY_MS + 1000;
        let messages = [
            at(Some(17 * DAY_MS)),
            at(Some(19 * DAY_MS)),
            at(Some(19 * DAY_MS + 5)),
            at(Some(now)),
        ];
        assert_eq!(
            rows(&messages, now, 0),
            [
                day("18 January 1970"),
                Row::Message(0),
                day("Yesterday"),
                Row::Message(1),
                Row::Message(2),
                day("Today"),
                Row::Message(3),
            ]
        );
    }

    #[test]
    fn the_day_is_the_local_one() {
        // 23:30 UTC on day 19 is already day 20 one hour east of UTC.
        let late = 19 * DAY_MS + 23 * 3_600_000 + 30 * 60_000;
        let now = 20 * DAY_MS + 3_600_000;
        assert_eq!(rows(&[at(Some(late))], now, 0)[0], day("Yesterday"));
        assert_eq!(rows(&[at(Some(late))], now, 3600)[0], day("Today"));
    }

    #[test]
    fn a_message_without_a_time_stays_with_the_one_before_it() {
        let now = 20 * DAY_MS;
        assert_eq!(
            rows(&[at(Some(19 * DAY_MS)), at(None)], now, 0),
            [day("Yesterday"), Row::Message(0), Row::Message(1)]
        );
        assert_eq!(rows(&[at(None)], now, 0), [day("Today"), Row::Message(0)]);
    }
}
