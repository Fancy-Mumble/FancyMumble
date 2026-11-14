//! Drawing on a shared screen, as the web client draws
//! (`DrawingOverlay.tsx`): its seven colours, its widths, its packets.
//!
//! A stroke's points are fractions of the shared picture: 0 to 1 across the
//! part of the stage the picture fills, whatever room it is shown in, so a
//! stroke lands on the same spot of the picture on every screen. Its width
//! is a fraction of the picture's height. Points go out every 300 ms while a
//! stroke is drawn, only those added since the last packet (the server's
//! rate limit counts every message), and the last packet ends the stroke.
//! Strokes stay until their drawer clears them, the sharer clears all of
//! them, or the share they were drawn on ends.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::engine::{ChannelId, Session};

/// The colours offered, ARGB, red first as the web client's are.
pub(crate) const COLOURS: [u32; 7] = [
    0xFF_FF_00_00,
    0xFF_00_CC_00,
    0xFF_00_88_FF,
    0xFF_FF_BB_00,
    0xFF_FF_00_FF,
    0xFF_FF_FF_FF,
    0xFF_00_00_00,
];
/// The widths offered, in pixels of the picture as drawn on screen.
pub(crate) const WIDTHS: std::ops::RangeInclusive<u32> = 2..=16;
/// The width a pen starts with.
pub(crate) const WIDTH: u32 = 4;
/// How often a stroke being drawn is sent on.
pub(crate) const SEND_EVERY: Duration = Duration::from_millis(300);
/// Packets with no id (a server that does not carry it, as Starling's
/// canon does not) this close together are one stroke.
const JOINED: Duration = Duration::from_millis(450);

/// One packet of a stroke, going out or come in (`FancyDrawStroke`).
#[derive(Debug, Clone)]
pub(crate) struct Stroke {
    pub sender: Session,
    pub channel: ChannelId,
    pub id: String,
    /// ARGB.
    pub colour: u32,
    /// In the drawer's pixels, for a client that reads no `width_frac`.
    pub width: f32,
    /// As a fraction of the picture's height.
    pub width_frac: Option<f32>,
    /// `x, y` pairs, 0 to 1 across the picture.
    pub points: Vec<f32>,
    pub end: bool,
    pub clear: bool,
    pub clear_all: bool,
}

impl PartialEq for Stroke {
    fn eq(&self, other: &Self) -> bool {
        let bits = |floats: &[f32]| floats.iter().map(|f| f.to_bits()).collect::<Vec<_>>();
        self.sender == other.sender
            && self.channel == other.channel
            && self.id == other.id
            && self.colour == other.colour
            && self.width.to_bits() == other.width.to_bits()
            && self.width_frac.map(f32::to_bits) == other.width_frac.map(f32::to_bits)
            && bits(&self.points) == bits(&other.points)
            && (self.end, self.clear, self.clear_all) == (other.end, other.clear, other.clear_all)
    }
}

impl Eq for Stroke {}

/// A stroke as it is drawn.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Drawn {
    pub colour: u32,
    /// As a fraction of the picture's height, where the drawer said.
    pub width_frac: Option<f32>,
    /// In pixels, where it did not.
    pub width: f32,
    pub points: Vec<(f32, f32)>,
}

impl Drawn {
    /// How wide it is over a picture drawn `height` pixels high.
    pub(crate) fn width_over(&self, height: f32) -> f32 {
        self.width_frac
            .map_or(self.width, |frac| frac * height)
            .max(1.0)
    }
}

/// A stroke, by who drew it and what they call it.
type Key = (Session, String);

/// Every stroke drawn in each channel, in the order they began.
#[derive(Debug, Default)]
pub(crate) struct Strokes {
    channels: HashMap<ChannelId, Vec<(Key, Drawn)>>,
    /// For each drawer whose packets come without an id: the id given to
    /// the stroke they are drawing, and when its last packet came.
    unnamed: HashMap<Session, (String, Instant)>,
    named: u64,
    /// How many times what is drawn has changed: what a view drawn only
    /// for the strokes compares.
    changes: u64,
}

impl Strokes {
    /// Take one packet, come `at`. `sharing` says whether its sender is
    /// sharing in its channel: only a sharer clears everybody's strokes, and
    /// a clearing of all from anybody else clears their own.
    pub(crate) fn take(&mut self, mut stroke: Stroke, sharing: bool, at: Instant) {
        self.changes += 1;
        if stroke.id.is_empty() && !stroke.clear {
            stroke.id = self.name_of(stroke.sender, at);
        }
        let drawn = self.channels.entry(stroke.channel).or_default();
        if stroke.clear {
            if stroke.clear_all && sharing {
                drawn.clear();
            } else {
                drawn.retain(|((sender, _), _)| *sender != stroke.sender);
            }
            return;
        }
        let points = stroke.points.as_chunks::<2>().0.iter().map(|[x, y]| (*x, *y));
        let key = (stroke.sender, stroke.id);
        match drawn.iter_mut().find(|(held, _)| *held == key) {
            Some((_, held)) => held.points.extend(points),
            None => drawn.push((
                key,
                Drawn {
                    // A colour that lost its alpha on the way (Starling's
                    // canon carries it as `#rrggbb`) is opaque.
                    colour: if stroke.colour >> 24 == 0 {
                        stroke.colour | 0xFF00_0000
                    } else {
                        stroke.colour
                    },
                    width_frac: stroke.width_frac.filter(|frac| *frac > 0.0),
                    width: if stroke.width > 0.0 { stroke.width } else { WIDTH as f32 },
                    points: points.collect(),
                },
            )),
        }
    }

