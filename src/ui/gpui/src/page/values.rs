//! The values inside a declaration, as cssparser reads them, and what each
//! means: a colour, a length, a ground that runs between two colours.

use cssparser::{Parser, ParserInput, Token};

use super::tree::{Ink, Role, Shadow, Wash};

/// How deep functions may sit inside functions in one value.
const NESTING: usize = 6;
/// How many pieces one value may have.
const PARTS: usize = 64;

/// One piece of a value.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Part {
    Ident(String),
    Number(f32),
    /// A number with a unit, the unit in lower case.
    Dimension(f32, String),
    /// A percentage, as written: `50%` is `50`.
    Percent(f32),
    Hash(String),
    /// A function, and its arguments as they stand between commas.
    Function(String, Vec<Vec<Part>>),
    Text(String),
    Comma,
    Slash,
}

/// `value` in pieces, or nothing if cssparser cannot read it.
pub(super) fn parts(value: &str) -> Vec<Part> {
    let mut input = ParserInput::new(value);
    let mut parser = Parser::new(&mut input);
    let mut out = Vec::new();
    collect(&mut parser, &mut out, 0);
    out
}

fn collect(parser: &mut Parser<'_, '_>, out: &mut Vec<Part>, depth: usize) {
    while out.len() < PARTS {
        let Ok(token) = parser.next() else {
            return;
        };
        let part = match token {
            Token::Ident(name) => Part::Ident(name.to_ascii_lowercase()),
            Token::Number { value, .. } => Part::Number(*value),
            Token::Dimension { value, unit, .. } => {
                Part::Dimension(*value, unit.to_ascii_lowercase())
            }
            Token::Percentage { unit_value, .. } => Part::Percent(unit_value * 100.0),
            Token::Hash(hash) | Token::IDHash(hash) => Part::Hash(hash.to_string()),
            Token::QuotedString(text) => Part::Text(text.to_string()),
            Token::Comma => Part::Comma,
            Token::Delim('/') => Part::Slash,
            Token::Function(name) if depth < NESTING => {
                let name = name.to_ascii_lowercase();
                let mut inner = Vec::new();
                let _ = parser.parse_nested_block(|nested| {
                    collect(nested, &mut inner, depth + 1);
                    Ok::<(), cssparser::ParseError<'_, ()>>(())
                });
                Part::Function(name, split_commas(inner))
            }
            _ => continue,
        };
        out.push(part);
    }
}

/// `parts` cut at its commas.
pub(super) fn split_commas(parts: Vec<Part>) -> Vec<Vec<Part>> {
    let mut groups = vec![Vec::new()];
    for part in parts {
        match part {
            Part::Comma => groups.push(Vec::new()),
            other => groups
                .last_mut()
                .into_iter()
                .for_each(|group| group.push(other.clone())),
        }
    }
    groups
}

/// A measure as CSS writes one, before it is known what it is measured
/// against.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum Measure {
    Px(f32),
    /// Times the size of the text it is with.
    Em(f32),
    /// Times the size of the page's root text, which is sixteen pixels.
    Rem(f32),
    Percent(f32),
    Auto,
}

/// The measure `part` is.
pub(super) fn measure(part: &Part) -> Option<Measure> {
    Some(match part {
        Part::Number(value) if *value == 0.0 => Measure::Px(0.0),
        Part::Dimension(value, unit) => match unit.as_str() {
            "px" => Measure::Px(*value),
            "pt" => Measure::Px(value * 4.0 / 3.0),
            "em" => Measure::Em(*value),
            "rem" => Measure::Rem(*value),
            _ => return None,
        },
        Part::Percent(value) => Measure::Percent(*value),
        Part::Ident(name) if name == "auto" => Measure::Auto,
        // A variable stands for its fallback here: the one variable a
        // document is given lengths in is the theme's hairline.
        Part::Function(name, arguments) if name == "var" => {
            return arguments.get(1)?.first().and_then(measure);
        }
        _ => return None,
    })
}

