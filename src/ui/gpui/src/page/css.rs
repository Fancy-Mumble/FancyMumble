//! An element's inline `style`, as the web client keeps it and as it is
//! drawn here.
//!
//! The web client cuts every `style` to a list of safe properties
//! (`sanitiseStyle` in `sanitizeHtml.ts`): a declaration of any other
//! property, or one whose value could fetch or run something, is dropped.
//! `safe.rs` makes the same cut the same way, so what is read here is
//! what survives there; cssparser then reads each value that is left.

use super::safe::declarations;
use super::tree::{Align, Fit, Ink, Marker, Shadow, Valign, Wash};
use super::values::{Measure, Part, first_ink, measure, parts, shadow, split_commas, wash};

/// Which sides a declaration sets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Edges(pub [bool; 4]);

impl Edges {
    const ALL: Self = Self([true; 4]);
}

/// How a box takes part in the flow it is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Display {
    Block,
    Inline,
    InlineBlock,
    Flex,
    ListItem,
    None,
}

/// What a font size is said as.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum FontSize {
    Measure(Measure),
    /// A fixed size in pixels: `small`, `large`.
    Keyword(f32),
    /// Smaller or larger than the text around it, by this much.
    Relative(f32),
}

/// One declaration, as it is acted on.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Declared {
    Color(Ink),
    /// A ground: its colour, its wash, either or both.
    Background(Option<Ink>, Option<Wash>),
    /// The colour of its ground, its wash left be.
    Ground(Option<Ink>),
    /// The wash over its ground, its colour left be.
    Washed(Option<Wash>),
    FontSize(FontSize),
    /// A weight, or `None` for one step bolder.
    Weight(Option<u16>),
    Italic(bool),
    Family(String),
    /// What lines run through it: under, through.
    Decoration(bool, bool),
    Align(Align),
    Upper,
    Lower,
    /// A line as tall as this times its text, or as this.
    LeadTimes(f32),
    Lead(Measure),
    KeepLines(bool),
    Valign(Valign),
    Margin(Edges, [Measure; 4]),
    Padding(Edges, [Measure; 4]),
    /// Edges set, and their width in pixels, whether dashed, and ink.
    Border(Edges, Option<f32>, Option<bool>, Option<Ink>),
    Radius(Measure),
    Collapse(bool),
    Spacing(Measure),
    Shadow(Option<Shadow>),
    Display(Display),
    Width(Measure),
    MinWidth(Measure),
    MaxWidth(Measure),
    Height(Measure),
    MinHeight(Measure),
    MaxHeight(Measure),
    Clip(bool),
    /// Grow, shrink, and the size it starts from.
    Flex(Option<f32>, Option<f32>, Option<Measure>),
    Column(bool),
    Wrap(bool),
    Gap(Measure),
    Justify(Align),
    CrossCentred(bool),
    ListStyle(Marker),
    Fit(Fit),
}

/// What `style` declares that is drawn here.
pub(super) fn read(style: &str) -> Vec<Declared> {
    declarations(style)
        .flat_map(|(property, value)| {
            let value = value.trim();
            let value = strip_important(value);
            declared(&property, &parts(value))
        })
        .collect()
}

fn strip_important(value: &str) -> &str {
    let lower = value.to_ascii_lowercase();
    lower
        .rfind("!important")
        .filter(|at| lower[at + "!important".len()..].trim().is_empty())
        .map_or(value, |at| value[..at].trim_end())
}

/// The first identifier among `parts`.
fn word(parts: &[Part]) -> Option<&str> {
    parts.iter().find_map(|part| match part {
        Part::Ident(word) => Some(word.as_str()),
        _ => None,
    })
}

fn has(parts: &[Part], wanted: &str) -> bool {
    parts
        .iter()
        .any(|part| matches!(part, Part::Ident(word) if word == wanted))
}

