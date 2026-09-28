//! A minimal Ogg Opus writer (RFC 7845), for recorded voice messages.
//!
//! Only what a single mono stream needs: the two header pages, audio pages of
//! whole packets, and an end-of-stream flag on the last. `audio/ogg` is what
//! every webview's `<audio>` plays natively, and the packets are the ones the
//! Opus encoder already produces, so wrapping them is the entire job - a
//! container crate would be a dependency for about a hundred lines.

/// Samples the decoder drops from the front, at 48 kHz.
///
/// libopus's encoder lookahead at 48 kHz, which is what every Opus encoder in
/// its default configuration reports. A decoder that skips fewer plays a few
/// milliseconds of the encoder's warm-up; one that skips more clips the first
/// syllable.
pub(super) const PRE_SKIP: u16 = 312;

/// Packets per audio page. One second of 20 ms frames: small enough that a
/// player can start before the whole file has arrived, large enough that the
/// 27-byte page header stays a rounding error.
const PACKETS_PER_PAGE: usize = 50;

/// Most lacing values one page can hold (the segment count is a byte).
const MAX_SEGMENTS: usize = 255;

const FLAG_BOS: u8 = 0x02;
const FLAG_EOS: u8 = 0x04;

/// Writes an Ogg Opus stream into memory.
///
/// A voice message is at most a few hundred kilobytes, so the whole file is
/// built in a `Vec` and written once when recording ends, rather than
/// streaming pages to a file that a cancelled take would then have to clean up.
#[derive(Debug)]
pub(super) struct OggOpusWriter {
    out: Vec<u8>,
    serial: u32,
    sequence: u32,
    /// Packets waiting for the next page.
    pending: Vec<Vec<u8>>,
    /// Samples encoded so far, pre-skip included, at 48 kHz.
    granule: u64,
}

impl OggOpusWriter {
    /// Start a mono 48 kHz stream, writing both header pages.
    pub(super) fn new(serial: u32, vendor: &str) -> Self {
        let mut writer = Self {
            out: Vec::new(),
            serial,
            sequence: 0,
            pending: Vec::new(),
            granule: u64::from(PRE_SKIP),
        };
        writer.write_page(&[opus_head()], 0, FLAG_BOS);
        writer.write_page(&[opus_tags(vendor)], 0, 0);
        writer
    }

    /// Queue one encoded packet of `samples` samples per channel.
    pub(super) fn push(&mut self, packet: Vec<u8>, samples: u64) {
        // Flushed *before* this packet when it would not fit, so the page
        // granule stays that of the last packet the page actually ends.
        let queued: usize = self.pending.iter().map(|p| lacing_len(p.len())).sum();
        if queued + lacing_len(packet.len()) > MAX_SEGMENTS {
            self.flush(0);
        }
        self.granule += samples;
        self.pending.push(packet);
        if self.pending.len() >= PACKETS_PER_PAGE {
            self.flush(0);
        }
    }

    /// Close the stream and hand back the file.
    ///
    /// The last page carries the end-of-stream flag even when it holds no
    /// packet, because a player that never sees one waits for more audio.
    pub(super) fn finish(mut self) -> Vec<u8> {
        self.flush(FLAG_EOS);
        self.out
    }

    fn flush(&mut self, flags: u8) {
        if self.pending.is_empty() && flags & FLAG_EOS == 0 {
            return;
        }
        let packets = std::mem::take(&mut self.pending);
        let granule = self.granule;
        self.write_page(&packets, granule, flags);
    }

    fn write_page(&mut self, packets: &[Vec<u8>], granule: u64, flags: u8) {
        let mut lacing = Vec::new();
        for packet in packets {
            lacing.extend(lacing_values(packet.len()));
        }
        let start = self.out.len();
        self.out.extend_from_slice(b"OggS");
        self.out.push(0); // stream structure version
        self.out.push(flags);
        self.out.extend_from_slice(&granule.to_le_bytes());
        self.out.extend_from_slice(&self.serial.to_le_bytes());
        self.out.extend_from_slice(&self.sequence.to_le_bytes());
        self.out.extend_from_slice(&[0; 4]); // CRC, filled in below
        self.out.push(u8::try_from(lacing.len()).unwrap_or(u8::MAX));
        self.out.extend_from_slice(&lacing);
        for packet in packets {
            self.out.extend_from_slice(packet);
        }
        let crc = crc32(&self.out[start..]);
        self.out[start + 22..start + 26].copy_from_slice(&crc.to_le_bytes());
        self.sequence += 1;
    }
}

/// How many lacing values a packet of `len` bytes takes.
fn lacing_len(len: usize) -> usize {
    len / 255 + 1
}

/// The lacing values for one packet: 255s, then the remainder, which ends it.
/// A packet whose length is a multiple of 255 ends in a zero.
fn lacing_values(len: usize) -> impl Iterator<Item = u8> {
    let full = len / 255;
    let rest = u8::try_from(len % 255).unwrap_or(0);
    std::iter::repeat_n(255, full).chain(std::iter::once(rest))
}

/// The identification header, RFC 7845 §5.1.
fn opus_head() -> Vec<u8> {
    let mut head = Vec::with_capacity(19);
    head.extend_from_slice(b"OpusHead");
    head.push(1); // version
    head.push(1); // channels
    head.extend_from_slice(&PRE_SKIP.to_le_bytes());
    head.extend_from_slice(&48_000u32.to_le_bytes()); // input sample rate
    head.extend_from_slice(&0i16.to_le_bytes()); // output gain
    head.push(0); // mapping family: mono/stereo, no table
    head
}

