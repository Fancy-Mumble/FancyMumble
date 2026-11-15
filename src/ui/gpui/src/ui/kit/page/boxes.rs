//! The box around a block: its room, its edge, its ground, its size; and
//! the two blocks that are only a box, a rule and a picture.

use std::collections::HashMap;

use gpui::{
    AlignSelf, AnyElement, App, BoxShadow, Div, Global, ParentElement, SharedString, Styled, div,
    linear_color_stop, linear_gradient, point, prelude::*, px, relative,
};

use super::Painter;
use crate::page::{Block, Extent, Family, Fit, Frame, Kind, Len, Picture};

/// The families a page's text has asked for, each as the first of its
/// stack this system has: asking the system is for once, not each frame.
#[derive(Default)]
pub(super) struct Families(HashMap<String, SharedString>);

impl Global for Families {}

impl Families {
    /// Those found so far, for one page to use and add to.
    pub(super) fn take(cx: &mut App) -> Self {
        std::mem::take(cx.default_global::<Self>())
    }

    /// Keep what was found for the next page.
    pub(super) fn give_back(self, cx: &mut App) {
        *cx.default_global::<Self>() = self;
    }

    /// The family `family` comes to, if it is not the surface's.
    pub(super) fn of(&self, family: &Family, mono: &SharedString) -> Option<SharedString> {
        match family {
            Family::Surface => None,
            Family::Mono => Some(mono.clone()),
            Family::Named(stack) if names_serif(stack) => self.0.get(SERIF).cloned(),
            // Any face but a generic one is the surface's own: a face this
            // system may not have falls back to whatever it does, which is
            // how a page came out scuffed.
            Family::Named(_) => None,
        }
    }

    /// Find the system's serif face, if a page asks for one.
    pub(super) fn learn(&mut self, stacks: impl Iterator<Item = String>, cx: &App) {
        for stack in stacks {
            if names_serif(&stack) && !self.0.contains_key(SERIF) {
                let _ = self
                    .0
                    .insert(SERIF.to_owned(), crate::theme::family(SERIF, cx));
            }
        }
    }
}

/// The generic family asked for by name, the one besides code's honoured.
const SERIF: &str = "serif";

/// Whether a CSS font stack falls back to the serif generic family.
fn names_serif(stack: &str) -> bool {
    stack
        .split(',')
        .any(|name| name.trim().trim_matches('"').eq_ignore_ascii_case(SERIF))
}

/// Whether a box keeps the room its first and last blocks ask for inside
/// its own edges, rather than handing it out: it does if an edge or room
/// of its own stands between, or it cuts off what is outside it.
pub(super) fn keeps_edges(frame: &Frame) -> (bool, bool) {
    let shut = frame.clip || frame.flex.is_some();
    (
        shut || frame.padding.top != Len::ZERO || frame.border.top > 0.0,
        shut || frame.padding.bottom != Len::ZERO
            || frame.border.bottom > 0.0
            || frame.height.is_some(),
    )
}

/// The room a block asks for above and below it, in pixels, with what
/// its first and last blocks ask for where that is handed out through it.
pub(super) fn margins(block: &Block, base: f32) -> (f32, f32) {
    let own = (
        block.frame.margin.top.at(base),
        block.frame.margin.bottom.at(base),
    );
    let Kind::Stack(inner) = &block.kind else {
        return own;
    };
    let kept = keeps_edges(&block.frame);
    let top = inner
        .first()
        .filter(|_| !kept.0)
        .map_or(0.0, |first| margins(first, base).0);
    let bottom = inner
        .last()
        .filter(|_| !kept.1)
        .map_or(0.0, |last| margins(last, base).1);
    (own.0.max(top), own.1.max(bottom))
}

