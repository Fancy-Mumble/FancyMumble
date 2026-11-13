//! A one-line text field.
//!
//! Text arrives the way the platform delivers it - through GPUI's input
//! handler - so composed input works: dead keys, the compose key, an input
//! method. Keys that are not text (arrows, backspace, enter) are handled
//! here. The caret does not blink, because a blink is a repaint twice a
//! second for as long as the field has focus, and an idle chat window should
//! draw nothing.
//!
//! Not handled yet: placing the caret or selecting with the pointer.

use std::ops::Range;

use gpui::{
    Bounds, ClipboardItem, Context, ElementInputHandler, EntityInputHandler, EventEmitter,
    FocusHandle, Focusable, IntoElement, KeyDownEvent, ParentElement, Pixels, Render, SharedString,
    Styled, UTF16Selection, Window, canvas, div, prelude::*, px,
};

use crate::theme::ActiveTheme;

/// What a [`TextInput`] tells whoever holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum InputEvent {
    /// Enter was pressed; the field's text at that moment.
    Submitted(String),
    /// The text changed.
    Changed,
    /// Tab was pressed: focus belongs to the next field; with shift, to the
    /// one before.
    Tabbed {
        /// Whether shift was held.
        back: bool,
    },
    /// Escape was pressed.
    Cancelled,
}

/// The text of a field, its caret and its selection: the editing itself,
/// with nothing of the toolkit in it. Offsets are bytes, always on a
/// character boundary.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct Line {
    text: String,
    /// Where typing goes, and the moving end of the selection.
    caret: usize,
    /// The fixed end of the selection; equal to `caret` when nothing is
    /// selected.
    anchor: usize,
}

impl Line {
    fn selection(&self) -> Range<usize> {
        self.caret.min(self.anchor)..self.caret.max(self.anchor)
    }

    /// Replace `range` with `text`, leaving the caret after it.
    fn replace(&mut self, range: Range<usize>, text: &str) {
        let range = self.clamp(range);
        self.text.replace_range(range.clone(), text);
        self.caret = range.start + text.len();
        self.anchor = self.caret;
    }

    /// Type `text` over the selection, or at the caret.
    fn insert(&mut self, text: &str) {
        self.replace(self.selection(), text);
    }

    /// Apply a key that is not text. `extend` (shift) moves the caret and
    /// leaves the anchor, growing the selection. Returns whether the key was
    /// one this handles.
    fn key(&mut self, key: &str, extend: bool) -> bool {
        let selection = self.selection();
        let selected = !selection.is_empty();
        match key {
            "backspace" if selected => self.replace(selection, ""),
            "delete" if selected => self.replace(selection, ""),
            "backspace" => {
                if let Some(previous) = self.previous_boundary() {
                    self.replace(previous..self.caret, "");
                }
            }
            "delete" => {
                if let Some(next) = self.next_boundary() {
                    self.replace(self.caret..next, "");
                }
            }
            // Without shift, an arrow collapses a selection to that side.
            "left" if selected && !extend => self.move_to(selection.start, false),
            "right" if selected && !extend => self.move_to(selection.end, false),
            "left" => self.move_to(self.previous_boundary().unwrap_or(0), extend),
            "right" => self.move_to(self.next_boundary().unwrap_or(self.text.len()), extend),
            "home" => self.move_to(0, extend),
            "end" => self.move_to(self.text.len(), extend),
            _ => return false,
        }
        true
    }

    fn move_to(&mut self, caret: usize, extend: bool) {
        self.caret = caret;
        if !extend {
            self.anchor = caret;
        }
    }

    fn select_all(&mut self) {
        self.anchor = 0;
        self.caret = self.text.len();
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

    /// `range`, pulled inside the text and onto character boundaries.
    fn clamp(&self, range: Range<usize>) -> Range<usize> {
        let floor = |mut at: usize| {
            at = at.min(self.text.len());
            while !self.text.is_char_boundary(at) {
                at -= 1;
            }
            at
        };
        let start = floor(range.start);
        start..floor(range.end).max(start)
    }

    /// A byte offset as the platform counts: in UTF-16 code units.
    fn byte_to_utf16(&self, offset: usize) -> usize {
        self.text[..self.clamp(0..offset).end]
            .encode_utf16()
            .count()
    }

    /// A UTF-16 offset from the platform, as a byte offset.
    fn utf16_to_byte(&self, offset: usize) -> usize {
        let mut units = 0;
        for (at, character) in self.text.char_indices() {
            if units >= offset {
                return at;
            }
            units += character.len_utf16();
        }
        self.text.len()
    }

    fn range_to_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.byte_to_utf16(range.start)..self.byte_to_utf16(range.end)
    }