/// The colour `part` is, as the web client would draw it here.
pub(super) fn ink(part: &Part) -> Option<Ink> {
    match part {
        Part::Hash(hex) => {
            let (r, g, b, a) = cssparser::color::parse_hash_color(hex.as_bytes()).ok()?;
            Some(Ink::Rgba([r, g, b, opacity(a)]))
        }
        Part::Ident(name) => match name.as_str() {
            "transparent" => Some(Ink::Rgba([0, 0, 0, 0])),
            "currentcolor" => Some(Ink::Current),
            named => {
                let (r, g, b) = cssparser::color::parse_named_color(named).ok()?;
                Some(Ink::Rgba([r, g, b, 255]))
            }
        },
        Part::Function(name, arguments) => match name.as_str() {
            "rgb" | "rgba" => rgb(arguments),
            "hsl" | "hsla" => hsl(arguments),
            "var" => variable(arguments),
            _ => None,
        },
        _ => None,
    }
}

/// The first colour among `parts`.
pub(super) fn first_ink(parts: &[Part]) -> Option<Ink> {
    parts.iter().find_map(ink)
}

fn opacity(alpha: f32) -> u8 {
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "clamped to a byte first"
    )]
    let byte = (alpha.clamp(0.0, 1.0) * 255.0).round() as u8;
    byte
}

/// The numbers of a colour function, written with commas or with spaces
/// and a slash before the opacity.
fn channels(arguments: &[Vec<Part>]) -> Vec<&Part> {
    arguments
        .iter()
        .flatten()
        .filter(|part| !matches!(part, Part::Slash))
        .collect()
}

fn rgb(arguments: &[Vec<Part>]) -> Option<Ink> {
    let parts = channels(arguments);
    let channel = |part: &Part| match part {
        Part::Number(value) => Some(*value),
        Part::Percent(value) => Some(value * 2.55),
        _ => None,
    };
    let (r, g, b) = (
        channel(parts.first()?)?,
        channel(parts.get(1)?)?,
        channel(parts.get(2)?)?,
    );
    let a = parts.get(3).map_or(Some(1.0), |part| alpha(part))?;
    let byte = |value: f32| opacity(value / 255.0);
    Some(Ink::Rgba([byte(r), byte(g), byte(b), opacity(a)]))
}

fn alpha(part: &Part) -> Option<f32> {
    match part {
        Part::Number(value) => Some(*value),
        Part::Percent(value) => Some(value / 100.0),
        _ => None,
    }
}

fn hsl(arguments: &[Vec<Part>]) -> Option<Ink> {
    let parts = channels(arguments);
    let hue = match parts.first()? {
        Part::Number(degrees) => *degrees,
        Part::Dimension(degrees, unit) if unit == "deg" => *degrees,
        _ => return None,
    };
    let fraction = |part: &Part| match part {
        Part::Percent(value) => Some(value / 100.0),
        Part::Number(value) => Some(value / 100.0),
        _ => None,
    };
    let (s, l) = (fraction(parts.get(1)?)?, fraction(parts.get(2)?)?);
    let a = parts.get(3).map_or(Some(1.0), |part| alpha(part))?;
    let rgba = gpui::Rgba::from(gpui::hsla(hue.rem_euclid(360.0) / 360.0, s, l, a));
    Some(Ink::Rgba([
        opacity(rgba.r),
        opacity(rgba.g),
        opacity(rgba.b),
        opacity(rgba.a),
    ]))
}

/// A theme variable, as the welcome designer writes one: the role it
/// names, or failing that its fallback.
fn variable(arguments: &[Vec<Part>]) -> Option<Ink> {
    let role = match arguments.first()?.first()? {
        Part::Ident(name) => match name.as_str() {
            "--color-accent" | "--accent" => Some(Role::Accent),
            "--color-accent-soft" => Some(Role::AccentSoft),
            "--color-text-on-accent" => Some(Role::OnAccent),
            "--color-glass-border" => Some(Role::Line),
            "--color-bg-elevated" => Some(Role::Surface),
            "--color-text-primary" => Some(Role::Text),
            "--color-text-secondary" => Some(Role::Muted),
            _ => None,
        },
        _ => None,
    };
    role.map(Ink::Role).or_else(|| first_ink(arguments.get(1)?))
}

