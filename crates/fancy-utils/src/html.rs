//! HTML utility functions.

/// Strip HTML tags from a string, returning only text content.
///
/// This is a crude `<`/`>` based stripper that does not handle edge
/// cases like tags inside attribute values, and it leaves entities
/// encoded. The Markdown converter relies on exactly that (it decodes the
/// few entities it cares about itself); anything shown to a person should
/// go through [`visible_text`] instead.
pub fn strip_html_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut inside_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

/// Elements whose content is never drawn, so their text must not leak out.
///
/// A stock Mumble client sends Qt's full rich-text document, head, `<style>`
/// sheet and all; without this every one of its messages would read
/// "p, li { white-space: pre-wrap; }" in a notification.
const HIDDEN_CONTENT_TAGS: &[&str] = &["head", "script", "style", "title"];

/// Elements that end a line or a block when drawn. Dropping them without a
/// gap glued "line1<br>line2" into "line1line2".
const BREAKING_TAGS: &[&str] = &[
    "blockquote",
    "br",
    "dd",
    "div",
    "dt",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
    "table",
    "td",
    "th",
    "tr",
    "ul",
];

/// The text a person would see when `html` is drawn, as one line.
///
/// Used wherever a message body is shown outside the chat view - desktop
/// notifications, the overlay, search snippets - and for matching search
/// queries, so a query hits what the reader saw rather than the markup
/// around it:
///
/// * tags are dropped, block and line breaks become a space;
/// * comments (`<!-- FANCY_FILE:... -->`, offload markers) are dropped;
/// * the content of `<head>`, `<style>`, `<script>` and `<title>` is dropped;
/// * entities are decoded (`&nbsp;`, `&amp;`, `&#39;`, `&#x1F600;`, ...);
/// * a bare `data:` URL is dropped - its base64 payload is never text;
/// * whitespace runs collapse to a single space, the ends are trimmed.
///
/// A `<` that cannot open a tag ("a <3 b") is kept as text.
pub fn visible_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len().min(4096));
    let mut rest = html;
    while let Some(ch) = rest.chars().next() {
        rest = match ch {
            '<' => consume_markup(rest, &mut out),
            '&' => consume_entity(rest, &mut out),
            _ => {
                out.push(ch);
                &rest[ch.len_utf8()..]
            }
        };
    }
    collapse_whitespace(&out)
}

/// What a message notification says: the visible text, or - for a message
/// that is only a picture or a file - what was sent, so the notification
/// is not an empty bubble under the sender's name.
pub fn message_preview(html: &str) -> String {
    let text = visible_text(html);
    if !text.is_empty() {
        return text;
    }
    if contains_ignore_ascii_case(html, "<img") {
        "sent an image".to_owned()
    } else if contains_ignore_ascii_case(html, "<video") {
        "sent a video".to_owned()
    } else if html.contains("<!-- FANCY_FILE:") {
        "sent a file".to_owned()
    } else {
        text
    }
}

/// Whether `haystack` contains the ASCII `needle`, ignoring ASCII case.
///
/// Byte-wise on purpose: [`str::to_lowercase`] allocates a copy of the
/// whole body, and changes byte lengths for characters such as 'İ', so
/// positions found in that copy do not fit the original.
pub fn contains_ignore_ascii_case(haystack: &str, needle: &str) -> bool {
    find_ignore_ascii_case(haystack, needle, 0).is_some()
}

/// Byte offset of the first ASCII-case-insensitive `needle` in `haystack`
/// at or after `from`.
///
/// When `needle` starts with an ASCII byte the offset is always a char
/// boundary of `haystack` (an ASCII byte never occurs inside a UTF-8
/// sequence), so it is safe to slice the original string with it.
pub fn find_ignore_ascii_case(haystack: &str, needle: &str, from: usize) -> Option<usize> {
    let hay = haystack.as_bytes().get(from..)?;
    let needle = needle.as_bytes();
    if needle.is_empty() {
        return Some(from);
    }
    hay.windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
        .map(|pos| pos + from)
}

