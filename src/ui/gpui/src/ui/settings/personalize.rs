//! The Personalize page, as the web UI's: the theme, drawn as its picker
//! draws it (a card of each theme's colours in the mode in force), light
//! or dark, the shape messages are drawn in, how large their text is,
//! how dense the list is and whether its actions always show, the picture
//! behind the conversation, where the servers are listed, and how the
//! people in a channel are shown.
//!
//! The web UI's page also chooses between its interface designs; this
//! client is one design, so there is nothing that choice could change.

use gpui::{
    Context, Div, IntoElement, ParentElement, SharedString, Styled, Window, div, prelude::*, px,
};

use super::super::Shell;
use super::super::kit::{Look, PageTitle, Reachable, Segmented, Slider, SliderRow, SwitchRow};
use super::super::widgets::EMPHASIS;
use super::heading;
use crate::store::{BubbleStyle, ChannelViewer, Format, ServerSwitcher, TextSize};
use crate::theme::{ActiveTheme, Catalog, Mode, Theme, ThemeEntry};
use crate::words::t;

/// How wide a theme's card is inside its edge and padding, and how tall
/// the strip of its colours.
const SWATCH_WIDTH: f32 = 118.0;
const SWATCH_HEIGHT: f32 = 52.0;

/// What the page changes about how messages are drawn.
#[derive(Debug, Clone, Copy)]
enum Restyle {
    Bubbles(BubbleStyle),
    Compact,
    Actions,
}

impl Shell {
    /// Follow the system's light or dark (`0`), or be light (`1`) or dark.
    fn choose_mode(&mut self, at: usize, window: &Window, cx: &mut Context<Self>) {
        let theme = ActiveTheme::get(cx);
        self.chrome.follows_system = at == 0;
        let mode = match at {
            0 => Mode::of(window.appearance()),
            1 => Mode::Light,
            _ => Mode::Dark,
        };
        self.set_theme(&theme.id, mode, cx);
    }

    /// Set message text in `size`.
    fn set_text_size(&mut self, size: TextSize, cx: &mut Context<Self>) {
        self.panels.settings.format.text = size;
        self.messages_restyled(cx);
    }

    /// Set message text this far along the bar of sizes, a pixel at a
    /// time: that is the size "large" stands for, and it is chosen.
    fn set_custom_size(&mut self, along: f32, cx: &mut Context<Self>) {
        let (least, most) = Format::CUSTOM_PX;
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a share of a small whole number"
        )]
        let px = least + (along.clamp(0.0, 1.0) * f32::from(most - least)).round() as u8;
        let format = &mut self.panels.settings.format;
        format.font_size_custom_px = Some(px);
        format.text = TextSize::Large;
        self.messages_restyled(cx);
    }

    /// Change how messages are drawn.
    fn restyle(&mut self, change: Restyle, cx: &mut Context<Self>) {
        let look = &mut self.panels.settings.look;
        match change {
            Restyle::Bubbles(style) => look.bubble_style = style,
            Restyle::Compact => look.compact_mode = !look.compact_mode,
            Restyle::Actions => {
                look.always_show_message_actions = !look.always_show_message_actions;
            }
        }
        self.messages_restyled(cx);
    }

    /// Messages are drawn another way: every row is measured again, the
    /// reader kept on what they were reading, and the change kept.
    fn messages_restyled(&mut self, cx: &mut Context<Self>) {
        let top = self.rows.logical_scroll_top();
        let rows = self.rows.item_count();
        self.rows.splice(0..rows, rows);
        self.rows.scroll_to(top);
        self.remember_settings(cx);
        cx.notify();
    }

    /// List the servers in the rail, in the band, or in both.
    fn set_server_switcher(&mut self, switcher: ServerSwitcher, cx: &mut Context<Self>) {
        self.panels.settings.server_switcher = switcher;
        self.remember_settings(cx);
        cx.notify();
    }

    /// Show the people in a channel by name, or by face on its row.
    fn set_channel_viewer(&mut self, viewer: ChannelViewer, cx: &mut Context<Self>) {
        self.panels.settings.look.channel_viewer_style = viewer;
        self.lay_out_column();
        self.remember_settings(cx);
        cx.notify();
    }
}

