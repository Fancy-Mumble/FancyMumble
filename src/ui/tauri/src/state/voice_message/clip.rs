//! A clip written from samples, and read back.
//!
//! [`ClipWriter`] is what a take goes through: samples cut into Opus
//! frames, encoded, wrapped in Ogg and measured for the waveform. A take
//! feeds it from the microphone; a view that has no microphone to use (a
//! test, a run that must stay silent) can feed it samples of its own and
//! get exactly the file a take would have written.
//!
//! [`ClipReader`] is the other way: an Ogg Opus file decoded a frame at a
//! time, from any place in it, so a player holds the compressed file and
//! never the whole of it decoded.

use std::path::Path;

use mumble_protocol::audio::decoder::{AudioDecoder, OpusDecoder};
use mumble_protocol::audio::encoder::{
    AudioEncoder, EncodedPacket, OpusApplication, OpusEncoder, OpusEncoderConfig,
};
use mumble_protocol::audio::sample::{AudioFormat, AudioFrame};

use super::{BITRATE, FRAME, VoiceClip, frame_of, millis, ogg, rms, waveform};

/// Samples turned into a voice clip as they arrive.
pub struct ClipWriter {
    encoder: OpusEncoder,
    writer: ogg::OggOpusWriter,
    /// Samples waiting to make up a whole frame.
    pending: Vec<f32>,
    /// One loudness value per encoded frame.
    levels: Vec<f32>,
    /// Samples encoded so far.
    samples: u64,
}

impl std::fmt::Debug for ClipWriter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ClipWriter")
            .field("samples", &self.samples)
            .finish_non_exhaustive()
    }
}

impl ClipWriter {
    /// An empty clip, with the encoder every voice message is made with.
    pub fn new() -> Result<Self, String> {
        let encoder = OpusEncoder::new(
            OpusEncoderConfig {
                bitrate: BITRATE,
                frame_size: FRAME,
                application: OpusApplication::Voip,
                complexity: 10,
                // Nothing is lost on the way to a file.
                fec: false,
                packet_loss_percent: 0,
                ..OpusEncoderConfig::default()
            },
            AudioFormat::MONO_48KHZ_F32,
        )
        .map_err(|e| e.to_string())?;
        // Any value will do; random so two clips spliced together by some
        // tool downstream do not claim to be one stream.
        let serial = uuid::Uuid::new_v4().as_fields().0;
        Ok(Self {
            encoder,
            writer: ogg::OggOpusWriter::new(serial, "Fancy Mumble"),
            pending: Vec::with_capacity(FRAME * 2),
            levels: Vec::new(),
            samples: 0,
        })
    }

    /// Take `samples` (mono, 48 kHz) and encode every whole frame there is,
    /// as long as fewer than `limit` samples are in the clip.
    pub fn push(&mut self, samples: &[f32], limit: u64) -> Result<(), String> {
        self.pending.extend_from_slice(samples);
        // Cut into exact Opus frames, whatever size the device delivers.
        while self.pending.len() >= FRAME && self.samples < limit {
            let chunk: Vec<f32> = self.pending.drain(..FRAME).collect();
            self.levels.push(rms(&chunk));
            let packet = self
                .encoder
                .encode(&frame_of(&chunk))
                .map_err(|e| e.to_string())?;
            self.writer.push(packet.data, FRAME as u64);
            self.samples += FRAME as u64;
        }
        Ok(())
    }

    /// Samples in the clip so far.
    pub const fn samples(&self) -> u64 {
        self.samples
    }

    /// How long the clip is so far, in milliseconds.
    pub fn elapsed_ms(&self) -> u32 {
        millis(self.samples)
    }

    /// The loudness of the last frame encoded, 0 to 1.
    pub fn level(&self) -> f32 {
        self.levels.last().copied().unwrap_or(0.0)
    }