    /// The id of the stroke `sender` is drawing, for a packet that came
    /// without one: the last one's while packets keep coming, a new one
    /// after a pause.
    fn name_of(&mut self, sender: Session, at: Instant) -> String {
        let fresh = match self.unnamed.get(&sender) {
            Some((name, last)) if at.duration_since(*last) < JOINED => name.clone(),
            _ => {
                self.named += 1;
                format!("~{}", self.named)
            }
        };
        let _ = self.unnamed.insert(sender, (fresh.clone(), at));
        fresh
    }

    /// How many times what is drawn has changed.
    pub(crate) fn changes(&self) -> u64 {
        self.changes
    }

    /// The strokes of `channel`, oldest first.
    pub(crate) fn of(&self, channel: ChannelId) -> impl Iterator<Item = &Drawn> {
        self.channels
            .get(&channel)
            .into_iter()
            .flatten()
            .map(|(_, drawn)| drawn)
    }

    /// Forget what `sender` drew anywhere: their share ended, or they left.
    pub(crate) fn forget_sender(&mut self, sender: Session) {
        self.changes += 1;
        for drawn in self.channels.values_mut() {
            drawn.retain(|((by, _), _)| *by != sender);
        }
    }

    /// Forget every stroke in `channel`.
    pub(crate) fn forget_channel(&mut self, channel: ChannelId) {
        self.changes += 1;
        let _ = self.channels.remove(&channel);
    }

    /// Forget everything: another server.
    pub(crate) fn forget_all(&mut self) {
        self.changes += 1;
        self.channels.clear();
    }
}

/// A stroke being drawn here: what has been sent of it, and what is still to
/// go.
#[derive(Debug)]
pub(crate) struct Pen {
    channel: ChannelId,
    id: String,
    colour: u32,
    width: f32,
    width_frac: f32,
    /// Points drawn and not sent yet.
    unsent: Vec<f32>,
    /// Every point drawn, for drawing it here while it is drawn.
    all: Vec<(f32, f32)>,
}

impl Pen {
    /// A stroke begun at `at` in `channel`, `width` pixels wide over a
    /// picture drawn `height` pixels high.
    pub(crate) fn down(channel: ChannelId, colour: u32, width: u32, height: f32, at: (f32, f32)) -> Self {
        let width = width as f32;
        Self {
            channel,
            id: stroke_id(),
            colour,
            width,
            width_frac: width / height.max(1.0),
            unsent: vec![at.0, at.1],
            all: vec![at],
        }
    }

    /// The pen went on to `at`.
    pub(crate) fn to(&mut self, at: (f32, f32)) {
        self.unsent.extend([at.0, at.1]);
        self.all.push(at);
    }

    /// The stroke so far, to draw.
    pub(crate) fn drawn(&self) -> Drawn {
        Drawn {
            colour: self.colour,
            width_frac: Some(self.width_frac),
            width: self.width,
            points: self.all.clone(),
        }
    }

    /// The whole stroke as one packet: what is kept of it here.
    pub(crate) fn whole(&self, own: Session) -> Stroke {
        Stroke {
            points: self.all.iter().flat_map(|(x, y)| [*x, *y]).collect(),
            end: true,
            ..self.packet_with(own, Vec::new(), true)
        }
    }

    /// The packet of what was drawn since the last, if anything was: sent
    /// every [`SEND_EVERY`] while the stroke goes on.
    pub(crate) fn packet(&mut self, own: Session) -> Option<Stroke> {
        (!self.unsent.is_empty()).then(|| {
            let points = std::mem::take(&mut self.unsent);
            self.packet_with(own, points, false)
        })
    }

    /// The pen came up: the last packet, which ends the stroke.
    pub(crate) fn up(mut self, own: Session) -> Stroke {
        let points = std::mem::take(&mut self.unsent);
        self.packet_with(own, points, true)
    }

    fn packet_with(&self, own: Session, points: Vec<f32>, end: bool) -> Stroke {
        Stroke {
            sender: own,
            channel: self.channel,
            id: self.id.clone(),
            colour: self.colour,
            width: self.width,
            width_frac: Some(self.width_frac),
            points,
            end,
            clear: false,
            clear_all: false,
        }
    }
}

/// The packet that clears what `own` drew in `channel`, or everything there
/// when `everybody` (the sharer's clear).
pub(crate) fn clearing(own: Session, channel: ChannelId, everybody: bool) -> Stroke {
    Stroke {
        sender: own,
        channel,
        id: stroke_id(),
        colour: 0,
        width: 0.0,
        width_frac: None,
        points: Vec::new(),
        end: false,
        clear: true,
        clear_all: everybody,
    }
}

