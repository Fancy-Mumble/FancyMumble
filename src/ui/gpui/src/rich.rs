//! A chat message's HTML, as the runs of text this view draws.
//!
//! Message bodies are HTML on the wire. What a chat message really uses of
//! it is small - emphasis, code, links, line breaks, the odd list, and
//! pictures pasted in as `data:` URIs - and that is what this reads. Anything
//! else contributes its text and nothing more; nothing is ever executed or
//! fetched.

use std::ops::Range;

/// How a stretch of text is set.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Style {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub code: bool,
    /// Somebody is named here: a mention.
    pub mention: bool,
}

/// A message, ready to draw.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Rich {
    /// The visible text, with line breaks as `\n`.
    pub text: String,
    /// Where the text is set differently, in order and not overlapping.
    pub spans: Vec<(Range<usize>, Style)>,
    /// Where the text is a link, and where each one leads.
    pub links: Vec<(Range<usize>, String)>,
    /// Pictures embedded in the message, as the encoded bytes of each.
    pub images: Vec<Vec<u8>>,
}

/// Schemes a link may open. Anything else is drawn as plain text: a chat
/// message does not get to start arbitrary handlers on the reader's machine.
const OPENABLE: &[&str] = &["https://", "http://", "mailto:", "mumble://"];

impl Rich {
    /// Read `html`.
    pub(crate) fn parse(html: &str) -> Self {
        let mut reader = Reader::default();
        let mut rest = html;
        while !rest.is_empty() {
            if let Some(after) = rest.strip_prefix("<!--") {
                rest = after.split_once("-->").map_or("", |(_, after)| after);
            } else if rest.starts_with('<')
                && rest[1..].starts_with(|c: char| c.is_ascii_alphabetic() || c == '/')
            {
                let (tag, after) = rest[1..].split_once('>').unwrap_or((&rest[1..], ""));
                rest = reader.tag(tag, after);
            } else if rest.starts_with('&') {
                let (character, after) = entity(rest);
                reader.push(character);
                rest = after;
            } else {
                // At least the first character, whatever it is, so this always
                // moves on - on a character boundary.
                let first = rest.chars().next().map_or(1, char::len_utf8);
                let end = rest[first..]
                    .find(['<', '&'])
                    .map_or(rest.len(), |at| at + first);
                reader.text(&rest[..end]);
                rest = &rest[end..];
            }
        }
        reader.finish()
    }
}

#[derive(Default)]
struct Reader {
    out: Rich,
    /// How many of each styling tag are open.
    bold: u32,
    italic: u32,
    underline: u32,
    strike: u32,
    code: u32,
    /// Inside `<pre>`: white space is kept as written.
    pre: u32,
    /// The `<span>`s open, innermost last: whether each is a mention.
    spans: Vec<bool>,
    /// The link being read: where it started, and where it leads.
    link: Option<(usize, String)>,
    /// The style in force, and where it began.
    run: (usize, Style),
    /// A break owed before the next text: block elements ask for one, and it
    /// is only paid if text follows, so a message never ends in blank lines.
    break_owed: bool,
}

impl Reader {
    fn style(&self) -> Style {
        Style {
            bold: self.bold > 0,
            italic: self.italic > 0,
            underline: self.underline > 0,
            strike: self.strike > 0,
            code: self.code > 0 || self.pre > 0,
            mention: self.spans.contains(&true),
        }
    }

    /// Close the run in force if the style has changed.
    fn restyle(&mut self) {
        let now = self.style();
        let (start, style) = self.run;
        if now == style {
            return;
        }
        let end = self.out.text.len();
        if end > start && style != Style::default() {
            self.out.spans.push((start..end, style));
        }
        self.run = (end, now);
    }

    fn push(&mut self, character: char) {
        if self.break_owed {
            self.break_owed = false;
            if !self.out.text.is_empty() {
                self.out.text.push('\n');
                self.run.0 = self.run.0.max(self.out.text.len());
            }
        }
        self.out.text.push(character);
    }

    /// Text between tags: outside `<pre>`, runs of white space are one space.
    fn text(&mut self, text: &str) {
        if self.pre > 0 {
            text.chars().for_each(|c| self.push(c));
            return;
        }
        for character in text.chars() {
            if character.is_whitespace() {
                let at_start = self.out.text.is_empty() || self.break_owed;
                if !at_start && !self.out.text.ends_with([' ', '\n']) {
                    self.push(' ');
                }
            } else {
                self.push(character);
            }
        }
    }