    fn range_from_utf16(&self, range: &Range<usize>) -> Range<usize> {
        self.utf16_to_byte(range.start)..self.utf16_to_byte(range.end)
    }
}

/// A one-line text field.
#[derive(Debug)]
pub(crate) struct TextInput {
    line: Line,
    /// Text an input method is still composing, as a byte range.
    marked: Option<Range<usize>>,
    placeholder: SharedString,
    /// Whether the text is drawn as dots: a password.
    obscured: bool,
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
            marked: None,
            placeholder: placeholder.into(),
            obscured: false,
            focus: cx.focus_handle(),
        }
    }

    /// The same field, drawing what is typed as dots.
    pub(crate) fn obscured(mut self) -> Self {
        self.obscured = true;
        self
    }

    /// The text in the field.
    pub(crate) fn text(&self) -> &str {
        &self.line.text
    }

    /// Replace the text, leaving the caret after it.
    pub(crate) fn set_text(&mut self, text: impl Into<String>) {
        self.line = Line::default();
        self.line.insert(&text.into());
        self.marked = None;
    }

    /// Give the field the keyboard.
    pub(crate) fn focus(&self, window: &mut Window) {
        window.focus(&self.focus);
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
        self.marked = None;
    }

    /// Keys that are not text. Text itself is left to propagate, and comes
    /// back through the input handler once the platform has made it text.
    fn on_key(&mut self, event: &KeyDownEvent, _window: &mut Window, cx: &mut Context<Self>) {
        let keystroke = &event.keystroke;
        let command = keystroke.modifiers.control || keystroke.modifiers.platform;
        let before = self.line.clone();
        let handled = match keystroke.key.as_str() {
            "enter" => {
                cx.emit(InputEvent::Submitted(self.line.text.clone()));
                true
            }
            "tab" => {
                cx.emit(InputEvent::Tabbed {
                    back: keystroke.modifiers.shift,
                });
                true
            }
            "escape" => {
                cx.emit(InputEvent::Cancelled);
                true
            }
            "a" if command => {
                self.line.select_all();
                true
            }
            "v" if command => {
                if let Some(pasted) = cx.read_from_clipboard().and_then(|item| item.text()) {
                    // One line: a pasted paragraph joins up rather than
                    // sending itself line by line.
                    self.line.insert(&pasted.replace(['\n', '\r'], " "));
                }
                true
            }
            // A password is not handed to the clipboard.
            "c" | "x" if command && self.obscured => true,
            key @ ("c" | "x") if command => {
                let selection = self.line.selection();
                if !selection.is_empty() {
                    cx.write_to_clipboard(ClipboardItem::new_string(
                        self.line.text[selection.clone()].to_owned(),
                    ));
                    if key == "x" {
                        self.line.replace(selection, "");
                    }
                }
                true
            }
            _ if command || keystroke.modifiers.alt => false,
            key => self.line.key(key, keystroke.modifiers.shift),
        };
        if handled {
            cx.stop_propagation();
        }
        self.after_edit(&before, cx);
    }

    /// Say so if the text changed, and repaint if anything did.
    fn after_edit(&mut self, before: &Line, cx: &mut Context<Self>) {
        if *before == self.line {
            return;
        }
        if before.text != self.line.text {
            cx.emit(InputEvent::Changed);
        }
        cx.notify();
    }

    /// The text as drawn: itself, or a dot for each character of a password.
    fn shown(&self, text: &str) -> String {
        if self.obscured {
            "•".repeat(text.chars().count())
        } else {
            text.to_owned()
        }
    }
}

