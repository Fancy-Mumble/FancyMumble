//! HTML as a stream of tags and text, for the migration to walk. Comments,
//! the profile's mark among them, are skipped, and so is what is inside a
//! script, a style sheet or a head: none of it is text.

use crate::markup::decoded;

/// One piece of HTML.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Token<'a> {
    /// Text, its entities read.
    Text(String),
    /// A tag opens: its name in lower case, and its attributes as written.
    Open {
        name: String,
        attributes: &'a str,
    },
    /// A tag closes.
    Close(String),
}

/// The pieces of some HTML, in order.
pub(super) struct Tokens<'a> {
    rest: &'a str,
}

impl<'a> Tokens<'a> {
    pub(super) const fn new(html: &'a str) -> Self {
        Self { rest: html }
    }

    /// Move past the element `name`, whose contents are not text.
    fn skip(&mut self, name: &str) {
        let closing = format!("</{name}");
        let at = self.rest.to_ascii_lowercase().find(&closing);
        self.rest = at
            .and_then(|at| self.rest[at..].split_once('>'))
            .map_or("", |(_, after)| after);
    }

    /// The tag at the head of what is left, which starts with `<`.
    fn tag(&mut self) -> Option<Token<'a>> {
        let (tag, after) = self.rest[1..]
            .split_once('>')
            .unwrap_or((&self.rest[1..], ""));
        self.rest = after;
        let tag = tag.trim_end_matches('/').trim();
        let (closing, tag) = tag
            .strip_prefix('/')
            .map_or((false, tag), |tag| (true, tag));
        let (name, attributes) = tag
            .split_once(|c: char| c.is_whitespace())
            .unwrap_or((tag, ""));
        let name = name.to_ascii_lowercase();
        if closing {
            return Some(Token::Close(name));
        }
        if matches!(name.as_str(), "script" | "style" | "head" | "title" | "template") {
            self.skip(&name);
            return None;
        }
        Some(Token::Open { name, attributes })
    }
}

impl<'a> Iterator for Tokens<'a> {
    type Item = Token<'a>;

    fn next(&mut self) -> Option<Token<'a>> {
        while !self.rest.is_empty() {
            if let Some(after) = self.rest.strip_prefix("<!--") {
                self.rest = after.split_once("-->").map_or("", |(_, after)| after);
                continue;
            }
            let opens_tag = self.rest.starts_with('<')
                && self.rest[1..].starts_with(|c: char| c.is_ascii_alphabetic() || c == '/');
            if opens_tag {
                match self.tag() {
                    Some(token) => return Some(token),
                    None => continue,
                }
            }
            // At least the first character, so this always moves on.
            let first = self.rest.chars().next().map_or(1, char::len_utf8);
            let end = self.rest[first..]
                .find('<')
                .map_or(self.rest.len(), |at| at + first);
            let text = decoded(&self.rest[..end]);
            self.rest = &self.rest[end..];
            return Some(Token::Text(text));
        }
        None
    }
}
