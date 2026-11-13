//! A text field: one line, or - for the composer - as many as are typed.
//!
//! Text arrives the way the platform delivers it - through GPUI's input
//! handler - so composed input works: dead keys, the compose key, an input
//! method. Keys that are not text (arrows, backspace, enter) are handled
//! here, and the pointer places the caret and drags out a selection. The
//! caret does not blink, because a blink is a repaint twice a second for as
//! long as the field has focus, and an idle chat window should draw nothing.

use std::ops::Range;

use std::cell::RefCell;
use std::rc::Rc;

use gpui::{
    Bounds, ClipboardItem, Context, ElementInputHandler, EntityInputHandler, EventEmitter,
    FocusHandle, Focusable, HighlightStyle, IntoElement, KeyDownEvent, MouseButton, MouseDownEvent,
    MouseMoveEvent, ParentElement, Pixels, Point, Render, SharedString, Styled, StyledText,
    TextLayout, UTF16Selection, Window, canvas, div, fill, prelude::*, px, size,
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
    /// A picture was pasted: its encoded bytes. Only a field that asked
    /// for pictures says this.
    PastedPicture(Vec<u8>),
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

    /// Select the word `offset` is in or beside: the run of letters and
    /// digits around it.
    fn select_word_at(&mut self, offset: usize) {
        let offset = self.clamp(offset..offset).start;
        let wordy = |c: char| c.is_alphanumeric() || c == '_';
        let start = self.text[..offset]
            .char_indices()
            .rev()
            .take_while(|(_, c)| wordy(*c))
            .last()
            .map_or(offset, |(at, _)| at);
        let end = self.text[offset..]
            .char_indices()
            .find(|(_, c)| !wordy(*c))
            .map_or(self.text.len(), |(at, _)| offset + at);
        self.anchor = start;
        self.caret = end;
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

/// What each character of a password is drawn as.
const DOT: &str = "•";

/// A text field.
pub(crate) struct TextInput {
    line: Line,
    /// Text an input method is still composing, as a byte range.
    marked: Option<Range<usize>>,
    placeholder: SharedString,
    /// Whether the text is drawn as dots: a password.
    obscured: bool,
    /// Whether Shift+Enter starts a new line.
    multiline: bool,
    /// Whether a pasted picture is passed on rather than ignored.
    takes_pictures: bool,
    /// Where the text was laid out in the frame last painted: what turns a
    /// pointer position into a place in the text. Empty while there is no
    /// text on screen to point at.
    layout: Rc<RefCell<Option<TextLayout>>>,
    /// Whether the pointer is dragging out a selection.
    selecting: bool,
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
            multiline: false,
            takes_pictures: false,
            layout: Rc::default(),
            selecting: false,
            focus: cx.focus_handle(),
        }
    }

    /// The same field, taking Shift+Enter as a new line.
    /// Pass a pasted picture on as an [`InputEvent::PastedPicture`].
    pub(crate) fn taking_pictures(mut self) -> Self {
        self.takes_pictures = true;
        self
    }

    pub(crate) fn multiline(mut self) -> Self {
        self.multiline = true;
        self
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

    /// Type `text` where the caret is, over what is selected.
    pub(crate) fn type_text(&mut self, text: &str) {
        self.line.insert(text);
        self.marked = None;
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
            "enter" if self.multiline && keystroke.modifiers.shift => {
                self.line.insert("\n");
                true
            }
            "enter" => {
                cx.emit(InputEvent::Submitted(self.line.text.clone()));
                true
            }
            key @ ("up" | "down") if self.multiline => {
                self.move_by_line(key == "down", keystroke.modifiers.shift);
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
                let item = cx.read_from_clipboard();
                // A picture on the clipboard goes to whoever takes them;
                // everything else is text for the field.
                let picture = item
                    .as_ref()
                    .filter(|_| self.takes_pictures)
                    .and_then(|item| {
                        item.entries().iter().find_map(|entry| match entry {
                            gpui::ClipboardEntry::Image(image) => Some(image.bytes.clone()),
                            gpui::ClipboardEntry::String(_) => None,
                        })
                    });
                if let Some(picture) = picture {
                    cx.emit(InputEvent::PastedPicture(picture));
                } else if let Some(pasted) = item.and_then(|item| item.text()) {
                    self.line.insert(&self.pasteable(&pasted));
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

    /// `pasted` as this field takes it: as it is where lines are allowed,
    /// and joined up into one where they are not.
    fn pasteable(&self, pasted: &str) -> String {
        if self.multiline {
            pasted.replace("\r\n", "\n").replace('\r', "\n")
        } else {
            pasted.replace(['\n', '\r'], " ")
        }
    }

    /// The text as drawn: itself, or a dot for each character of a password.
    fn shown(&self, text: &str) -> String {
        if self.obscured {
            DOT.repeat(text.chars().count())
        } else {
            text.to_owned()
        }
    }

    /// An offset in the text as an offset in what is drawn.
    fn text_to_drawn(&self, offset: usize) -> usize {
        if self.obscured {
            self.line.text[..offset].chars().count() * DOT.len()
        } else {
            offset
        }
    }

    /// An offset in what is drawn as an offset in the text.
    fn drawn_to_text(&self, offset: usize) -> usize {
        if !self.obscured {
            return self.line.clamp(offset..offset).start;
        }
        self.line
            .text
            .char_indices()
            .nth(offset / DOT.len())
            .map_or(self.line.text.len(), |(at, _)| at)
    }

    /// The place in the text nearest `position` in the window.
    fn offset_at(&self, position: Point<Pixels>) -> Option<usize> {
        let layout = self.layout.borrow();
        let drawn = match layout.as_ref()?.index_for_position(position) {
            Ok(inside) | Err(inside) => inside,
        };
        Some(self.drawn_to_text(drawn))
    }

    /// Move the caret a line up or down, keeping its column as nearly as
    /// the lines allow. At the first or last line it goes to the very start
    /// or end.
    fn move_by_line(&mut self, down: bool, extend: bool) {
        let target = {
            let layout = self.layout.borrow();
            layout.as_ref().and_then(|layout| {
                let mut at = layout.position_for_index(self.text_to_drawn(self.line.caret))?;
                let line = layout.line_height();
                at.y += if down { line * 1.5 } else { -(line * 0.5) };
                let bounds = layout.bounds();
                (at.y >= bounds.top() && at.y <= bounds.bottom()).then(|| {
                    match layout.index_for_position(at) {
                        Ok(inside) | Err(inside) => inside,
                    }
                })
            })
        };
        let caret = target.map_or(if down { self.line.text.len() } else { 0 }, |drawn| {
            self.drawn_to_text(drawn)
        });
        self.line.move_to(caret, extend);
    }

    fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        window.focus(&self.focus);
        if let Some(offset) = self.offset_at(event.position) {
            match event.click_count {
                // A double click takes the word, a triple click everything.
                2 => self.line.select_word_at(offset),
                3.. => self.line.select_all(),
                _ => self.line.move_to(offset, event.modifiers.shift),
            }
            self.selecting = true;
        }
        cx.notify();
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.selecting {
            return;
        }
        if event.pressed_button != Some(MouseButton::Left) {
            // Released somewhere this field never heard of.
            self.selecting = false;
            return;
        }
        if let Some(offset) = self.offset_at(event.position)
            && offset != self.line.caret
        {
            self.line.move_to(offset, true);
            cx.notify();
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
        _point: Point<Pixels>,
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
        let caret_ink = theme.c.accent_text;
        let empty = self.line.text.is_empty();
        let text = (!empty).then(|| {
            let selection = self.line.selection();
            let selected = self.text_to_drawn(selection.start)..self.text_to_drawn(selection.end);
            let marked = self
                .marked
                .as_ref()
                .map(|range| self.text_to_drawn(range.start)..self.text_to_drawn(range.end));
            StyledText::new(self.shown(&self.line.text)).with_highlights(
                marks(selected, marked)
                    .into_iter()
                    .map(|(range, selected, composing)| {
                        let style = HighlightStyle {
                            background_color: selected.then_some(theme.c.accent_soft),
                            underline: composing.then(|| gpui::UnderlineStyle {
                                thickness: px(1.0),
                                color: Some(caret_ink),
                                wavy: false,
                            }),
                            ..HighlightStyle::default()
                        };
                        (range, style)
                    }),
            )
        });
        // What the pointer can be mapped against: this frame's text, once
        // it has been painted, and nothing while there is none.
        let layout = text.as_ref().map(|text| text.layout().clone());
        if layout.is_none() {
            *self.layout.borrow_mut() = None;
        }
        let painted = Rc::clone(&self.layout);
        let caret_at = self.text_to_drawn(self.line.caret);
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
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _, _, _| this.selecting = false),
            )
            .map(|field| match text {
                Some(text) => field.text_color(theme.c.text).child(text),
                None => field.child(
                    div()
                        .flex()
                        .items_center()
                        // An empty field has no text to measure a caret
                        // against, so its caret is an element of its own.
                        .when(focused, |line| {
                            line.child(div().flex_none().w(px(1.5)).h(px(18.0)).bg(caret_ink))
                        })
                        .child(
                            div()
                                .text_color(theme.c.dim)
                                .child(self.placeholder.clone()),
                        ),
                ),
            })
            // Paints the caret, and is where the field tells the platform,
            // each frame it has focus, that text typed now belongs to it.
            .child(
                canvas(
                    |_, _, _| {},
                    move |bounds, (), window, cx| {
                        window.handle_input(&focus, ElementInputHandler::new(bounds, entity), cx);
                        let Some(layout) = layout else { return };
                        if focused && let Some(origin) = layout.position_for_index(caret_at) {
                            let caret = Bounds::new(origin, size(px(1.5), layout.line_height()));
                            window.paint_quad(fill(caret, caret_ink));
                        }
                        *painted.borrow_mut() = Some(layout);
                    },
                )
                .absolute()
                .size_full(),
            )
    }
}

/// The stretches of drawn text that are selected or being composed, in
/// order and not overlapping, each with which of the two it is.
fn marks(
    selected: Range<usize>,
    composing: Option<Range<usize>>,
) -> Vec<(Range<usize>, bool, bool)> {
    let composing = composing.unwrap_or(0..0);
    let mut cuts = vec![selected.start, selected.end, composing.start, composing.end];
    cuts.sort_unstable();
    cuts.dedup();
    cuts.windows(2)
        .filter_map(|cut| {
            let range = cut[0]..cut[1];
            let within =
                |other: &Range<usize>| other.start <= range.start && range.end <= other.end;
            let (is_selected, is_composing) = (within(&selected), within(&composing));
            (is_selected || is_composing).then_some((range, is_selected, is_composing))
        })
        .collect()
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
    fn a_double_click_takes_the_word_under_it() {
        let mut text = line("say hello_there now", 0);
        text.select_word_at(7);
        assert_eq!(text.selection(), 4..15);
        // On the space between two words: the word that ends there.
        text.select_word_at(3);
        assert_eq!(text.selection(), 0..3);
        let mut accented = line("über cool", 0);
        accented.select_word_at(2);
        assert_eq!(accented.selection(), 0..5, "by character, not by byte");
    }

    #[test]
    fn marked_stretches_are_cut_where_selection_and_composition_meet() {
        assert!(
            marks(3..3, None).is_empty(),
            "nothing selected, nothing composing"
        );
        assert_eq!(marks(2..5, None), [(2..5, true, false)]);
        assert_eq!(
            marks(2..6, Some(4..8)),
            [(2..4, true, false), (4..6, true, true), (6..8, false, true)]
        );
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