/// The page.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let mode = if shell.follows_system() {
        0
    } else if theme.mode == Mode::Light {
        1
    } else {
        2
    };
    let lit = &shell.panels.settings.lit;
    div()
        .child(PageTitle::new(t!("Personalize")))
        .child(heading(lit, t!("Theme")))
        .child(
            div().flex().flex_wrap().gap(px(9.0)).children(
                Catalog::get()
                    .entries(theme.mode)
                    .into_iter()
                    .map(|entry| theme_card(entry, theme, cx)),
            ),
        )
        .child(heading(lit, t!("Appearance")).hint(t!(
            "Every theme is drawn in both a light and a dark scheme. This chooses which one the window wears."
        )))
        .child(
            div().flex().child(
                Segmented::new("mode", [t!("Match system"), t!("Light"), t!("Dark")], mode)
                    .on_choose(cx.listener(|shell, at: &usize, window, cx| {
                        shell.choose_mode(*at, window, cx);
                    })),
            ),
        )
        .child(message_style(shell, cx))
        .child(text_size(shell, cx))
        .child(message_list(shell, cx))
        .child(super::wall::render(shell, theme, cx))
        .child(server_list(shell, cx))
        .child(channel_viewer(shell, cx))
}

/// The shape messages are drawn in.
fn message_style(shell: &Shell, cx: &mut Context<Shell>) -> Div {
    let style = shell.panels.settings.look.bubble_style;
    let taken = BubbleStyle::ALL.iter().position(|known| *known == style);
    div()
        .child(
            heading(&shell.panels.settings.lit, t!("Message style")).hint(t!(
                "Bubbles shows every message in a rounded card; Flat is one continuous river."
            )),
        )
        .child(
            div().flex().child(
                Segmented::new(
                    "message-style",
                    [t!("Bubbles"), t!("Flat"), t!("Compact")],
                    taken.unwrap_or(0),
                )
                .on_choose(cx.listener(|shell, at: &usize, _, cx| {
                    if let Some(style) = BubbleStyle::ALL.get(*at) {
                        shell.restyle(Restyle::Bubbles(*style), cx);
                    }
                })),
            ),
        )
}

/// How large message text is: three sizes, and for an expert the size
/// "large" stands for, a pixel at a time.
fn text_size(shell: &Shell, cx: &mut Context<Shell>) -> Div {
    let format = shell.panels.settings.format;
    let taken = TextSize::ALL.iter().position(|known| *known == format.text);
    let (least, most) = Format::CUSTOM_PX;
    let custom = format.custom_px();
    div()
        .child(
            heading(&shell.panels.settings.lit, t!("Text size"))
                .hint(t!("Applies to message text.")),
        )
        .child(
            div().flex().child(
                Segmented::new(
                    "text-size",
                    [t!("Small"), t!("Medium"), t!("Large")],
                    taken.unwrap_or(1),
                )
                .on_choose(cx.listener(|shell, at: &usize, _, cx| {
                    if let Some(size) = TextSize::ALL.get(*at) {
                        shell.set_text_size(*size, cx);
                    }
                })),
            ),
        )
        .when(shell.panels.settings.user_mode.expert(), |group| {
            group.child(
                div()
                    .mt(px(14.0))
                    .max_w(px(320.0))
                    .flex()
                    .child(SliderRow::new(
                        t!("Custom size"),
                        t!("{{value}} px", value = custom),
                        Slider::new(
                            "custom-size",
                            f32::from(custom.saturating_sub(least)) / f32::from(most - least),
                        )
                        .on_change(cx.listener(
                            |shell, at: &f32, _, cx| {
                                shell.set_custom_size(*at, cx);
                            },
                        )),
                    )),
            )
        })
}

/// How dense the list of messages is, and whether every message shows its
/// actions.
fn message_list(shell: &Shell, cx: &mut Context<Shell>) -> Div {
    let look = shell.panels.settings.look;
    let lit = &shell.panels.settings.lit;
    let card = |id: &'static str,
                title: SharedString,
                hint: SharedString,
                on: bool,
                change: Restyle,
                cx: &mut Context<Shell>| {
        let lights = lit.lights(&title);
        SwitchRow::new(id, title, on)
            .look(Look::Card)
            .lit(lights)
            .hint(hint)
            .on_click(cx.listener(move |shell, _, _, cx| shell.restyle(change, cx)))
    };
    div().child(heading(lit, t!("Message list"))).child(
        div()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .child(card(
                "compact-mode",
                t!("Compact mode"),
                t!("Hides avatars and tightens the spacing."),
                look.compact_mode,
                Restyle::Compact,
                cx,
            ))
            .child(card(
                "always-show-actions",
                t!("Always show message actions"),
                t!("Shows them on every message, not just on hover."),
                look.always_show_message_actions,
                Restyle::Actions,
                cx,
            )),
    )
}