/// A ground that runs between colours: the first and last of a gradient's
/// stops, at its angle. A round one runs from where it is centred.
pub(super) fn wash(part: &Part) -> Option<Wash> {
    let Part::Function(name, arguments) = part else {
        return None;
    };
    let linear = matches!(
        name.as_str(),
        "linear-gradient" | "repeating-linear-gradient"
    );
    let radial = matches!(
        name.as_str(),
        "radial-gradient" | "repeating-radial-gradient"
    );
    if !linear && !radial {
        return None;
    }
    let stops: Vec<Ink> = arguments
        .iter()
        .filter_map(|stop| first_ink(stop))
        .collect();
    let (from, to) = (*stops.first()?, *stops.last()?);
    let head = arguments.first()?;
    let angle = if linear {
        direction(head).unwrap_or(180.0)
    } else {
        centre_angle(head)
    };
    Some(Wash { angle, from, to })
}

/// The angle a linear gradient's first argument names, if it names one.
fn direction(head: &[Part]) -> Option<f32> {
    match head.first()? {
        Part::Dimension(value, unit) => match unit.as_str() {
            "deg" => Some(*value),
            "turn" => Some(value * 360.0),
            "rad" => Some(value.to_degrees()),
            _ => None,
        },
        Part::Ident(to) if to == "to" => {
            let words: Vec<&str> = head[1..]
                .iter()
                .filter_map(|part| match part {
                    Part::Ident(word) => Some(word.as_str()),
                    _ => None,
                })
                .collect();
            let has = |word: &str| words.contains(&word);
            let (x, y) = (
                f32::from(u8::from(has("right"))) - f32::from(u8::from(has("left"))),
                f32::from(u8::from(has("bottom"))) - f32::from(u8::from(has("top"))),
            );
            Some(x.atan2(-y).to_degrees().rem_euclid(360.0))
        }
        _ => None,
    }
}

/// The angle from where a round gradient is centred across its box: one
/// centred at the top left runs towards the bottom right.
fn centre_angle(head: &[Part]) -> f32 {
    let at = head
        .iter()
        .position(|part| matches!(part, Part::Ident(word) if word == "at"));
    let place: Vec<f32> = at
        .map(|at| &head[at + 1..])
        .unwrap_or_default()
        .iter()
        .filter_map(|part| match part {
            Part::Percent(value) => Some(value / 100.0),
            Part::Ident(word) => match word.as_str() {
                "left" | "top" => Some(0.0),
                "right" | "bottom" => Some(1.0),
                "center" => Some(0.5),
                _ => None,
            },
            _ => None,
        })
        .collect();
    let (x, y) = (
        place.first().copied().unwrap_or(0.5),
        place.get(1).copied().unwrap_or(0.5),
    );
    if (x - 0.5).abs() < f32::EPSILON && (y - 0.5).abs() < f32::EPSILON {
        return 180.0;
    }
    (0.5 - x).atan2(y - 0.5).to_degrees().rem_euclid(360.0)
}

/// The first shadow of `parts`, unless it is cast inwards.
pub(super) fn shadow(parts: &[Part]) -> Option<Shadow> {
    let first = split_commas(parts.to_vec()).into_iter().next()?;
    if first
        .iter()
        .any(|part| matches!(part, Part::Ident(word) if word == "inset" || word == "none"))
    {
        return None;
    }
    let lengths: Vec<f32> = first
        .iter()
        .filter_map(|part| match measure(part)? {
            Measure::Px(px) => Some(px),
            _ => None,
        })
        .collect();
    Some(Shadow {
        x: *lengths.first()?,
        y: *lengths.get(1)?,
        blur: lengths.get(2).copied().unwrap_or(0.0),
        spread: lengths.get(3).copied().unwrap_or(0.0),
        ink: first_ink(&first).unwrap_or(Ink::Current),
    })
}