/// What the declaration of `property` as `parts` sets.
fn declared(property: &str, parts: &[Part]) -> Vec<Declared> {
    let one = |declared: Option<Declared>| declared.into_iter().collect();
    let first_measure = || parts.first().and_then(measure);
    match property {
        "color" => one(first_ink(parts).map(Declared::Color)),
        "background" => one(background(parts)),
        // A colour alone, or a wash alone, leaves the other layer be.
        "background-color" => one(first_ink(parts).map(|ink| Declared::Ground(Some(ink)))),
        "background-image" => one(Some(Declared::Washed(parts.iter().find_map(wash)))),
        "font-size" => one(font_size(parts).map(Declared::FontSize)),
        "font-weight" => one(weight(parts)),
        "font-style" => one(word(parts).map(|word| Declared::Italic(word != "normal"))),
        "font-family" => one(family(parts).map(Declared::Family)),
        "text-decoration" | "text-decoration-line" => one(Some(Declared::Decoration(
            has(parts, "underline"),
            has(parts, "line-through"),
        ))),
        "text-align" => one(word(parts).and_then(align).map(Declared::Align)),
        "text-transform" => one(match word(parts) {
            Some("uppercase") => Some(Declared::Upper),
            Some("lowercase") => Some(Declared::Lower),
            _ => None,
        }),
        "line-height" => one(lead(parts)),
        "white-space" => one(word(parts).map(|word| {
            Declared::KeepLines(matches!(
                word,
                "pre" | "pre-wrap" | "pre-line" | "break-spaces"
            ))
        })),
        "vertical-align" => one(word(parts).and_then(valign).map(Declared::Valign)),
        "margin" | "padding" => one(sides(parts).map(|values| {
            if property == "margin" {
                Declared::Margin(Edges::ALL, values)
            } else {
                Declared::Padding(Edges::ALL, values)
            }
        })),
        "border-radius" => one(first_measure().map(Declared::Radius)),
        "border-collapse" => one(word(parts).map(|word| Declared::Collapse(word == "collapse"))),
        "border-spacing" => one(first_measure().map(Declared::Spacing)),
        "box-shadow" => one(Some(Declared::Shadow(shadow(parts)))),
        "display" => one(word(parts).and_then(display).map(Declared::Display)),
        "overflow" | "overflow-x" | "overflow-y" => one(word(parts)
            .map(|word| Declared::Clip(matches!(word, "hidden" | "clip" | "auto" | "scroll")))),
        "flex-direction" => {
            one(word(parts).map(|word| Declared::Column(word.starts_with("column"))))
        }
        "flex-wrap" => one(word(parts).map(|word| Declared::Wrap(word != "nowrap"))),
        "flex-flow" => vec![
            Declared::Column(word(parts).is_some_and(|word| word.starts_with("column"))),
            Declared::Wrap(has(parts, "wrap")),
        ],
        "gap" | "column-gap" => one(first_measure().map(Declared::Gap)),
        "justify-content" => one(word(parts).map(|word| {
            Declared::Justify(match word {
                "center" => Align::Center,
                "flex-end" | "end" | "right" => Align::Right,
                _ => Align::Left,
            })
        })),
        "align-items" => one(word(parts).map(|word| Declared::CrossCentred(word == "center"))),
        "list-style" | "list-style-type" => one(parts
            .iter()
            .find_map(|part| match part {
                Part::Ident(word) => marker(word),
                _ => None,
            })
            .map(Declared::ListStyle)),
        "object-fit" => one(word(parts).map(|word| {
            Declared::Fit(match word {
                "cover" => Fit::Cover,
                "contain" | "scale-down" => Fit::Contain,
                _ => Fit::Fill,
            })
        })),
        _ => boxes(property, parts),
    }
}

/// The declarations about a box's size, edges and share of a row.
fn boxes(property: &str, parts: &[Part]) -> Vec<Declared> {
    let first_measure = || parts.first().and_then(measure);
    let one = |declared: Option<Declared>| declared.into_iter().collect();
    match property {
        "width" => one(first_measure().map(Declared::Width)),
        "min-width" => one(first_measure().map(Declared::MinWidth)),
        "max-width" => one(first_measure().map(Declared::MaxWidth)),
        "height" => one(first_measure().map(Declared::Height)),
        "min-height" => one(first_measure().map(Declared::MinHeight)),
        "max-height" => one(first_measure().map(Declared::MaxHeight)),
        "flex" => one(flex(parts)),
        "flex-grow" => one(number(parts).map(|grow| Declared::Flex(Some(grow), None, None))),
        "flex-shrink" => one(number(parts).map(|shrink| Declared::Flex(None, Some(shrink), None))),
        "flex-basis" => one(first_measure().map(|basis| Declared::Flex(None, None, Some(basis)))),
        "margin-top" | "margin-right" | "margin-bottom" | "margin-left" => {
            one(first_measure().map(|value| Declared::Margin(edge(property), [value; 4])))
        }
        "padding-top" | "padding-right" | "padding-bottom" | "padding-left" => {
            one(first_measure().map(|value| Declared::Padding(edge(property), [value; 4])))
        }
        "border" | "border-top" | "border-right" | "border-bottom" | "border-left" => {
            one(Some(border(edge(property), parts)))
        }
        "border-width" => {
            one(border_width(parts)
                .map(|width| Declared::Border(Edges::ALL, Some(width), None, None)))
        }
        "border-style" => one(word(parts).map(|style| {
            Declared::Border(
                Edges::ALL,
                None,
                Some(style == "dashed" || style == "dotted"),
                None,
            )
        })),
        "border-color" => {
            one(first_ink(parts).map(|ink| Declared::Border(Edges::ALL, None, None, Some(ink))))
        }
        _ => Vec::new(),
    }
}

