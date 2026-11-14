//! The bar over a selection in the composer, as the web UI's `FormatBar`:
//! the marks that set words apart, a link, an emoji, and the key that sets
//! bold.
//!
//! Each button does what its key does, through the same call, so the bar is
//! a second way to the keys and not a second way of marking. The parts are
//! the kit's toolbar; what is here is which tools it has, what each does to
//! the composer, and where the bar stands.

use std::rc::Rc;

use gpui::{
    AnyElement, App, AppContext as _, ClickEvent, Context, Entity, Focusable, IntoElement,
    KeyDownEvent, ParentElement, Pixels, Point, Render, Styled, WeakEntity, Window, div,
    prelude::*, px,
};

use super::keys::Dismiss;
use super::kit::{Divider, ToolButton, Toolbar, icon};
use super::marking::{self, Draft, Mark};
use super::text_input::{Spot, TextInput};
use super::widgets::EMPHASIS;
use crate::theme::ActiveTheme;

/// How far above the composer's text the bar's foot is: clear of the plate
/// the composer sits on.
const LIFT: f32 = 22.0;

/// The marks the bar offers, in its order: what the tests call each, its
/// icon and what it says.
const MARKS: [(Mark, &str, &str, &str); 5] = [
    (Mark::Bold, "format-bold", "bold", "Bold"),
    (Mark::Italic, "format-italic", "italic", "Italic"),
    (
        Mark::Underlined,
        "format-underline",
        "underline",
        "Underline",
    ),
    (
        Mark::Struck,
        "format-strike",
        "strikethrough",
        "Strike through",
    ),
    (Mark::Code, "format-code", "code", "Code"),
];

/// What a tool on the bar does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tool {
    Mark(Mark),
    /// Ask for an address and make the selection a link to it, or undo
    /// the link it is.
    Link,
    Emoji,
}

type OnEmoji = Rc<dyn Fn(&mut Window, &mut App)>;

/// The bar over the composer's selection, while the composer has the
/// keyboard or the bar is asking for a link's address.
pub(crate) struct FormatBar {
    composer: WeakEntity<TextInput>,
    /// Where a link's address is typed.
    address: Entity<TextInput>,
    /// Whether a link's address is being asked for.
    asking: bool,
    on_emoji: OnEmoji,
    /// The tools drawn pressed when the bar was last drawn.
    #[cfg(test)]
    pub(super) pressed: Vec<&'static str>,
}

impl FormatBar {
    /// Float a bar over `composer`'s selection. Its emoji button does
    /// `on_emoji`.
    pub(crate) fn attach(
        composer: &Entity<TextInput>,
        on_emoji: impl Fn(&mut Window, &mut App) + 'static,
        cx: &mut App,
    ) {
        let bar = cx.new(|cx| Self {
            composer: composer.downgrade(),
            address: cx.new(|cx| TextInput::new("Link address", cx)),
            asking: false,
            on_emoji: Rc::new(on_emoji),
            #[cfg(test)]
            pressed: Vec::new(),
        });
        composer.update(cx, |composer, _| {
            composer.float_over_selection(bar.into(), Self::stand);
        });
    }

    /// Where the bar stands: over the middle of what is selected on its
    /// first line, its foot clear of the composer, as the web UI stands it.
    fn stand(spot: Spot) -> Point<Pixels> {
        Toolbar::stand(
            spot.selected.center().x,
            spot.field.top() - px(LIFT),
            spot.size,
            spot.room,
        )
    }

    /// Do what `tool` does to the composer.
    fn press(&mut self, tool: Tool, window: &mut Window, cx: &mut Context<Self>) {
        let Some(composer) = self.composer.upgrade() else {
            return;
        };
        match tool {
            Tool::Mark(mark) => composer.update(cx, |field, cx| field.toggle_mark(mark, cx)),
            Tool::Link => {
                let linked = composer
                    .read(cx)
                    .read_selection(Draft::is_linked)
                    .unwrap_or(false);
                if linked {
                    composer.update(cx, |field, cx| {
                        field.rewrite_selection(Draft::unlink, cx);
                    });
                } else {
                    self.ask(window, cx);
                }
            }
            Tool::Emoji => (self.on_emoji)(window, cx),
        }
        cx.notify();
    }

    /// Ask for the address of the link the selection is to become.
    fn ask(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.asking = true;
        self.address.update(cx, |field, _| field.clear());
        window.focus(&self.address.focus_handle(cx), cx);
    }

    /// Make the selection a link to what was typed as its address. Nothing
    /// typed is nothing asked for; what cannot be an address stays to be
    /// put right.
    fn add_link(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let typed = self.address.read(cx).text().to_owned();
        if !typed.trim().is_empty() {
            let Some(address) = marking::address(&typed) else {
                return;
            };
            if let Some(composer) = self.composer.upgrade() {
                composer.update(cx, |field, cx| {
                    field.rewrite_selection(|draft| draft.link(&address), cx);
                });
            }
        }
        self.leave(window, cx);
    }

