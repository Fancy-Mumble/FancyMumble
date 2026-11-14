//! The bar over a selection in the composer, and the keys that do what its
//! buttons do: driven by clicks and keys against a window in memory.

use gpui::{Entity, Modifiers, TestAppContext, VisualTestContext};

use super::Shell;
use super::emoji::For;
use super::format_bar::FormatBar;
use super::tests::{click, shell};

/// What the composer holds, with what is selected in it between `[` and `]`.
fn typed(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> String {
    shell.read_with(cx, |shell, cx| {
        let field = shell.composer.read(cx);
        let (text, at) = (field.text(), field.selection());
        format!(
            "{}[{}]{}",
            &text[..at.start],
            &text[at.clone()],
            &text[at.end..]
        )
    })
}

/// Empty the composer, type `text` into it and select the `len`
/// characters after the first `from`, with shift and the arrows.
fn write_and_select(cx: &mut VisualTestContext, text: &str, from: usize, len: usize) {
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("ctrl-a backspace");
    cx.simulate_input(text);
    cx.simulate_keystrokes("home");
    for _ in 0..from {
        cx.simulate_keystrokes("right");
    }
    for _ in 0..len {
        cx.simulate_keystrokes("shift-right");
    }
}

/// The tools the bar showed pressed when it was last drawn.
fn pressed(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> Vec<&'static str> {
    shell.read_with(cx, |shell, cx| {
        shell
            .composer
            .read(cx)
            .floating()
            .and_then(|view| view.downcast::<FormatBar>().ok())
            .map(|bar| bar.read(cx).pressed.clone())
            .unwrap_or_default()
    })
}

/// The marks the bar offers, by what the tests call its button, the key
/// that does the same and how the mark is typed.
const MARKS: [(&str, &str, &str); 5] = [
    ("format-bold", "ctrl-b", "**"),
    ("format-italic", "ctrl-i", "*"),
    ("format-underline", "ctrl-u", "__"),
    ("format-strike", "ctrl-shift-x", "~~"),
    ("format-code", "ctrl-e", "`"),
];

#[gpui::test]
fn the_bar_is_over_a_selection_and_goes_with_it(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    write_and_select(cx, "a loud b", 2, 0);
    assert!(
        cx.debug_bounds("format-bar").is_none(),
        "nothing selected: no bar"
    );
    cx.simulate_keystrokes("shift-right shift-right shift-right shift-right");
    assert_eq!(typed(&shell, cx), "a [loud] b");
    let bar = cx.debug_bounds("format-bar").expect("the bar");
    let field = cx
        .debug_bounds("input-Message #lounge")
        .expect("the composer");
    assert!(bar.bottom() < field.top(), "above the composer, not on it");
    let room = cx.update(|window, _| window.viewport_size());
    assert!(
        bar.left() >= gpui::px(0.0) && bar.right() <= room.width,
        "inside the window"
    );
    assert!(bar.top() >= gpui::px(0.0));
    // The selection collapsed: a press where a button was sets nothing.
    let bold = cx.debug_bounds("format-bold").expect("a button");
    cx.simulate_keystrokes("right");
    cx.simulate_click(bold.center(), Modifiers::none());
    cx.run_until_parked();
    assert_eq!(typed(&shell, cx), "a loud[] b");
}

#[gpui::test]
fn each_button_puts_its_mark_round_the_selection_and_takes_it_off(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    for (button, _, mark) in MARKS {
        write_and_select(cx, "a loud b", 2, 4);
        assert!(pressed(&shell, cx).is_empty(), "{button}: nothing on yet");
        click(cx, button);
        assert_eq!(
            typed(&shell, cx),
            format!("a {mark}[loud]{mark} b"),
            "{button}"
        );
        assert_eq!(pressed(&shell, cx), [button], "{button} shows it is on");
        click(cx, button);
        assert_eq!(typed(&shell, cx), "a [loud] b", "{button} takes it off");
        assert!(pressed(&shell, cx).is_empty(), "{button}");
    }
}

#[gpui::test]
fn each_key_does_what_its_button_does_without_the_bar(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    let keys = MARKS.map(|(_, key, mark)| (key, mark));
    for (key, mark) in keys.into_iter().chain([("ctrl-shift-h", "||")]) {
        write_and_select(cx, "a loud b", 2, 4);
        cx.simulate_keystrokes(key);
        assert_eq!(
            typed(&shell, cx),
            format!("a {mark}[loud]{mark} b"),
            "{key}"
        );
        // While writing, the keys the window binds (the column, the
        // members) are the composer's.
        shell.read_with(cx, |shell, _| {
            let window = !shell.panels.members.open && !shell.chrome.column_hidden;
            assert!(window, "{key} is not the window's");
        });
        cx.simulate_keystrokes(key);
        assert_eq!(typed(&shell, cx), "a [loud] b", "{key} again");
    }
}

#[gpui::test]
fn two_marks_in_a_row_and_the_keyboard_stays_with_the_composer(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    write_and_select(cx, "a loud b", 2, 4);
    click(cx, "format-bold");
    click(cx, "format-italic");
    assert_eq!(typed(&shell, cx), "a ***[loud]*** b");
    assert_eq!(pressed(&shell, cx), ["format-bold", "format-italic"]);
    click(cx, "format-bold");
    assert_eq!(typed(&shell, cx), "a *[loud]* b");
    // Neither the keyboard nor the selection went to the bar.
    cx.simulate_input("x");
    assert_eq!(typed(&shell, cx), "a *x[]* b");
}

#[gpui::test]
fn a_partly_marked_selection_is_marked_through_and_part_of_a_run_unmarked(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    // "**lo**ud": half of it is bold, so bold is not pressed, and a press
    // makes all of it bold under one pair of marks.
    write_and_select(cx, "a **lo**ud b", 2, 8);
    assert!(pressed(&shell, cx).is_empty());
    click(cx, "format-bold");
    assert_eq!(typed(&shell, cx), "a **[loud]** b");
    // The same by key.
    write_and_select(cx, "a **lo**ud b", 2, 8);
    cx.simulate_keystrokes("ctrl-b");
    assert_eq!(typed(&shell, cx), "a **[loud]** b");
    // The end of a bold run: bold is pressed, and comes off that end only.
    write_and_select(cx, "**so loud**", 5, 4);
    assert_eq!(pressed(&shell, cx), ["format-bold"]);
    click(cx, "format-bold");
    assert_eq!(typed(&shell, cx), "**so** [loud]");
}

#[gpui::test]
fn the_link_button_asks_for_an_address_and_links_the_words(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    write_and_select(cx, "see the docs", 4, 8);
    click(cx, "format-link");
    assert!(
        cx.debug_bounds("format-link-prompt").is_some(),
        "the address is asked for"
    );
    cx.simulate_input("example.org/guide");
    cx.simulate_keystrokes("enter");
    assert_eq!(
        typed(&shell, cx),
        "see [[the docs]](https://example.org/guide)"
    );
    assert_eq!(
        pressed(&shell, cx),
        ["format-link"],
        "back on the tools, the link on"
    );
    // Pressed again: the words are words again.
    click(cx, "format-link");
    assert_eq!(typed(&shell, cx), "see [the docs]");
    // The same with the button that takes the address.
    click(cx, "format-link");
    cx.simulate_input("http://a.example");
    click(cx, "format-link-add");
    assert_eq!(typed(&shell, cx), "see [[the docs]](http://a.example)");
}

#[gpui::test]
fn escape_from_the_address_leaves_the_text_as_it_was(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    write_and_select(cx, "see the docs", 4, 8);
    click(cx, "format-link");
    cx.simulate_input("example.org");
    cx.simulate_keystrokes("escape");
    assert_eq!(typed(&shell, cx), "see [the docs]");
    // The composer has the keyboard again, its selection kept.
    cx.simulate_input("x");
    assert_eq!(typed(&shell, cx), "see x[]");
    // What cannot be an address is not taken; Escape still leaves.
    write_and_select(cx, "see the docs", 4, 8);
    click(cx, "format-link");
    cx.simulate_input("two words");
    cx.simulate_keystrokes("enter");
    assert_eq!(typed(&shell, cx), "see [the docs]", "nothing linked");
    cx.simulate_keystrokes("escape");
    cx.simulate_input("y");
    assert_eq!(typed(&shell, cx), "see y[]");
}

#[gpui::test]
fn the_emoji_button_opens_the_picker_for_the_composer(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    write_and_select(cx, "a loud b", 2, 4);
    click(cx, "format-emoji");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.emoji_for, Some(For::Composer))
    });
}
