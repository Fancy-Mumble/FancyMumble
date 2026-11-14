//! How one element is set: a browser's own defaults for its tag, then what
//! its `style` says, on top of what it inherits from around it.

use std::sync::Arc;

use super::css::{Declared, Display, Edges, FontSize};
use super::tree::{
    Align, Extent, Family, Fit, Flex, Frame, Ink, Lead, Len, Look, Marker, Role, Sides, Valign,
};
use super::values::Measure;

/// What text inherits from the elements it is inside.
#[derive(Debug, Clone)]
pub(super) struct Context {
    pub look: Look,
    pub align: Align,
    pub lead: Lead,
    pub keep_lines: bool,
    /// Its letters in capitals, or in small letters.
    pub case: Option<bool>,
    /// The link it is in, if it is in one.
    pub link: Option<Arc<str>>,
    /// Inside a box that is itself a link: its words need not be.
    pub in_link_box: bool,
    /// How many lists it is inside.
    pub lists: u8,
    /// Straight inside a list's item, where a paragraph adds no room.
    pub in_item: bool,
}

impl Context {
    /// What a surface's text starts as.
    pub(super) fn surface() -> Self {
        Self {
            look: Look::default(),
            align: Align::Left,
            lead: Lead::Surface,
            keep_lines: false,
            case: None,
            link: None,
            in_link_box: false,
            lists: 0,
            in_item: false,
        }
    }
}

/// Room a table leaves between its cells, as a browser sets it.
const CELL_SPACING: f32 = 2.0;

/// One element, set.
#[derive(Debug, Clone)]
pub(super) struct Styled {
    pub display: Display,
    /// What its contents inherit.
    pub context: Context,
    pub frame: Frame,
    pub row: RowSetting,
    /// The room between a table's cells, in pixels.
    pub spacing: f32,
    pub marker: Option<Marker>,
    pub fit: Fit,
    pub valign: Option<Valign>,
    /// Which sides' padding the document set, or a default that must stand.
    pub padded: super::room::Said,
}

/// How a flexible box lays out what is in it.
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct RowSetting {
    pub column: bool,
    pub wrap: bool,
    pub gap: Len,
    pub justify: Align,
    pub centred: bool,
}

impl Styled {
    /// `tag` as a browser sets it, inside `outer`.
    pub(super) fn new(tag: &str, outer: &Context) -> Self {
        let mut context = outer.clone();
        context.in_item = false;
        let mut styled = Self {
            display: display_of(tag),
            context,
            frame: Frame::default(),
            row: RowSetting::default(),
            spacing: CELL_SPACING,
            marker: None,
            fit: Fit::Fill,
            valign: None,
            padded: super::room::Said::default(),
        };
        styled.defaults(tag, outer);
        styled
    }

    fn size(&self) -> Len {
        self.context.look.size
    }

    /// A margin above and below of `em` times its own text.
    fn spaced(&mut self, em: f32) {
        let margin = self.size().times(em);
        self.frame.margin.top = margin;
        self.frame.margin.bottom = margin;
    }

    fn defaults(&mut self, tag: &str, outer: &Context) {
        let look = &mut self.context.look;
        match tag {
            "b" | "strong" => look.weight = look.weight.max(700),
            "i" | "em" => look.italic = true,
            "u" | "ins" => look.underline = true,
            "s" | "del" | "strike" => look.strike = true,
            "small" | "sub" | "sup" => look.size = look.size.times(1.0 / 1.2),
            "code" | "pre" => look.family = Family::Mono,
            "mark" => {
                look.ground = Some(Ink::Rgba([255, 255, 0, 255]));
                look.ink = Some(Ink::Rgba([0, 0, 0, 255]));
            }
            "a" => {
                look.ink = Some(Ink::Role(Role::Link));
                look.underline = false;
            }
            "th" => {
                look.weight = 700;
                self.context.align = Align::Center;
            }
            _ => {}
        }
        if let Some(level) = heading(tag) {
            let (larger, room) = [
                (2.0, 0.67),
                (1.5, 0.83),
                (1.17, 1.0),
                (1.0, 1.33),
                (0.83, 1.67),
                (0.67, 2.33),
            ][usize::from(level - 1)];
            self.context.look.size = self.size().times(larger);
            self.context.look.weight = 700;
            self.spaced(room);
        }
        match tag {
            "p" if outer.in_item => {}
            "p" => self.spaced(1.0),
            "pre" => {
                self.spaced(1.0);
                self.context.keep_lines = true;
            }
            "blockquote" => {
                self.spaced(1.0);
                self.frame.margin.left = Len::px(40.0);
                self.frame.margin.right = Len::px(40.0);
            }
            "ul" | "ol" => {
                if outer.lists == 0 {
                    self.spaced(1.0);
                }
                self.frame.padding.left = Len::px(40.0);
                // The marks stand in that room: a list keeps it.
                self.padded.left = true;
                self.context.lists = outer.lists + 1;
                self.marker = Some(match (tag, outer.lists) {
                    ("ol", _) => Marker::Decimal,
                    (_, 0) => Marker::Disc,
                    (_, 1) => Marker::Circle,
                    _ => Marker::Square,
                });
            }
            "li" => self.context.in_item = true,
            "hr" => {
                self.spaced(0.5);
                self.frame.border = Sides {
                    top: 1.0,
                    right: 1.0,
                    bottom: 1.0,
                    left: 1.0,
                };
                self.frame.border_ink = Some(Ink::Rgba([128, 128, 128, 255]));
            }
            "td" | "th" => {
                let one = Len::px(1.0);
                self.frame.padding = Sides {
                    top: one,
                    right: one,
                    bottom: one,
                    left: one,
                };
            }
            _ => {}
        }
    }

