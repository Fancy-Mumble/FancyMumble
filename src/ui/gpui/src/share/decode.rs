//! A watched share decoded to frames, on a thread of its own.
//!
//! The viewer (`fancy_screenshare::viewer`) hands over H.264 as the web
//! page's decoder takes it: length-prefixed units, with the parameter sets
//! apart in an `avcC` record. openh264 reads start codes, so [`AnnexB`] puts
//! them back. [`Decoding`] then decodes every unit while the share is in
//! sight (a unit skipped breaks every one after it until the next keyframe),
//! makes a frame only as often as the window wants one and only as large as
//! it is drawn, and while the share is out of sight decodes nothing at all:
//! coming back into sight, it asks for a keyframe and starts again there.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use openh264::formats::YUVSource;

use super::Wake;
use super::convert::{Converter, Planes};
use super::frame::{Frame, FrameSlot, Pace, Wanted};

/// What the viewer hands over for one track.
#[derive(Debug, Clone)]
pub(crate) enum Unit {
    #[cfg_attr(target_os = "android", expect(dead_code, reason = "what uses it is not built on Android, where share/real_absent.rs stands in"))]
    /// A new `avcC` record: the parameter sets every unit after it needs.
    Config(Vec<u8>),
    #[cfg_attr(target_os = "android", expect(dead_code, reason = "what uses it is not built on Android, where share/real_absent.rs stands in"))]
    /// One access unit, length-prefixed.
    Sample { data: Vec<u8>, keyframe: bool },
}

/// Length-prefixed H.264 back to start codes.
#[derive(Debug, Default)]
pub(crate) struct AnnexB {
    /// The parameter sets, start codes and all, put before every keyframe.
    sets: Vec<u8>,
}

const START: [u8; 4] = [0, 0, 0, 1];

impl AnnexB {
    /// Read an `avcC` record; says whether it held a parameter set.
    pub(crate) fn configure(&mut self, avcc: &[u8]) -> bool {
        let mut sets = Vec::new();
        let mut at = 5;
        for count_mask in [0x1F, 0xFF] {
            let Some(count) = avcc.get(at) else {
                return false;
            };
            at += 1;
            for _ in 0..(count & count_mask) {
                let Some(len) = avcc.get(at..at + 2) else {
                    return false;
                };
                let len = usize::from(u16::from_be_bytes([len[0], len[1]]));
                let Some(set) = avcc.get(at + 2..at + 2 + len) else {
                    return false;
                };
                sets.extend_from_slice(&START);
                sets.extend_from_slice(set);
                at += 2 + len;
            }
        }
        let read = !sets.is_empty();
        if read {
            self.sets = sets;
        }
        read
    }

    /// One length-prefixed unit, with start codes, into `out`.
    pub(crate) fn unit(&self, data: &[u8], keyframe: bool, out: &mut Vec<u8>) {
        out.clear();
        if keyframe {
            out.extend_from_slice(&self.sets);
        }
        let mut rest = data;
        while rest.len() >= 4 {
            let len = u32::from_be_bytes([rest[0], rest[1], rest[2], rest[3]]) as usize;
            let Some(nal) = rest.get(4..4 + len) else {
                break;
            };
            out.extend_from_slice(&START);
            out.extend_from_slice(nal);
            rest = &rest[4 + len..];
        }
    }
}

/// What decoding one share has done, for the statistics.
#[derive(Debug, Default)]
pub(crate) struct Counts {
    pub decoded: AtomicU64,
    /// Units passed over while the share was out of sight, or waiting for a
    /// keyframe.
    pub skipped: AtomicU64,
    pub failed: AtomicU64,
    /// Microseconds spent decoding and making frames.
    pub busy_us: AtomicU64,
    /// The size last decoded, one word each.
    pub sent: AtomicU64,
}

impl Counts {
    pub(crate) fn sent(&self) -> Option<(u32, u32)> {
        let both = self.sent.load(Ordering::Relaxed);
        #[expect(clippy::cast_possible_truncation, reason = "two words packed into one")]
        let (width, height) = ((both >> 32) as u32, both as u32);
        (width > 0).then_some((width, height))
    }
}

/// One share being decoded: everything its thread keeps between units.
pub(crate) struct Decoding {
    decoder: openh264::decoder::Decoder,
    annexb: AnnexB,
    unit: Vec<u8>,
    converter: Converter,
    slot: FrameSlot,
    wanted: Arc<Wanted>,
    pace: Pace,
    /// Out of sight, or failed: nothing decodes until a keyframe.
    needs_key: bool,
    /// When the window was last woken for a share out of sight.
    woke_unseen: Option<Instant>,
    wake: Wake,
    ask_key: Box<dyn Fn() + Send>,
    counts: Arc<Counts>,
}