    /// Close the stream and write the clip into `dir`, under a name of its
    /// own.
    pub fn finish(mut self, dir: &Path) -> Result<VoiceClip, String> {
        if self.samples == 0 {
            return Err("nothing was recorded".to_owned());
        }
        // The encoder holds back its look-ahead: a frame of silence brings
        // the end of the take out of it, and the stream is said to end
        // where the take did.
        let flush = self
            .encoder
            .encode(&frame_of(&[0.0; FRAME]))
            .map_err(|e| e.to_string())?;
        let mut writer = self.writer;
        writer.push(flush.data, FRAME as u64);
        let bytes = writer.finish(u64::from(ogg::PRE_SKIP) + self.samples);
        std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let short = uuid::Uuid::new_v4().simple().to_string();
        let path = dir.join(format!("voice-message-{}.ogg", &short[..8]));
        std::fs::write(&path, &bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
        Ok(VoiceClip {
            path: path.to_string_lossy().into_owned(),
            duration_ms: millis(self.samples),
            size: bytes.len() as u64,
            mime_type: "audio/ogg",
            waveform: waveform(&self.levels),
        })
    }
}

/// Frames decoded before the place a seek lands on, and thrown away: the
/// decoder needs them to settle (RFC 7845 §4.6 asks for 80 ms).
const PREROLL_PACKETS: usize = 4;

/// An Ogg Opus clip, decoded a frame at a time.
pub struct ClipReader {
    /// The audio packets, in order; the two headers are not among them.
    packets: Vec<Vec<u8>>,
    /// Where each packet starts, in samples from the start of the stream,
    /// the pre-skip included.
    starts: Vec<u64>,
    /// Samples the stream starts with that are not to be played.
    pre_skip: u64,
    /// Where the stream ends, in the same count as `starts`.
    end: u64,
    decoder: OpusDecoder,
    /// The next packet to decode.
    next: usize,
    /// Where the next sample decoded is, in the same count as `starts`.
    at: u64,
    /// Where the next sample handed out is to be: what is decoded before
    /// it is thrown away.
    wanted: u64,
    /// Samples made up as silence past the packets, for a take written
    /// before November 2026 (see [`Self::new`]).
    padded: u64,
}

impl std::fmt::Debug for ClipReader {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ClipReader")
            .field("packets", &self.packets.len())
            .field("at", &self.at)
            .finish_non_exhaustive()
    }
}

impl ClipReader {
    /// Read the clip in `bytes`, the whole Ogg Opus file.
    pub fn new(bytes: &[u8]) -> Result<Self, String> {
        let stream = OggStream::read(bytes)?;
        let head = stream.packets.first().ok_or("not an Ogg stream")?;
        if !head.starts_with(b"OpusHead") || head.len() < 19 {
            return Err("not an Opus stream".to_owned());
        }
        let pre_skip = u64::from(u16::from_le_bytes([head[10], head[11]]));
        // The head and the comments; what follows is audio.
        let packets: Vec<Vec<u8>> = stream.packets.into_iter().skip(2).collect();
        let mut starts = Vec::with_capacity(packets.len());
        let mut total = 0u64;
        for packet in &packets {
            starts.push(total);
            total += packet_samples(packet);
        }
        // The last page says where the stream ends, as a browser reads it.
        // Takes written before November 2026 counted the encoder's
        // look-ahead as if it had come out, so their end lies up to a
        // pre-skip beyond the packets: that stretch plays as silence. A
        // stream cut shorter than that ends where its packets do.
        let end = stream
            .last_granule
            .filter(|end| *end <= total + pre_skip)
            .unwrap_or(total);
        let decoder = OpusDecoder::new(AudioFormat::MONO_48KHZ_F32).map_err(|e| e.to_string())?;
        Ok(Self {
            packets,
            starts,
            pre_skip,
            end: end.max(pre_skip),
            decoder,
            next: 0,
            at: 0,
            wanted: pre_skip,
            padded: 0,
        })
    }

    /// How many samples the clip plays, at 48 kHz.
    pub const fn len_samples(&self) -> u64 {
        self.end - self.pre_skip
    }

