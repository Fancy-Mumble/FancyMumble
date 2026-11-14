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
    /// The colour its writer gave it, as red, green and blue.
    pub color: Option<[u8; 3]>,
}

/// How a stretch of whole lines is set apart from running text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Block {
    /// Quoted from somebody: a rule down its side, dimmed.
    Quote,
    /// Code as written: its own face and ground, never wrapped.
    Code,
    /// A heading, by its level from one.
    Heading(u8),
    /// An item of a list nested `depth` deep, from zero. Its mark, a bullet
    /// or a number, is the first `mark` bytes of its text.
    Item {
        /// How many lists it is inside, less one.
        depth: u8,
        /// How many bytes its mark takes, without the space after it.
        mark: u8,
    },
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
    /// Pictures the message names by a web address, a GIF somebody picked
    /// among them: drawn under it, and fetched only as the reader allows.
    pub web_pictures: Vec<String>,
    /// Where the text is hidden until its reader asks for it: spoilers.
    pub spoilers: Vec<Range<usize>>,
    /// The lines set apart from running text, in order and not
    /// overlapping. Each is whole lines: what is between two is running
    /// text, with a line break either side.
    pub blocks: Vec<(Range<usize>, Block)>,
}

/// Schemes a link may open. Anything else is drawn as plain text: a chat
/// message does not get to start arbitrary handlers on the reader's machine.
const OPENABLE: &[&str] = &["https://", "http://", "mailto:", "mumble://"];

impl Rich {
    /// Read `html`.
    pub(crate) fn parse(html: &str) -> Self {
        Self::read(html, Reader::default())
    }

    /// Only the basic words of `html`: text, line breaks, bold, italic,
    /// underline, links and simple lists. A picture is neither decoded nor
    /// kept, and colours, code, struck text, headings and quotes are read as
    /// plain words. For a profile of the older format.
    pub(crate) fn basic(html: &str) -> Self {
        let mut rich = Self::read(
            html,
            Reader {
                basic: true,
                ..Reader::default()
            },
        );
        for (_, style) in &mut rich.spans {
            *style = Style {
                bold: style.bold,
                italic: style.italic,
                underline: style.underline,
                ..Style::default()
            };
        }
        rich.spans.retain(|(_, style)| *style != Style::default());
        // A list's items are lines with their marks: nothing is set apart.
        rich.blocks.clear();
        rich
    }

