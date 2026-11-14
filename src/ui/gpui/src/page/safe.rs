//! The cut the web client makes of every `style` before it is drawn
//! (`sanitiseStyle` in `sanitizeHtml.ts`): only safe properties, and none
//! whose value could fetch or run something.

/// The properties the web client keeps (`SAFE_CSS_PROPS`).
const SAFE: &[&str] = &[
    "color",
    "background-color",
    "background",
    "font-size",
    "font-weight",
    "font-style",
    "font-family",
    "text-decoration",
    "text-shadow",
    "text-decoration-line",
    "text-decoration-color",
    "text-align",
    "text-transform",
    "text-indent",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "word-break",
    "white-space",
    "vertical-align",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border",
    "border-color",
    "border-width",
    "border-style",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "border-radius",
    "border-collapse",
    "border-spacing",
    "box-shadow",
    "filter",
    "backdrop-filter",
    "-webkit-backdrop-filter",
    "object-fit",
    "object-position",
    "aspect-ratio",
    "background-image",
    "background-size",
    "background-position",
    "background-repeat",
    "overflow",
    "overflow-x",
    "overflow-y",
    "display",
    "box-sizing",
    "flex",
    "flex-basis",
    "flex-direction",
    "flex-flow",
    "flex-grow",
    "flex-shrink",
    "flex-wrap",
    "gap",
    "row-gap",
    "column-gap",
    "justify-content",
    "align-items",
    "align-content",
    "align-self",
    "order",
    "list-style",
    "list-style-type",
    "width",
    "max-width",
    "min-width",
    "height",
    "max-height",
    "min-height",
];

/// The longest `style` read, in bytes. A document's styles are a line or
/// two each.
const LONGEST: usize = 4096;

/// The declarations of `style` the web client would keep, in order, each
/// as its property's name and its value.
pub(super) fn declarations(style: &str) -> impl Iterator<Item = (String, &str)> {
    let style = &style[..floor(style, LONGEST)];
    style.split(';').filter_map(|declaration| {
        let (property, value) = declaration.split_once(':')?;
        let property = property.trim().to_ascii_lowercase();
        (SAFE.contains(&property.as_str()) && !reaches_out(value)).then_some((property, value))
    })
}

/// Whether a value could make a browser fetch or run something, by the
/// web client's two tests (`DANGEROUS_CSS_VALUE_RE`, `styleValueFetches`).
fn reaches_out(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let called = |name: &str| {
        lower
            .match_indices(name)
            .any(|(at, _)| lower[at + name.len()..].trim_start().starts_with('('))
    };
    called("url")
        || called("expression")
        || called("image-set")
        || lower.contains("javascript:")
        || lower.contains("@import")
        || lower.contains('\\')
}

/// The largest character boundary at or before `at`.
fn floor(text: &str, at: usize) -> usize {
    (0..=at.min(text.len()))
        .rev()
        .find(|at| text.is_char_boundary(*at))
        .unwrap_or(0)
}
