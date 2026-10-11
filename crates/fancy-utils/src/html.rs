//! HTML utility functions.

/// Strip HTML tags from a string, returning only text content.
///
/// This is a crude `<`/`>` based stripper that does not handle edge
/// cases like tags inside attribute values. Good enough for display
/// and notification purposes.
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

/// Opens the part of a message body that only legacy Mumble clients draw.
pub const LEGACY_FALLBACK_OPEN: &str = "<!-- FANCY_LEGACY -->";
/// Closes it.
pub const LEGACY_FALLBACK_CLOSE: &str = "<!-- /FANCY_LEGACY -->";

/// Cut every legacy-only block out of a message body.
///
/// A picture shared through the file server travels as a `FANCY_FILE`
/// comment, which a stock Mumble client draws as nothing at all. So the
/// sender puts a small inline copy beside it, fenced by these two comments,
/// for those clients alone - a Fancy client already draws the card, and
/// drawing the copy as well would show the picture twice.
///
/// An opening comment without its close is left alone rather than eating the
/// rest of the message.
pub fn strip_legacy_fallback(body: &str) -> String {
    if !body.contains(LEGACY_FALLBACK_OPEN) {
        return body.to_owned();
    }
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(start) = rest.find(LEGACY_FALLBACK_OPEN) {
        let Some(len) = rest[start..].find(LEGACY_FALLBACK_CLOSE) else {
            break;
        };
        out.push_str(&rest[..start]);
        rest = &rest[start + len + LEGACY_FALLBACK_CLOSE.len()..];
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
        let body = "<!-- FANCY_LEGACY -->a<!-- /FANCY_LEGACY -->x<!-- FANCY_LEGACY -->b<!-- /FANCY_LEGACY -->";
        assert_eq!(strip_legacy_fallback(body), "x");
    }

    #[test]
    fn unclosed_legacy_fallback_is_kept() {
        let body = "x<!-- FANCY_LEGACY -->y";
        assert_eq!(strip_legacy_fallback(body), body);
    }

    #[test]
    fn body_without_fallback_is_unchanged() {
        assert_eq!(strip_legacy_fallback("<b>hi</b> "), "<b>hi</b> ");
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
}