/// A new stroke's id: random, written as a UUID is, as the web client's
/// `crypto.randomUUID()` writes one.
fn stroke_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    static COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let half = || {
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_u64(COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
        hasher.finish()
    };
    let bits = u128::from(half()) << 64 | u128::from(half());
    let hex = format!("{bits:032x}");
    format!(
        "{}-{}-4{}-a{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[13..16],
        &hex[17..20],
        &hex[20..]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(sender: Session, id: &str, points: &[f32], end: bool) -> Stroke {
        Stroke {
            sender,
            channel: 1,
            id: id.to_owned(),
            colour: COLOURS[2],
            width: 4.0,
            width_frac: Some(0.01),
            points: points.to_vec(),
            end,
            clear: false,
            clear_all: false,
        }
    }

    #[test]
    fn a_strokes_packets_join_into_one_line() {
        let mut strokes = Strokes::default();
        strokes.take(line(2, "a", &[0.1, 0.1, 0.2, 0.2], false), false, Instant::now());
        strokes.take(line(2, "a", &[0.3, 0.3], true), false, Instant::now());
        strokes.take(line(3, "a", &[0.5, 0.5], true), false, Instant::now());
        let drawn: Vec<&Drawn> = strokes.of(1).collect();
        assert_eq!(drawn.len(), 2, "the same id from two drawers is two strokes");
        assert_eq!(drawn[0].points, [(0.1, 0.1), (0.2, 0.2), (0.3, 0.3)]);
        assert_eq!(drawn[0].width_over(500.0), 5.0);
        assert_eq!(strokes.of(2).count(), 0, "another channel");
    }

    #[test]
    fn a_clear_takes_the_drawers_own_and_only_a_sharer_clears_everybodys() {
        let mut strokes = Strokes::default();
        strokes.take(line(2, "a", &[0.1, 0.1], true), false, Instant::now());
        strokes.take(line(3, "b", &[0.2, 0.2], true), false, Instant::now());
        strokes.take(clearing(3, 1, true), false, Instant::now());
        assert_eq!(strokes.of(1).count(), 1, "not a sharer: their own only");
        strokes.take(line(3, "c", &[0.2, 0.2], true), false, Instant::now());
        strokes.take(clearing(2, 1, true), true, Instant::now());
        assert_eq!(strokes.of(1).count(), 0, "the sharer's clears all");
    }

    #[test]
    fn a_packet_from_an_older_client_is_drawn_as_wide_as_it_says() {
        let mut strokes = Strokes::default();
        let mut old = line(2, "a", &[0.1, 0.1], true);
        old.width_frac = None;
        old.width = 6.0;
        strokes.take(old, false, Instant::now());
        let drawn = strokes.of(1).next().expect("drawn");
        assert_eq!(drawn.width_over(1000.0), 6.0, "pixels, whatever the size");
    }

    #[test]
    fn packets_that_lost_their_id_and_alpha_on_the_way_are_still_drawn() {
        // Starling's canon carries neither a stroke's id nor its colour's
        // alpha: packets close together are one stroke, a pause starts the
        // next, and the colour is opaque.
        let mut strokes = Strokes::default();
        let start = Instant::now();
        let mut packet = line(2, "", &[0.1, 0.1], false);
        packet.colour = 0x00_00_88_FF;
        strokes.take(packet.clone(), false, start);
        strokes.take(packet.clone(), false, start + Duration::from_millis(300));
        strokes.take(packet, false, start + Duration::from_secs(2));
        let drawn: Vec<&Drawn> = strokes.of(1).collect();
        assert_eq!(drawn.len(), 2);
        assert_eq!(drawn[0].points.len(), 2);
        assert_eq!(drawn[0].colour, 0xFF_00_88_FF);
    }

    #[test]
    fn a_pen_sends_what_was_drawn_since_the_last_packet_and_ends_with_the_last() {
        let mut pen = Pen::down(1, COLOURS[0], 8, 400.0, (0.5, 0.5));
        pen.to((0.6, 0.5));
        let first = pen.packet(7).expect("the start and the first move");
        assert_eq!(first.points, [0.5, 0.5, 0.6, 0.5]);
        assert_eq!(first.width_frac, Some(0.02));
        assert!(!first.end);
        assert!(pen.packet(7).is_none(), "nothing new, nothing sent");
        pen.to((0.7, 0.5));
        pen.to((0.8, 0.5));
        assert_eq!(pen.drawn().points.len(), 4, "drawn here whole");
        assert_eq!(pen.whole(7).points.len(), 8);
        let last = pen.up(7);
        assert_eq!(last.points, [0.7, 0.5, 0.8, 0.5]);
        assert!(last.end);
        assert_eq!(last.id, first.id, "one stroke");
        assert_eq!((last.sender, last.channel), (7, 1));
    }

    #[test]
    fn stroke_ids_are_written_as_uuids_and_differ() {
        let (a, b) = (stroke_id(), stroke_id());
        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
        assert_eq!(a.matches('-').count(), 4);
        assert_eq!(&a[14..15], "4");
    }
}