impl EntityInputHandler for TextInput {
    fn text_for_range(
        &mut self,
        range_utf16: Range<usize>,
        adjusted_range: &mut Option<Range<usize>>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.line.clamp(self.line.range_from_utf16(&range_utf16));
        *adjusted_range = Some(self.line.range_to_utf16(&range));
        Some(self.line.text[range].to_owned())
    }

    fn selected_text_range(
        &mut self,
        _ignore_disabled_input: bool,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.line.range_to_utf16(&self.line.selection()),
            reversed: self.line.caret < self.line.anchor,
        })
    }

    fn marked_text_range(
        &self,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Range<usize>> {
        self.marked
            .as_ref()
            .map(|range| self.line.range_to_utf16(range))
    }

    fn unmark_text(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {
        self.marked = None;
    }

    fn replace_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        text: &str,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let before = self.line.clone();
        // Where the platform says, else over what is being composed, else
        // over the selection.
        let range = range_utf16
            .map(|range| self.line.range_from_utf16(&range))
            .or_else(|| self.marked.clone())
            .unwrap_or_else(|| self.line.selection());
        self.line.replace(range, text);
        self.marked = None;
        self.after_edit(&before, cx);
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range_utf16: Option<Range<usize>>,
        new_text: &str,
        new_selected_range_utf16: Option<Range<usize>>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let before = self.line.clone();
        let range = range_utf16
            .map(|range| self.line.range_from_utf16(&range))
            .or_else(|| self.marked.clone())
            .unwrap_or_else(|| self.line.selection());
        let start = self.line.clamp(range.clone()).start;
        self.line.replace(range, new_text);
        self.marked = (!new_text.is_empty()).then(|| start..start + new_text.len());
        // The input method may place its own caret inside what it composes.
        if let Some(selected) = new_selected_range_utf16 {
            let composed = Line {
                text: new_text.to_owned(),
                ..Line::default()
            };
            let selected = composed.range_from_utf16(&selected);
            self.line.anchor = start + selected.start;
            self.line.caret = start + selected.end;
        }
        self.after_edit(&before, cx);
    }

    fn bounds_for_range(
        &mut self,
        _range_utf16: Range<usize>,
        element_bounds: Bounds<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        // Near enough for an input method to put its candidates by the field.
        Some(element_bounds)
    }

    fn character_index_for_point(
        &mut self,
        _point: gpui::Point<Pixels>,
        _window: &mut Window,
        _cx: &mut Context<Self>,
    ) -> Option<usize> {
        None
    }
}

impl Render for TextInput {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let focused = self.focus.is_focused(window);
        let caret = || {
            div()
                .flex_none()
                .w(px(1.5))
                .h(px(18.0))
                .bg(theme.c.accent_text)
        };
        let line = div().flex().items_center().overflow_hidden();
        let line = if self.line.text.is_empty() {
            line.when(focused, |line| line.child(caret())).child(
                div()
                    .text_color(theme.c.dim)
                    .child(self.placeholder.clone()),
            )
        } else {
            let selection = self.line.selection();
            let caret_first = self.line.caret == selection.start;
            line.text_color(theme.c.text)
                .child(self.shown(&self.line.text[..selection.start]))
                .when(focused && caret_first, |line| line.child(caret()))
                .when(!selection.is_empty(), |line| {
                    line.child(
                        div()
                            .bg(theme.c.accent_soft)
                            .child(self.shown(&self.line.text[selection.clone()])),
                    )
                })
                .when(focused && !caret_first, |line| line.child(caret()))
                .child(self.shown(&self.line.text[selection.end..]))
        };
        let entity = cx.entity();
        let focus = self.focus.clone();
        div()
            .id("text-input")
            .debug_selector(|| format!("input-{}", self.placeholder))
            .relative()
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
            // Paints nothing: it is where the field tells the platform, each
            // frame it has focus, that text typed now belongs to it.
            .child(
                canvas(
                    |_, _, _| {},
                    move |bounds, (), window, cx| {
                        window.handle_input(&focus, ElementInputHandler::new(bounds, entity), cx);
                    },
                )
                .absolute()
                .size_full(),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, caret: usize) -> Line {
        Line {
            text: text.to_owned(),
            caret,
            anchor: caret,
        }
    }

    fn selected(text: &str, anchor: usize, caret: usize) -> Line {
        Line {
            text: text.to_owned(),
            caret,
            anchor,
        }
    }