    /// Stop asking, and give the keyboard back to the composer, its
    /// selection as it was.
    fn leave(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.asking = false;
        if let Some(composer) = self.composer.upgrade() {
            window.focus(&composer.focus_handle(cx), cx);
        }
        cx.notify();
    }

    /// Enter and Escape in the address: before the field hears them.
    fn on_prompt_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        match event.keystroke.key.as_str() {
            "enter" => self.add_link(window, cx),
            "escape" => self.leave(window, cx),
            _ => return,
        }
        cx.stop_propagation();
    }

    /// What a click on `tool` does.
    fn pressing(
        tool: Tool,
        cx: &mut Context<Self>,
    ) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
        cx.listener(move |bar, _, window, cx| bar.press(tool, window, cx))
    }

    /// The tools; those whose mark every selected word has are pressed.
    fn tools(&mut self, marks: [bool; 5], linked: bool, cx: &mut Context<Self>) -> AnyElement {
        let theme = ActiveTheme::get(cx);
        #[cfg(test)]
        {
            self.pressed = MARKS
                .iter()
                .zip(marks)
                .filter(|(_, on)| *on)
                .map(|((_, id, ..), _)| *id)
                .chain(linked.then_some("format-link"))
                .collect();
        }
        let mut bar = Toolbar::new("format-bar");
        for (&(mark, id, glyph, says), on) in MARKS.iter().zip(marks) {
            bar = bar.child(
                ToolButton::new(id, glyph, says)
                    .key(mark.shortcut())
                    .on(on)
                    .on_click(Self::pressing(Tool::Mark(mark), cx)),
            );
        }
        bar.child(Divider::upright(16.0).inset(5.0))
            .child(
                ToolButton::new(
                    "format-link",
                    "link-2",
                    if linked { "Remove link" } else { "Link" },
                )
                .on(linked)
                .on_click(Self::pressing(Tool::Link, cx)),
            )
            .child(Divider::upright(16.0).inset(5.0))
            .child(
                ToolButton::new("format-emoji", "smile", "Emoji")
                    .on_click(Self::pressing(Tool::Emoji, cx)),
            )
            .child(Divider::upright(16.0).inset(5.0))
            // The key the web UI teaches while the mouse is in use.
            .child(
                div()
                    .px(px(7.0))
                    .text_size(px(10.5))
                    .font_weight(EMPHASIS)
                    .text_color(theme.c.dim)
                    .child(Mark::Bold.shortcut()),
            )
            .into_any_element()
    }

    /// The field that asks for a link's address, with the buttons that
    /// take it and that leave it.
    fn prompt(&self, cx: &mut Context<Self>) -> AnyElement {
        let theme = ActiveTheme::get(cx);
        div()
            .on_action(cx.listener(|bar, _: &Dismiss, window, cx| bar.leave(window, cx)))
            .capture_key_down(cx.listener(Self::on_prompt_key))
            .child(
                Toolbar::new("format-link-prompt")
                    .child(div().px(px(4.0)).child(icon("link-2", 15.0, theme.c.dim)))
                    .child(
                        div()
                            .w(px(220.0))
                            .text_size(px(13.0))
                            .child(self.address.clone()),
                    )
                    .child(
                        ToolButton::new("format-link-add", "check", "Add link")
                            .key("Enter")
                            .on_click(cx.listener(|bar, _, window, cx| bar.add_link(window, cx))),
                    )
                    .child(
                        ToolButton::new("format-link-cancel", "x", "Cancel")
                            .key("Esc")
                            .on_click(cx.listener(|bar, _, window, cx| bar.leave(window, cx))),
                    ),
            )
            .into_any_element()
    }
}

impl Render for FormatBar {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(composer) = self.composer.upgrade() else {
            return div().into_any_element();
        };
        // The address was left some other way than Enter or Escape: by a
        // click elsewhere.
        if self.asking && !self.address.read(cx).focus_handle(cx).is_focused(window) {
            self.asking = false;
        }
        let writing = composer.read(cx).focus_handle(cx).is_focused(window);
        let pressed = composer
            .read(cx)
            .read_selection(|draft| (MARKS.map(|(mark, ..)| draft.has(mark)), draft.is_linked()));
        match pressed.filter(|_| writing || self.asking) {
            None => {
                #[cfg(test)]
                self.pressed.clear();
                div().into_any_element()
            }
            Some(_) if self.asking => self.prompt(cx),
            Some((marks, linked)) => self.tools(marks, linked, cx),
        }
    }
}