    fn read(html: &str, mut reader: Reader) -> Self {
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

    /// The bytes `range` of it as a text of their own, set as they were.
    /// `range` is on character boundaries: a block's, or what is between
    /// two.
    pub(crate) fn slice(&self, range: Range<usize>) -> Self {
        let within = |other: &Range<usize>| {
            let (start, end) = (other.start.max(range.start), other.end.min(range.end));
            (start < end).then(|| start - range.start..end - range.start)
        };
        let kept = |ranges: &[(Range<usize>, Style)]| {
            ranges
                .iter()
                .filter_map(|(span, style)| Some((within(span)?, *style)))
                .collect()
        };
        Self {
            text: self.text[range.clone()].to_owned(),
            spans: kept(&self.spans),
            links: self
                .links
                .iter()
                .filter_map(|(link, to)| Some((within(link)?, to.clone())))
                .collect(),
            images: Vec::new(),
            web_pictures: Vec::new(),
            spoilers: self.spoilers.iter().filter_map(within).collect(),
            blocks: Vec::new(),
        }
    }

    /// The text in the pieces it is drawn in, in order: each block, and
    /// the running text between them, without the breaks that part them.
    pub(crate) fn pieces(&self) -> Vec<(Range<usize>, Option<Block>)> {
        let mut pieces = Vec::with_capacity(self.blocks.len() * 2 + 1);
        let running = |from: usize, to: usize| {
            let between = &self.text[from..to];
            let start = from + (between.len() - between.trim_start_matches('\n').len());
            let end = to - (between.len() - between.trim_end_matches('\n').len());
            (start < end).then_some((start..end, None))
        };
        let mut at = 0;
        for (range, block) in &self.blocks {
            pieces.extend(running(at, range.start));
            pieces.push((range.clone(), Some(*block)));
            at = range.end;
        }
        pieces.extend(running(at, self.text.len()));
        pieces
    }
}

impl Rich {
    /// Print each link that is its own address as its host and the start
    /// of its path. Where it leads is unchanged, and what is copied is the
    /// message as it was sent.
    fn shorten_links(&mut self) {
        // From the last, so that what is still to be looked at has not moved.
        for at in (0..self.links.len()).rev() {
            let (range, to) = self.links[at].clone();
            let Some(pretty) = pretty_url(&to).filter(|_| self.text[range.clone()] == to) else {
                continue;
            };
            let was = range.end;
            let now = range.start + pretty.len();
            self.text.replace_range(range.clone(), &pretty);
            let moved = |place: usize| {
                if place >= was {
                    place - was + now
                } else {
                    place.min(now)
                }
            };
            let shift = |other: &mut Range<usize>| {
                // What began inside the address begins with it now.
                let start = if other.start > range.start {
                    moved(other.start)
                } else {
                    other.start
                };
                *other = start..moved(other.end).max(start);
            };
            self.spans.iter_mut().for_each(|(span, _)| shift(span));
            self.links.iter_mut().for_each(|(link, _)| shift(link));
            self.blocks.iter_mut().for_each(|(block, _)| shift(block));
            self.spoilers.iter_mut().for_each(shift);
        }
        self.spans.retain(|(span, _)| span.start < span.end);
    }
}

/// The longest a shortened address is allowed to be, in characters.
const PRETTY_LIMIT: usize = 48;

/// `url` as its host and as much of its path as fits, or `None` if it is
/// not a web address. The rule is the web UI's (`prettyUrl`): the scheme,
/// a leading `www.` and the whole query go; a long path is cut from its
/// end, whole segments at a time, with an ellipsis for what was dropped.
fn pretty_url(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let rest = rest.split(['?', '#']).next().unwrap_or(rest);
    let (authority, path) = rest.find('/').map_or((rest, ""), |at| rest.split_at(at));
    // Who it is signed in as, and on which port, are no part of where.
    let host = authority.rsplit('@').next().unwrap_or(authority);
    let host = host.split(':').next().unwrap_or(host);
    let host = host.strip_prefix("www.").unwrap_or(host);
    if host.is_empty() {
        return None;
    }
    let path = path.trim_end_matches('/');
    if path.is_empty() {
        return Some(host.to_owned());
    }
    if host.chars().count() + path.chars().count() <= PRETTY_LIMIT {
        return Some(format!("{host}{path}"));
    }
    let mut shown = host.to_owned();
    for segment in path.split('/').filter(|segment| !segment.is_empty()) {
        if shown.chars().count() + segment.chars().count() + 2 > PRETTY_LIMIT {
            break;
        }
        shown.push('/');
        shown.push_str(segment);
    }
    shown.push_str("/…");
    Some(shown)
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
    /// The `<span>`s and `<font>`s open, innermost last.
    spans: Vec<Span>,
    /// The link being read: where it started, and where it leads.
    link: Option<(usize, String)>,
    /// The style in force, and where it began.
    run: (usize, Style),
    /// A break owed before the next text: block elements ask for one, and it
    /// is only paid if text follows, so a message never ends in blank lines.
    break_owed: bool,
    /// The block being read, and where it began. One at a time: what is
    /// inside a quote is the quote's, and an item's code is the item's.
    block: Option<(usize, Block)>,
    /// The lists open, innermost last: the number its next item takes, for
    /// one that counts.
    lists: Vec<Option<u32>>,
    /// Reading only the basic words: pictures are passed over unread.
    basic: bool,
}

impl Reader {
    fn style(&self) -> Style {
        Style {
            bold: self.bold > 0,
            italic: self.italic > 0,
            underline: self.underline > 0,
            strike: self.strike > 0,
            code: self.code > 0 || self.pre > 0,
            mention: self.spans.iter().any(|span| span.mention),
            // The innermost that names one: a colour holds until another does.
            color: self.spans.iter().rev().find_map(|span| span.color),
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

    /// Where the next character of text will be put.
    fn here(&self) -> usize {
        self.out.text.len() + usize::from(self.break_owed && !self.out.text.is_empty())
    }

    /// A block begins or ends: lines apart from what is around them. One
    /// that begins inside another is part of that one.
    fn block(&mut self, closing: bool, block: Block) {
        self.break_owed = true;
        if !closing {
            if self.block.is_none() {
                self.block = Some((self.here(), block));
            }
            return;
        }
        let same = |open: Block| std::mem::discriminant(&open) == std::mem::discriminant(&block);
        if self.block.is_some_and(|(_, open)| same(open)) {
            self.close_block();
        }
    }

    /// The block being read ends here.
    fn close_block(&mut self) {
        let Some((start, block)) = self.block.take() else {
            return;
        };
        let end = self.out.text.len();
        if end > start {
            self.out.blocks.push((start..end, block));
        }
    }

    /// A list begins or ends. `counts` is whether its items are numbered,
    /// and from what.
    fn list(&mut self, closing: bool, counts: Option<u32>) {
        self.break_owed = true;
        if !closing {
            self.lists.push(counts);
            return;
        }
        // An item nobody closed ends with its list.
        if matches!(self.block, Some((_, Block::Item { .. }))) {
            self.close_block();
        }
        let _ = self.lists.pop();
    }

    /// A list's item begins: its mark, and the block that is its lines.
    fn item(&mut self) {
        // The item before it, if nobody closed that, ends here.
        if matches!(self.block, Some((_, Block::Item { .. }))) {
            self.close_block();
        }
        self.break_owed = true;
        self.restyle();
        let mark = match self.lists.last_mut() {
            Some(Some(number)) => {
                let mark = format!("{number}.");
                *number += 1;
                mark
            }
            _ => "•".to_owned(),
        };
        if self.block.is_none() {
            let depth = self.lists.len().saturating_sub(1);
            self.block = Some((
                self.here(),
                Block::Item {
                    depth: u8::try_from(depth).unwrap_or(u8::MAX),
                    mark: u8::try_from(mark.len()).unwrap_or(u8::MAX),
                },
            ));
        }
        mark.chars().for_each(|c| self.push(c));
        self.push(' ');
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
            "b" | "strong" => count(&mut self.bold),
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                let level = name.as_bytes()[1] - b'0';
                self.block(closing, Block::Heading(level));
                count(&mut self.bold);
            }
            "i" | "em" => count(&mut self.italic),
            "u" | "ins" => count(&mut self.underline),
            "s" | "del" | "strike" => count(&mut self.strike),
            "code" | "tt" | "kbd" => count(&mut self.code),
            "pre" => {
                self.block(closing, Block::Code);
                count(&mut self.pre);
            }
            "blockquote" => self.block(closing, Block::Quote),
            "br" => self.line_break(),
            "p" | "div" | "tr" | "table" => self.break_owed = true,
            "ul" => self.list(closing, None),
            "ol" => {
                let from = attribute(attributes, "start").and_then(|from| from.parse().ok());
                self.list(closing, Some(from.unwrap_or(1)));
            }
            "li" if !closing => self.item(),
            "li" => {
                if matches!(self.block, Some((_, Block::Item { .. }))) {
                    self.close_block();
                }
            }
            "span" | "font" if closing => self.close_span(),
            "span" | "font" => {
                let at = self.out.text.len() + usize::from(self.break_owed);
                self.spans.push(Span::read(attributes, at));
            }
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

    /// The innermost `<span>` ends: what it hid is hidden as far as here.
    fn close_span(&mut self) {
        let Some(hidden_from) = self.spans.pop().and_then(|span| span.hidden_from) else {
            return;
        };
        let end = self.out.text.len();
        if end > hidden_from {
            self.out.spoilers.push(hidden_from..end);
        }
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

    /// A picture: embedded ones are kept to be drawn; one on the web is
    /// kept by its address, to be drawn as far as the reader lets it in
    /// (nothing is fetched on a message's say-so); any other is named.
    fn image(&mut self, attributes: &str) {
        if self.basic {
            return;
        }
        let source = attribute(attributes, "src").unwrap_or_default();
        if let Some(bytes) = embedded_picture(&source) {
            self.out.images.push(bytes);
            return;
        }
        let source = source.trim();
        let web = ["https://", "http://"].iter().any(|scheme| {
            source
                .get(..scheme.len())
                .is_some_and(|start| start.eq_ignore_ascii_case(scheme))
        });
        if web {
            self.out.web_pictures.push(source.to_owned());
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
        // What was never closed is closed by the message ending.
        while !self.spans.is_empty() {
            self.close_span();
        }
        self.close_block();
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
        self.out.spoilers.retain_mut(|range| {
            range.end = range.end.min(trimmed);
            range.start < range.end
        });
        self.out.blocks.retain_mut(|(range, _)| {
            range.end = range.end.min(trimmed);
            range.start < range.end
        });
        link_bare_addresses(&mut self.out);
        self.out.shorten_links();
        self.out
    }
}

/// What a `<span>` or a `<font>` says of the text inside it.
#[derive(Clone, Copy)]
struct Span {
    mention: bool,
    color: Option<[u8; 3]>,
    /// Where what it hides begins, if it is a spoiler.
    hidden_from: Option<usize>,
}

impl Span {
    /// Read the attributes of a tag opened at `at` in the text: the editor
    /// writes `style="color:#ff4d4d"`, older clients `color="red"`, and a
    /// spoiler is a span of that class.
    fn read(attributes: &str, at: usize) -> Self {
        let styled = attribute(attributes, "style").and_then(|style| {
            style
                .split(';')
                .filter_map(|declared| declared.split_once(':'))
                .find(|(property, _)| property.trim().eq_ignore_ascii_case("color"))
                .map(|(_, value)| value.to_owned())
        });
        let hides = attribute(attributes, "class")
            .is_some_and(|class| class.split_whitespace().any(|name| name == "spoiler"));
        Self {
            hidden_from: hides.then_some(at),
            mention: attributes.to_ascii_lowercase().contains("data-mention-"),
            color: styled
                .or_else(|| attribute(attributes, "color"))
                .and_then(|value| color(&value)),
        }
    }
}

/// The sixteen colours HTML has had names for from the start: what a
/// `<font color>` written by hand or by an old client uses.
const NAMED: &[(&str, [u8; 3])] = &[
    ("black", [0, 0, 0]),
    ("silver", [192, 192, 192]),
    ("gray", [128, 128, 128]),
    ("white", [255, 255, 255]),
    ("maroon", [128, 0, 0]),
    ("red", [255, 0, 0]),
    ("purple", [128, 0, 128]),
    ("fuchsia", [255, 0, 255]),
    ("green", [0, 128, 0]),
    ("lime", [0, 255, 0]),
    ("olive", [128, 128, 0]),
    ("yellow", [255, 255, 0]),
    ("navy", [0, 0, 128]),
    ("blue", [0, 0, 255]),
    ("teal", [0, 128, 128]),
    ("aqua", [0, 255, 255]),
];

/// A colour as markup writes one: by name, as `#rgb`/`#rrggbb`, or as
/// `rgb()`. Anything else is no colour, and the text keeps its own.
fn color(value: &str) -> Option<[u8; 3]> {
    let value = value.trim();
    if let Some((_, named)) = NAMED
        .iter()
        .find(|(name, _)| value.eq_ignore_ascii_case(name))
    {
        return Some(*named);
    }
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "clamped to a byte first"
    )]
    let byte = |part: f32| (part.clamp(0.0, 1.0) * 255.0).round() as u8;
    crate::theme::parse_color(&value.to_ascii_lowercase())
        .map(|parsed| [byte(parsed.r), byte(parsed.g), byte(parsed.b)])
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
        color: None,
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
    fn an_address_is_printed_as_where_it_goes() {
        // The web UI's own cases (`prettyLinks.test.ts`).
        assert_eq!(
            pretty_url("https://www.youtube.com/watch?v=B5EwrXHvE5o&t=2941s").as_deref(),
            Some("youtube.com/watch")
        );
        assert_eq!(
            pretty_url("https://www.reddit.com/r/dataisbeautiful/comments/1abcdef/a_very_long_title_of_a_post_indeed/")
                .as_deref(),
            Some("reddit.com/r/dataisbeautiful/comments/1abcdef/…")
        );
        assert_eq!(
            pretty_url("https://example.org/a/b").as_deref(),
            Some("example.org/a/b")
        );
        assert_eq!(
            pretty_url("https://example.org/").as_deref(),
            Some("example.org")
        );
        assert_eq!(pretty_url("not a url"), None);
        assert_eq!(pretty_url("mailto:a@example.org"), None);
    }

    #[test]
    fn a_link_that_is_its_own_address_is_shortened_and_what_follows_keeps_its_place() {
        let rich = Rich::parse(
            "see https://www.example.org/a/b?utm=1 and <b>this</b> \
             <a href=\"https://example.org/x?y=2\">with words</a>",
        );
        assert_eq!(rich.text, "see example.org/a/b and this with words");
        assert_eq!(
            rich.links,
            [
                (4..19, "https://www.example.org/a/b?utm=1".to_owned()),
                (29..39, "https://example.org/x?y=2".to_owned()),
            ],
            "where each leads is untouched; words somebody wrote are theirs"
        );
        assert_eq!(&rich.text[rich.spans[0].0.clone()], "this");
        // Inside a block, the block ends where its text now does.
        let quoted = Rich::parse("<blockquote>https://www.example.org/a?b=1</blockquote>after");
        assert_eq!(quoted.text, "example.org/a\nafter");
        assert_eq!(quoted.blocks, [(0..13, Block::Quote)]);
    }

    #[test]
    fn lines_set_apart_are_blocks_and_what_is_between_them_running_text() {
        let rich = Rich::parse(
            "before<blockquote>said <b>once</b><br>and again</blockquote>between\
             <pre><code>fn x() {\n    1\n}</code></pre><h2>Title</h2>after",
        );
        assert_eq!(
            rich.text,
            "before\nsaid once\nand again\nbetween\nfn x() {\n    1\n}\nTitle\nafter"
        );
        let pieces: Vec<_> = rich
            .pieces()
            .into_iter()
            .map(|(range, block)| (&rich.text[range], block))
            .collect();
        assert_eq!(
            pieces,
            [
                ("before", None),
                ("said once\nand again", Some(Block::Quote)),
                ("between", None),
                ("fn x() {\n    1\n}", Some(Block::Code)),
                ("Title", Some(Block::Heading(2))),
                ("after", None),
            ]
        );
        // A piece keeps how its text was set, counted from its own start.
        let quote = rich.slice(rich.blocks[0].0.clone());
        assert_eq!(quote.text, "said once\nand again");
        assert_eq!(quote.spans.len(), 1);
        assert_eq!(&quote.text[quote.spans[0].0.clone()], "once");
        assert!(quote.spans[0].1.bold && quote.blocks.is_empty());
        // Nothing set apart: nothing to draw apart.
        assert!(Rich::parse("just <b>words</b>").blocks.is_empty());
    }

    #[test]
    fn a_list_counts_where_it_is_told_to_and_knows_how_deep_it_is() {
        let rich = Rich::parse(
            "<ol start=\"9\"><li>nine<li>ten<ul><li>inner</li></ul></li><li>eleven</li></ol>done",
        );
        assert_eq!(rich.text, "9. nine\n10. ten\n• inner\n11. eleven\ndone");
        let items: Vec<_> = rich
            .blocks
            .iter()
            .map(|(range, block)| (&rich.text[range.clone()], *block))
            .collect();
        assert_eq!(
            items,
            [
                ("9. nine", Block::Item { depth: 0, mark: 2 }),
                ("10. ten", Block::Item { depth: 0, mark: 3 }),
                ("• inner", Block::Item { depth: 1, mark: 3 }),
                ("11. eleven", Block::Item { depth: 0, mark: 3 }),
            ]
        );
        assert_eq!(rich.pieces().last().map(|(_, block)| *block), Some(None));
        // A list inside a quote is the quote's.
        let quoted = Rich::parse("<blockquote><ul><li>a</li><li>b</li></ul></blockquote>");
        assert_eq!(quoted.blocks, [(0..11, Block::Quote)]);
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
                (6..19, "https://example.org/x".to_owned()),
                (26..35, "http://b.example".to_owned()),
            ],
            "each printed as where it goes"
        );
        assert_eq!(rich.text, "go to example.org/x, then b.example.");
        assert_eq!(
            Rich::parse("a https://example.org/x b https://example.org/x")
                .links
                .len(),
            2
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
            r#"look <img src="data:image/png;base64,aGkh"> <img src="https://x.example/a.png?w=1&amp;h=2" alt="a cat"> <img src="cid:part1" alt="a dog">"#,
        );
        assert_eq!(rich.images, [b"hi!".to_vec()]);
        // One on the web is kept by its address, to be shown as allowed.
        assert_eq!(rich.web_pictures, ["https://x.example/a.png?w=1&h=2"]);
        assert_eq!(rich.text, "look [a dog]");
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
    fn the_basic_reading_keeps_words_emphasis_links_and_lists_and_reads_no_picture() {
        let rich = Rich::basic(concat!(
            r#"<p><b>bold</b> <i>slanted</i> <u>under</u> <s>struck</s> <code>code</code></p>"#,
            r#"<p><span style="color:red">red</span> <a href="https://example.org">site</a></p>"#,
            r#"<h1>Big</h1><blockquote>said</blockquote><ul><li>one</li><li>two</li></ul>"#,
            r#"<img src="data:image/png;base64,aGkh">"#,
        ));
        assert_eq!(
            rich.text,
            "bold slanted under struck code\nred site\nBig\nsaid\n\u{2022} one\n\u{2022} two"
        );
        assert!(rich.images.is_empty(), "a picture is not even decoded");
        assert!(rich.blocks.is_empty(), "nothing set apart");
        let styles: Vec<_> = rich.spans.iter().map(|(range, style)| (&rich.text[range.clone()], *style)).collect();
        assert!(styles.iter().all(|(_, style)| !style.strike && !style.code && style.color.is_none()));
        assert!(styles.iter().any(|(text, style)| *text == "bold" && style.bold));
        assert!(styles.iter().any(|(text, style)| *text == "under" && style.underline));
        assert_eq!(rich.links.len(), 1);
    }

    /// The one stretch `rich` hides, if it hides exactly one.
    fn only(rich: &Rich) -> Option<Range<usize>> {
        match rich.spoilers.as_slice() {
            [hidden] => Some(hidden.clone()),
            _ => None,
        }
    }

    #[test]
    fn what_is_marked_a_spoiler_is_known_to_be_hidden() {
        let rich = Rich::parse(
            r#"the butler <span class="spoiler">did <b>it</b></span>, and <span class="spoilers">no</span>"#,
        );
        assert_eq!(rich.text, "the butler did it, and no");
        assert_eq!(only(&rich), Some(11..17), "that class and no other");
        // Never closed: hidden to the end.
        let open = Rich::parse(r#"so <span class="spoiler">it ends<br>badly"#);
        assert_eq!(only(&open), Some(3..16));
    }

    #[test]
    fn text_keeps_the_colour_its_writer_gave_it() {
        let rich = Rich::parse(concat!(
            r##"<span style="font-weight:600; color: #FF4d4d">red</span> "##,
            r#"<font color="Lime">lime <span style="background-color:#000">still</span></font> "#,
            r#"<span style="color:rgb(0, 0, 255)">blue</span> "#,
            r#"<span style="color:url(x)">none</span>"#,
        ));
        assert_eq!(rich.text, "red lime still blue none");
        let colored = |color| Style {
            color: Some(color),
            ..Style::default()
        };
        assert_eq!(
            rich.spans,
            [
                (0..3, colored([255, 77, 77])),
                // A ground is not an ink, and what is inside keeps the ink
                // of what it is in.
                (4..14, colored([0, 255, 0])),
                (15..19, colored([0, 0, 255])),
            ],
            "and what is no colour colours nothing"
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