    fn line_break(&mut self) {
        if !self.out.text.is_empty() {
            self.out.text.push('\n');
        }
    }

    /// Handle the tag `<tag>`; returns what is left to read after it.
    fn tag<'a>(&mut self, tag: &str, after: &'a str) -> &'a str {
        let tag = tag.trim_end_matches('/').trim();
        let (closing, tag) = tag
            .strip_prefix('/')
            .map_or((false, tag), |tag| (true, tag));
        let (name, attributes) = tag
            .split_once(|c: char| c.is_whitespace())
            .unwrap_or((tag, ""));
        let name = name.to_ascii_lowercase();
        let count = |open: &mut u32| {
            *open = if closing {
                open.saturating_sub(1)
            } else {
                *open + 1
            };
        };
        match name.as_str() {
            "b" | "strong" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                if name.starts_with('h') {
                    self.break_owed = true;
                }
                count(&mut self.bold);
            }
            "i" | "em" => count(&mut self.italic),
            "u" | "ins" => count(&mut self.underline),
            "s" | "del" | "strike" => count(&mut self.strike),
            "code" | "tt" | "kbd" => count(&mut self.code),
            "pre" => {
                self.break_owed = true;
                count(&mut self.pre);
            }
            "br" => self.line_break(),
            "p" | "div" | "ul" | "ol" | "blockquote" | "tr" | "table" => self.break_owed = true,
            "li" if !closing => {
                self.break_owed = true;
                self.restyle();
                self.push('•');
                self.push(' ');
            }
            "span" if closing => drop(self.spans.pop()),
            "span" => self
                .spans
                .push(attributes.to_ascii_lowercase().contains("data-mention-")),
            "a" => self.anchor(closing, attributes),
            "img" if !closing => self.image(attributes),
            // Their contents are not text to show.
            "script" | "style" | "head" | "title" if !closing => {
                return skip_element(after, &name);
            }
            _ => {}
        }
        self.restyle();
        after
    }

    fn anchor(&mut self, closing: bool, attributes: &str) {
        if !closing {
            self.link = attribute(attributes, "href")
                .filter(|href| OPENABLE.iter().any(|scheme| href.starts_with(scheme)))
                .map(|href| (self.out.text.len() + usize::from(self.break_owed), href));
            return;
        }
        if let Some((start, href)) = self.link.take() {
            let start = start.min(self.out.text.len());
            if self.out.text.len() > start {
                self.out.links.push((start..self.out.text.len(), href));
            }
        }
    }

    /// A picture: embedded ones are kept to be drawn; a linked one is named,
    /// since nothing is fetched on a message's say-so.
    fn image(&mut self, attributes: &str) {
        let source = attribute(attributes, "src").unwrap_or_default();
        if let Some(bytes) = embedded_picture(&source) {
            self.out.images.push(bytes);
            return;
        }
        let name = attribute(attributes, "alt").filter(|alt| !alt.is_empty());
        self.text(&format!("[{}]", name.as_deref().unwrap_or("image")));
    }

    fn finish(mut self) -> Rich {
        // Close the last run by pretending the style ends.
        self.bold = 0;
        self.italic = 0;
        self.underline = 0;
        self.strike = 0;
        self.code = 0;
        self.pre = 0;
        self.spans.clear();
        self.restyle();
        if let Some((start, href)) = self.link.take()
            && self.out.text.len() > start
        {
            self.out.links.push((start..self.out.text.len(), href));
        }
        let trimmed = self.out.text.trim_end().len();
        self.out.text.truncate(trimmed);
        self.out.spans.retain_mut(|(range, _)| {
            range.end = range.end.min(trimmed);
            range.start < range.end
        });
        self.out.links.retain_mut(|(range, _)| {
            range.end = range.end.min(trimmed);
            range.start < range.end
        });
        link_bare_addresses(&mut self.out);
        self.out
    }
}

/// What follows the element `name`, whose contents are skipped.
fn skip_element<'a>(after: &'a str, name: &str) -> &'a str {
    let closing = format!("</{name}");
    let lower = after.to_ascii_lowercase();
    let Some(at) = lower.find(&closing) else {
        return "";
    };
    after[at..].split_once('>').map_or("", |(_, rest)| rest)
}

