//! The word that comes up beside a control the pointer rests on.
//!
//! A button that is only an icon says what it does this way, and so does a
//! badge that is only a colour. The toolkit decides when it comes up and
//! where; this is what comes up.

use gpui::{
    AnyView, App, AppContext as _, Context, IntoElement, ParentElement, Render, SharedString,
    Styled, Window, div, prelude::*, px,
};

use crate::theme::ActiveTheme;

/// What a tooltip says: a word or two, and the key that does the same, if
/// one does.
struct Tip {
    says: SharedString,
    key: Option<SharedString>,
}

impl Render for Tip {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let says = self.says.clone();
        div()
            .debug_selector(move || format!("tip-{says}"))
            // Clear of the pointer, which sits on what is being named.
            .mt(px(6.0))
            .px(px(8.0))
            .py(px(4.0))
            .rounded(theme.skin.radius_sm)
            .bg(theme.c.card2)
            .border_1()
            .border_color(theme.c.line2)
            .text_size(px(12.0))
            .text_color(theme.c.text)
            .flex()
            .items_center()
            .gap(px(8.0))
            .child(self.says.clone())
            .when_some(self.key.clone(), |tip, key| {
                tip.child(div().text_color(theme.c.dim).child(key))
            })
    }
}

/// What to hand a control's `tooltip`: it says `says`, and names the key
/// that does the same, if one does.
///
/// ```ignore
/// div().id("mute").tooltip(keyed_tip("Mute", None::<&str>))
/// ```
pub(crate) fn keyed_tip(
    says: impl Into<SharedString>,
    key: Option<impl Into<SharedString>>,
) -> impl Fn(&mut Window, &mut App) -> AnyView + 'static {
    let (says, key) = (says.into(), key.map(Into::into));
    move |_, cx| {
        cx.new(|_| Tip {
            says: says.clone(),
            key: key.clone(),
        })
        .into()
    }
}
