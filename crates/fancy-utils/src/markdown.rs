//! Chat markdown helpers: editor span parsing and markdown <-> HTML.
//!
//! Rust port of the web front-end's
//! `mumble-tauri/ui/src/components/chat/markdown/MarkdownInput.tsx` so
//! native clients format messages identically. Kept dependency-free
//! (hand-rolled scanning; the TS regexes use lookarounds that the `regex`
//! crate does not support anyway).
//!
//! Syntax: `**bold**`, `*italic*`, `__underline__`, `~~strike~~`,
//! `` `code` ``, ```` ```lang ```` fences, `||spoiler||`, `$math$`,
//! `$$display math$$`, bare URLs and `<@SESSION>` user mentions.

// --- Editor spans (live WYSIWYG decoration) -------------------------------

/// Bit flags describing the decoration of a [`Span`](super::Span) range.
pub mod flags {
    /// `**bold**`
    pub const BOLD: u16 = 1;
    /// `*italic*`
    pub const ITALIC: u16 = 2;
    /// `__underline__`
    pub const UNDERLINE: u16 = 4;
    /// `~~strikethrough~~`
    pub const STRIKE: u16 = 8;
    /// `` `inline code` `` or a fenced-code body line.
    pub const CODE: u16 = 16;
    /// A bare URL.
    pub const LINK: u16 = 32;
    /// `||spoiler||`
    pub const SPOILER: u16 = 64;
    /// `<@SESSION>` user mention token.
    pub const MENTION: u16 = 128;
    /// A triple-backtick fence delimiter line (shown muted/monospace).
    pub const FENCE_MARKER: u16 = 256;
}

/// One decorated byte range within a single line of editor text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    /// Byte offset of the range start within the line.
    pub start: usize,
    /// Byte length of the range.
    pub len: usize,
    /// Bitwise OR of [`flags`] constants.
    pub flags: u16,
}

/// Parse one line of editor text into decorated spans.
///
/// `in_fence` carries the fenced-code state across lines (a syntax
/// highlighter's block state). Returns the spans plus the state that the
/// *next* line starts in. Undecorated text produces no span.
///
/// This mirrors the web editor's `parseMarkdown` with one deliberate
/// difference: the web parser lets inline formatting span newlines, a
/// per-line highlighter cannot - formatting is closed at the line end.
pub fn line_spans(line: &str, in_fence: bool) -> (Vec<Span>, bool) {
    if in_fence {
        if line.trim_end().starts_with("```") {
            return (vec![Span { start: 0, len: line.len(), flags: flags::FENCE_MARKER }], false);
        }
        return (vec![Span { start: 0, len: line.len(), flags: flags::CODE }], true);
    }
    if line.starts_with("```") {
        return (vec![Span { start: 0, len: line.len(), flags: flags::FENCE_MARKER }], true);
    }

    let b = line.as_bytes();
    let mut spans = Vec::new();
    let mut plain_start = 0usize;
    let mut i = 0usize;

    let flush_plain = |spans: &mut Vec<Span>, from: usize, to: usize| {
        push_url_spans(spans, line, from, to);
    };

    while i < b.len() {
        // <@SESSION> user mention
        if b[i] == b'<' && i + 1 < b.len() && b[i + 1] == b'@' {
            let mut j = i + 2;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            if j > i + 2 && j < b.len() && b[j] == b'>' {
                flush_plain(&mut spans, plain_start, i);
                spans.push(Span { start: i, len: j + 1 - i, flags: flags::MENTION });
                i = j + 1;
                plain_start = i;
                continue;
            }
        }

        // `inline code`
        if b[i] == b'`' {
            if let Some(end) = find_byte(b, b'`', i + 1) {
                flush_plain(&mut spans, plain_start, i);
                spans.push(Span { start: i, len: end + 1 - i, flags: flags::CODE });
                i = end + 1;
                plain_start = i;
                continue;
            }
        }

        // **bold**
        if b[i] == b'*' && i + 1 < b.len() && b[i + 1] == b'*' {
            if let Some(end) = find_sub(b, b"**", i + 2) {
                flush_plain(&mut spans, plain_start, i);
                spans.push(Span { start: i, len: end + 2 - i, flags: flags::BOLD });
                i = end + 2;
                plain_start = i;
                continue;
            }
        }

        // ||spoiler||
        if b[i] == b'|' && i + 1 < b.len() && b[i + 1] == b'|' {
            if let Some(end) = find_sub(b, b"||", i + 2) {
                flush_plain(&mut spans, plain_start, i);
                spans.push(Span { start: i, len: end + 2 - i, flags: flags::SPOILER });
                i = end + 2;
                plain_start = i;
                continue;
            }
        }

        // *italic* (single star)
        if b[i] == b'*' && (i + 1 >= b.len() || b[i + 1] != b'*') {
            if let Some(end) = find_byte(b, b'*', i + 1) {
                if end + 1 >= b.len() || b[end + 1] != b'*' {
                    flush_plain(&mut spans, plain_start, i);
                    spans.push(Span { start: i, len: end + 1 - i, flags: flags::ITALIC });
                    i = end + 1;
                    plain_start = i;
                    continue;
                }
            }
        }

        // __underline__
        if b[i] == b'_' && i + 1 < b.len() && b[i + 1] == b'_' {
            if let Some(end) = find_sub(b, b"__", i + 2) {
                flush_plain(&mut spans, plain_start, i);
                spans.push(Span { start: i, len: end + 2 - i, flags: flags::UNDERLINE });
                i = end + 2;
                plain_start = i;
                continue;
            }
        }

        // ~~strikethrough~~
        if b[i] == b'~' && i + 1 < b.len() && b[i + 1] == b'~' {
            if let Some(end) = find_sub(b, b"~~", i + 2) {
                flush_plain(&mut spans, plain_start, i);
                spans.push(Span { start: i, len: end + 2 - i, flags: flags::STRIKE });
                i = end + 2;
                plain_start = i;
                continue;
            }
        }

        i += 1;
    }
    flush_plain(&mut spans, plain_start, b.len());
    (spans, false)
}

