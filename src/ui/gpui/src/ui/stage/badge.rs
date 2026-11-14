//! The mark beside somebody who is sharing their screen, in the channel list
//! and the member list: the web client's `LiveBadge`. "LIVE" in the theme's
//! bad colour where the server relays shares, "P2P" in its warning colour
//! where it does not.

use gpui::{
    App, InteractiveElement, IntoElement, ParentElement, RenderOnce, SharedString,
    StatefulInteractiveElement, Styled, Window, div, px,
};

use crate::theme::ActiveTheme;
use crate::ui::kit::icon;
use crate::words::t;

/// The mark, for one person.
#[derive(IntoElement)]
pub(crate) struct LiveBadge {
    relayed: bool,
}

impl LiveBadge {
    /// The mark of somebody sharing, through the server when `relayed`.
    pub(crate) fn new(relayed: bool) -> Self {
        Self { relayed }
    }
}

impl RenderOnce for LiveBadge {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let (ink, says, tip) = if self.relayed {
            (theme.c.bad, t!("Live"), t!("Sharing screen (server-relayed)"))
        } else {
            (theme.c.warn, t!("P2P"), t!("Sharing screen (peer-to-peer)"))
        };
        div()
            .debug_selector(|| "live-badge".to_owned())
            .id("live-badge")
            .flex_none()
            .h(px(16.0))
            .px(px(5.0))
            .flex()
            .items_center()
            .gap(px(3.0))
            .rounded(theme.skin.radius_sm)
            .bg(gpui::Hsla { a: 0.15, ..ink })
            .text_color(ink)
            .text_size(px(9.5))
            .font_weight(gpui::FontWeight::BOLD)
            .child(icon("screen-share", 10.0, ink))
            .child(says.to_uppercase())
            .tooltip(crate::ui::kit::keyed_tip(tip, None::<SharedString>))
    }
}
