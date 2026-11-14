//! Which markup is drawn, and which is only its words.
//!
//! The web client renders a welcome, a channel description and anything
//! else a server sends through one allow-list (`sanitizeHtml.ts`). What it
//! does not name keeps its words and loses its box; what it drops whole,
//! with what is inside, is dropped here too.

use std::sync::Arc;

/// What becomes of an element.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Treat {
    /// Dropped, with everything inside it.
    Drop,
    /// Its contents stand where it stood, its own box gone.
    Unwrap,
    /// Drawn, as the tag named.
    Keep(&'static str),
}

/// The sanitiser's tags (`ALLOWED_TAGS`).
const TAGS: &[&str] = &[
    "b",
    "i",
    "u",
    "s",
    "em",
    "strong",
    "small",
    "sub",
    "sup",
    "del",
    "ins",
    "mark",
    "abbr",
    "code",
    "span",
    "font",
    "p",
    "br",
    "hr",
    "pre",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "img",
    "a",
];

/// What `DOMPurify` drops with its contents rather than unwrapping
/// (`FORBID_CONTENTS`), and the controls that have no words to keep.
const DROPPED: &[&str] = &[
    "annotation-xml",
    "audio",
    "colgroup",
    "desc",
    "foreignobject",
    "head",
    "iframe",
    "math",
    "mi",
    "mn",
    "mo",
    "ms",
    "mtext",
    "noembed",
    "noframes",
    "noscript",
    "plaintext",
    "script",
    "style",
    "svg",
    "template",
    "title",
    "video",
    "xmp",
    "select",
    "textarea",
    "object",
    "embed",
    "input",
    "button",
];

/// What becomes of the element `name`.
pub(super) fn treat(name: &str) -> Treat {
    if DROPPED.contains(&name) {
        return Treat::Drop;
    }
    TAGS.iter()
        .find(|tag| **tag == name)
        .map_or(Treat::Unwrap, |tag| Treat::Keep(tag))
}

/// Where a link to `href` may lead: a web address (`EXTERNAL_URL_RE`), and
/// nothing that starts a program or runs script. Anything else keeps its
/// words and is no link.
pub(super) fn link(href: &str) -> Option<Arc<str>> {
    let lower = href.get(..8).unwrap_or(href).to_ascii_lowercase();
    let web = lower.starts_with("https://") || lower.starts_with("http://");
    (web && href.len() > 8).then(|| Arc::from(href))
}

/// Whether a picture's `src` is one that is drawn (`DATA_IMAGE_RE`): only a
/// picture the document carries itself. Nothing is ever fetched.
pub(super) fn picture(src: &str) -> bool {
    const KINDS: &[&str] = &[
        "png;", "jpeg;", "jpg;", "gif;", "webp;", "avif;", "svg+xml;",
    ];
    let lower = src.get(..32).unwrap_or(src).to_ascii_lowercase();
    let Some(rest) = lower.strip_prefix("data:image/") else {
        return false;
    };
    KINDS
        .iter()
        .any(|kind| rest.starts_with(kind) && rest[kind.len()..].starts_with("base64,"))
}
