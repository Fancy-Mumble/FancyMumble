//! What somebody types, as the HTML a message is sent as.
//!
//! Mumble's messages are HTML. A person types text, and the marks people
//! use in text for emphasis are turned into it here: `**bold**`, `*italic*`
//! or `_italic_`, `***both***`, `__underlined__`, `~~struck~~`, `||hidden||`
//! until it is asked for, `` `code` ``, a fenced block of code, lines
//! quoted with `>`, and `[words](https://address)` for a link that shows
//! other words than its address. Everything else is escaped and its line breaks
//! kept, so what was not meant as a mark reads as it was typed: `2 * 3 * 4`
//! and `snake_case_name` are left alone.
//!
//! The same reading says how each stretch of what is typed will be set
//! ([`typed`]), for a field that sets it so while it is being typed. One
//! reader, two things it is told to: what the field shows and what is sent
//! cannot come apart.
//!
//! [`source`] goes the other way: a message as its writer would type it, for
//! changing one that was sent.

use std::ops::Range;

/// `text` as HTML.
pub(crate) fn marked(text: &str) -> String {
    let mut html = Html {
        typed: text,
        out: String::with_capacity(text.len() + text.len() / 8),
    };
    Reader::new(text, &mut html).read();
    html.out
}

/// How the stretches of `text` will be set once it is sent, in order and
/// not overlapping. What is set plainly is left out.
#[must_use]
pub fn typed(text: &str) -> Vec<Typed> {
    let mut stretches = Stretches::default();
    Reader::new(text, &mut stretches).read();
    stretches.found
}

/// What, typed, is sent as `html`: a sent message as its writer would type
/// it, to be changed and sent again.
///
/// It is the other way from [`marked`] for what `marked` writes. Of markup
/// it does not write, which another client may have sent, the words are
/// kept and the setting is dropped.
#[must_use]
pub fn source(html: &str) -> String {
    let mut source = Source::default();
    let mut rest = html;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix("<!--") {
            rest = after.split_once("-->").map_or("", |(_, after)| after);
        } else if rest.starts_with('<')
            && rest[1..].starts_with(|c: char| c.is_ascii_alphabetic() || c == '/')
        {
            let (tag, after) = rest[1..].split_once('>').unwrap_or((&rest[1..], ""));
            source.tag(tag);
            rest = after;
        } else if rest.starts_with('&') {
            let (character, after) = entity(rest);
            source.character(character);
            rest = after;
        } else {
            // At least the first character, so this always moves on.
            let first = rest.chars().next().map_or(1, char::len_utf8);
            let end = rest[first..]
                .find(['<', '&'])
                .map_or(rest.len(), |at| at + first);
            rest[..end].chars().for_each(|c| source.character(c));
            rest = &rest[end..];
        }
    }
    source.typed
}

/// Writes what would be typed, from the tags of a message.
#[derive(Default)]
struct Source {
    typed: String,
    /// How many quotations are open: their lines start with the mark.
    quotes: u32,
    /// Inside a block of code, where white space is kept as it is.
    block: bool,
    /// A block has just ended: whatever follows starts a line of its own.
    break_owed: bool,
    /// The `<span>`s open, innermost last: whether each hides its words.
    spans: Vec<bool>,
    /// The `<a>`s open, innermost last: for a link this writes, where its
    /// `[` was written and its address.
    links: Vec<Option<(usize, String)>>,
}

impl Source {
    fn at_line_start(&self) -> bool {
        self.typed.is_empty() || self.typed.ends_with('\n')
    }

    /// End the line. Inside a quotation an empty line still says it is one.
    fn line_break(&mut self) {
        if self.quotes > 0 && self.at_line_start() {
            self.typed.push('>');
        }
        self.typed.push('\n');
    }

    /// Start a line of its own, unless already on one.
    fn own_line(&mut self) {
        if !self.at_line_start() {
            self.typed.push('\n');
        }
        self.break_owed = false;
    }