/// The value of `name` among a tag's attributes, with entities decoded.
fn attribute(attributes: &str, name: &str) -> Option<String> {
    let lower = attributes.to_ascii_lowercase();
    let mut from = 0;
    while let Some(found) = lower[from..].find(name) {
        let at = from + found;
        from = at + name.len();
        let boundary = at == 0 || lower.as_bytes()[at - 1].is_ascii_whitespace();
        let Some(value) = attributes[from..].trim_start().strip_prefix('=') else {
            continue;
        };
        if !boundary {
            continue;
        }
        let value = value.trim_start();
        let raw = match value.chars().next() {
            Some(quote @ ('"' | '\'')) => value[1..].split(quote).next().unwrap_or(""),
            _ => value
                .split(|c: char| c.is_whitespace())
                .next()
                .unwrap_or(""),
        };
        return Some(decode_entities(raw));
    }
    None
}

fn decode_entities(text: &str) -> String {
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

/// The character the entity at the start of `text` stands for, and what
/// follows it. Something that is not an entity is the ampersand it starts
/// with.
fn entity(text: &str) -> (char, &str) {
    let Some((name, after)) = text[1..]
        .split_once(';')
        .filter(|(name, _)| name.len() <= 10)
    else {
        return ('&', &text[1..]);
    };
    let character = match name {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some('\u{a0}'),
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

/// The bytes of a picture given as a base64 `data:` URI.
pub(crate) fn embedded_picture(source: &str) -> Option<Vec<u8>> {
    use base64::Engine as _;

    let data = source.strip_prefix("data:image/")?;
    let (kind, encoded) = data.split_once(',')?;
    if !kind.ends_with(";base64") {
        return None;
    }
    // Encoders wrap long lines, and a URI may have been percent-encoded.
    let encoded: String = encoded
        .replace("%2B", "+")
        .replace("%2F", "/")
        .replace("%3D", "=")
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()
        .filter(|bytes| !bytes.is_empty())
}

/// Make links of addresses written out in the text, where the message did
/// not already make them one.
fn link_bare_addresses(rich: &mut Rich) {
    let mut found = Vec::new();
    let mut from = 0;
    while let Some(at) = ["https://", "http://"]
        .iter()
        .filter_map(|scheme| rich.text[from..].find(scheme))
        .min()
    {
        let start = from + at;
        let length = rich.text[start..]
            .find(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '"'))
            .unwrap_or(rich.text.len() - start);
        // Punctuation that ends a sentence is not part of the address.
        let address =
            rich.text[start..start + length].trim_end_matches(['.', ',', ')', '!', '?', ';', ':']);
        let range = start..start + address.len();
        from = start + length.max(1);
        let taken = rich
            .links
            .iter()
            .any(|(link, _)| link.start < range.end && range.start < link.end);
        if !taken && address.contains('.') {
            found.push((range, address.to_owned()));
        }
    }
    rich.links.extend(found);
    rich.links.sort_by_key(|(range, _)| range.start);
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOLD: Style = Style {
        bold: true,
        italic: false,
        underline: false,
        strike: false,
        code: false,
        mention: false,
    };

    #[test]
    fn plain_text_is_itself() {
        let rich = Rich::parse("hello there");
        assert_eq!(rich.text, "hello there");
        assert!(rich.spans.is_empty() && rich.links.is_empty() && rich.images.is_empty());
    }

    #[test]
    fn entities_become_their_characters() {
        assert_eq!(
            Rich::parse("1 &lt; 2 &amp;&amp; 3 &gt; 2").text,
            "1 < 2 && 3 > 2"
        );
        assert_eq!(Rich::parse("&#228;&#x1F600;&quot;").text, "ä😀\"");
        assert_eq!(
            Rich::parse("AT&T & co; &bogus; &").text,
            "AT&T & co; &bogus; &"
        );
    }

    #[test]
    fn emphasis_is_a_span_over_exactly_its_text() {
        let rich = Rich::parse("a <b>bold</b> and <i>slanted <b>both</b></i> word");
        assert_eq!(rich.text, "a bold and slanted both word");
        let italic = Style {
            italic: true,
            ..Style::default()
        };
        let both = Style {
            italic: true,
            ..BOLD
        };
        assert_eq!(rich.spans, [(2..6, BOLD), (11..19, italic), (19..23, both)]);
    }

    #[test]
    fn an_unclosed_tag_styles_to_the_end() {
        let rich = Rich::parse("so <strong>loud");
        assert_eq!(rich.text, "so loud");
        assert_eq!(rich.spans, [(3..7, BOLD)]);
    }

    #[test]
    fn breaks_and_blocks_become_lines_without_trailing_blanks() {
        assert_eq!(Rich::parse("one<br>two<br/>three").text, "one\ntwo\nthree");
        assert_eq!(Rich::parse("<p>one</p><p>two</p>").text, "one\ntwo");
        assert_eq!(
            Rich::parse("<div>one</div>\n<div>two</div><br><br>").text,
            "one\ntwo"
        );
        assert_eq!(
            Rich::parse("list:<ul><li>a</li><li>b</li></ul>").text,
            "list:\n• a\n• b"
        );
    }

    #[test]
    fn white_space_collapses_except_in_pre() {
        assert_eq!(
            Rich::parse("  a   lot\n of   space ").text,
            "a lot of space"
        );
        let pre = Rich::parse("<pre>fn x() {\n    1\n}</pre>");
        assert_eq!(pre.text, "fn x() {\n    1\n}");
        assert!(pre.spans[0].1.code);
    }

    #[test]
    fn a_link_keeps_its_text_and_its_destination() {
        let rich = Rich::parse(r#"see <a href="https://example.org/a?b=1&amp;c=2">the docs</a>."#);
        assert_eq!(rich.text, "see the docs.");
        assert_eq!(
            rich.links,
            [(4..12, "https://example.org/a?b=1&c=2".to_owned())]
        );
    }

    #[test]
    fn a_link_that_would_run_something_is_only_text() {
        let rich = Rich::parse(
            r#"<a href="javascript:alert(1)">click</a> <a href="file:///etc/passwd">x</a>"#,
        );
        assert_eq!(rich.text, "click x");
        assert!(rich.links.is_empty());
    }

    #[test]
    fn a_written_out_address_becomes_a_link_once() {
        let rich = Rich::parse("go to https://example.org/x, then http://b.example.");
        assert_eq!(
            rich.links,
            [
                (6..27, "https://example.org/x".to_owned()),
                (34..50, "http://b.example".to_owned()),
            ]
        );
        // Already a link: not linked a second time.
        let linked = Rich::parse(r#"<a href="https://a.example">https://a.example</a>"#);
        assert_eq!(linked.links.len(), 1);
    }

    #[test]
    fn script_and_style_contribute_nothing() {
        let rich = Rich::parse("a<script>alert('x')</script>b<style>p{}</style>c<!-- note -->d");
        assert_eq!(rich.text, "abcd");
    }

    #[test]
    fn an_embedded_picture_is_kept_and_a_linked_one_is_named() {
        // "hi!" in base64.
        let rich = Rich::parse(
            r#"look <img src="data:image/png;base64,aGkh"> <img src="https://x.example/a.png" alt="a cat">"#,
        );
        assert_eq!(rich.images, [b"hi!".to_vec()]);
        assert_eq!(rich.text, "look [a cat]");
        assert!(
            Rich::parse(r#"<img src="data:image/png;base64,!!!">"#)
                .images
                .is_empty()
        );
    }

    #[test]
    fn a_mention_is_set_apart_and_ends_with_its_span() {
        let rich = Rich::parse(
            r#"hi <span class="mention mention-user" data-mention-session="3">@Rin</span> and <span class="x">you</span>"#,
        );
        assert_eq!(rich.text, "hi @Rin and you");
        assert_eq!(
            rich.spans,
            [(
                3..7,
                Style {
                    mention: true,
                    ..Style::default()
                }
            )],
            "only the span that names somebody"
        );
    }

    #[test]
    fn attributes_are_found_by_name_whatever_the_quoting() {
        assert_eq!(
            attribute(r#"class="x" href='a b'"#, "href").as_deref(),
            Some("a b")
        );
        assert_eq!(
            attribute("href=plain target=_blank", "href").as_deref(),
            Some("plain")
        );
        assert_eq!(
            attribute(r#"data-href="no" HREF="yes""#, "href").as_deref(),
            Some("yes")
        );
        assert_eq!(attribute("alt", "href"), None);
    }

    #[test]
    fn malformed_markup_does_not_panic_or_lose_the_text() {
        for html in [
            "<",
            "<b",
            "a < b",
            "<<>>",
            "&",
            "&#;",
            "&#xZZ;",
            "</b>x",
            "<a href=",
            "<!--",
            "ß<b>é</b>ü",
        ] {
            let rich = Rich::parse(html);
            for (range, _) in &rich.spans {
                assert!(
                    rich.text.is_char_boundary(range.start)
                        && rich.text.is_char_boundary(range.end),
                    "{html}"
                );
            }
        }
        assert_eq!(Rich::parse("a < b").text, "a < b");
        assert_eq!(Rich::parse("ß<b>é</b>ü").text, "ßéü");
    }
}