/// Handle the `<` at the start of `rest`: a comment, a tag, or a literal.
/// Returns what is left to scan.
fn consume_markup<'a>(rest: &'a str, out: &mut String) -> &'a str {
    if let Some(after) = rest.strip_prefix("<!--") {
        // An unterminated comment hides the rest, the way a browser does.
        return after.find("-->").map_or("", |end| &after[end + 3..]);
    }
    let Some(tag) = parse_tag(rest) else {
        out.push('<');
        return &rest[1..];
    };
    let after = &rest[tag.len..];
    if !tag.closing && !tag.self_closing && HIDDEN_CONTENT_TAGS.contains(&tag.name.as_str()) {
        let close = format!("</{}", tag.name);
        return find_ignore_ascii_case(after, &close, 0).map_or("", |end| &after[end..]);
    }
    if BREAKING_TAGS.contains(&tag.name.as_str()) {
        out.push(' ');
    }
    after
}

/// A tag found at the start of a string.
struct Tag {
    /// Lowercased element name (`"img"`, `"br"`); empty for `<!DOCTYPE>`.
    name: String,
    /// `</p>`.
    closing: bool,
    /// `<br/>`.
    self_closing: bool,
    /// Byte length of the whole tag, `<` through `>`.
    len: usize,
}

/// Parse the tag `s` starts with, or `None` when its `<` cannot open one.
///
/// A `>` inside a quoted attribute value does not end the tag. A tag that
/// never closes runs to the end of the input.
fn parse_tag(s: &str) -> Option<Tag> {
    let bytes = s.as_bytes();
    let first = *bytes.get(1)?;
    if !(first.is_ascii_alphabetic() || matches!(first, b'/' | b'!' | b'?')) {
        return None;
    }
    let closing = first == b'/';
    let name: String = bytes
        .iter()
        .skip(usize::from(closing) + 1)
        .take_while(|b| b.is_ascii_alphanumeric())
        .map(|b| char::from(b.to_ascii_lowercase()))
        .collect();

    let mut quote: Option<u8> = None;
    let mut last_significant = 0u8;
    let mut end = bytes.len();
    for (i, &b) in bytes.iter().enumerate().skip(1) {
        match quote {
            Some(q) if b == q => quote = None,
            Some(_) => {}
            // A quote only opens a value right after `=`: an apostrophe in
            // an unquoted value must not swallow the rest of the message.
            None if matches!(b, b'"' | b'\'') && last_significant == b'=' => quote = Some(b),
            None if b == b'>' => {
                end = i + 1;
                break;
            }
            None => {}
        }
        if !b.is_ascii_whitespace() {
            last_significant = b;
        }
    }
    let self_closing = end >= 2 && bytes.get(end - 2) == Some(&b'/');
    Some(Tag {
        name,
        closing,
        self_closing,
        len: end,
    })
}

/// Handle the `&` at the start of `rest`: decode a known entity, or keep
/// the ampersand as text. Returns what is left to scan.
fn consume_entity<'a>(rest: &'a str, out: &mut String) -> &'a str {
    // The longest entity worth decoding is `&#x10FFFF;`, 10 bytes.
    let window = &rest.as_bytes()[..rest.len().min(12)];
    let decoded = window
        .iter()
        .position(|&b| b == b';')
        // `&` and `;` are ASCII, so both slice ends are char boundaries.
        .and_then(|semi| Some((decode_entity(&rest[1..semi])?, semi)));
    match decoded {
        Some((ch, semi)) => {
            out.push(ch);
            &rest[semi + 1..]
        }
        None => {
            out.push('&');
            &rest[1..]
        }
    }
}

/// Decode the entity name between `&` and `;`.
fn decode_entity(name: &str) -> Option<char> {
    let named = match name {
        "nbsp" => Some('\u{a0}'),
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        _ => None,
    };
    if named.is_some() {
        return named;
    }
    let numeric = name.strip_prefix('#')?;
    let code = match numeric.strip_prefix(['x', 'X']) {
        Some(hex) => u32::from_str_radix(hex, 16).ok()?,
        None => numeric.parse::<u32>().ok()?,
    };
    // NUL is never text worth showing.
    char::from_u32(code).filter(|&c| c != '\0')
}