/// The sides a longhand property names; all four for a shorthand.
fn edge(property: &str) -> Edges {
    let ends = |side: &str| property.ends_with(side);
    if ends("-top") {
        Edges([true, false, false, false])
    } else if ends("-right") {
        Edges([false, true, false, false])
    } else if ends("-bottom") {
        Edges([false, false, true, false])
    } else if ends("-left") {
        Edges([false, false, false, true])
    } else {
        Edges::ALL
    }
}

/// One to four measures, as top, right, bottom and left.
fn sides(parts: &[Part]) -> Option<[Measure; 4]> {
    let values: Vec<Measure> = parts.iter().filter_map(measure).take(4).collect();
    Some(match values.as_slice() {
        [all] => [*all; 4],
        [vertical, horizontal] => [*vertical, *horizontal, *vertical, *horizontal],
        [top, horizontal, bottom] => [*top, *horizontal, *bottom, *horizontal],
        [top, right, bottom, left] => [*top, *right, *bottom, *left],
        _ => return None,
    })
}

fn number(parts: &[Part]) -> Option<f32> {
    parts.iter().find_map(|part| match part {
        Part::Number(value) => Some(*value),
        _ => None,
    })
}

fn background(parts: &[Part]) -> Option<Declared> {
    if has(parts, "none") && parts.len() == 1 {
        return Some(Declared::Background(None, None));
    }
    // The last layer is the one with the colour; a wash is any layer.
    let layers = split_commas(parts.to_vec());
    let washed = layers.iter().flatten().find_map(wash);
    let ground = layers.last().and_then(|layer| first_ink(layer));
    (ground.is_some() || washed.is_some()).then_some(Declared::Background(ground, washed))
}

fn font_size(parts: &[Part]) -> Option<FontSize> {
    let first = parts.first()?;
    if let Some(measure) = measure(first) {
        return Some(FontSize::Measure(measure));
    }
    let Part::Ident(word) = first else {
        return None;
    };
    Some(match word.as_str() {
        "xx-small" => FontSize::Keyword(9.0),
        "x-small" => FontSize::Keyword(10.0),
        "small" => FontSize::Keyword(13.0),
        "medium" => FontSize::Keyword(16.0),
        "large" => FontSize::Keyword(18.0),
        "x-large" => FontSize::Keyword(24.0),
        "xx-large" => FontSize::Keyword(32.0),
        "xxx-large" => FontSize::Keyword(48.0),
        "smaller" => FontSize::Relative(1.0 / 1.2),
        "larger" => FontSize::Relative(1.2),
        _ => return None,
    })
}

fn weight(parts: &[Part]) -> Option<Declared> {
    Some(Declared::Weight(match parts.first()? {
        Part::Number(value) => {
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss,
                reason = "clamped"
            )]
            let value = value.clamp(1.0, 1000.0) as u16;
            Some(value)
        }
        Part::Ident(word) => match word.as_str() {
            "normal" => Some(400),
            "bold" => Some(700),
            "lighter" => Some(300),
            "bolder" => None,
            _ => return None,
        },
        _ => return None,
    }))
}

/// A font stack, as CSS lists one.
fn family(parts: &[Part]) -> Option<String> {
    let names: Vec<String> = split_commas(parts.to_vec())
        .into_iter()
        .filter_map(|name| {
            let words: Vec<&str> = name
                .iter()
                .filter_map(|part| match part {
                    Part::Ident(word) | Part::Text(word) => Some(word.as_str()),
                    _ => None,
                })
                .collect();
            (!words.is_empty()).then(|| words.join(" "))
        })
        .collect();
    (!names.is_empty()).then(|| names.join(", "))
}