impl std::fmt::Debug for Decoding {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Decoding")
            .field("needs_key", &self.needs_key)
            .finish_non_exhaustive()
    }
}

/// How often a share out of sight wakes the window: drawing is what says
/// it is back in sight.
const UNSEEN_WAKE: Duration = Duration::from_secs(1);

impl Decoding {
    pub(crate) fn new(
        slot: FrameSlot,
        wanted: Arc<Wanted>,
        wake: Wake,
        ask_key: Box<dyn Fn() + Send>,
        counts: Arc<Counts>,
    ) -> Result<Self, String> {
        Ok(Self {
            decoder: openh264::decoder::Decoder::new().map_err(|error| error.to_string())?,
            annexb: AnnexB::default(),
            unit: Vec::new(),
            converter: Converter::default(),
            slot,
            wanted,
            pace: Pace::default(),
            needs_key: true,
            woke_unseen: None,
            wake,
            ask_key,
            counts,
        })
    }

    #[cfg_attr(target_os = "android", expect(dead_code, reason = "what uses it is not built on Android, where share/real_absent.rs stands in"))]
    /// Take units until the viewer stops sending them.
    pub(crate) fn run(mut self, units: &std::sync::mpsc::Receiver<Unit>) {
        for unit in units {
            self.take(unit);
        }
    }

    /// One unit.
    pub(crate) fn take(&mut self, unit: Unit) {
        match unit {
            Unit::Config(avcc) => {
                if self.annexb.configure(&avcc) {
                    self.needs_key = true;
                }
            }
            Unit::Sample { data, keyframe } => self.sample(&data, keyframe),
        }
    }

    fn sample(&mut self, data: &[u8], keyframe: bool) {
        if !self.wanted.in_sight() {
            self.pass_over();
            return;
        }
        if self.needs_key && !keyframe {
            let _ = self.counts.skipped.fetch_add(1, Ordering::Relaxed);
            (self.ask_key)();
            return;
        }
        let started = Instant::now();
        self.annexb.unit(data, keyframe, &mut self.unit);
        match self.decoder.decode(&self.unit) {
            Ok(Some(picture)) => {
                self.needs_key = false;
                let _ = self.counts.decoded.fetch_add(1, Ordering::Relaxed);
                let (width, height) = picture.dimensions();
                let planes = Planes {
                    width: u32::try_from(width).unwrap_or(0),
                    height: u32::try_from(height).unwrap_or(0),
                    y: picture.y(),
                    u: picture.u(),
                    v: picture.v(),
                    strides: (picture.strides().0, picture.strides().1),
                };
                self.counts.sent.store(
                    u64::from(planes.width) << 32 | u64::from(planes.height),
                    Ordering::Relaxed,
                );
                if self.pace.due(self.wanted.rate(), Instant::now()) {
                    let frame = make(&mut self.converter, &self.slot, &self.wanted, &planes);
                    if self.slot.put(frame) {
                        self.wake.now();
                    }
                }
            }
            Ok(None) => {}
            Err(error) => {
                tracing::debug!(%error, "share: a unit did not decode; asking for a keyframe");
                let _ = self.counts.failed.fetch_add(1, Ordering::Relaxed);
                self.needs_key = true;
                (self.ask_key)();
            }
        }
        let busy = u64::try_from(started.elapsed().as_micros()).unwrap_or(u64::MAX);
        let _ = self.counts.busy_us.fetch_add(busy, Ordering::Relaxed);
    }

    /// Out of sight: decode nothing, and now and then wake the window, whose
    /// drawing of the share is what brings it back.
    fn pass_over(&mut self) {
        let _ = self.counts.skipped.fetch_add(1, Ordering::Relaxed);
        self.needs_key = true;
        let now = Instant::now();
        if self.woke_unseen.is_none_or(|woke| now.duration_since(woke) >= UNSEEN_WAKE) {
            self.woke_unseen = Some(now);
            self.wake.now();
        }
    }
}