    /// How long the clip plays, in milliseconds.
    pub fn duration_ms(&self) -> u32 {
        millis(self.len_samples())
    }

    /// Where the next sample handed out is, from the start of the clip.
    pub const fn position(&self) -> u64 {
        self.wanted - self.pre_skip
    }

    /// Go to `sample`, counted from the start of the clip.
    pub fn seek(&mut self, sample: u64) -> Result<(), String> {
        let target = (sample + self.pre_skip).min(self.end);
        let holding = self.starts.partition_point(|start| *start <= target);
        let from = holding.saturating_sub(1 + PREROLL_PACKETS);
        self.decoder = OpusDecoder::new(AudioFormat::MONO_48KHZ_F32).map_err(|e| e.to_string())?;
        self.next = from;
        self.at = self.starts.get(from).copied().unwrap_or(self.end);
        self.wanted = target;
        Ok(())
    }

    /// The next stretch of the clip, mono at 48 kHz; `None` at its end.
    pub fn next_frame(&mut self) -> Option<Vec<f32>> {
        loop {
            if self.wanted >= self.end {
                return None;
            }
            let Some(packet) = self.packets.get(self.next) else {
                let pad = (self.end - self.wanted).min(FRAME as u64);
                self.wanted += pad;
                self.padded += pad;
                return Some(vec![0.0; usize::try_from(pad).unwrap_or(0)]);
            };
            self.next += 1;
            let decoded = self.decoder.decode(&EncodedPacket {
                data: packet.clone(),
                sequence: 0,
                frame_samples: 0,
            });
            let samples = match decoded {
                Ok(frame) => samples_of(&frame),
                // A packet that will not decode plays as the silence it
                // stood for, so the clip keeps its length.
                Err(_) => vec![0.0; usize::try_from(packet_samples(packet)).unwrap_or(0)],
            };
            let from = self.at;
            self.at += samples.len() as u64;
            let keep_from = usize::try_from(self.wanted.saturating_sub(from)).unwrap_or(usize::MAX);
            let keep_to = usize::try_from(self.end.saturating_sub(from)).unwrap_or(usize::MAX);
            let kept = samples
                .get(keep_from.min(samples.len())..keep_to.min(samples.len()))
                .unwrap_or_default();
            if kept.is_empty() {
                continue;
            }
            self.wanted = from + (keep_from + kept.len()) as u64;
            return Some(kept.to_vec());
        }
    }
}

/// A decoded frame's samples, read without casting its bytes in place.
fn samples_of(frame: &AudioFrame) -> Vec<f32> {
    let (samples, _) = frame.data.as_chunks::<4>();
    samples.iter().map(|bytes| f32::from_ne_bytes(*bytes)).collect()
}

/// How many samples an Opus packet holds, at 48 kHz, from its first bytes
/// (RFC 6716 §3.1). Zero for a packet too short to say.
fn packet_samples(packet: &[u8]) -> u64 {
    let Some(&toc) = packet.first() else {
        return 0;
    };
    let config = toc >> 3;
    // The frame size each configuration names, in samples at 48 kHz.
    let per_frame: u64 = match config {
        0..=11 => [480, 960, 1920, 2880][usize::from(config % 4)],
        12..=15 => [480, 960][usize::from(config % 2)],
        _ => [120, 240, 480, 960][usize::from(config % 4)],
    };
    let frames: u64 = match toc & 0x3 {
        0 => 1,
        1 | 2 => 2,
        _ => packet.get(1).map_or(0, |count| u64::from(count & 0x3f)),
    };
    per_frame * frames
}

/// The packets of one Ogg stream, and the granule its last page ends on.
struct OggStream {
    packets: Vec<Vec<u8>>,
    last_granule: Option<u64>,
}