    /// Before anything is written: pay the break a block left owing, and
    /// start a quoted line with its mark.
    fn settle(&mut self) {
        if self.break_owed {
            self.own_line();
        }
        if self.quotes > 0 && !self.block && self.at_line_start() {
            self.typed.push_str("> ");
        }
    }

    fn character(&mut self, character: char) {
        if self.block {
            self.typed.push(character);
            return;
        }
        // Outside a block of code a line break in markup is only a space.
        let character = if character == '\n' { ' ' } else { character };
        self.settle();
        self.typed.push(character);
    }

    fn mark(&mut self, mark: &str) {
        self.settle();
        self.typed.push_str(mark);
    }

    /// An `<a>` opens: a link this writes, if it goes somewhere one can.
    fn open_link(&mut self, attributes: &str) {
        let address = attribute(attributes, "href").filter(|address| linkable(address));
        let link = address.map(|address| {
            self.mark("[");
            (self.typed.len() - 1, address)
        });
        self.links.push(link);
    }

    /// An `<a>` closes. A link that shows its own address, or nothing, is
    /// typed as its words alone, as it was before it was a link.
    fn close_link(&mut self) {
        let Some(Some((at, address))) = self.links.pop() else {
            return;
        };
        let words = &self.typed[at + 1..];
        let shown = words.trim().is_empty()
            || words == address
            || address.strip_prefix("mailto:") == Some(words);
        if shown {
            self.typed.replace_range(at..=at, "");
        } else {
            self.typed.push_str("](");
            self.typed.push_str(&address);
            self.typed.push(')');
        }
    }

    fn tag(&mut self, tag: &str) {
        let tag = tag.trim_end_matches('/').trim();
        let (closing, tag) = tag
            .strip_prefix('/')
            .map_or((false, tag), |tag| (true, tag));
        let (name, attributes) = tag
            .split_once(|c: char| c.is_whitespace())
            .unwrap_or((tag, ""));
        let name = name.to_ascii_lowercase();
        match name.as_str() {
            "span" if closing => {
                if self.spans.pop() == Some(true) {
                    self.mark("||");
                }
            }
            "span" => {
                let hides = attributes.to_ascii_lowercase().contains("spoiler");
                self.spans.push(hides);
                if hides {
                    self.mark("||");
                }
            }
            "a" if closing => self.close_link(),
            "a" => self.open_link(attributes),
            "u" | "ins" => self.mark("__"),
            "b" | "strong" => self.mark("**"),
            "i" | "em" => self.mark("*"),
            "s" | "del" | "strike" => self.mark("~~"),
            // A block's own `<code>` is the block.
            "code" if !self.block => self.mark("`"),
            "pre" if closing => {
                if !self.typed.ends_with('\n') {
                    self.typed.push('\n');
                }
                self.typed.push_str("```");
                self.block = false;
                self.break_owed = true;
            }
            "pre" => {
                self.own_line();
                self.typed.push_str("```\n");
                self.block = true;
            }
            "blockquote" if closing => {
                self.quotes = self.quotes.saturating_sub(1);
                self.break_owed = true;
            }
            "blockquote" => {
                self.own_line();
                self.quotes += 1;
            }
            "br" if self.block => self.typed.push('\n'),
            "br" => {
                self.break_owed = false;
                self.line_break();
            }
            // Another client's paragraphs and list items: lines of their own.
            "p" | "div" | "li" | "tr" => self.break_owed = !self.typed.is_empty(),
            _ => {}
        }
    }
}

/// The character the entity at the start of `text` stands for, and what
/// follows it. What is not an entity is the ampersand it starts with.
pub(crate) fn entity(text: &str) -> (char, &str) {
    let named = text[1..]
        .split_once(';')
        .filter(|(name, _)| name.len() <= 10);
    let Some((name, after)) = named else {
        return ('&', &text[1..]);
    };
    let character = match name {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some(' '),
        _ => name.strip_prefix('#').and_then(|number| {
            let code = match number.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => number.parse().ok()?,
            };
            char::from_u32(code)
        }),
    };
    character.map_or(('&', &text[1..]), |character| (character, after))
}