/// Collapse whitespace runs into single spaces, trim the ends, and drop
/// words that are bare `data:` URLs.
fn collapse_whitespace(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for word in text.split_whitespace().filter(|w| !is_data_url(w)) {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(word);
    }
    out
}

/// Whether `word` is an inline `data:...;base64,...` payload.
fn is_data_url(word: &str) -> bool {
    word.as_bytes()
        .get(..5)
        .is_some_and(|head| head.eq_ignore_ascii_case(b"data:"))
        && word.contains(";base64,")
}

/// Opens the part of a message body that only legacy Mumble clients draw.
pub const LEGACY_FALLBACK_OPEN: &str = "<!-- FANCY_LEGACY -->";
/// Closes it.
pub const LEGACY_FALLBACK_CLOSE: &str = "<!-- /FANCY_LEGACY -->";

/// Says "this body carries a fallback" where nothing else in it does: a GIF
/// or a video is plain markup with no marker of its own to vouch for the cut.
/// Removed along with the fences, so the body a Fancy client draws is the one
/// it drew before fallbacks existed.
pub const LEGACY_FALLBACK_TAG: &str = "<!-- FANCY_FALLBACK -->";
/// Opens markup hidden from legacy clients, which a Fancy client expands.
pub const FANCY_ONLY_OPEN: &str = "<!-- FANCY_ONLY:";
const FANCY_ONLY_CLOSE: &str = " -->";
const FANCY_MARKER: &str = "<!-- FANCY_";

