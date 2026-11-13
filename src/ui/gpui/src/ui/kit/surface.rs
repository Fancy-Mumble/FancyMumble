//! Surfaces and the small marks that sit on them.

use gpui::{
    AnyElement, App, BoxShadow, Div, Hsla, IntoElement, ParentElement, RenderOnce, SharedString,
    StyleRefinement, Styled, Window, div, point, prelude::*, px,
};

use crate::theme::ActiveTheme;
use crate::ui::widgets::EMPHASIS;

/// What a paper is cut from.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Cut {
    /// A card standing proud of a panel: the user's own tile.
    Raised,
    /// A field laid over the conversation: the composer.
    Field,
    /// A plate of this fill on a ground of this edge, casting nothing.
    Plate { fill: Hsla, edge: Hsla },
}

/// A surface cut the way the web UI cuts its cards and bubbles: a ground of
/// the edge colour with the fill laid a pixel inside it, so the edge shows
/// round the fill and tints it from under. Style it and fill it like a
/// `div`.
///
/// ```ignore
/// Paper::raised().flex().p(px(10.0)).child(...)
/// Paper::plate(theme.c.card, theme.c.line).nearest(Nearest::Leading).child(...)
/// ```
#[derive(IntoElement)]
pub(crate) struct Paper {
    base: Div,
    children: Vec<AnyElement>,
    cut: Cut,
    lit: bool,
    nearest: Option<Nearest>,
}

/// The bottom corner of a message's plate that points at whoever sent it,
/// and so is cut smaller than the other three.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Nearest {
    Leading,
    Trailing,
}

impl Paper {
    fn cut(cut: Cut) -> Self {
        Self {
            base: div(),
            children: Vec::new(),
            cut,
            lit: false,
            nearest: None,
        }
    }

    /// A card standing proud of the panel it is on.
    pub(crate) fn raised() -> Self {
        Self::cut(Cut::Raised)
    }

    /// A field laid over the conversation.
    pub(crate) fn field() -> Self {
        Self::cut(Cut::Field)
    }

    /// A flat plate of `fill` on a ground of `edge`.
    pub(crate) fn plate(fill: Hsla, edge: Hsla) -> Self {
        Self::cut(Cut::Plate { fill, edge })
    }

    /// Edge it in the accent: the keyboard is pointed here.
    pub(crate) fn lit(mut self, lit: bool) -> Self {
        self.lit = lit;
        self
    }

    /// Cut the bottom corner on this side small.
    pub(crate) fn nearest(mut self, side: Nearest) -> Self {
        self.nearest = Some(side);
        self
    }
}

impl ParentElement for Paper {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for Paper {
    fn style(&mut self) -> &mut StyleRefinement {
        self.base.style()
    }
}

impl RenderOnce for Paper {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let (fill, edge, shadow) = match self.cut {
            // Drop, blur and strength, as CSS writes a shadow.
            Cut::Raised => (theme.c.card, theme.c.line2, Some((8.0, 28.0, 0.14))),
            Cut::Field => (theme.c.input, theme.c.line2, Some((6.0, 24.0, 0.12))),
            Cut::Plate { fill, edge } => (fill, edge, None),
        };
        let edge = if self.lit {
            Hsla {
                a: 0.6,
                ..theme.c.accent
            }
        } else {
            edge
        };
        let large = theme.skin.radius_lg;
        let small = theme.skin.radius_sm.min(large);
        let (leading, trailing) = match self.nearest {
            Some(Nearest::Leading) => (small, large),
            Some(Nearest::Trailing) => (large, small),
            None => (large, large),
        };
        let inside = |corner: gpui::Pixels| (corner - px(1.0)).max(px(0.0));
        self.base
            .relative()
            .rounded(large)
            .rounded_bl(leading)
            .rounded_br(trailing)
            .bg(edge)
            .when_some(shadow, |paper, (drop, blur, strength)| {
                paper.shadow(vec![BoxShadow {
                    color: gpui::hsla(0.0, 0.0, 0.0, strength),
                    offset: point(px(0.0), px(drop)),
                    // A CSS blur is twice the deviation the renderer takes.
                    blur_radius: px(blur / 2.0),
                    spread_radius: px(0.0),
                }])
            })
            // The fill, a pixel inside the ground: what is left showing
            // round it is the edge.
            .child(
                div()
                    .absolute()
                    .top(px(1.0))
                    .left(px(1.0))
                    .right(px(1.0))
                    .bottom(px(1.0))
                    .rounded(inside(large))
                    .rounded_bl(inside(leading))
                    .rounded_br(inside(trailing))
                    .bg(fill),
            )
            .children(self.children)
    }
}

/// A keyboard shortcut, on the chip the web UI sets one in.
#[derive(IntoElement)]
pub(crate) struct Kbd {
    keys: SharedString,
}

impl Kbd {
    pub(crate) fn new(keys: impl Into<SharedString>) -> Self {
        Self { keys: keys.into() }
    }
}

impl RenderOnce for Kbd {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div()
            .flex_none()
            .px(px(4.75))
            .py(px(1.0))
            .rounded(theme.skin.radius_sm)
            .bg(theme.c.card2)
            .text_size(px(10.0))
            .line_height(px(15.5))
            .text_color(theme.c.dim)
            .child(self.keys)
    }
}

/// How many of something wait, on a pill: unread messages.
#[derive(IntoElement)]
pub(crate) struct Badge {
    count: u32,
}

impl Badge {
    pub(crate) fn new(count: u32) -> Self {
        Self { count }
    }
}

impl RenderOnce for Badge {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div()
            .flex_none()
            .min_w(px(18.0))
            .h(px(18.0))
            .px(px(5.0))
            .rounded(theme.skin.radius_pill)
            .bg(theme.c.accent)
            .flex()
            .items_center()
            .justify_center()
            .text_size(px(10.5))
            .line_height(gpui::relative(1.0))
            .font_weight(EMPHASIS)
            .text_color(theme.c.on_accent)
            .child(if self.count > 99 {
                SharedString::from("99+")
            } else {
                SharedString::from(self.count.to_string())
            })
    }
}