/// `text` with its entities read.
pub(crate) fn decoded(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let (character, after) = entity(&rest[at..]);
        out.push(character);
        rest = after;
    }
    out.push_str(rest);
    out
}

/// The value of the attribute `name` among a tag's `attributes`, quoted or
/// not, its entities read.
pub(crate) fn attribute(attributes: &str, name: &str) -> Option<String> {
    let lower = attributes.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find(name).map(|at| at + from) {
        from = at + name.len();
        let whole = lower[..at]
            .chars()
            .next_back()
            .is_none_or(char::is_whitespace);
        let Some(value) = attributes[from..].trim_start().strip_prefix('=') else {
            continue;
        };
        if !whole {
            continue;
        }
        let value = value.trim_start();
        let raw = match value.chars().next() {
            Some(quote @ ('"' | '\'')) => value[1..].split(quote).next().unwrap_or(""),
            _ => value.split(char::is_whitespace).next().unwrap_or(""),
        };
        return Some(decoded(raw));
    }
    None
}

/// The ways of opening a link that a link is written for.
const LINKABLE: &[&str] = &["https://", "http://", "mailto:", "mumble://"];

/// Whether `address` is one a link is written to: it goes somewhere one of
/// [`LINKABLE`] opens, and holds nothing that would end it early.
fn linkable(address: &str) -> bool {
    LINKABLE
        .iter()
        .any(|scheme| address.len() > scheme.len() && address.starts_with(scheme))
        && !address.contains(|c: char| c.is_whitespace() || "\"<>()[]".contains(c))
}

/// A stretch of what was typed, and how it will be set.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Typed {
    /// Where it is in what was typed, in bytes.
    pub range: Range<usize>,
    /// How it will be set.
    pub setting: Setting,
}

/// How a stretch of a message is set.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[allow(
    clippy::struct_excessive_bools,
    reason = "each is a way of setting text, and any may be on with any other"
)]
pub struct Setting {
    /// Heavier.
    pub bold: bool,
    /// Slanted.
    pub italic: bool,
    /// Struck through.
    pub struck: bool,
    /// Underlined.
    pub underlined: bool,
    /// Hidden until the reader asks for it.
    pub hidden: bool,
    /// Code, in a line or in a block of its own.
    pub code: bool,
    /// Quoted from somebody.
    pub quoted: bool,
    /// One of the marks themselves, which the message will not show.
    pub mark: bool,
    /// The words of a link.
    pub linked: bool,
}

/// A way a stretch is set apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Set {
    Bold,
    Italic,
    /// Both of those at once, from the one mark.
    BoldItalic,
    Struck,
    Underlined,
    /// Hidden until the reader asks for it: a spoiler.
    Hidden,
    Code,
    /// A fenced block of code.
    Block,
    Quote,
    /// The words of a link, to the address typed after them: where that is
    /// in what was typed, start and end.
    Link {
        address: (usize, usize),
    },
}

impl Set {
    /// The tags that open and close it. A link's opening tag carries its
    /// address, and is written by [`Html`] itself.
    const fn tags(self) -> (&'static str, &'static str) {
        match self {
            Self::Bold => ("<b>", "</b>"),
            Self::Italic => ("<i>", "</i>"),
            Self::BoldItalic => ("<b><i>", "</i></b>"),
            Self::Struck => ("<s>", "</s>"),
            Self::Underlined => ("<u>", "</u>"),
            Self::Hidden => (r#"<span class="spoiler">"#, "</span>"),
            Self::Code => ("<code>", "</code>"),
            Self::Block => ("<pre><code>", "</code></pre>"),
            Self::Quote => ("<blockquote>", "</blockquote>"),
            Self::Link { .. } => ("<a>", "</a>"),
        }
    }
}

/// What a [`Reader`] tells of what was typed, in the order it stands.
/// Stretches are given as where they are in it, in bytes.
trait Sink {
    /// Text the message shows, as it was typed.
    fn text(&mut self, at: Range<usize>);
    /// A mark, which the message does not show.
    fn mark(&mut self, at: Range<usize>);
    /// What follows is set apart as `set`, until it is closed.
    fn open(&mut self, set: Set);
    /// What was last opened ends here.
    fn close(&mut self, set: Set);
    /// A typed line break that the message keeps.
    fn line_break(&mut self);
}

/// Writes the message.
struct Html<'a> {
    typed: &'a str,
    out: String,
}