/// Scan `line[from..to]` for bare URLs and push a LINK span per hit.
fn push_url_spans(spans: &mut Vec<Span>, line: &str, from: usize, to: usize) {
    let mut i = from;
    while i < to {
        match url_at(line, i, to) {
            Some(end) => {
                let trimmed = trim_trailing_punctuation(&line[i..end]);
                spans.push(Span { start: i, len: trimmed.len(), flags: flags::LINK });
                i += end - i;
            }
            None => i += 1,
        }
    }
}

/// If a URL scheme starts at byte `i`, return the exclusive end of the URL
/// (before punctuation trimming), bounded by `limit`.
fn url_at(text: &str, i: usize, limit: usize) -> Option<usize> {
    if !text.is_char_boundary(i) {
        return None;
    }
    let rest = &text[i..limit.min(text.len())];
    let scheme = ["https://", "http://", "ftp://"]
        .iter()
        .find(|s| rest.starts_with(**s))?;
    let mut end = i + scheme.len();
    for ch in text[end..limit].chars() {
        if ch.is_whitespace() || matches!(ch, '<' | '>' | '"' | '\'' | '`') {
            break;
        }
        end += ch.len_utf8();
    }
    Some(end)
}

/// Strip trailing characters that are almost never part of a URL:
/// sentence punctuation and unbalanced closing brackets (port of the web
/// front-end's `trimTrailingPunctuation`).
fn trim_trailing_punctuation(url: &str) -> &str {
    let mut out = url.trim_end_matches(|c| {
        matches!(c, '.' | ',' | ';' | ':' | '!' | '?' | '\'' | '\u{201d}' | '\u{2019}' | '\u{2026}')
    });
    while let Some(last) = out.chars().next_back() {
        let opens = |c| out.chars().filter(|&x| x == c).count();
        let strip = match last {
            ')' => opens('(') < opens(')'),
            ']' => opens('[') < opens(']'),
            '>' | '\u{bb}' => true,
            _ => false,
        };
        if !strip {
            break;
        }
        out = &out[..out.len() - last.len_utf8()];
    }
    out
}

// --- markdown -> HTML (for sending) ----------------------------------------