/// The frame the window draws of `planes`.
fn make(converter: &mut Converter, slot: &FrameSlot, wanted: &Wanted, planes: &Planes<'_>) -> Frame {
    let sent = (planes.width, planes.height);
    let (width, height) = wanted.size_for(sent);
    let mut bgra = slot.buffer((width * height * 4) as usize);
    converter.convert(planes, (width, height), &mut bgra);
    Frame {
        width,
        height,
        bgra,
        sent,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn length_prefixed_units_get_their_start_codes_and_a_keyframe_its_parameter_sets() {
        let sps = [0x67, 0x42, 0xE0, 0x34, 0xAA];
        let pps = [0x68, 0xBB];
        // As the viewer's `build_avcc` writes it.
        let mut avcc = vec![1, 0x42, 0xE0, 0x34, 0xFF, 0xE1, 0, 5];
        avcc.extend_from_slice(&sps);
        avcc.extend_from_slice(&[1, 0, 2]);
        avcc.extend_from_slice(&pps);
        let mut annexb = AnnexB::default();
        assert!(annexb.configure(&avcc));
        let mut out = Vec::new();
        annexb.unit(&[0, 0, 0, 3, 0x65, 0xCC, 0xDD, 0, 0, 0, 1, 0x65], true, &mut out);
        let mut want = vec![0, 0, 0, 1];
        want.extend_from_slice(&sps);
        want.extend_from_slice(&[0, 0, 0, 1, 0x68, 0xBB]);
        want.extend_from_slice(&[0, 0, 0, 1, 0x65, 0xCC, 0xDD, 0, 0, 0, 1, 0x65]);
        assert_eq!(out, want);
        annexb.unit(&[0, 0, 0, 2, 0x41, 0x11], false, &mut out);
        assert_eq!(out, [0, 0, 0, 1, 0x41, 0x11], "a delta goes as it is");
        assert!(!annexb.configure(&[1, 2]), "a record cut short");
    }

    /// Encode `frames` of the test pattern as the broadcaster would, and
    /// hand them over as the viewer does.
    fn sent_as_viewer_sends(frames: u32) -> Vec<Unit> {
        super::super::replay::encoded((320, 180), frames)
    }

    fn decoding(wanted: &Arc<Wanted>, asked: &Arc<AtomicU64>) -> (Decoding, FrameSlot, Arc<Counts>) {
        let slot = FrameSlot::default();
        let counts = Arc::new(Counts::default());
        let asked = Arc::clone(asked);
        let decoding = Decoding::new(
            slot.clone(),
            Arc::clone(wanted),
            Wake::nowhere(),
            Box::new(move || {
                let _ = asked.fetch_add(1, Ordering::Relaxed);
            }),
            Arc::clone(&counts),
        )
        .expect("a decoder");
        (decoding, slot, counts)
    }

    #[test]
    fn a_share_in_sight_is_decoded_to_frames_the_size_it_is_drawn_that_read_back() {
        let wanted = Wanted::new();
        wanted.drawn(160, 90, u32::MAX, super::super::fit::Fit::Whole);
        let asked = Arc::new(AtomicU64::new(0));
        let (mut decoding, slot, counts) = decoding(&wanted, &asked);
        for unit in sent_as_viewer_sends(5) {
            decoding.take(unit);
        }
        assert_eq!(counts.decoded.load(Ordering::Relaxed), 5);
        assert_eq!(counts.sent(), Some((320, 180)));
        let frame = slot.take().expect("a frame");
        assert_eq!((frame.width, frame.height, frame.sent), (160, 90, (320, 180)));
        // Made as large as sent, it reads back as the number it was.
        wanted.drawn(320, 180, u32::MAX, super::super::fit::Fit::Actual);
        for unit in sent_as_viewer_sends(3) {
            decoding.take(unit);
        }
        let frame = slot.take().expect("a frame");
        let mut rgba = frame.bgra.clone();
        for pixel in rgba.as_chunks_mut::<4>().0 {
            pixel.swap(0, 2);
        }
        let read = super::super::pattern::Pattern::new(320, 180).read(&rgba);
        assert_eq!(read, Some(2), "the third frame of the second run");
        assert_eq!(asked.load(Ordering::Relaxed), 0, "no keyframe asked for");
    }

    #[test]
    fn a_share_out_of_sight_is_not_decoded_and_asks_for_a_keyframe_when_back() {
        let wanted = Wanted::new();
        let asked = Arc::new(AtomicU64::new(0));
        let (mut decoding, slot, counts) = decoding(&wanted, &asked);
        let units = sent_as_viewer_sends(4);
        let mut units = units.into_iter();
        // Never drawn: the keyframe and the next frame pass by undecoded.
        for unit in units.by_ref().take(3) {
            decoding.take(unit);
        }
        assert_eq!(counts.decoded.load(Ordering::Relaxed), 0);
        assert!(slot.take().is_none());
        // In sight again, a delta cannot be decoded: a keyframe is asked for.
        wanted.drawn(320, 180, 30, super::super::fit::Fit::Whole);
        for unit in units {
            decoding.take(unit);
        }
        assert_eq!(counts.decoded.load(Ordering::Relaxed), 0);
        assert!(asked.load(Ordering::Relaxed) >= 1, "the viewer limits how often");
        for unit in sent_as_viewer_sends(1) {
            decoding.take(unit);
        }
        assert_eq!(counts.decoded.load(Ordering::Relaxed), 1, "from the keyframe on");
    }
}