impl Sink for Html<'_> {
    fn text(&mut self, at: Range<usize>) {
        for character in self.typed[at].chars() {
            push_escaped(character, &mut self.out);
        }
    }

    fn mark(&mut self, _: Range<usize>) {}

    fn open(&mut self, set: Set) {
        if let Set::Link {
            address: (start, end),
        } = set
        {
            self.out.push_str("<a href=\"");
            for character in self.typed[start..end].chars() {
                push_escaped(character, &mut self.out);
            }
            self.out.push_str("\">");
        } else {
            self.out.push_str(set.tags().0);
        }
    }

    fn close(&mut self, set: Set) {
        self.out.push_str(set.tags().1);
    }

    fn line_break(&mut self) {
        // HTML folds a line break into a space; a typed one is meant.
        self.out.push_str("<br>");
    }
}

/// Notes how each stretch is set.
#[derive(Default)]
struct Stretches {
    /// What is open, innermost last.
    open: Vec<Set>,
    found: Vec<Typed>,
}

impl Stretches {
    fn setting(&self, mark: bool) -> Setting {
        let open = |set| self.open.contains(&set);
        Setting {
            bold: open(Set::Bold) || open(Set::BoldItalic),
            italic: open(Set::Italic) || open(Set::BoldItalic),
            struck: open(Set::Struck),
            underlined: open(Set::Underlined),
            hidden: open(Set::Hidden),
            code: open(Set::Code) || open(Set::Block),
            quoted: open(Set::Quote),
            mark,
            linked: self.open.iter().any(|set| matches!(set, Set::Link { .. })),
        }
    }

    /// Note that `at` is set as `setting`, as one stretch with what came
    /// just before it if that is set the same.
    fn note(&mut self, at: Range<usize>, setting: Setting) {
        if at.is_empty() || setting == Setting::default() {
            return;
        }
        match self.found.last_mut() {
            Some(last) if last.range.end == at.start && last.setting == setting => {
                last.range.end = at.end;
            }
            _ => self.found.push(Typed { range: at, setting }),
        }
    }
}

impl Sink for Stretches {
    fn text(&mut self, at: Range<usize>) {
        self.note(at, self.setting(false));
    }

    fn mark(&mut self, at: Range<usize>) {
        self.note(at, self.setting(true));
    }

    fn open(&mut self, set: Set) {
        self.open.push(set);
    }

    fn close(&mut self, _: Set) {
        let _ = self.open.pop();
    }

    fn line_break(&mut self) {}
}

/// Reads what was typed, a line at a time, and tells a [`Sink`] of it.
struct Reader<'a, S> {
    typed: &'a str,
    /// Where each line is, without the break that ends it.
    lines: Vec<Range<usize>>,
    sink: &'a mut S,
}

impl<'a, S: Sink> Reader<'a, S> {
    fn new(typed: &'a str, sink: &'a mut S) -> Self {
        let mut start = 0;
        let lines = typed
            .split('\n')
            .map(|line| {
                let range = start..start + line.len();
                start = range.end + 1;
                range
            })
            .collect();
        Self { typed, lines, sink }
    }

