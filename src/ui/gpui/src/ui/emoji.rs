//! The emoji picker: a small set, for a reaction or into what is being
//! written.
//!
//! Not every emoji there is: the hundred or so that get used, as text the
//! system's own emoji font draws. Anything else can be typed or pasted.

use gpui::{
    Context, IntoElement, ParentElement, SharedString, Styled, Window, div, prelude::*, px,
};

use super::Shell;
use super::widgets::{EMPHASIS, opaque};
use crate::engine::{Action, ChannelId};
use crate::theme::Theme;

/// The emoji offered, in the groups they are shown in.
pub(super) const GROUPS: &[(&str, &[&str])] = &[
    (
        "Faces",
        &[
            "😀", "😄", "😁", "😂", "🤣", "😊", "🙂", "😉", "😍", "😘", "😋", "😎", "🤔", "😐",
            "🙄", "😴", "😢", "😭", "😡", "😱", "🤯", "🥳", "😇", "🤗", "😬", "🤫", "😮", "😅",
        ],
    ),
    (
        "Hands",
        &[
            "👍", "👎", "👏", "🙌", "🙏", "👋", "🤝", "💪", "👌", "✌️", "🤞", "🫡", "🤷", "🤦",
        ],
    ),
    (
        "Signs",
        &[
            "❤️", "🧡", "💛", "💚", "💙", "💜", "💔", "🔥", "✨", "⭐", "🎉", "🎊", "💯", "✅",
            "❌", "❓", "❗", "💤", "👀", "🚀",
        ],
    ),
    (
        "Things",
        &[
            "☕", "🍺", "🍕", "🍰", "🎮", "🎧", "🎤", "🎵", "📷", "💻", "📌", "🔒", "⏰", "🏆",
            "🐱", "🐶", "🌈", "☀️", "🌙", "⚡",
        ],
    ),
];

/// What a picked emoji is for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum For {
    /// Into what is being written.
    Composer,
    /// Onto a message, as a reaction.
    Reaction { channel: ChannelId, id: String },
}

impl Shell {
    /// Use `emoji` for what the picker was opened for, and close it.
    fn pick_emoji(&mut self, emoji: &'static str, window: &mut Window, cx: &mut Context<Self>) {
        match self.emoji_for.take() {
            Some(For::Composer) => {
                self.composer.update(cx, |composer, cx| {
                    composer.type_text(emoji);
                    composer.focus(window);
                    cx.notify();
                });
            }
            Some(For::Reaction { channel, id }) => self.engine.act(Action::React {
                channel,
                id,
                emoji: emoji.to_owned(),
                add: true,
            }),
            None => {}
        }
        cx.notify();
    }
}

/// The picker, over a veil that closes it.
pub(super) fn render(theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    let mut veil = gpui::black();
    veil.a = 0.35;
    let groups = GROUPS.iter().enumerate().map(|(group, (name, emoji))| {
        div()
            .flex()
            .flex_col()
            .gap(px(4.0))
            .child(
                div()
                    .text_size(px(11.0))
                    .font_weight(EMPHASIS)
                    .text_color(theme.c.muted)
                    .child(*name),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .children(emoji.iter().enumerate().map(|(at, emoji)| {
                        let emoji: &'static str = emoji;
                        div()
                            .id(("emoji", group * 64 + at))
                            .debug_selector(move || format!("emoji-{emoji}"))
                            .size(px(34.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(theme.skin.radius_md)
                            .cursor_pointer()
                            .text_size(px(19.0))
                            .hover(move |style| style.bg(hover))
                            // Not also a click on the veil underneath.
                            .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| {
                                cx.stop_propagation()
                            })
                            .on_click(cx.listener(move |shell, _, window, cx| {
                                shell.pick_emoji(emoji, window, cx);
                            }))
                            .child(SharedString::from(emoji))
                    })),
            )
    });
    div()
        .id("emoji-picker")
        .absolute()
        .size_full()
        .top_0()
        .left_0()
        .occlude()
        .bg(veil)
        .flex()
        .items_center()
        .justify_center()
        .on_mouse_down(
            gpui::MouseButton::Left,
            cx.listener(|shell, _, _, cx| {
                shell.emoji_for = None;
                cx.notify();
            }),
        )
        .child(
            div()
                .id("emoji-groups")
                .w(px(34.0 * 10.0 + 32.0))
                .max_h(px(440.0))
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(10.0))
                .p(px(16.0))
                .rounded(theme.skin.radius_lg)
                .bg(opaque(theme.c.card, theme.c.bg0))
                .border_1()
                .border_color(theme.c.line2)
                .shadow_lg()
                .children(groups),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_emoji_is_offered_twice() {
        let mut seen = std::collections::HashSet::new();
        for (_, emoji) in GROUPS {
            for one in *emoji {
                assert!(seen.insert(*one), "{one} is there twice");
            }
        }
        assert!(seen.len() >= 80);
    }
}