/// The comment header, RFC 7845 §5.2, with no user comments.
fn opus_tags(vendor: &str) -> Vec<u8> {
    let vendor = vendor.as_bytes();
    let mut tags = Vec::with_capacity(16 + vendor.len());
    tags.extend_from_slice(b"OpusTags");
    tags.extend_from_slice(&u32::try_from(vendor.len()).unwrap_or(0).to_le_bytes());
    tags.extend_from_slice(vendor);
    tags.extend_from_slice(&0u32.to_le_bytes());
    tags
}

/// Ogg's CRC-32: polynomial 0x04c11db7, unreflected, zero initial value and no
/// final XOR - not the zlib one, which is why `crc32fast` would be wrong here.
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0u32;
    for &byte in bytes {
        crc ^= u32::from(byte) << 24;
        for _ in 0..8 {
            crc = if crc & 0x8000_0000 != 0 {
                (crc << 1) ^ 0x04c1_1db7
            } else {
                crc << 1
            };
        }
    }
    crc
}

/// Every packet in a stream, in order, headers included. For tests.
#[cfg(test)]
pub(super) fn packets(mut bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut packet = Vec::new();
    while bytes.len() >= 27 {
        let segments = usize::from(bytes[26]);
        let (lacing, mut body) = bytes[27..].split_at(segments);
        let mut consumed = 27 + segments;
        for &len in lacing {
            let (part, rest) = body.split_at(usize::from(len));
            packet.extend_from_slice(part);
            body = rest;
            consumed += usize::from(len);
            if len < 255 {
                out.push(std::mem::take(&mut packet));
            }
        }
        bytes = &bytes[consumed..];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One parsed page: flags, granule, sequence and its packets' bytes.
    struct Page {
        flags: u8,
        granule: u64,
        sequence: u32,
        body: Vec<u8>,
        lacing: Vec<u8>,
    }

    fn pages(mut bytes: &[u8]) -> Vec<Page> {
        let mut out = Vec::new();
        while !bytes.is_empty() {
            assert_eq!(
                &bytes[..4],
                b"OggS",
                "every page starts with the capture pattern"
            );
            let segments = usize::from(bytes[26]);
            let lacing = bytes[27..27 + segments].to_vec();
            let body_len: usize = lacing.iter().map(|&l| usize::from(l)).sum();
            let total = 27 + segments + body_len;
            let mut zeroed = bytes[..total].to_vec();
            zeroed[22..26].copy_from_slice(&[0; 4]);
            let stored = u32::from_le_bytes(bytes[22..26].try_into().unwrap());
            assert_eq!(crc32(&zeroed), stored, "the page CRC checks out");
            out.push(Page {
                flags: bytes[5],
                granule: u64::from_le_bytes(bytes[6..14].try_into().unwrap()),
                sequence: u32::from_le_bytes(bytes[18..22].try_into().unwrap()),
                body: bytes[27 + segments..total].to_vec(),
                lacing,
            });
            bytes = &bytes[total..];
        }
        out
    }

    #[test]
    fn the_crc_is_oggs_and_not_zlibs() {
        // CRC-32/POSIX has the same polynomial, initial value and bit order
        // and a final XOR of all ones; its published check value for
        // "123456789" is 0x765e7680, so Ogg's is that inverted.
        assert_eq!(crc32(b"123456789"), 0x765e_7680 ^ 0xffff_ffff);
    }

    #[test]
    fn a_stream_opens_with_both_headers_and_ends_flagged() {
        let mut writer = OggOpusWriter::new(7, "fancy-mumble");
        for _ in 0..3 {
            writer.push(vec![0xAA; 40], 960);
        }
        let pages = pages(&writer.finish());

        assert_eq!(pages.len(), 3);
        assert_eq!(pages[0].flags, FLAG_BOS);
        assert!(pages[0].body.starts_with(b"OpusHead"));
        assert_eq!(pages[1].flags, 0);
        assert!(pages[1].body.starts_with(b"OpusTags"));
        assert_eq!(pages[2].flags, FLAG_EOS);
        assert_eq!(
            pages[2].granule,
            u64::from(PRE_SKIP) + 3 * 960,
            "the last granule is every sample plus the pre-skip"
        );
        let sequences: Vec<u32> = pages.iter().map(|p| p.sequence).collect();
        assert_eq!(sequences, vec![0, 1, 2]);
    }

    #[test]
    fn a_long_take_is_split_into_pages_whose_granules_climb() {
        let mut writer = OggOpusWriter::new(1, "t");
        for _ in 0..(PACKETS_PER_PAGE * 2 + 5) {
            writer.push(vec![1; 60], 960);
        }
        let pages = pages(&writer.finish());
        let audio: Vec<&Page> = pages.iter().skip(2).collect();
        assert_eq!(audio.len(), 3);
        assert!(audio.windows(2).all(|w| w[0].granule < w[1].granule));
        assert_eq!(audio.last().map(|p| p.flags), Some(FLAG_EOS));
    }

    #[test]
    fn a_packet_of_exactly_255_bytes_is_terminated_by_a_zero() {
        let mut writer = OggOpusWriter::new(1, "t");
        writer.push(vec![9; 255], 960);
        let pages = pages(&writer.finish());
        assert_eq!(pages[2].lacing, vec![255, 0]);
        assert_eq!(pages[2].body.len(), 255);
    }

    #[test]
    fn an_empty_take_still_closes_the_stream() {
        let pages = pages(&OggOpusWriter::new(1, "t").finish());
        assert_eq!(pages.len(), 3);
        assert_eq!(pages[2].flags, FLAG_EOS);
        assert!(pages[2].body.is_empty());
    }
}
