//! Room inside the boxes a document draws.
//!
//! A welcome message often draws a panel of its own, a table with a border
//! and a fill, and says nothing about the room inside it: a browser then
//! sets the text against the panel's edge. Both clients give such a box
//! room instead, by one rule (the web client's is `boxPadding.ts`):
//!
//! - A box is a block, a table cell or a link made into a button that has a
//!   border or a fill of its own, or a cell of a table that has one.
//! - A side whose padding the document set keeps it, zero included; every
//!   other side gets [`ABOVE`] and [`BESIDE`] times the box's own text.
//! - Where it got that room above, its first block's top margin is dropped,
//!   and below, its last block's bottom margin, unless the document set
//!   them: a paragraph's 1em would leave the box lopsided.
//! - Nothing else gets anything, and neither does a box with nothing in it
//!   (a stripe of colour beside a callout): there is no text to keep off
//!   its edge.

use super::style::Styled;
use super::tree::{Block, Ink, Kind, Len, Piece, Sides};

/// The room above and below, and at either side, as a share of the box's
/// own text: 8 and 12 pixels in a welcome's 13.5.
const ABOVE: f32 = 0.6;
const BESIDE: f32 = 0.9;

/// Whether a box draws an edge or a ground that can be seen.
pub(super) fn is_box(styled: &Styled) -> bool {
    let frame = &styled.frame;
    let border = frame.border;
    let edged = [border.top, border.right, border.bottom, border.left]
        .iter()
        .any(|width| *width > 0.0);
    let seen = |ink: Ink| !matches!(ink, Ink::Rgba([_, _, _, 0]));
    edged || frame.ground.is_some_and(seen) || frame.wash.is_some()
}

/// Give `styled`'s box the room the rule says, on each side the document
/// left alone, and let its first and last blocks of `inside` sit in that
/// room rather than on top of it.
pub(super) fn pad(styled: &mut Styled, inside: &mut [Block]) {
    let size = styled.context.look.size;
    let said = styled.padded;
    let padding = &mut styled.frame.padding;
    let room = |said: bool, side: &mut Len, times: f32| {
        if !said {
            *side = size.times(times);
        }
    };
    room(said.top, &mut padding.top, ABOVE);
    room(said.right, &mut padding.right, BESIDE);
    room(said.bottom, &mut padding.bottom, ABOVE);
    room(said.left, &mut padding.left, BESIDE);
    if !said.top {
        snug(inside, true);
    }
    if !said.bottom {
        snug(inside, false);
    }
}

/// Drop the margin of the block at one end of `blocks` (`top`: the first's
/// above, else the last's below), and of the block at that end inside it
/// where its margin would come through, unless the document set it.
fn snug(blocks: &mut [Block], top: bool) {
    let end = if top {
        blocks.first_mut()
    } else {
        blocks.last_mut()
    };
    let Some(block) = end else {
        return;
    };
    let frame = &mut block.frame;
    let (said, margin) = if top {
        (frame.margin_said.0, &mut frame.margin.top)
    } else {
        (frame.margin_said.1, &mut frame.margin.bottom)
    };
    if !said {
        *margin = Len::ZERO;
    }
    // A plain box hands its first block's margin out through itself.
    let open = if top {
        frame.padding.top == Len::ZERO && frame.border.top == 0.0
    } else {
        frame.padding.bottom == Len::ZERO && frame.border.bottom == 0.0
    };
    if open && let Kind::Stack(inner) = &mut block.kind {
        snug(inner, top);
    }
}

/// Whether there is anything in `blocks` to keep off a box's edge: words
/// or a picture.
pub(super) fn holds(blocks: &[Block]) -> bool {
    blocks
        .iter()
        .flat_map(Block::every)
        .any(|block| match &block.kind {
            Kind::Picture(_) => true,
            Kind::Para(para) => para.pieces.iter().any(|piece| match piece {
                Piece::Words(words) => !words.text.trim().is_empty(),
                Piece::Atom(_) => true,
            }),
            Kind::List(items) => !items.is_empty(),
            _ => false,
        })
}

/// Which sides of a box the document set the padding of.
pub(super) type Said = Sides<bool>;