/// Convert markdown to the HTML message body sent over the wire.
/// Port of the web front-end's `markdownToHtml`.
pub fn markdown_to_html(raw: &str) -> String {
    // Escape HTML entities first.
    let mut html = raw
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");

    // Extract fenced code blocks so no later pass touches their contents.
    let mut fences: Vec<String> = Vec::new();
    html = extract_fences(&html, &mut fences);

    // Stash inline code so `$...$` inside backticks is not treated as math.
    let mut icode: Vec<String> = Vec::new();
    html = stash_inline_code(&html, &mut icode);

    // Display math $$...$$ (may span lines) before the newline pass.
    let mut math_blocks: Vec<String> = Vec::new();
    html = stash_display_math(&html, &mut math_blocks);

    // Inline math $...$
    html = replace_inline_math(&html);

    // Restore inline code now that math has been processed.
    html = restore_stash(&html, "ICODE", &icode);

    html = replace_pair(&html, "**", "<b>", "</b>");
    html = replace_italic(&html);
    html = replace_pair(&html, "__", "<u>", "</u>");
    html = replace_pair(&html, "~~", "<s>", "</s>");
    html = replace_pair(&html, "||", "<span class=\"spoiler\">", "</span>");

    html = linkify(&html);

    // Newlines -> <br> (last, so inline formatting is applied first).
    html = html.replace('\n', "<br>");

    // Restore fences after the <br> pass so their newlines survive.
    html = restore_stash(&html, "FENCE", &fences);
    // Display math wrapped so web clients can render it with KaTeX.
    let math_spans: Vec<String> = math_blocks
        .iter()
        .map(|latex| format!("<span class=\"math-display\">{latex}</span>"))
        .collect();
    html = restore_stash(&html, "MATH_BLOCK", &math_spans);
    html
}