fn align(word: &str) -> Option<Align> {
    Some(match word {
        "left" | "start" | "justify" => Align::Left,
        "center" | "-webkit-center" => Align::Center,
        "right" | "end" => Align::Right,
        _ => return None,
    })
}

fn valign(word: &str) -> Option<Valign> {
    Some(match word {
        "top" | "text-top" => Valign::Top,
        "middle" => Valign::Middle,
        "bottom" | "text-bottom" => Valign::Bottom,
        _ => return None,
    })
}

fn lead(parts: &[Part]) -> Option<Declared> {
    match parts.first()? {
        Part::Number(times) => Some(Declared::LeadTimes(*times)),
        Part::Ident(word) if word == "normal" => Some(Declared::LeadTimes(1.2)),
        other => measure(other).map(Declared::Lead),
    }
}

fn display(word: &str) -> Option<Display> {
    Some(match word {
        "block" | "table" | "table-row" | "table-cell" | "flow-root" | "grid" => Display::Block,
        "inline" | "contents" => Display::Inline,
        "inline-block" | "inline-table" | "inline-grid" => Display::InlineBlock,
        "flex" | "inline-flex" => Display::Flex,
        "list-item" => Display::ListItem,
        "none" => Display::None,
        _ => return None,
    })
}

fn flex(parts: &[Part]) -> Option<Declared> {
    match parts {
        [Part::Ident(word)] if word == "none" => {
            Some(Declared::Flex(Some(0.0), Some(0.0), Some(Measure::Auto)))
        }
        [Part::Ident(word)] if word == "auto" => {
            Some(Declared::Flex(Some(1.0), Some(1.0), Some(Measure::Auto)))
        }
        _ => {
            let numbers: Vec<f32> = parts
                .iter()
                .filter_map(|part| match part {
                    Part::Number(value) => Some(*value),
                    _ => None,
                })
                .collect();
            let basis = parts.iter().find_map(|part| match part {
                Part::Number(_) => None,
                other => measure(other),
            });
            let grow = *numbers.first()?;
            Some(Declared::Flex(
                Some(grow),
                Some(numbers.get(1).copied().unwrap_or(1.0)),
                // `flex: 1` starts from nothing, as CSS says.
                Some(basis.unwrap_or(if numbers.len() == 3 {
                    Measure::Px(numbers[2])
                } else {
                    Measure::Px(0.0)
                })),
            ))
        }
    }
}

fn border_width(parts: &[Part]) -> Option<f32> {
    parts.iter().find_map(|part| match part {
        Part::Ident(word) => match word.as_str() {
            "thin" => Some(1.0),
            "medium" => Some(3.0),
            "thick" => Some(5.0),
            _ => None,
        },
        other => match measure(other)? {
            Measure::Px(px) => Some(px),
            _ => None,
        },
    })
}

/// `border` and its sides' shorthands: a width, a style, a colour, in any
/// order. A border with a style but no width is `medium`, as CSS says.
fn border(edges: Edges, parts: &[Part]) -> Declared {
    let style = parts.iter().find_map(|part| match part {
        Part::Ident(word) => match word.as_str() {
            "none" | "hidden" => Some(None),
            "dashed" | "dotted" => Some(Some(true)),
            "solid" | "double" | "groove" | "ridge" | "inset" | "outset" => Some(Some(false)),
            _ => None,
        },
        _ => None,
    });
    let width = match style {
        Some(None) | None => 0.0,
        Some(Some(_)) => border_width(parts).unwrap_or(3.0),
    };
    Declared::Border(
        edges,
        Some(width),
        style.flatten(),
        Some(first_ink(parts).unwrap_or(Ink::Current)),
    )
}

/// The mark a list style names.
pub(super) fn marker(word: &str) -> Option<Marker> {
    Some(match word {
        "disc" => Marker::Disc,
        "circle" => Marker::Circle,
        "square" => Marker::Square,
        "decimal" | "decimal-leading-zero" => Marker::Decimal,
        "lower-alpha" | "lower-latin" | "a" => Marker::LowerAlpha,
        "upper-alpha" | "upper-latin" | "A" => Marker::UpperAlpha,
        "lower-roman" | "i" => Marker::LowerRoman,
        "upper-roman" | "I" => Marker::UpperRoman,
        "none" => Marker::None,
        _ => return None,
    })
}