    /// Apply what a `style` declares, its font size first: the rest is
    /// measured against it.
    pub(super) fn apply(&mut self, declared: &[Declared], outer: &Context) {
        for declaration in declared {
            if let Declared::FontSize(size) = declaration {
                self.context.look.size = font_size(*size, outer.look.size);
            }
        }
        for declaration in declared {
            self.declare(declaration);
        }
    }

    /// A length `measure` comes to, against its own text.
    fn len(&self, measure: Measure) -> Option<Len> {
        match measure {
            Measure::Px(px) => Some(Len::px(px)),
            Measure::Em(em) => Some(self.size().times(em)),
            Measure::Rem(rem) => Some(Len::px(rem * 16.0)),
            Measure::Percent(_) | Measure::Auto => None,
        }
    }

    fn extent(&self, measure: Measure) -> Extent {
        match measure {
            Measure::Percent(share) => Extent::Share(share / 100.0),
            Measure::Auto => Extent::Auto,
            other => self.len(other).map_or(Extent::Auto, Extent::Len),
        }
    }

    fn declare(&mut self, declared: &Declared) {
        let look = &mut self.context.look;
        match declared {
            Declared::Color(ink) => look.ink = Some(*ink),
            Declared::Weight(weight) => look.weight = weight.unwrap_or(700.max(look.weight)),
            Declared::Italic(italic) => look.italic = *italic,
            Declared::Family(stack) => {
                look.family = if stack.starts_with("monospace") || stack.starts_with("ui-monospace")
                {
                    Family::Mono
                } else {
                    Family::Named(Arc::from(stack.as_str()))
                };
            }
            Declared::Decoration(under, through) => {
                look.underline = *under;
                look.strike = *through;
            }
            Declared::Align(align) => self.context.align = *align,
            Declared::Upper => self.context.case = Some(true),
            Declared::Lower => self.context.case = Some(false),
            Declared::LeadTimes(times) => self.context.lead = Lead::Times(*times),
            Declared::Lead(measure) => {
                self.context.lead = match measure {
                    Measure::Percent(share) => Lead::Len(self.size().times(share / 100.0)),
                    other => self.len(*other).map_or(self.context.lead, Lead::Len),
                };
            }
            Declared::KeepLines(keep) => self.context.keep_lines = *keep,
            Declared::Valign(valign) => self.valign = Some(*valign),
            Declared::Display(display) => self.display = *display,
            Declared::ListStyle(marker) => self.marker = Some(*marker),
            Declared::Fit(fit) => self.fit = *fit,
            Declared::Collapse(collapse) => {
                if *collapse {
                    self.spacing = 0.0;
                }
            }
            Declared::Spacing(measure) => {
                if self.spacing > 0.0 {
                    self.spacing = self.len(*measure).map_or(0.0, |len| len.px);
                }
            }
            _ => self.declare_box(declared),
        }
    }

