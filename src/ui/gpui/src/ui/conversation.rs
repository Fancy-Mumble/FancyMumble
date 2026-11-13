//! The conversation: the channel's header, its messages and the composer.

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, linear_color_stop,
    linear_gradient, list, prelude::*, px,
};

use super::Shell;
use super::widgets::{EMPHASIS, avatar, clock, icon, label};
use crate::engine::Message;
use crate::theme::{Fill, Theme};

/// How many rows a conversation of `messages` has: the day rule, then one
/// per message. An empty channel has none.
pub(super) fn row_count(messages: &[Message]) -> usize {
    if messages.is_empty() {
        0
    } else {
        messages.len() + 1
    }
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
        .child(header(shell, theme))
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
                .child(
                    list(
                        shell.rows.clone(),
                        cx.processor(|shell, row: usize, _, cx| shell.render_row(row, cx)),
                    )
                    .flex_1()
                    .min_h_0(),
                )
                .child(composer(shell, theme)),
        )
}

fn header(shell: &Shell, theme: &Theme) -> impl IntoElement + use<> {
    let name = shell.current_channel_name().unwrap_or("No channel");
    let in_voice = shell
        .snapshot
        .current_channel
        .map_or(0, |channel| shell.occupants(channel).count());
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
        .child(icon("hash", 16.0, theme.c.dim))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .font_weight(EMPHASIS)
                        .text_size(px(15.0))
                        .child(label(name, theme))
                        .child(icon("chevron-down", 13.0, theme.c.muted)),
                )
                .child(
                    div()
                        .text_size(px(11.5))
                        .text_color(theme.c.muted)
                        .child(SharedString::from(format!("{in_voice} in voice"))),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .text_color(theme.c.muted)
                .child(icon("users", 15.0, theme.c.muted))
                .child(
                    div()
                        .font_weight(EMPHASIS)
                        .text_size(px(12.0))
                        .text_color(theme.c.text)
                        .child(SharedString::from(in_voice.to_string())),
                ),
        )
        .child(icon("search", 15.0, theme.c.muted))
        .child(icon("pin", 15.0, theme.c.muted))
        .child(icon("ellipsis-vertical", 15.0, theme.c.muted))
}

fn composer(shell: &Shell, theme: &Theme) -> impl IntoElement + use<> {
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
            .child(icon("paperclip", 16.0, theme.c.muted))
            .child(icon("chevron-down", 12.0, theme.c.muted))
            .child(shell.composer.clone())
            .child(
                div()
                    .flex_none()
                    .size(px(32.0))
                    .rounded(theme.skin.radius_pill)
                    .bg(theme.c.card2)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(icon("send", 15.0, theme.c.muted)),
            ),
    )
}

impl Shell {
    /// One row of the conversation. Called only for rows near the viewport.
    fn render_row(&self, row: usize, cx: &mut Context<Self>) -> AnyElement {
        let theme = crate::theme::ActiveTheme::get(cx);
        let Some(index) = row.checked_sub(1) else {
            return row_frame().child(day_rule(&theme)).into_any_element();
        };
        let Some(message) = self.messages.get(index) else {
            return div().into_any_element();
        };
        // A run is one person talking: the name and picture are said once.
        let continues = index
            .checked_sub(1)
            .and_then(|previous| self.messages.get(previous))
            .is_some_and(|previous| {
                previous.sender == message.sender && !previous.own == !message.own
            });
        let gap = if continues {
            theme.skin.message_run_gap
        } else {
            theme.skin.message_gap
        };
        let body = if message.own {
            own_message(message, &theme).into_any_element()
        } else {
            their_message(message, continues, &theme).into_any_element()
        };
        row_frame().pt(gap).child(body).into_any_element()
    }
}

/// A conversation row: the full width of the column, inset from its edges.
fn row_frame() -> gpui::Div {
    div().w_full().pl(px(10.0)).pr(px(20.0))
}

/// The rule that starts a day, with the day on a pill in the middle.
fn day_rule(theme: &Theme) -> impl IntoElement + use<> {
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
                .child(label("Today", theme)),
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

fn their_message(message: &Message, continues: bool, theme: &Theme) -> impl IntoElement + use<> {
    let time = SharedString::from(clock(message.sent_at_ms));
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
                        .child(avatar(&message.sender_name, 38.0, theme))
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
                        .child(message.body.clone()),
                ),
        )
}

fn own_message(message: &Message, theme: &Theme) -> impl IntoElement + use<> {
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
        .child(plate.child(message.body.clone()))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .text_size(px(11.0))
                .text_color(theme.c.dim)
                .child(SharedString::from(clock(message.sent_at_ms)))
                .child(icon("check", 12.0, theme.c.dim)),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_channel_has_no_rows_and_a_full_one_gets_a_day_rule() {
        assert_eq!(row_count(&[]), 0);
        let message = Message {
            sender: Some(1),
            sender_name: "Alex".into(),
            body: "hi".into(),
            sent_at_ms: Some(0),
            own: true,
        };
        assert_eq!(row_count(&[message.clone(), message]), 3);
    }
}
