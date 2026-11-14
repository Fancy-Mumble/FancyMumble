//! A fact on a pill: how many are online, how far away a server is, one of
//! the tags a server gives itself. The web UI's `StatChip`.

use gpui::{
    AnyElement, App, Hsla, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window,
    div, prelude::*, px,
};

use crate::theme::{ActiveTheme, Theme};

/// What a chip says by its colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum ChipTone {
    #[default]
    Neutral,
    Dim,
    Ok,
    Accent,
    Warn,
    Bad,
}

impl ChipTone {
    /// Its ink, ground and edge.
    fn colours(self, theme: &Theme) -> (Hsla, Hsla, Hsla) {
        let wash = |color: Hsla| (color, Hsla { a: 0.14, ..color }, Hsla { a: 0.333, ..color });
        match self {
            Self::Neutral => (theme.c.muted, theme.c.card2, gpui::transparent_black()),
            Self::Dim => (theme.c.dim, theme.c.card2, gpui::transparent_black()),
            Self::Ok => wash(theme.c.ok),
            Self::Warn => wash(theme.c.warn),
            Self::Bad => wash(theme.c.bad),
            Self::Accent => (
                theme.c.accent_text,
                theme.c.accent_soft,
                theme.c.accent_line,
            ),
        }
    }
}

/// What a chip that leads somewhere does when clicked.
type OnClick = Box<dyn Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static>;

/// A chip: words, and a mark before them if wanted, toned.
#[derive(IntoElement)]
pub(crate) struct Chip {
    id: Option<SharedString>,
    tone: ChipTone,
    children: Vec<AnyElement>,
    on_click: Option<OnClick>,
}

impl Chip {
    pub(crate) fn new(tone: ChipTone) -> Self {
        Self {
            id: None,
            tone,
            children: Vec::new(),
            on_click: None,
        }
    }

    /// A chip that does something when clicked: a tag that is a link.
    pub(crate) fn on_click(
        mut self,
        id: impl Into<SharedString>,
        handler: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.id = Some(id.into());
        self.on_click = Some(Box::new(handler));
        self
    }
}

impl ParentElement for Chip {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Chip {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let (ink, ground, edge) = self.tone.colours(&theme);
        let chip = div()
            .flex_none()
            .h(px(27.0))
            .px(px(11.0))
            .flex()
            .items_center()
            .gap(px(8.0))
            .rounded(theme.skin.radius_lg)
            .bg(ground)
            .border_1()
            .border_color(edge)
            .text_size(px(11.0))
            .font_weight(gpui::FontWeight::MEDIUM)
            .text_color(ink)
            .children(self.children);
        match (self.id, self.on_click) {
            (Some(id), Some(handler)) => {
                let tag = id.clone();
                chip.id(id)
                    .debug_selector(move || tag.to_string())
                    .cursor_pointer()
                    .hover(|style| style.opacity(0.85))
                    .on_click(handler)
                    .into_any_element()
            }
            _ => chip.into_any_element(),
        }
    }
}
