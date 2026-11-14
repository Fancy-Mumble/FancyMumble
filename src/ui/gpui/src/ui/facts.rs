//! What is known of a user, a channel or a server, as rows of names and
//! values; and, for an account on several devices, each device's rows.

use gpui::{Div, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::widgets::{EMPHASIS, label};
use crate::engine::DeviceFacts;
use crate::theme::Theme;

/// Names and values, one pair to a row, the names in a column of their own.
pub(super) fn rows(facts: &[(SharedString, SharedString)], theme: &Theme) -> Div {
    let muted = theme.c.muted;
    div()
        .flex()
        .flex_col()
        .gap(px(4.0))
        .text_size(px(12.5))
        .children(facts.iter().map(move |(name, value)| {
            div()
                .flex()
                .gap(px(12.0))
                .child(
                    div()
                        .flex_none()
                        .w(px(130.0))
                        .text_color(muted)
                        .child(name.clone()),
                )
                .child(div().flex_1().min_w_0().child(value.clone()))
        }))
}

/// Each device an account is on, under its name; `None` where there are
/// none to list, which is all anybody but an administrator is told.
pub(super) fn devices(devices: &[DeviceFacts], theme: &Theme) -> Option<Div> {
    if devices.is_empty() {
        return None;
    }
    Some(
        div()
            .debug_selector(|| "info-devices".to_owned())
            .flex()
            .flex_col()
            .gap(px(10.0))
            .child(
                div()
                    .text_size(px(11.5))
                    .font_weight(EMPHASIS)
                    .text_color(theme.c.muted)
                    .child(label("Devices", theme)),
            )
            .children(devices.iter().map(|device| self::device(device, theme))),
    )
}

/// One device: its name, then what is known of its connection.
fn device(device: &DeviceFacts, theme: &Theme) -> Div {
    let session = device.session;
    div()
        .debug_selector(move || format!("info-device-{session}"))
        .flex()
        .flex_col()
        .gap(px(4.0))
        .child(
            div()
                .text_size(px(12.5))
                .font_weight(EMPHASIS)
                .child(device.name.clone()),
        )
        .child(rows(&device.facts, theme))
}