impl Painter<'_> {
    /// `len` in whole pixels: an edge or a room between pixels sets the
    /// text inside it between pixels too, and blurs it.
    fn length(&self, len: Len) -> gpui::Pixels {
        px(len.at(self.surface.size).round())
    }

    fn extent(&self, extent: Extent) -> Option<gpui::Length> {
        match extent {
            Extent::Auto => None,
            Extent::Len(len) => Some(self.length(len).into()),
            Extent::Share(share) => Some(relative(share).into()),
        }
    }

    /// `part` in the box `frame` says. A list's gutter is its marks', and
    /// a box that `shrinks` is as wide as what is in it.
    pub(super) fn framed(&self, part: Div, frame: &Frame, listed: bool, shrinks: bool) -> Div {
        let mut part = self.sized(part, frame).when(shrinks, |part| {
            let mut part = part;
            part.style().align_self = Some(AlignSelf::FlexStart);
            part
        });
        let padding = frame.padding;
        part = part
            .pt(self.length(padding.top))
            .pr(self.length(padding.right))
            .pb(self.length(padding.bottom))
            .when(!listed, |part| part.pl(self.length(padding.left)));
        part = if frame.centred {
            part.mx_auto()
        } else {
            part.ml(self.length(frame.margin.left))
                .mr(self.length(frame.margin.right))
        };
        let border = frame.border;
        if border != crate::page::Sides::default() {
            part = part
                .border_t(px(border.top))
                .border_r(px(border.right))
                .border_b(px(border.bottom))
                .border_l(px(border.left))
                .border_color(
                    frame
                        .border_ink
                        .map_or(self.surface.ink, |ink| self.ink(ink)),
                )
                .when(frame.dashed, Styled::border_dashed);
        }
        let radius = self.length(frame.radius);
        part = part
            .rounded(radius)
            .when(frame.clip, Styled::overflow_hidden);
        if let Some(shadow) = frame.shadow {
            part = part.shadow(vec![BoxShadow {
                color: self.ink(shadow.ink),
                offset: point(px(shadow.x), px(shadow.y)),
                blur_radius: px(shadow.blur / 2.0),
                spread_radius: px(shadow.spread),
                inset: false,
            }]);
        }
        self.grounded(part, frame, radius)
    }

    /// Its ground: a colour, a wash, or a wash over a colour.
    fn grounded(&self, part: Div, frame: &Frame, radius: gpui::Pixels) -> Div {
        let wash = frame.wash.map(|wash| {
            linear_gradient(
                wash.angle,
                linear_color_stop(self.ink(wash.from), 0.0),
                linear_color_stop(self.ink(wash.to), 1.0),
            )
        });
        match (frame.ground.map(|ink| self.ink(ink)), wash) {
            (Some(ground), Some(wash)) => part.relative().bg(ground).child(
                div()
                    .absolute()
                    .top_0()
                    .left_0()
                    .size_full()
                    .rounded(radius)
                    .bg(wash),
            ),
            (Some(ground), None) => part.bg(ground),
            (None, Some(wash)) => part.bg(wash),
            (None, None) => part,
        }
    }

    /// `part` as large as `frame` asks.
    fn sized(&self, part: Div, frame: &Frame) -> Div {
        let mut part = part;
        let style = part.style();
        if let Some(width) = self.extent(frame.width) {
            style.size.width = Some(width);
        }
        if let Some(width) = self.extent(frame.min_width) {
            style.min_size.width = Some(width);
        }
        if let Some(width) = self.extent(frame.max_width) {
            style.max_size.width = Some(width);
        }
        let len = |len: Option<Len>| len.map(|len| gpui::Length::from(self.length(len)));
        // A height is the least a box is: one too short for its lines
        // would cut them.
        if let Some(height) = len(frame.height) {
            style.min_size.height = Some(height);
        }
        if let Some(height) = len(frame.min_height) {
            style.min_size.height = Some(height);
        }
        if let Some(height) = len(frame.max_height) {
            style.max_size.height = Some(height);
        }
        part
    }

    /// A picture at the size the document asks for, else its own, never
    /// wider than its room, drawn from a copy kept at the size it is seen.
    pub(super) fn picture(&self, picture: &Picture, frame: &Frame) -> AnyElement {
        let base = self.surface.size;
        let natural = picture.natural.map(|(width, height)| {
            #[expect(
                clippy::cast_precision_loss,
                reason = "a picture's side is far below 2^24"
            )]
            let size = (width as f32, height as f32);
            size
        });
        let stated = |extent: Extent| match extent {
            Extent::Len(len) => Some(len.at(base)),
            Extent::Auto | Extent::Share(_) => None,
        };
        let height = frame.height.map(|len| len.at(base));
        let width = stated(frame.width).or_else(|| {
            let (wide, tall) = natural?;
            Some(height.map_or(wide, |height| height * wide / tall))
        });
        let height = height.or_else(|| {
            let (wide, tall) = natural?;
            width.map(|width| width * tall / wide)
        });
        let large = width.is_some_and(|width| width > 460.0) || height.is_some_and(|h| h > 320.0);
        let fit = if large {
            crate::pictures::Fit::Page
        } else {
            crate::pictures::Fit::Tile
        };
        let drawn = gpui::img(crate::pictures::shown(&picture.image, fit))
            .size_full()
            .rounded(self.length(frame.radius))
            .object_fit(match picture.fit {
                Fit::Fill => gpui::ObjectFit::Fill,
                Fit::Contain => gpui::ObjectFit::Contain,
                Fit::Cover => gpui::ObjectFit::Cover,
            });
        let tag = self.tag("picture");
        let mut held = div().debug_selector(move || tag).flex_none().max_w_full();
        {
            let style = held.style();
            if let Some(width) = width {
                style.size.width = Some(px(width).into());
            }
            if let Extent::Share(share) = frame.width {
                style.size.width = Some(relative(share).into());
            }
            if let (Some(width), Some(height)) = (width, height) {
                style.aspect_ratio = Some(width / height);
            }
        }
        let held = held
            .when(frame.centred, Styled::mx_auto)
            .when(!frame.centred, |held| {
                let mut held = held;
                held.style().align_self = Some(AlignSelf::FlexStart);
                held
            })
            .rounded(self.length(frame.radius))
            .overflow_hidden()
            .child(drawn);
        self.linked(held, frame.link.as_ref())
    }
}

/// Every font stack named in `blocks`.
pub(super) fn stacks(blocks: &[Block]) -> Vec<String> {
    blocks
        .iter()
        .flat_map(Block::every)
        .filter_map(|block| match &block.kind {
            Kind::Para(para) => Some(para),
            _ => None,
        })
        .flat_map(|para| &para.pieces)
        .filter_map(|piece| match piece {
            crate::page::Piece::Words(words) => Some(words),
            crate::page::Piece::Atom(_) => None,
        })
        .flat_map(|words| &words.runs)
        .filter_map(|(_, look)| match &look.family {
            Family::Named(stack) => Some(stack.to_string()),
            _ => None,
        })
        .collect()
}