impl OggStream {
    /// Read every page of `bytes`, joining packets that span pages.
    fn read(mut bytes: &[u8]) -> Result<Self, String> {
        let mut packets = Vec::new();
        let mut packet = Vec::new();
        let mut last_granule = None;
        while !bytes.is_empty() {
            if bytes.len() < 27 || &bytes[..4] != b"OggS" {
                return Err("not an Ogg stream".to_owned());
            }
            let granule = u64::from_le_bytes(
                bytes[6..14]
                    .try_into()
                    .map_err(|_| "a page cut short".to_owned())?,
            );
            let segments = usize::from(bytes[26]);
            let lacing = bytes.get(27..27 + segments).ok_or("a page cut short")?;
            let mut body = &bytes[27 + segments..];
            let mut used = 27 + segments;
            for &len in lacing {
                let len = usize::from(len);
                let part = body.get(..len).ok_or("a page cut short")?;
                packet.extend_from_slice(part);
                body = &body[len..];
                used += len;
                if len < 255 {
                    packets.push(std::mem::take(&mut packet));
                }
            }
            // A page on which no packet ends says -1.
            if granule != u64::MAX {
                last_granule = Some(granule);
            }
            bytes = &bytes[used..];
        }
        Ok(Self {
            packets,
            last_granule,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Samples at 48 kHz in `millis` milliseconds.
    fn at_ms(millis: u64) -> u64 {
        millis * super::super::SAMPLE_RATE / 1000
    }

    /// A sweep from 200 Hz to 2 kHz, `seconds` long, at half scale.
    fn sweep(seconds: f32) -> Vec<f32> {
        let count = (seconds * 48_000.0) as usize;
        let mut phase = 0.0f32;
        (0..count)
            .map(|i| {
                let t = i as f32 / count as f32;
                phase += (200.0 + 1800.0 * t) / 48_000.0;
                (phase * std::f32::consts::TAU).sin() * 0.5
            })
            .collect()
    }

    fn written(samples: &[f32], dir: &Path) -> VoiceClip {
        let mut writer = ClipWriter::new().expect("an encoder");
        // In odd pieces, as a device delivers them.
        for piece in samples.chunks(733) {
            writer.push(piece, u64::MAX).expect("encodes");
        }
        writer.finish(dir).expect("a clip")
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("fancy-clip-{name}-{}", std::process::id()))
    }

    /// Loudness of the last `ms` milliseconds of `samples`.
    fn tail_loudness(samples: &[f32], ms: usize) -> f32 {
        rms(&samples[samples.len() - ms * 48..])
    }

    #[test]
    fn the_end_of_a_take_is_in_its_file_and_its_length_is_what_it_holds() {
        // Loud to its very end: an end lost to the encoder's look-ahead
        // would decode as silence, or not at all.
        let dir = scratch("tail");
        let input = sweep(1.0);
        let clip = written(&input, &dir);
        let bytes = std::fs::read(&clip.path).expect("the file");
        let mut reader = ClipReader::new(&bytes).expect("an Opus file");
        let mut decoded = Vec::new();
        while let Some(frame) = reader.next_frame() {
            decoded.extend(frame);
        }
        assert_eq!(decoded.len(), input.len(), "as long as what went in");
        assert!(
            tail_loudness(&decoded, 6) > 0.2,
            "the last 6 ms are heard: {}",
            tail_loudness(&decoded, 6)
        );
        // Every sample decoded is a real one: nothing is made up to fill
        // a length the packets do not reach.
        assert_eq!(reader.padded, 0);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_take_written_before_the_fix_still_plays_as_long_as_it_says() {
        // The old writer's last granule: the pre-skip on top of every
        // sample the packets decode to. Made from a new file by moving its
        // end, its page checksum written again.
        let dir = scratch("old");
        let clip = written(&sweep(1.0), &dir);
        let mut bytes = std::fs::read(&clip.path).expect("the file");
        let last = bytes.windows(4).rposition(|w| w == b"OggS").expect("a page");
        let decoded_end: u64 = ogg::packets(&bytes)
            .iter()
            .skip(2)
            .map(|packet| packet_samples(packet))
            .sum();
        let old_end = decoded_end + u64::from(ogg::PRE_SKIP);
        bytes[last + 6..last + 14].copy_from_slice(&old_end.to_le_bytes());
        bytes[last + 22..last + 26].copy_from_slice(&[0; 4]);
        let crc = ogg::crc32(&bytes[last..]);
        bytes[last + 22..last + 26].copy_from_slice(&crc.to_le_bytes());

        let mut reader = ClipReader::new(&bytes).expect("an Opus file");
        assert_eq!(u64::from(reader.duration_ms()), (old_end - u64::from(ogg::PRE_SKIP)) / 48);
        let mut played = 0;
        while let Some(frame) = reader.next_frame() {
            played += frame.len() as u64;
        }
        assert_eq!(played, reader.len_samples(), "to the length it states");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_sweep_written_reads_back_as_long_as_it_was() {
        let dir = scratch("length");
        let clip = written(&sweep(2.0), &dir);
        assert_eq!(clip.duration_ms, 2000);
        assert_eq!(clip.waveform.len(), 48);
        assert!(clip.waveform.contains(&100));
        let bytes = std::fs::read(&clip.path).expect("the file");
        assert_eq!(bytes.len() as u64, clip.size);
        let mut reader = ClipReader::new(&bytes).expect("an Opus file");
        assert_eq!(reader.duration_ms(), 2000);
        let mut decoded = Vec::new();
        while let Some(frame) = reader.next_frame() {
            decoded.extend(frame);
        }
        assert_eq!(decoded.len() as u64, at_ms(2000), "every sample, no more");
        let loudness = rms(&decoded[48_000..48_960]);
        assert!(loudness > 0.2, "the sweep is heard, not silence: {loudness}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_seek_lands_where_it_was_asked_and_plays_on_to_the_end() {
        let dir = scratch("seek");
        let clip = written(&sweep(3.0), &dir);
        let bytes = std::fs::read(&clip.path).expect("the file");
        let mut reader = ClipReader::new(&bytes).expect("an Opus file");
        reader.seek(at_ms(1234)).expect("seeks");
        assert_eq!(reader.position(), at_ms(1234));
        let mut rest = 0u64;
        while let Some(frame) = reader.next_frame() {
            rest += frame.len() as u64;
        }
        assert_eq!(rest, at_ms(3000) - at_ms(1234));
        // Back to the start, and past the end.
        reader.seek(0).expect("seeks");
        assert!(reader.next_frame().is_some());
        reader.seek(at_ms(9000)).expect("seeks");
        assert!(reader.next_frame().is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn what_is_not_an_ogg_opus_file_is_refused() {
        assert!(ClipReader::new(b"").is_err());
        assert!(ClipReader::new(b"RIFF....WAVEfmt ").is_err());
        let mut vorbis = ogg::OggOpusWriter::new(1, "t").finish(0);
        // The head renamed: an Ogg stream of something else.
        if let Some(at) = vorbis.windows(8).position(|w| w == b"OpusHead") {
            vorbis[at..at + 8].copy_from_slice(b"VorbisHd");
        }
        assert!(ClipReader::new(&vorbis).is_err());
    }

    #[test]
    fn nothing_recorded_is_no_clip() {
        let writer = ClipWriter::new().expect("an encoder");
        assert!(writer.finish(&scratch("empty")).is_err());
    }

    #[test]
    fn a_packet_says_how_long_it_is() {
        // Config 1 (SILK 20 ms), one frame; config 31 (CELT 20 ms), two.
        assert_eq!(packet_samples(&[1 << 3]), 960);
        assert_eq!(packet_samples(&[(31 << 3) | 1]), 1920);
        // Code 3: the count is in the second byte.
        assert_eq!(packet_samples(&[(16 << 3) | 3, 6]), 720);
        assert_eq!(packet_samples(&[]), 0);
    }
}