/// ```` ```lang\nbody``` ```` -> `<pre><code class="language-lang">..</code></pre>`,
/// stashed behind a sentinel until the very end.
fn extract_fences(text: &str, stash: &mut Vec<String>) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'`' && text[i..].starts_with("```") {
            let mut k = i + 3;
            while k < b.len()
                && (b[k].is_ascii_alphanumeric() || matches!(b[k], b'_' | b'+' | b'-'))
            {
                k += 1;
            }
            if k < b.len() && b[k] == b'\n' {
                if let Some(close) = find_sub(b, b"```", k + 1) {
                    let lang = &text[i + 3..k];
                    let body = text[k + 1..close].strip_suffix('\n').unwrap_or(&text[k + 1..close]);
                    stash.push(fence_html(lang, body));
                    out.push_str(&format!("\u{0}FENCE{}\u{0}", stash.len() - 1));
                    i = close + 3;
                    continue;
                }
            }
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

/// `<pre><code class="language-lang">body</code></pre>` for one fence
/// (no class attribute when the language is empty).
fn fence_html(lang: &str, body: &str) -> String {
    if lang.is_empty() {
        format!("<pre><code>{body}</code></pre>")
    } else {
        format!("<pre><code class=\"language-{lang}\">{body}</code></pre>")
    }
}

/// `` `code` `` -> `<code>code</code>`, stashed behind a sentinel.
fn stash_inline_code(text: &str, stash: &mut Vec<String>) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'`' {
            if let Some(end) = find_byte(b, b'`', i + 1) {
                if end > i + 1 {
                    stash.push(format!("<code>{}</code>", &text[i + 1..end]));
                    out.push_str(&format!("\u{0}ICODE{}\u{0}", stash.len() - 1));
                    i = end + 1;
                    continue;
                }
            }
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

/// `$$latex$$` -> stashed trimmed latex behind a sentinel.
fn stash_display_math(text: &str, stash: &mut Vec<String>) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'$' && i + 1 < b.len() && b[i + 1] == b'$' {
            if let Some(end) = find_sub(b, b"$$", i + 2) {
                if end > i + 2 {
                    stash.push(text[i + 2..end].trim().to_owned());
                    out.push_str(&format!("\u{0}MATH_BLOCK{}\u{0}", stash.len() - 1));
                    i = end + 2;
                    continue;
                }
            }
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

/// `$latex$` (same line, non-empty) -> `<span class="math-inline">latex</span>`.
fn replace_inline_math(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'$' {
            let mut j = i + 1;
            while j < b.len() && b[j] != b'$' && b[j] != b'\n' {
                j += 1;
            }
            if j < b.len() && b[j] == b'$' && j > i + 1 {
                out.push_str(&format!(
                    "<span class=\"math-inline\">{}</span>",
                    &text[i + 1..j]
                ));
                i = j + 1;
                continue;
            }
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

/// Replace `\u{0}{tag}{index}\u{0}` sentinels with the stashed strings.
fn restore_stash(text: &str, tag: &str, stash: &[String]) -> String {
    let needle = format!("\u{0}{tag}");
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    let b = text.as_bytes();
    while i < b.len() {
        if text[i..].starts_with(&needle) {
            let digits_start = i + needle.len();
            let mut k = digits_start;
            while k < b.len() && b[k].is_ascii_digit() {
                k += 1;
            }
            if k > digits_start && k < b.len() && b[k] == 0 {
                let stashed = text[digits_start..k]
                    .parse::<usize>()
                    .ok()
                    .and_then(|idx| stash.get(idx));
                if let Some(s) = stashed {
                    out.push_str(s);
                    i = k + 1;
                    continue;
                }
            }
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

/// `{delim}inner{delim}` -> `{open}inner{close}` with a non-empty,
/// single-line inner (mirrors the web's non-greedy `(.+?)` regexes).
fn replace_pair(text: &str, delim: &str, open: &str, close: &str) -> String {
    let b = text.as_bytes();
    let d = delim.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < b.len() {
        if text[i..].starts_with(delim) {
            if let Some(end) = find_sub(b, d, i + d.len()) {
                let inner = &text[i + d.len()..end];
                if !inner.is_empty() && !inner.contains('\n') {
                    out.push_str(open);
                    out.push_str(inner);
                    out.push_str(close);
                    i = end + d.len();
                    continue;
                }
            }
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

/// `*italic*` where neither star is part of a `**` pair (the web regex's
/// lookarounds), single-line inner.
fn replace_italic(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < b.len() {
        let opener = b[i] == b'*'
            && (i == 0 || b[i - 1] != b'*')
            && (i + 1 >= b.len() || b[i + 1] != b'*');
        if opener {
            // Find a closing single star with a non-empty inner on this line.
            let mut j = i + 2;
            let mut matched = None;
            while j < b.len() && b[j] != b'\n' {
                if b[j] == b'*' && b[j - 1] != b'*' && (j + 1 >= b.len() || b[j + 1] != b'*') {
                    matched = Some(j);
                    break;
                }
                j += 1;
            }
            if let Some(j) = matched {
                out.push_str("<i>");
                out.push_str(&text[i + 1..j]);
                out.push_str("</i>");
                i = j + 1;
                continue;
            }
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

/// Bare URLs -> `<a href>` anchors (runs after entity escaping, so `<`/`>`
/// act as terminators). Trailing sentence punctuation stays outside the link.
fn linkify(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < text.len() {
        match url_at(text, i, text.len()) {
            Some(end) => {
                let url = trim_trailing_punctuation(&text[i..end]);
                out.push_str(&format!(
                    "<a href=\"{url}\" target=\"_blank\" rel=\"noopener noreferrer\">{url}</a>"
                ));
                out.push_str(&text[i + url.len()..end]);
                i = end;
            }
            None => push_next_char(&mut out, text, &mut i),
        }
    }
    out
}

// --- HTML -> markdown (for editing) ----------------------------------------

/// Reverse of [`markdown_to_html`]: convert a stored HTML body back into
/// editable markdown. Port of the web front-end's `htmlToMarkdown`.
pub fn html_to_markdown(html: &str) -> String {
    let mut text = replace_br(html);
    text = replace_pre_code(&text);
    text = replace_anchors(&text);
    text = replace_simple_tag(&text, "code", "`", "`");
    text = replace_span_class(&text, "math-display", "$$", "$$", true);
    text = replace_span_class(&text, "math-inline", "$", "$", false);
    text = replace_simple_tag(&text, "b", "**", "**");
    text = replace_simple_tag(&text, "strong", "**", "**");
    text = replace_simple_tag(&text, "i", "*", "*");
    text = replace_simple_tag(&text, "em", "*", "*");
    text = replace_simple_tag(&text, "u", "__", "__");
    text = replace_simple_tag(&text, "s", "~~", "~~");
    text = replace_span_class(&text, "spoiler", "||", "||", false);
    text = strip_comments(&text);
    text = crate::html::strip_html_tags(&text);
    text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

/// `<br>`, `<br/>`, `<br />` (any case) -> newline.
fn replace_br(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < b.len() {
        if starts_with_ci(text, i, "<br") {
            let mut k = i + 3;
            while k < b.len() && b[k].is_ascii_whitespace() {
                k += 1;
            }
            if k < b.len() && b[k] == b'/' {
                k += 1;
            }
            if k < b.len() && b[k] == b'>' {
                out.push('\n');
                i = k + 1;
                continue;
            }
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

/// `<pre><code class="language-x">body</code></pre>` -> ```` ```x\nbody\n``` ````.
fn replace_pre_code(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    'outer: while i < b.len() {
        if starts_with_ci(text, i, "<pre><code") {
            let mut k = i + "<pre><code".len();
            let mut lang = "";
            if k < b.len() && b[k] != b'>' {
                // optional: \s+class="language-LANG"
                let ws_start = k;
                while k < b.len() && b[k].is_ascii_whitespace() {
                    k += 1;
                }
                if k == ws_start || !starts_with_ci(text, k, "class=\"language-") {
                    push_next_char(&mut out, text, &mut i);
                    continue 'outer;
                }
                k += "class=\"language-".len();
                let lang_start = k;
                while k < b.len()
                    && (b[k].is_ascii_alphanumeric() || matches!(b[k], b'_' | b'+' | b'-'))
                {
                    k += 1;
                }
                if k == lang_start || k >= b.len() || b[k] != b'"' {
                    push_next_char(&mut out, text, &mut i);
                    continue 'outer;
                }
                lang = &text[lang_start..k];
                k += 1;
            }
            if k < b.len() && b[k] == b'>' {
                if let Some(close) = find_ci(text, "</code></pre>", k + 1) {
                    let body = &text[k + 1..close];
                    out.push_str(&format!("```{lang}\n{body}\n```"));
                    i = close + "</code></pre>".len();
                    continue;
                }
            }
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

/// `<a ...>text</a>` -> `text`.
fn replace_anchors(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < b.len() {
        if let Some((inner_start, inner_end)) = anchor_inner(text, b, i) {
            out.push_str(&text[inner_start..inner_end]);
            i = inner_end + 4; // skip "</a>"
            continue;
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

/// When a complete `<a ...>text</a>` starts at byte `i`, return the byte
/// range of its inner `text`; `None` otherwise.
fn anchor_inner(text: &str, b: &[u8], i: usize) -> Option<(usize, usize)> {
    if !starts_with_ci(text, i, "<a") {
        return None;
    }
    let gt = find_byte(b, b'>', i + 2)?;
    if text[i + 2..gt].contains('>') {
        return None;
    }
    let inner_end = find_byte(b, b'<', gt + 1)?;
    if starts_with_ci(text, inner_end, "</a>") {
        Some((gt + 1, inner_end))
    } else {
        None
    }
}

/// `<tag>inner</tag>` -> `{open}inner{close}` where `inner` contains no `<`.
fn replace_simple_tag(text: &str, tag: &str, open: &str, close: &str) -> String {
    let b = text.as_bytes();
    let open_tag = format!("<{tag}>");
    let close_tag = format!("</{tag}>");
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < b.len() {
        if starts_with_ci(text, i, &open_tag) {
            let inner_start = i + open_tag.len();
            if let Some(lt) = find_byte(b, b'<', inner_start) {
                if starts_with_ci(text, lt, &close_tag) {
                    out.push_str(open);
                    out.push_str(&text[inner_start..lt]);
                    out.push_str(close);
                    i = lt + close_tag.len();
                    continue;
                }
            }
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

/// `<span class="CLS" ...>inner</span>` -> `{open}inner{close}`.
/// With `multiline`, `inner` runs to the first `</span>`; otherwise it must
/// not contain `<`.
fn replace_span_class(text: &str, class: &str, open: &str, close: &str, multiline: bool) -> String {
    let b = text.as_bytes();
    let class_attr = format!("class=\"{class}\"");
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    'outer: while i < b.len() {
        if starts_with_ci(text, i, "<span") {
            let mut k = i + 5;
            let ws_start = k;
            while k < b.len() && b[k].is_ascii_whitespace() {
                k += 1;
            }
            if k > ws_start && starts_with_ci(text, k, &class_attr) {
                k += class_attr.len();
                // Skip remaining attributes up to '>'.
                let Some(gt) = find_byte(b, b'>', k) else {
                    push_next_char(&mut out, text, &mut i);
                    continue 'outer;
                };
                if text[k..gt].contains('<') {
                    push_next_char(&mut out, text, &mut i);
                    continue 'outer;
                }
                let inner_start = gt + 1;
                let end = if multiline {
                    find_ci(text, "</span>", inner_start)
                } else {
                    find_byte(b, b'<', inner_start)
                        .filter(|&lt| starts_with_ci(text, lt, "</span>"))
                };
                if let Some(end) = end {
                    out.push_str(open);
                    out.push_str(&text[inner_start..end]);
                    out.push_str(close);
                    i = end + "</span>".len();
                    continue;
                }
            }
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

/// Remove `<!-- ... -->` comments.
fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < text.len() {
        if text[i..].starts_with("<!--") {
            if let Some(end) = text[i + 4..].find("-->") {
                i += 4 + end + 3;
                continue;
            }
        }
        push_next_char(&mut out, text, &mut i);
    }
    out
}

// --- HTML -> Qt StyledText (for display) ------------------------------------

/// Reduce a chat HTML body to the subset Qt's `Text.StyledText` renders:
/// `<b> <i> <u> <s> <br> <a href>`. All other tags are dropped (their inner
/// text is kept); newlines inside code blocks become `<br>`.
pub fn sanitize_styled_text(html: &str) -> String {
    let b = html.as_bytes();
    let mut out = String::with_capacity(html.len());
    let mut i = 0usize;
    while i < b.len() {
        if b[i] == b'<' {
            let Some(gt) = find_byte(b, b'>', i + 1) else {
                // Malformed trailing '<...': keep as-is.
                out.push_str(&html[i..]);
                break;
            };
            let tag = &html[i + 1..gt];
            let lower = tag.to_ascii_lowercase();
            let name_end = lower
                .find(|c: char| c.is_ascii_whitespace() || c == '/')
                .filter(|&e| e > 0 || !lower.starts_with('/'))
                .unwrap_or(lower.len());
            let (closing, name) = if let Some(n) = lower.strip_prefix('/') {
                (true, n.trim_end_matches(char::is_whitespace))
            } else {
                (false, &lower[..name_end])
            };
            match name {
                "b" | "strong" => out.push_str(if closing { "</b>" } else { "<b>" }),
                "i" | "em" => out.push_str(if closing { "</i>" } else { "<i>" }),
                "u" => out.push_str(if closing { "</u>" } else { "<u>" }),
                "s" | "del" => out.push_str(if closing { "</s>" } else { "<s>" }),
                "br" => out.push_str("<br>"),
                "a" => {
                    if closing {
                        out.push_str("</a>");
                    } else if let Some(href) = attr_value(tag, "href") {
                        out.push_str(&format!("<a href=\"{}\">", href.replace('"', "&quot;")));
                    }
                    // An <a> without href is dropped (its text is kept).
                }
                _ => {} // drop the tag, keep surrounding text
            }
            i = gt + 1;
            continue;
        }
        push_next_char(&mut out, html, &mut i);
    }
    out.replace('\n', "<br>")
}

/// Extract a double-quoted attribute value from a raw tag body.
fn attr_value<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{name}=\"");
    let start = lower.find(&needle)? + needle.len();
    let end = tag[start..].find('"')? + start;
    Some(&tag[start..end])
}

// --- Scanning helpers -------------------------------------------------------

/// Copy the (possibly multi-byte) char at byte `i` to `out` and advance `i`.
fn push_next_char(out: &mut String, text: &str, i: &mut usize) {
    if let Some(ch) = text[*i..].chars().next() {
        out.push(ch);
        *i += ch.len_utf8();
    } else {
        // Defensive: callers only invoke this with `i < text.len()`, so an
        // empty tail is unreachable - but never panic in a chat parser.
        *i = text.len();
    }
}

fn find_byte(b: &[u8], needle: u8, from: usize) -> Option<usize> {
    b.iter().skip(from).position(|&x| x == needle).map(|p| p + from)
}

fn find_sub(b: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if from > b.len() {
        return None;
    }
    b[from..]
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|p| p + from)
}

/// Case-insensitive (ASCII) `starts_with` at byte offset `i`.
fn starts_with_ci(text: &str, i: usize, needle: &str) -> bool {
    text.len() >= i + needle.len()
        && text.as_bytes()[i..i + needle.len()].eq_ignore_ascii_case(needle.as_bytes())
}

/// Case-insensitive (ASCII) substring search from byte offset `from`.
fn find_ci(text: &str, needle: &str, from: usize) -> Option<usize> {
    let b = text.as_bytes();
    let n = needle.as_bytes();
    if from > b.len() || n.is_empty() {
        return None;
    }
    b[from..]
        .windows(n.len())
        .position(|w| w.eq_ignore_ascii_case(n))
        .map(|p| p + from)
}

// --- Tests -------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- markdown_to_html (mirrors the web unit tests) --

    #[test]
    fn md_bold() {
        assert_eq!(markdown_to_html("**hello**"), "<b>hello</b>");
    }

    #[test]
    fn md_italic() {
        assert_eq!(markdown_to_html("*hello*"), "<i>hello</i>");
    }

    #[test]
    fn md_underline() {
        assert_eq!(markdown_to_html("__hello__"), "<u>hello</u>");
    }

    #[test]
    fn md_strike() {
        assert_eq!(markdown_to_html("~~hello~~"), "<s>hello</s>");
    }

    #[test]
    fn md_inline_code() {
        assert_eq!(markdown_to_html("`foo`"), "<code>foo</code>");
    }

    #[test]
    fn md_spoiler() {
        assert_eq!(
            markdown_to_html("||secret||"),
            "<span class=\"spoiler\">secret</span>"
        );
    }

    #[test]
    fn md_newline() {
        assert_eq!(markdown_to_html("a\nb"), "a<br>b");
    }

    #[test]
    fn md_escapes_entities() {
        assert_eq!(markdown_to_html("<div> & x"), "&lt;div&gt; &amp; x");
    }

    #[test]
    fn md_bold_not_across_newline() {
        assert_eq!(markdown_to_html("**a\nb**"), "**a<br>b**");
    }

    #[test]
    fn md_fence_with_lang() {
        assert_eq!(
            markdown_to_html("```rust\nlet x = 1;\n```"),
            "<pre><code class=\"language-rust\">let x = 1;</code></pre>"
        );
    }

    #[test]
    fn md_fence_without_lang() {
        assert_eq!(
            markdown_to_html("```\ncode\n```"),
            "<pre><code>code</code></pre>"
        );
    }

    #[test]
    fn md_fence_content_untouched() {
        assert_eq!(
            markdown_to_html("```\n**not bold**\n```"),
            "<pre><code>**not bold**</code></pre>"
        );
    }

    #[test]
    fn md_no_math_inside_inline_code() {
        assert_eq!(markdown_to_html("`$5 + $6`"), "<code>$5 + $6</code>");
    }

    #[test]
    fn md_inline_math() {
        assert_eq!(
            markdown_to_html("$x^2$"),
            "<span class=\"math-inline\">x^2</span>"
        );
    }

    #[test]
    fn md_display_math() {
        assert_eq!(
            markdown_to_html("$$x = 1\ny = 2$$"),
            "<span class=\"math-display\">x = 1\ny = 2</span>"
        );
    }

    #[test]
    fn md_url() {
        assert_eq!(
            markdown_to_html("see https://example.com/a,b."),
            "see <a href=\"https://example.com/a,b\" target=\"_blank\" rel=\"noopener noreferrer\">https://example.com/a,b</a>."
        );
    }

    #[test]
    fn md_url_balanced_parens_kept() {
        assert_eq!(
            markdown_to_html("https://en.wikipedia.org/wiki/Foo_(bar)"),
            "<a href=\"https://en.wikipedia.org/wiki/Foo_(bar)\" target=\"_blank\" rel=\"noopener noreferrer\">https://en.wikipedia.org/wiki/Foo_(bar)</a>"
        );
    }

    #[test]
    fn md_url_unbalanced_paren_trimmed() {
        assert_eq!(
            markdown_to_html("(https://example.com)"),
            "(<a href=\"https://example.com\" target=\"_blank\" rel=\"noopener noreferrer\">https://example.com</a>)"
        );
    }

    // -- html_to_markdown (mirrors MessageEdit.test.ts) --

    #[test]
    fn html_bold() {
        assert_eq!(html_to_markdown("<b>hello</b>"), "**hello**");
        assert_eq!(html_to_markdown("<strong>hello</strong>"), "**hello**");
    }

    #[test]
    fn html_italic() {
        assert_eq!(html_to_markdown("<i>hello</i>"), "*hello*");
        assert_eq!(html_to_markdown("<em>hello</em>"), "*hello*");
    }

    #[test]
    fn html_underline_strike_code() {
        assert_eq!(html_to_markdown("<u>hello</u>"), "__hello__");
        assert_eq!(html_to_markdown("<s>hello</s>"), "~~hello~~");
        assert_eq!(html_to_markdown("<code>foo</code>"), "`foo`");
    }

    #[test]
    fn html_br() {
        assert_eq!(html_to_markdown("line1<br>line2"), "line1\nline2");
    }

    #[test]
    fn html_anchor() {
        assert_eq!(
            html_to_markdown("<a href=\"https://example.com\">https://example.com</a>"),
            "https://example.com"
        );
    }

    #[test]
    fn html_entities() {
        assert_eq!(html_to_markdown("&lt;div&gt; &amp; stuff"), "<div> & stuff");
    }

    #[test]
    fn html_comments_stripped() {
        assert_eq!(html_to_markdown("<!-- FANCY_QUOTE:abc123 -->hello"), "hello");
    }

    #[test]
    fn html_unknown_tags_stripped() {
        assert_eq!(html_to_markdown("<div>hello</div>"), "hello");
    }

    #[test]
    fn html_pre_code_with_lang() {
        assert_eq!(
            html_to_markdown("<pre><code class=\"language-rust\">let x = 1;</code></pre>"),
            "```rust\nlet x = 1;\n```"
        );
    }

    // -- round trips --

    #[test]
    fn round_trip_inline_styles() {
        for md in ["**b**", "*i*", "__u__", "~~s~~", "`c`", "||sp||", "a\nb"] {
            assert_eq!(html_to_markdown(&markdown_to_html(md)), md, "round trip of {md}");
        }
    }

    #[test]
    fn round_trip_fence() {
        let md = "```rust\nlet x = 1;\n```";
        assert_eq!(html_to_markdown(&markdown_to_html(md)), md);
    }

    // -- line_spans --

    fn span(start: usize, len: usize, flags: u16) -> Span {
        Span { start, len, flags }
    }

    #[test]
    fn spans_bold() {
        let (spans, fence) = line_spans("a **b** c", false);
        assert!(!fence);
        assert_eq!(spans, vec![span(2, 5, flags::BOLD)]);
    }

    #[test]
    fn spans_mixed() {
        let (spans, _) = line_spans("*i* `c`", false);
        assert_eq!(
            spans,
            vec![span(0, 3, flags::ITALIC), span(4, 3, flags::CODE)]
        );
    }

    #[test]
    fn spans_unclosed_is_plain() {
        let (spans, _) = line_spans("**not closed", false);
        assert!(spans.is_empty());
    }

    #[test]
    fn spans_url() {
        let (spans, _) = line_spans("go to https://example.com now", false);
        assert_eq!(spans, vec![span(6, 19, flags::LINK)]);
    }

    #[test]
    fn spans_mention() {
        let (spans, _) = line_spans("hi <@42>!", false);
        assert_eq!(spans, vec![span(3, 5, flags::MENTION)]);
    }

    #[test]
    fn spans_fence_state() {
        let (spans, fence) = line_spans("```rust", false);
        assert!(fence);
        assert_eq!(spans, vec![span(0, 7, flags::FENCE_MARKER)]);

        let (spans, fence) = line_spans("let x = 1;", true);
        assert!(fence);
        assert_eq!(spans, vec![span(0, 10, flags::CODE)]);

        let (spans, fence) = line_spans("```", true);
        assert!(!fence);
        assert_eq!(spans, vec![span(0, 3, flags::FENCE_MARKER)]);
    }

    #[test]
    fn spans_utf8_safe() {
        // Multi-byte chars before the marker must not break offsets.
        let (spans, _) = line_spans("héllo **wörld**", false);
        assert_eq!(spans.len(), 1);
        let s = spans[0];
        assert_eq!(&"héllo **wörld**"[s.start..s.start + s.len], "**wörld**");
    }

    // -- sanitize_styled_text --

    #[test]
    fn styled_keeps_basic_formatting() {
        assert_eq!(
            sanitize_styled_text("<b>a</b> <i>b</i> <u>c</u> <s>d</s>"),
            "<b>a</b> <i>b</i> <u>c</u> <s>d</s>"
        );
    }

    #[test]
    fn styled_normalizes_strong_em() {
        assert_eq!(
            sanitize_styled_text("<strong>a</strong><em>b</em>"),
            "<b>a</b><i>b</i>"
        );
    }

    #[test]
    fn styled_rebuilds_anchor() {
        assert_eq!(
            sanitize_styled_text(
                "<a href=\"https://x.y\" target=\"_blank\" rel=\"noopener noreferrer\">https://x.y</a>"
            ),
            "<a href=\"https://x.y\">https://x.y</a>"
        );
    }

    #[test]
    fn styled_drops_unknown_tags_keeps_text() {
        assert_eq!(
            sanitize_styled_text("<span class=\"spoiler\">s</span><code>c</code>"),
            "sc"
        );
    }

    #[test]
    fn styled_code_newlines_become_br() {
        assert_eq!(
            sanitize_styled_text("<pre><code>a\nb</code></pre>"),
            "a<br>b"
        );
    }
}
