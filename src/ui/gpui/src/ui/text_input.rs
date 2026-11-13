//! A one-line text field.
//!
//! Deliberately small: a string, a caret and the keys that move it. The
//! caret does not blink, because a blink is a repaint twice a second for as
//! long as the field has focus, and an idle chat window should draw nothing.
//!
//! Not handled yet: selection, and composed input (an IME).

use gpui::{
    ClipboardItem, Context, EventEmitter, FocusHandle, Focusable, IntoElement, KeyDownEvent,
    ParentElement, Render, SharedString, Styled, Window, div, prelude::*, px,
};

use crate::theme::ActiveTheme;

/// What a [`TextInput`] tells whoever holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum InputEvent {
    /// Enter was pressed; the field's text at that moment.
    Submitted(String),
    /// The text changed.
    Changed,
}

/// The text of a field and where its caret is: the editing itself, with
/// nothing of the toolkit in it.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct Line {
    text: String,
    /// Byte offset of the caret; always on a character boundary.
    caret: usize,
}

impl Line {
    /// Apply one plain key: a caret movement, a deletion, or a character.
    fn edit(&mut self, key: &str, typed: Option<&str>) {
        match key {
            "backspace" => {
                if let Some(previous) = self.previous_boundary() {
                    self.text.replace_range(previous..self.caret, "");
                    self.caret = previous;
                }
            }
            "delete" => {
                if let Some(next) = self.next_boundary() {
                    self.text.replace_range(self.caret..next, "");
                }
            }
            "left" => self.caret = self.previous_boundary().unwrap_or(0),
            "right" => self.caret = self.next_boundary().unwrap_or(self.text.len()),
            "home" => self.caret = 0,
            "end" => self.caret = self.text.len(),
            _ => {
                if let Some(typed) = typed {
                    self.insert(typed);
                }
            }
        }
    }

    fn insert(&mut self, typed: &str) {
        self.text.insert_str(self.caret, typed);
        self.caret += typed.len();
    }

    fn previous_boundary(&self) -> Option<usize> {
        self.text[..self.caret]
            .char_indices()
            .next_back()
            .map(|(at, _)| at)
    }

    fn next_boundary(&self) -> Option<usize> {
        self.text[self.caret..]
            .chars()
            .next()
            .map(|next| self.caret + next.len_utf8())
    }
}

/// A one-line text field.
#[derive(Debug)]
pub(crate) struct TextInput {
    line: Line,
    placeholder: SharedString,
    focus: FocusHandle,
}

impl EventEmitter<InputEvent> for TextInput {}

impl Focusable for TextInput {
    fn focus_handle(&self, _cx: &gpui::App) -> FocusHandle {
        self.focus.clone()
    }
}

impl TextInput {
    /// An empty field showing `placeholder` until something is typed.
    pub(crate) fn new(placeholder: impl Into<SharedString>, cx: &mut Context<Self>) -> Self {
        Self {
            line: Line::default(),
            placeholder: placeholder.into(),
            focus: cx.focus_handle(),
        }
    }

    /// The text in the field.
    pub(crate) fn text(&self) -> &str {
        &self.line.text
    }

    /// The placeholder shown while the field is empty.
    #[cfg(test)]
    pub(crate) fn placeholder(&self) -> &str {
        &self.placeholder
    }

    /// Replace the placeholder, e.g. when the channel changes.
    pub(crate) fn set_placeholder(&mut self, placeholder: impl Into<SharedString>) {
        self.placeholder = placeholder.into();
    }

    /// Empty the field.
    pub(crate) fn clear(&mut self) {
        self.line = Line::default();
    }

    fn on_key(&mut self, event: &KeyDownEvent, _window: &mut Window, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        let command = keystroke.modifiers.control || keystroke.modifiers.platform;
        let before = self.line.clone();
        match keystroke.key.as_str() {
            "enter" => {
                cx.emit(InputEvent::Submitted(self.line.text.clone()));
                return;
            }
            "v" if command => {
                if let Some(pasted) = cx.read_from_clipboard().and_then(|item| item.text()) {
                    // One line: a pasted paragraph joins up rather than
                    // sending itself line by line.
                    self.line.insert(&pasted.replace(['\n', '\r'], " "));
                }
            }
            "c" if command => {
                cx.write_to_clipboard(ClipboardItem::new_string(self.line.text.clone()));
            }
            _ if command || keystroke.modifiers.alt => return,
            key => self.line.edit(key, keystroke.key_char.as_deref()),
        }
        if before != self.line {
            if before.text != self.line.text {
                cx.emit(InputEvent::Changed);
            }
            cx.notify();
        }
    }
}

impl Render for TextInput {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let focused = self.focus.is_focused(window);
        let caret = div()
            .flex_none()
            .w(px(1.5))
            .h(px(18.0))
            .bg(theme.c.accent_text);
        let line = div().flex().items_center().overflow_hidden();
        let line = if self.line.text.is_empty() {
            line.when(focused, |line| line.child(caret)).child(
                div()
                    .text_color(theme.c.dim)
                    .child(self.placeholder.clone()),
            )
        } else {
            let (before, after) = self.line.text.split_at(self.line.caret);
            line.text_color(theme.c.text)
                .child(before.to_owned())
                .when(focused, |line| line.child(caret))
                .child(after.to_owned())
        };
        div()
            .id("text-input")
            .debug_selector(|| format!("input-{}", self.placeholder))
            .flex_1()
            .min_w_0()
            .cursor_text()
            .track_focus(&self.focus)
            .on_key_down(cx.listener(Self::on_key))
            .on_click(cx.listener(|this, _, window, cx| {
                window.focus(&this.focus);
                cx.notify();
            }))
            .child(line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, caret: usize) -> Line {
        Line {
            text: text.to_owned(),
            caret,
        }
    }

    fn after(mut start: Line, key: &str, typed: Option<&str>) -> Line {
        start.edit(key, typed);
        start
    }

    #[test]
    fn typing_inserts_at_the_caret() {
        assert_eq!(after(line("hllo", 1), "e", Some("e")), line("hello", 2));
    }

    #[test]
    fn deleting_respects_character_boundaries() {
        // 'ß' is two bytes: a caret left inside it would panic on the next edit.
        assert_eq!(after(line("aßb", 3), "backspace", None), line("ab", 1));
        assert_eq!(after(line("aßb", 1), "delete", None), line("ab", 1));
        assert_eq!(after(line("", 0), "backspace", None), line("", 0));
        assert_eq!(after(line("ab", 2), "delete", None), line("ab", 2));
    }

    #[test]
    fn the_caret_moves_by_character_and_stops_at_the_ends() {
        assert_eq!(after(line("aß", 3), "left", None), line("aß", 1));
        assert_eq!(after(line("aß", 1), "right", None), line("aß", 3));
        assert_eq!(after(line("aß", 3), "right", None), line("aß", 3));
        assert_eq!(after(line("aß", 0), "left", None), line("aß", 0));
        assert_eq!(after(line("abc", 1), "end", None), line("abc", 3));
        assert_eq!(after(line("abc", 2), "home", None), line("abc", 0));
    }

    #[test]
    fn a_key_that_types_nothing_changes_nothing() {
        assert_eq!(after(line("ab", 1), "f5", None), line("ab", 1));
    }
}