    fn line(&self, at: usize) -> Option<&'a str> {
        self.lines.get(at).map(|range| &self.typed[range.clone()])
    }

    fn read(mut self) {
        // Whether the next thing written stands on a line of its own
        // already: true at the start, and after a block, which breaks the
        // line itself.
        let mut fresh = true;
        let mut at = 0;
        while let Some(line) = self.lines.get(at).cloned() {
            if let Some(after) = self.fence(at).or_else(|| self.quotation(at)) {
                at = after;
                fresh = true;
                continue;
            }
            if !fresh {
                self.sink.line_break();
            }
            self.inline(line);
            fresh = false;
            at += 1;
        }
    }

    /// The fenced block of code that starts at line `at`, if one does;
    /// returns the line after it. A fence that is never closed is just a
    /// line that says so.
    fn fence(&mut self, at: usize) -> Option<usize> {
        let fenced = |line: &str| line.trim_start().starts_with("```");
        if !self.line(at).is_some_and(fenced) {
            return None;
        }
        let closing =
            (at + 1..self.lines.len()).find(|line| self.line(*line).is_some_and(fenced))?;
        let (opens, closes) = (self.lines[at].clone(), self.lines[closing].clone());
        // The block is the lines between the two, breaks and all; the breaks
        // beside the fences go with the fences.
        let body = if closing == at + 1 {
            closes.start..closes.start
        } else {
            self.lines[at + 1].start..self.lines[closing - 1].end
        };
        self.sink.mark(opens.start..body.start);
        self.sink.open(Set::Block);
        self.sink.text(body.clone());
        self.sink.close(Set::Block);
        self.sink.mark(body.end..closes.end);
        Some(closing + 1)
    }

    /// The quotation that starts at line `at`, if one does: that line and
    /// every quoted line under it. Returns the line after it.
    fn quotation(&mut self, at: usize) -> Option<usize> {
        let mut quoted = self.quoted(at)?;
        let mut line = at;
        self.sink.open(Set::Quote);
        loop {
            self.sink.mark(self.lines[line].start..quoted.start);
            self.inline(quoted);
            line += 1;
            let Some(more) = self.quoted(line) else { break };
            self.sink.line_break();
            quoted = more;
        }
        self.sink.close(Set::Quote);
        Some(line)
    }

    /// What line `at` quotes, if it starts with the quoting mark.
    fn quoted(&self, at: usize) -> Option<Range<usize>> {
        let range = self.lines.get(at)?;
        let rest = self.typed[range.clone()].strip_prefix('>')?;
        let rest = rest.strip_prefix(' ').unwrap_or(rest);
        Some(range.end - rest.len()..range.end)
    }

    /// One stretch of a line, its marks told apart from its text.
    fn inline(&mut self, stretch: Range<usize>) {
        let mut at = stretch.start;
        // What came just before `at`, to tell a mark from a character in
        // the middle of a word.
        let mut before: Option<char> = None;
        while let Some(first) = self.typed[at..stretch.end].chars().next() {
            let rest = &self.typed[at..stretch.end];
            if first == '`'
                && let Some(len) = rest[1..].find('`').filter(|len| *len > 0)
            {
                // Code is not read for marks.
                at = self.set_apart(Set::Code, at, (1, len), false);
                before = Some('`');
            } else if first == '['
                && let Some(link) = linked(rest)
            {
                at = self.link(at, link);
                before = Some(')');
            } else if let Some((mark, set, len)) = opened(rest, before) {
                at = self.set_apart(set, at, (mark.len(), len), true);
                before = mark.chars().next();
            } else {
                self.sink.text(at..at + first.len_utf8());
                before = Some(first);
                at += first.len_utf8();
            }
        }
    }

    /// Tell of a stretch set apart as `set` between two marks, the first of
    /// them at `at`; `(mark, len)` is how long a mark is and how long the
    /// stretch between them. `read` is whether the stretch is itself read
    /// for marks. Returns where the second mark ends.
    fn set_apart(&mut self, set: Set, at: usize, (mark, len): (usize, usize), read: bool) -> usize {
        let inside = at + mark..at + mark + len;
        self.sink.mark(at..inside.start);
        self.sink.open(set);
        if read {
            self.inline(inside.clone());
        } else {
            self.sink.text(inside.clone());
        }
        self.sink.close(set);
        self.sink.mark(inside.end..inside.end + mark);
        inside.end + mark
    }

    /// Tell of the link at `at`: its words, read for marks, between `[`
    /// and `](address)`. `(words, address)` is how long its words are and
    /// where its address is from `at`. Returns where it ends.
    fn link(&mut self, at: usize, (words, address): (usize, Range<usize>)) -> usize {
        let inside = at + 1..at + 1 + words;
        let set = Set::Link {
            address: (at + address.start, at + address.end),
        };
        self.sink.mark(at..inside.start);
        self.sink.open(set);
        self.inline(inside.clone());
        self.sink.close(set);
        let end = at + address.end + 1;
        self.sink.mark(inside.end..end);
        end
    }
}

