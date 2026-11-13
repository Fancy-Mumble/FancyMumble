//! What somebody types, as the HTML a message is sent as.
//!
//! Mumble's messages are HTML. A person types text, and the marks people
//! use in text for emphasis are turned into it here: `**bold**`, `*italic*`
//! or `_italic_`, `~~struck~~`, `` `code` ``, a fenced block of code, and
//! lines quoted with `>`. Everything else is escaped and its line breaks
//! kept, so what was not meant as a mark reads as it was typed: `2 * 3 * 4`
//! and `snake_case_name` are left alone.

/// `text` as HTML.
pub(crate) fn marked(text: &str) -> String {
    let mut html = String::with_capacity(text.len() + text.len() / 8);
    let mut lines = text.split('\n').peekable();
    // Whether the next thing written stands on a line of its own already:
    // true at the start, and after a block, which breaks the line itself.
    let mut fresh = true;
    while let Some(line) = lines.next() {
        if line.trim_start().starts_with("```") {
            // A fence that is never closed is just a line that says so.
            let mut body: Vec<&str> = Vec::new();
            let mut closed = false;
            let mut ahead = lines.clone();
            for inside in ahead.by_ref() {
                if inside.trim_start().starts_with("```") {
                    closed = true;
                    break;
                }
                body.push(inside);
            }
            if closed {
                lines = ahead;
                html.push_str("<pre><code>");
                html.push_str(&escaped(&body.join("\n")));
                html.push_str("</code></pre>");
                fresh = true;
                continue;
            }
        }
        if let Some(quoted) = quote(line) {
            html.push_str("<blockquote>");
            inline(quoted, &mut html);
            while let Some(more) = lines.peek().and_then(|next| quote(next)) {
                let _ = lines.next();
                html.push_str("<br>");
                inline(more, &mut html);
            }
            html.push_str("</blockquote>");
            fresh = true;
            continue;
        }
        if !fresh {
            // HTML folds a line break into a space; a typed one is meant.
            html.push_str("<br>");
        }
        inline(line, &mut html);
        fresh = false;
    }
    html
}

/// What a line quotes, if it starts with the quoting mark.
fn quote(line: &str) -> Option<&str> {
    let rest = line.strip_prefix('>')?;
    Some(rest.strip_prefix(' ').unwrap_or(rest))
}

/// `text` with what HTML would read as markup made literal.
fn escaped(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        push_escaped(character, &mut out);
    }
    out
}

fn push_escaped(character: char, out: &mut String) {
    match character {
        '&' => out.push_str("&amp;"),
        '<' => out.push_str("&lt;"),
        '>' => out.push_str("&gt;"),
        other => out.push(other),
    }
}

/// The marks that open and close a stretch, longest first, with the tag
/// each becomes.
const MARKS: &[(&str, &str)] = &[("**", "b"), ("~~", "s"), ("*", "i"), ("_", "i")];

/// One line, its marks turned into tags, written onto `out`.
fn inline(line: &str, out: &mut String) {
    let mut rest = line;
    // What came just before `rest`, to tell a mark from a character in the
    // middle of a word.
    let mut before: Option<char> = None;
    while let Some(first) = rest.chars().next() {
        if first == '`'
            && let Some(len) = rest[1..].find('`').filter(|len| *len > 0)
        {
            out.push_str("<code>");
            out.push_str(&escaped(&rest[1..=len]));
            out.push_str("</code>");
            rest = &rest[len + 2..];
            before = Some('`');
            continue;
        }
        if let Some((mark, tag, len)) = opened(rest, before) {
            out.push('<');
            out.push_str(tag);
            out.push('>');
            inline(&rest[mark.len()..mark.len() + len], out);
            out.push_str("</");
            out.push_str(tag);
            out.push('>');
            rest = &rest[mark.len() * 2 + len..];
            before = mark.chars().next();
            continue;
        }
        push_escaped(first, out);
        before = Some(first);
        rest = &rest[first.len_utf8()..];
    }
}

/// The mark `rest` opens with, the tag it becomes and how long the stretch
/// inside it is, if it is one: it has something in it, with no space just
/// inside either end, and an underscore marks whole words only.
fn opened(rest: &str, before: Option<char>) -> Option<(&'static str, &'static str, usize)> {
    let (mark, tag) = MARKS.iter().find(|(mark, _)| rest.starts_with(mark))?;
    let wordy = |c: char| c.is_alphanumeric();
    if *mark == "_" && before.is_some_and(wordy) {
        return None;
    }
    let inside = &rest[mark.len()..];
    if inside.chars().next().is_none_or(char::is_whitespace) {
        return None;
    }
    let mut from = 0;
    while let Some(at) = inside[from..].find(mark).map(|at| at + from) {
        let stretch = &inside[..at];
        let after = inside[at + mark.len()..].chars().next();
        let ends_cleanly = stretch
            .chars()
            .next_back()
            .is_some_and(|c| !c.is_whitespace());
        let whole_word = *mark != "_" || !after.is_some_and(wordy);
        // A single star closing against a double one is the double's.
        let not_longer = *mark != "*" || after != Some('*');
        if !stretch.is_empty() && ends_cleanly && whole_word && not_longer {
            return Some((mark, tag, at));
        }
        from = at + mark.len();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_is_escaped_and_its_lines_kept() {
        assert_eq!(marked("a < b & c > d"), "a &lt; b &amp; c &gt; d");
        assert_eq!(marked("one\ntwo\n\nfour"), "one<br>two<br><br>four");
        assert_eq!(marked(""), "");
    }

    #[test]
    fn marks_become_tags() {
        assert_eq!(
            marked("**bold** and *italic*"),
            "<b>bold</b> and <i>italic</i>"
        );
        assert_eq!(
            marked("_so_ ~~not~~ `x < y`"),
            "<i>so</i> <s>not</s> <code>x &lt; y</code>"
        );
        assert_eq!(marked("**very *much* so**"), "<b>very <i>much</i> so</b>");
        // Code is not read for marks.
        assert_eq!(marked("`**no**`"), "<code>**no**</code>");
    }

    #[test]
    fn what_is_not_a_mark_is_left_as_typed() {
        for plain in [
            "2 * 3 * 4",
            "snake_case_name and file_name.rs",
            "a ** b",
            "*",
            "**",
            "* list item",
            "unclosed *star",
            "5 ~ 6",
            "it`s",
            "``",
        ] {
            assert_eq!(marked(plain), plain, "{plain}");
        }
        assert_eq!(
            marked("https://example.org/a_b_c"),
            "https://example.org/a_b_c"
        );
    }

    #[test]
    fn a_fence_is_a_block_of_code_kept_as_it_is() {
        assert_eq!(
            marked("see:\n```rust\nlet a = *b;\n  if a < 1 {}\n```\ndone"),
            "see:<pre><code>let a = *b;\n  if a &lt; 1 {}</code></pre>done"
        );
        // Never closed: nothing to make a block of.
        assert_eq!(marked("```\nlet a"), "```<br>let a");
    }

    #[test]
    fn quoted_lines_are_one_quotation() {
        assert_eq!(
            marked("> first\n>second **line**\nand me"),
            "<blockquote>first<br>second <b>line</b></blockquote>and me"
        );
        assert_eq!(marked("a > b"), "a &gt; b");
    }
}