/// Turn a message body into what a Fancy client draws.
///
/// Two kinds of part are only for one side. A fenced block (these two
/// comments around it) is for stock Mumble alone: a file card, a reply or a
/// document invite is a comment it draws as nothing, so the sender adds a
/// line or a small inline copy of a picture for it, and a Fancy client, which
/// already draws the card, cuts that out. A `FANCY_ONLY` comment is the other
/// way round: a spoiler's content, kept where Qt - which ignores the blur -
/// draws nothing, and put back here. Inside it every hyphen was written as
/// `&#45;` so the comment cannot end early; that is undone too.
///
/// Only beside a Fancy marker (`FANCY_FILE`, `FANCY_QUOTE`, ...) outside the
/// fences: a fence in a body with no marker is text somebody wrapped to hide
/// it from Fancy clients, and it stays. The opening fence does not count as a
/// marker, nor does one inside a fence. An opening comment without its close
/// is left alone rather than eating the rest of the message. Must agree with
/// `stripLegacyFallback` in the UI's `legacyFallbackMarker.ts`.
pub fn strip_legacy_fallback(body: &str) -> String {
    if !body.contains(LEGACY_FALLBACK_OPEN) && !body.contains(FANCY_ONLY_OPEN) {
        return body.to_owned();
    }
    let mut cut = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(start) = rest.find(LEGACY_FALLBACK_OPEN) {
        let Some(len) = rest[start..].find(LEGACY_FALLBACK_CLOSE) else {
            break;
        };
        cut.push_str(&rest[..start]);
        rest = &rest[start + len + LEGACY_FALLBACK_CLOSE.len()..];
    }
    cut.push_str(rest);
    let vouched = cut
        .match_indices(FANCY_MARKER)
        .any(|(at, _)| !cut[at..].starts_with(LEGACY_FALLBACK_OPEN));
    if !vouched {
        return body.to_owned();
    }
    let cut = cut.replace(LEGACY_FALLBACK_TAG, "");
    let mut out = String::with_capacity(cut.len());
    let mut rest = cut.as_str();
    while let Some(start) = rest.find(FANCY_ONLY_OPEN) {
        let inner_start = start + FANCY_ONLY_OPEN.len();
        let Some(len) = rest[inner_start..].find(FANCY_ONLY_CLOSE) else {
            break;
        };
        out.push_str(&rest[..start]);
        out.push_str(&rest[inner_start..inner_start + len].replace("&#45;", "-"));
        rest = &rest[inner_start + len + FANCY_ONLY_CLOSE.len()..];
    }
    out.push_str(rest);
    out.trim_end().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_fallback_is_cut_out() {
        let body = "hi\n<!-- FANCY_FILE:abc -->\n<!-- FANCY_LEGACY --><img src=\"data:image/jpeg;base64,AA\" /><!-- /FANCY_LEGACY -->";
        assert_eq!(strip_legacy_fallback(body), "hi\n<!-- FANCY_FILE:abc -->");
    }

    #[test]
    fn every_legacy_fallback_is_cut_out() {
        let body = "<!-- FANCY_FILE:a --><!-- FANCY_LEGACY -->a<!-- /FANCY_LEGACY -->x<!-- FANCY_LEGACY -->b<!-- /FANCY_LEGACY -->";
        assert_eq!(strip_legacy_fallback(body), "<!-- FANCY_FILE:a -->x");
    }

    #[test]
    fn unclosed_legacy_fallback_is_kept() {
        let body = "<!-- FANCY_FILE:a -->x<!-- FANCY_LEGACY -->y";
        assert_eq!(strip_legacy_fallback(body), body);
    }

    #[test]
    fn fence_without_a_file_is_kept() {
        let body = "<!-- FANCY_LEGACY -->hidden<!-- /FANCY_LEGACY -->";
        assert_eq!(strip_legacy_fallback(body), body);
    }

    #[test]
    fn body_without_fallback_is_unchanged() {
        assert_eq!(strip_legacy_fallback("<b>hi</b> "), "<b>hi</b> ");
    }

    #[test]
    fn fence_beside_any_fancy_marker_is_cut_out() {
        let body = "<!-- FANCY_QUOTE:m1 --><!-- FANCY_LEGACY --><blockquote>a: b</blockquote><!-- /FANCY_LEGACY -->hi";
        assert_eq!(strip_legacy_fallback(body), "<!-- FANCY_QUOTE:m1 -->hi");
        let body = "<!-- FANCY_WATCH:s -->
<!-- FANCY_LEGACY -->started<!-- /FANCY_LEGACY -->";
        assert_eq!(strip_legacy_fallback(body), "<!-- FANCY_WATCH:s -->");
    }

    #[test]
    fn fallback_tag_vouches_and_is_removed() {
        let body = "<img src=\"https://x/g.gif\" />
<!-- FANCY_FALLBACK --><!-- FANCY_LEGACY --><a href=\"https://x/g.gif\">GIF</a><!-- /FANCY_LEGACY -->";
        assert_eq!(
            strip_legacy_fallback(body),
            "<img src=\"https://x/g.gif\" />"
        );
    }

    #[test]
    fn marker_inside_a_fence_does_not_vouch() {
        let body = "<!-- FANCY_LEGACY -->hidden<!-- FANCY_QUOTE:x --><!-- /FANCY_LEGACY -->";
        assert_eq!(strip_legacy_fallback(body), body);
        let body = "<!-- FANCY_LEGACY -->a<!-- /FANCY_LEGACY --><!-- FANCY_LEGACY -->b";
        assert_eq!(strip_legacy_fallback(body), body);
    }

    #[test]
    fn fancy_only_content_is_put_back() {
        let body = "x <!-- FANCY_ONLY:<span class=\"spoiler\">a&#45;&#45;b</span> --><!-- FANCY_LEGACY -->[spoiler]<!-- /FANCY_LEGACY --> y";
        assert_eq!(
            strip_legacy_fallback(body),
            "x <span class=\"spoiler\">a--b</span> y"
        );
        let body =
            "<!-- FANCY_ONLY:<img src=\"data:image/png;base64,AA\" data&#45;spoiler=\"1\" /> -->";
        assert_eq!(
            strip_legacy_fallback(body),
            "<img src=\"data:image/png;base64,AA\" data-spoiler=\"1\" />"
        );
    }

    #[test]
    fn strip_simple_tags() {
        assert_eq!(strip_html_tags("<b>hello</b>"), "hello");
    }

    #[test]
    fn strip_nested_tags() {
        assert_eq!(strip_html_tags("<div><p>text</p></div>"), "text");
    }

    #[test]
    fn strip_preserves_plain_text() {
        assert_eq!(strip_html_tags("no tags here"), "no tags here");
    }

    #[test]
    fn strip_empty() {
        assert_eq!(strip_html_tags(""), "");
    }

    #[test]
    fn strip_with_attributes() {
        assert_eq!(
            strip_html_tags(r#"<a href="http://example.com">link</a>"#),
            "link"
        );
    }

    #[test]
    fn visible_text_decodes_entities() {
        assert_eq!(
            visible_text("a&nbsp;b &quot;c&quot; &amp; &lt;d&gt; &#39;e&apos; &#65;&#x42;&#X43;"),
            "a b \"c\" & <d> 'e' ABC"
        );
    }

    #[test]
    fn visible_text_keeps_unknown_and_broken_entities() {
        assert_eq!(
            visible_text("AT&T &bogus; &#xZZ; &#0; &"),
            "AT&T &bogus; &#xZZ; &#0; &"
        );
        // A multibyte character right after `&` must not trip the window.
        assert_eq!(visible_text("&äöü;x"), "&äöü;x");
    }

    #[test]
    fn visible_text_breaks_lines_and_blocks() {
        assert_eq!(
            visible_text("line1<br>line2<br/>line3"),
            "line1 line2 line3"
        );
        assert_eq!(
            visible_text("<p>one</p><p>two</p><div>three</div>"),
            "one two three"
        );
        assert_eq!(visible_text("<ul><li>a</li><li>b</li></ul>"), "a b");
        // Inline elements do not split a word.
        assert_eq!(visible_text("<b>he</b>llo"), "hello");
    }

    #[test]
    fn visible_text_drops_comments_and_hidden_content() {
        assert_eq!(
            visible_text("hi <!-- FANCY_FILE:{\"a\":\"<b>\"} --> there"),
            "hi there"
        );
        assert_eq!(visible_text("<!-- OFFLOADED:m1:70000 -->"), "");
        assert_eq!(visible_text("text <!-- never closed"), "text");
        let qt = "<!DOCTYPE HTML><html><head><meta name=\"qrichtext\" content=\"1\" />\
                  <style type=\"text/css\">p, li { white-space: pre-wrap; }</style></head>\
                  <body><p>Hello</p></body></html>";
        assert_eq!(visible_text(qt), "Hello");
    }

    #[test]
    fn visible_text_skips_attributes_and_data_urls() {
        let body = "<img src=\"data:image/jpeg;base64,/9j/AAA>BBB\" alt='a > b'> caption \
                    data:image/png;base64,iVBORw0KGgo=";
        assert_eq!(visible_text(body), "caption");
    }

    #[test]
    fn visible_text_keeps_a_lone_angle_bracket() {
        assert_eq!(visible_text("i <3 you, 1 < 2"), "i <3 you, 1 < 2");
    }

    #[test]
    fn visible_text_handles_multibyte_text() {
        assert_eq!(
            visible_text("<p>İstanbul</p>&nbsp;Kelvin\u{212a}"),
            "İstanbul Kelvin\u{212a}"
        );
    }

    #[test]
    fn message_preview_names_media_only_messages() {
        assert_eq!(message_preview("<b>hi</b>"), "hi");
        assert_eq!(
            message_preview("<IMG SRC=\"data:image/png;base64,AA\">"),
            "sent an image"
        );
        assert_eq!(
            message_preview("<video src=\"x.mp4\"></video>"),
            "sent a video"
        );
        assert_eq!(message_preview("<!-- FANCY_FILE:abc -->"), "sent a file");
        assert_eq!(message_preview("<p> </p>"), "");
    }

    #[test]
    fn find_ignore_ascii_case_lands_on_char_boundaries() {
        // 'İ' is 2 bytes but lowercases to 3; the offset must fit the original.
        let s = "İİ<IMG src=x>";
        let pos = find_ignore_ascii_case(s, "<img", 0).unwrap();
        assert_eq!(&s[pos..pos + 4], "<IMG");
        assert_eq!(find_ignore_ascii_case(s, "<img", pos + 1), None);
        assert_eq!(find_ignore_ascii_case(s, "x", 100), None);
        assert!(contains_ignore_ascii_case("A<Img", "<iMG"));
    }
}