    fn after(mut start: Line, key: &str, extend: bool) -> Line {
        assert!(start.key(key, extend), "`{key}` is a key the field handles");
        start
    }

    #[test]
    fn typing_inserts_at_the_caret_and_replaces_a_selection() {
        let mut typed = line("hllo", 1);
        typed.insert("e");
        assert_eq!(typed, line("hello", 2));
        let mut over = selected("hello world", 0, 5);
        over.insert("bye");
        assert_eq!(over, line("bye world", 3));
    }

    #[test]
    fn deleting_respects_character_boundaries() {
        // 'ß' is two bytes: a caret left inside it would panic on the next edit.
        assert_eq!(after(line("aßb", 3), "backspace", false), line("ab", 1));
        assert_eq!(after(line("aßb", 1), "delete", false), line("ab", 1));
        assert_eq!(after(line("", 0), "backspace", false), line("", 0));
        assert_eq!(after(line("ab", 2), "delete", false), line("ab", 2));
    }

    #[test]
    fn deleting_with_a_selection_removes_exactly_it() {
        assert_eq!(
            after(selected("hello", 1, 4), "backspace", false),
            line("ho", 1)
        );
        assert_eq!(
            after(selected("hello", 4, 1), "delete", false),
            line("ho", 1)
        );
    }

    #[test]
    fn the_caret_moves_by_character_and_stops_at_the_ends() {
        assert_eq!(after(line("aß", 3), "left", false), line("aß", 1));
        assert_eq!(after(line("aß", 1), "right", false), line("aß", 3));
        assert_eq!(after(line("aß", 3), "right", false), line("aß", 3));
        assert_eq!(after(line("aß", 0), "left", false), line("aß", 0));
        assert_eq!(after(line("abc", 1), "end", false), line("abc", 3));
        assert_eq!(after(line("abc", 2), "home", false), line("abc", 0));
    }

    #[test]
    fn shift_extends_the_selection_and_an_arrow_collapses_it() {
        let grown = after(after(line("abc", 1), "right", true), "right", true);
        assert_eq!(grown, selected("abc", 1, 3));
        assert_eq!(grown.selection(), 1..3);
        assert_eq!(after(grown.clone(), "left", false), line("abc", 1));
        assert_eq!(after(grown, "right", false), line("abc", 3));
        assert_eq!(after(line("abc", 2), "home", true), selected("abc", 2, 0));
        let mut all = line("abc", 1);
        all.select_all();
        assert_eq!(all.selection(), 0..3);
    }

    #[test]
    fn a_key_that_is_not_an_edit_is_left_alone() {
        let mut untouched = line("ab", 1);
        assert!(!untouched.key("f5", false));
        assert!(!untouched.key("e", false), "text is not a key this handles");
        assert_eq!(untouched, line("ab", 1));
    }

    #[test]
    fn offsets_convert_between_bytes_and_utf16() {
        // 'ß' is two bytes and one UTF-16 unit; '😀' is four bytes and two.
        let mixed = line("aß😀b", 0);
        assert_eq!(mixed.byte_to_utf16(1), 1);
        assert_eq!(mixed.byte_to_utf16(3), 2);
        assert_eq!(mixed.byte_to_utf16(7), 4);
        assert_eq!(mixed.utf16_to_byte(2), 3);
        assert_eq!(mixed.utf16_to_byte(4), 7);
        assert_eq!(mixed.utf16_to_byte(99), mixed.text.len());
        assert_eq!(mixed.range_from_utf16(&(1..4)), 1..7);
        assert_eq!(mixed.range_to_utf16(&(1..7)), 1..4);
    }

    #[test]
    fn a_range_from_outside_is_pulled_onto_the_text() {
        let text = line("aß", 0);
        assert_eq!(text.clamp(0..99), 0..3);
        assert_eq!(text.clamp(2..3), 1..3, "not into the middle of a character");
        let backwards = Range { start: 3, end: 1 };
        assert_eq!(text.clamp(backwards), 3..3, "never backwards");
        let mut replaced = line("aß", 0);
        replaced.replace(1..99, "!");
        assert_eq!(replaced, line("a!", 2));
    }
}