/// Where the servers are listed.
fn server_list(shell: &Shell, cx: &mut Context<Shell>) -> Div {
    let switcher = shell.panels.settings.server_switcher;
    let taken = ServerSwitcher::ALL
        .iter()
        .position(|known| *known == switcher);
    div()
        .child(heading(&shell.panels.settings.lit, t!("Server list")).hint(t!(
            "The rail keeps every server in view; the title bar keeps the window taller. With neither up there, it names the server you are on instead."
        )))
        .child(
            div().flex().child(
                Segmented::new(
                    "server-list",
                    [t!("Sidebar"), t!("Title bar"), t!("Both")],
                    taken.unwrap_or(0),
                )
                .on_choose(cx.listener(|shell, at: &usize, _, cx| {
                    if let Some(switcher) = ServerSwitcher::ALL.get(*at) {
                        shell.set_server_switcher(*switcher, cx);
                    }
                })),
            ),
        )
}

/// How the people in a channel are shown. A record of the web client's
/// older design's tree is drawn flat, and says so.
fn channel_viewer(shell: &Shell, cx: &mut Context<Shell>) -> Div {
    let stored = shell.panels.settings.look.channel_viewer_style;
    let taken = ChannelViewer::OFFERED
        .iter()
        .position(|known| *known == stored.drawn());
    let title = heading(&shell.panels.settings.lit, t!("Channel viewer"));
    let title = if stored == ChannelViewer::Classic {
        title.hint(t!(
            "This profile has Standard's \"{{stored}}\" saved. Nebula has no collapsing folders, so it draws \"{{shown}}\".",
            stored = t!("Classic"),
            shown = t!("Flat")
        ))
    } else {
        title
    };
    div().child(title).child(
        div().flex().child(
            Segmented::new(
                "channel-viewer",
                [t!("Flat"), t!("Modern")],
                taken.unwrap_or(0),
            )
            .on_choose(cx.listener(|shell, at: &usize, _, cx| {
                if let Some(viewer) = ChannelViewer::OFFERED.get(*at) {
                    shell.set_channel_viewer(*viewer, cx);
                }
            })),
        ),
    )
}

/// One theme: a strip of its colours in the mode in force, its name under
/// it, washed in the accent while it is the one in use.
fn theme_card(
    entry: ThemeEntry,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let current = entry.id == theme.id;
    let mode = theme.mode;
    let id = entry.id.clone();
    let corner = theme.skin.radius_md;
    let inner = (corner - px(1.0)).max(px(0.0));
    let last = entry.swatches.len() - 1;
    let strip = div()
        .w(px(SWATCH_WIDTH))
        .h(px(SWATCH_HEIGHT))
        .flex()
        .rounded(corner)
        .border_1()
        .border_color(gpui::hsla(0.0, 0.0, 0.5, 0.2))
        .children(entry.swatches.into_iter().enumerate().map(|(at, swatch)| {
            div()
                .flex_1()
                .h_full()
                .bg(swatch)
                .when(at == 0, |first| first.rounded_l(inner))
                .when(at == last, |end| end.rounded_r(inner))
        }));
    let card = div()
        .id(entry.id.clone())
        .debug_selector({
            let id = entry.id.clone();
            move || format!("theme-{id}")
        })
        .p(px(7.0))
        .rounded(corner)
        .border_1()
        .cursor_pointer()
        .map(|card| {
            if current {
                card.bg(theme.c.accent_soft)
                    .border_color(theme.c.accent_line)
            } else {
                card.bg(theme.c.card).border_color(theme.c.line)
            }
        })
        .on_click(cx.listener(move |shell, _, _, cx| shell.set_theme(&id, mode, cx)))
        .child(strip)
        .child(
            div()
                .mt(px(7.0))
                .w(px(SWATCH_WIDTH))
                .flex()
                .justify_center()
                .text_size(px(12.0))
                .font_weight(if current {
                    EMPHASIS
                } else {
                    gpui::FontWeight::MEDIUM
                })
                .child(entry.name),
        );
    Reachable::new(entry.id, card)
}