    fn declare_box(&mut self, declared: &Declared) {
        match declared {
            Declared::Background(ground, wash) => {
                self.frame.ground = *ground;
                self.frame.wash = *wash;
            }
            Declared::Ground(ground) => self.frame.ground = *ground,
            Declared::Washed(wash) => self.frame.wash = *wash,
            Declared::Margin(edges, values) => self.margin(*edges, values),
            Declared::Padding(edges, values) => {
                let mut padding = self.frame.padding;
                for (side, value) in sides_mut(&mut padding, *edges).zip(values) {
                    *side = self.len(*value).unwrap_or(Len::ZERO);
                }
                self.frame.padding = padding;
                for said in sides_mut(&mut self.padded, *edges) {
                    *said = true;
                }
            }
            Declared::Border(edges, width, dashed, ink) => {
                if let Some(width) = width {
                    let mut border = self.frame.border;
                    for side in sides_mut(&mut border, *edges) {
                        *side = *width;
                    }
                    self.frame.border = border;
                }
                if let Some(dashed) = dashed {
                    self.frame.dashed = *dashed;
                }
                if let Some(ink) = ink {
                    self.frame.border_ink = Some(match ink {
                        Ink::Current => self.context.look.ink.unwrap_or(Ink::Current),
                        other => *other,
                    });
                }
            }
            Declared::Radius(measure) => {
                self.frame.radius = self.len(*measure).unwrap_or(Len::ZERO);
            }
            Declared::Shadow(shadow) => self.frame.shadow = *shadow,
            Declared::Width(measure) => self.frame.width = self.extent(*measure),
            Declared::MinWidth(measure) => self.frame.min_width = self.extent(*measure),
            Declared::MaxWidth(measure) => self.frame.max_width = self.extent(*measure),
            Declared::Height(measure) => self.frame.height = self.len(*measure),
            Declared::MinHeight(measure) => self.frame.min_height = self.len(*measure),
            Declared::MaxHeight(measure) => self.frame.max_height = self.len(*measure),
            Declared::Clip(clip) => self.frame.clip = *clip,
            Declared::Flex(grow, shrink, basis) => {
                let flex = self.frame.flex.get_or_insert(Flex {
                    grow: 0.0,
                    shrink: 1.0,
                    basis: Extent::Auto,
                });
                flex.grow = grow.unwrap_or(flex.grow);
                flex.shrink = shrink.unwrap_or(flex.shrink);
                if let Some(basis) = basis {
                    let basis = self.extent(*basis);
                    if let Some(flex) = &mut self.frame.flex {
                        flex.basis = basis;
                    }
                }
            }
            Declared::Column(column) => self.row.column = *column,
            Declared::Wrap(wrap) => self.row.wrap = *wrap,
            Declared::Gap(measure) => self.row.gap = self.len(*measure).unwrap_or(Len::ZERO),
            Declared::Justify(justify) => self.row.justify = *justify,
            Declared::CrossCentred(centred) => self.row.centred = *centred,
            _ => {}
        }
    }

    fn margin(&mut self, edges: Edges, values: &[Measure; 4]) {
        let mut margin = self.frame.margin;
        let [top, right, bottom, left] = edges.0;
        self.frame.margin_said.0 |= top;
        self.frame.margin_said.1 |= bottom;
        for (side, value) in sides_mut(&mut margin, edges).zip(values) {
            *side = self.len(*value).unwrap_or(Len::ZERO);
        }
        self.frame.margin = margin;
        let auto = |at: usize| values[at] == Measure::Auto;
        if right && left && auto(1) && auto(3) {
            self.frame.centred = true;
        } else if right || left {
            self.frame.centred = false;
        }
    }
}

/// The sides `edges` names, in the order top, right, bottom, left.
fn sides_mut<T>(sides: &mut Sides<T>, edges: Edges) -> impl Iterator<Item = &mut T> {
    let Sides {
        top,
        right,
        bottom,
        left,
    } = sides;
    [top, right, bottom, left]
        .into_iter()
        .zip(edges.0)
        .filter_map(|(side, set)| set.then_some(side))
}

/// The level of a heading tag.
pub(super) fn heading(tag: &str) -> Option<u8> {
    match tag.as_bytes() {
        [b'h', level @ b'1'..=b'6'] => Some(level - b'0'),
        _ => None,
    }
}

/// How a tag stands in the flow, by default.
fn display_of(tag: &str) -> Display {
    match tag {
        "p" | "pre" | "blockquote" | "ul" | "ol" | "hr" | "table" | "thead" | "tbody" | "tfoot"
        | "tr" | "td" | "th" => Display::Block,
        "li" => Display::ListItem,
        _ if heading(tag).is_some() => Display::Block,
        _ => Display::Inline,
    }
}

/// A font size said as `size`, inside text `outer` large.
pub(super) fn font_size(size: FontSize, outer: Len) -> Len {
    match size {
        FontSize::Measure(Measure::Px(px)) => Len::px(px),
        FontSize::Measure(Measure::Em(em)) => outer.times(em),
        FontSize::Measure(Measure::Rem(rem)) => Len::px(rem * 16.0),
        FontSize::Measure(Measure::Percent(share)) => outer.times(share / 100.0),
        FontSize::Measure(Measure::Auto) => outer,
        FontSize::Keyword(px) => Len::px(px),
        FontSize::Relative(by) => outer.times(by),
    }
}

/// What the old `<font size>` asks for: one of seven sizes, or a step from
/// the middle one, as a browser reads it.
pub(super) fn font_steps(size: &str) -> Option<FontSize> {
    const SIZES: [f32; 7] = [10.0, 13.0, 16.0, 18.0, 24.0, 32.0, 48.0];
    let size = size.trim();
    let step: i32 = if let Some(more) = size.strip_prefix('+') {
        3 + more.parse::<i32>().ok()?
    } else if let Some(less) = size.strip_prefix('-') {
        3 - less.parse::<i32>().ok()?
    } else {
        size.parse().ok()?
    };
    let index = usize::try_from(step.clamp(1, 7) - 1).ok()?;
    Some(FontSize::Keyword(SIZES[index]))
}