/// The link `rest` starts with, if it is one: how long its words are, and
/// where its address is in `rest`. The words are not empty and hold no
/// other link; the address is one a link is written to.
fn linked(rest: &str) -> Option<(usize, Range<usize>)> {
    let after = rest.strip_prefix('[')?;
    let words = after.find("](")?;
    let said = &after[..words];
    if said.trim().is_empty() || said.contains('[') {
        return None;
    }
    let start = 1 + words + "](".len();
    let len = rest[start..].find(')')?;
    linkable(&rest[start..start + len]).then_some((words, start..start + len))
}

fn push_escaped(character: char, out: &mut String) {
    match character {
        '&' => out.push_str("&amp;"),
        '<' => out.push_str("&lt;"),
        '>' => out.push_str("&gt;"),
        other => out.push(other),
    }
}

/// The marks that open and close a stretch, longest first, with how each
/// sets it.
const MARKS: &[(&str, Set)] = &[
    ("***", Set::BoldItalic),
    ("**", Set::Bold),
    ("~~", Set::Struck),
    ("||", Set::Hidden),
    ("__", Set::Underlined),
    ("*", Set::Italic),
    ("_", Set::Italic),
];

/// The mark `rest` opens with, how it sets its stretch and how long the
/// stretch inside it is, if it is one: it has something in it, with no space
/// just inside either end, and an underscore marks whole words only.
fn opened(rest: &str, before: Option<char>) -> Option<(&'static str, Set, usize)> {
    let (mark, set) = MARKS.iter().find(|(mark, _)| rest.starts_with(mark))?;
    let wordy = |c: char| c.is_alphanumeric();
    // Underscores join words in names: they mark whole words only, and one
    // that follows another that was not a mark is not one either.
    let underscores = mark.starts_with('_');
    if underscores && before.is_some_and(|c| wordy(c) || c == '_') {
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
        let whole_word = !underscores || !after.is_some_and(wordy);
        // A single mark closing against a double one is the double's.
        let not_longer = mark.len() > 1 || !after.is_some_and(|next| mark.starts_with(next));
        if !stretch.is_empty() && ends_cleanly && whole_word && not_longer {
            return Some((mark, *set, at));
        }
        from = at + mark.len();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sent_message_reads_back_as_it_was_typed() {
        for typed in [
            "plain, with a < b & c > d",
            "one\ntwo\n\nfour",
            "**bold** and *italic* and ***both***",
            "~~not~~ `x < y` and **very *much* so**",
            "__under__ and ||the ending|| and **||both||**",
            "> quoted\n> on two lines\nand then not",
            "> a\n>\n> b",
            "see:\n```\nlet a = *b;\n  if a < 1 {}\n```\ndone",
            "```\none\n```",
            "2 * 3 * 4 and snake_case_name",
            "see [the docs](https://example.org/a?b=1&c=2) and [**this**](mailto:a@b.example)",
        ] {
            assert_eq!(source(&marked(typed)), typed, "{typed}");
        }
        // An underscore's italic comes back as a star's: sent the same.
        assert_eq!(source(&marked("_so_")), "*so*");
        assert_eq!(marked(&source(&marked("_so_"))), marked("_so_"));
    }

    #[test]
    fn another_clients_markup_keeps_its_words_and_loses_what_is_not_typed() {
        assert_eq!(
            source(
                r#"<p>Hello <span style="color:red">there</span></p><p><strong>you</strong> &amp; <u>me</u></p>"#
            ),
            "Hello there\n**you** & __me__"
        );
        // A mark that says what is answered is not part of what was typed.
        assert_eq!(source("<!-- FANCY_QUOTE:abc -->fine"), "fine");
        assert_eq!(source("a&nbsp;b &#228; &bogus; &"), "a b ä &bogus; &");
    }

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
        assert_eq!(
            marked("__under__ ||secret||"),
            r#"<u>under</u> <span class="spoiler">secret</span>"#
        );
        // One underscore each side is still italic, two are underlined.
        assert_eq!(marked("_a_ __b__"), "<i>a</i> <u>b</u>");
        // Three stars are both at once, and each pair still closes its own.
        assert_eq!(marked("***both***"), "<b><i>both</i></b>");
        assert_eq!(marked("**bold***italic*"), "<b>bold</b><i>italic</i>");
        // Code is not read for marks.
        assert_eq!(marked("`**no**`"), "<code>**no**</code>");
    }

    #[test]
    fn what_is_not_a_mark_is_left_as_typed() {
        for plain in [
            "2 * 3 * 4",
            "snake_case_name and file_name.rs",
            "a ** b",
            "a *** b",
            "*",
            "**",
            "***",
            "* list item",
            "unclosed *star",
            "5 ~ 6",
            "a || b",
            "||",
            "if a||b",
            "file__name__here and snake__case",
            "_",
            "__",
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
    fn a_link_shows_its_words_and_goes_to_its_address() {
        assert_eq!(
            marked("see [the *docs*](https://example.org/a?b=1&c=2)."),
            r#"see <a href="https://example.org/a?b=1&amp;c=2">the <i>docs</i></a>."#
        );
        assert_eq!(
            marked("**[x](mumble://host:64738)**"),
            r#"<b><a href="mumble://host:64738">x</a></b>"#
        );
        // What is not a link to somewhere a link goes is typed text.
        for plain in [
            "[a](b)",
            "[](https://x.example)",
            "[ ](https://x.example)",
            "[a](ftp://x.example)",
            "[a](javascript:alert(1))",
            "[a] (https://x.example)",
            "[a](https://x.example y)",
            "[a](https://)",
            "[a]\n(https://x.example)",
            "[a](https://x.example",
            "`[a](https://x.example)`",
        ] {
            assert!(!marked(plain).contains("<a"), "{plain}");
        }
        assert_eq!(marked("[a](b)"), "[a](b)");
    }

    #[test]
    fn a_link_reads_back_as_typed_and_one_showing_its_address_as_that() {
        assert_eq!(
            source(r#"see <a href='https://x.example/?a=1&amp;b=2'>the docs</a>"#),
            "see [the docs](https://x.example/?a=1&b=2)"
        );
        // Another client's link to its own address, or to nowhere a link
        // goes, is its words: what `source` always made of an `<a>`.
        assert_eq!(
            source(r#"<a href="https://x.example">https://x.example</a>"#),
            "https://x.example"
        );
        assert_eq!(
            source(r#"<a href="mailto:a@b.example">a@b.example</a>"#),
            "a@b.example"
        );
        assert_eq!(
            source(r#"<a href="javascript:alert(1)">click</a>"#),
            "click"
        );
        assert_eq!(source("<a name=top>top</a>"), "top");
        assert_eq!(source(r#"<a HREF="https://x.example"></a>after"#), "after");
        assert_eq!(
            source(r#"<a data-href="no" href="https://y.example">y</a>"#),
            "[y](https://y.example)"
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

    /// The stretches of `text` as what is there and how it is set.
    fn stretches(text: &str) -> Vec<(&str, Setting)> {
        typed(text)
            .into_iter()
            .map(|typed| (&text[typed.range], typed.setting))
            .collect()
    }

    const PLAIN: Setting = Setting {
        bold: false,
        italic: false,
        struck: false,
        underlined: false,
        hidden: false,
        code: false,
        quoted: false,
        mark: false,
        linked: false,
    };
    const MARK: Setting = Setting {
        mark: true,
        ..PLAIN
    };
    const BOLD: Setting = Setting {
        bold: true,
        ..PLAIN
    };
    const CODE: Setting = Setting {
        code: true,
        ..PLAIN
    };

    #[test]
    fn what_is_typed_is_set_as_it_will_be_sent() {
        assert_eq!(
            stretches("a **b** c"),
            [("**", MARK), ("b", BOLD), ("**", MARK)]
        );
        let struck = Setting {
            struck: true,
            ..PLAIN
        };
        assert_eq!(
            stretches("`**no**` ~~x~~"),
            [
                ("`", MARK),
                ("**no**", CODE),
                ("`", MARK),
                ("~~", MARK),
                ("x", struck),
                ("~~", MARK),
            ]
        );
        // One inside the other: the inner's marks are set as the outer is.
        let (both, inner_mark) = (
            Setting {
                italic: true,
                ..BOLD
            },
            Setting { mark: true, ..BOLD },
        );
        assert_eq!(
            stretches("**very *much* so**"),
            [
                ("**", MARK),
                ("very ", BOLD),
                ("*", inner_mark),
                ("much", both),
                ("*", inner_mark),
                (" so", BOLD),
                ("**", MARK),
            ]
        );
    }

    #[test]
    fn a_links_words_are_set_as_linked_and_its_brackets_and_address_as_marks() {
        let linked = Setting {
            linked: true,
            ..PLAIN
        };
        let (mark, bold) = (
            Setting {
                mark: true,
                ..linked
            },
            Setting {
                bold: true,
                ..linked
            },
        );
        assert_eq!(
            stretches("[a **b**](https://x.example)"),
            [
                ("[", MARK),
                ("a ", linked),
                ("**", mark),
                ("b", bold),
                ("**", mark),
                ("](https://x.example)", MARK),
            ]
        );
    }

    #[test]
    fn what_is_not_a_mark_is_not_set_at_all() {
        for plain in [
            "2 * 3 * 4",
            "snake_case_name",
            "unclosed *star",
            "",
            "```\nlet a",
        ] {
            assert_eq!(typed(plain), [], "{plain}");
        }
    }

    #[test]
    fn a_fence_and_a_quotation_are_set_with_their_marks_apart() {
        assert_eq!(
            stretches("see:\n```rust\nlet a = *b;\n```\ndone"),
            [("```rust\n", MARK), ("let a = *b;", CODE), ("\n```", MARK)]
        );
        assert_eq!(stretches("```\n```"), [("```\n```", MARK)]);
        let quoted = Setting {
            quoted: true,
            ..PLAIN
        };
        let quoting = Setting {
            mark: true,
            ..quoted
        };
        assert_eq!(
            stretches("> first\n>second\nand me"),
            [
                ("> ", quoting),
                ("first", quoted),
                (">", quoting),
                ("second", quoted),
            ]
        );
    }

    #[test]
    fn stretches_fall_on_whole_characters_in_order() {
        let text = "ä **ß** `é` > ü\n> **ö**\n```\nñ\n```";
        let mut end = 0;
        for typed in typed(text) {
            assert!(typed.range.start >= end, "in order, not overlapping");
            assert!(text.is_char_boundary(typed.range.start));
            assert!(text.is_char_boundary(typed.range.end));
            end = typed.range.end;
        }
        assert_eq!(
            marked(text),
            "ä <b>ß</b> <code>é</code> &gt; ü<blockquote><b>ö</b></blockquote><pre><code>ñ</code></pre>"
        );
    }
}
