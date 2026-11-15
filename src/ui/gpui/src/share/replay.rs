//! The test pattern through the real encoder and back into the real
//! decoder, with no network between: for measuring what watching and
//! sharing cost on a machine with no server to share through.
//!
//! `FANCY_GPUI_DEMO_SHARE_CODEC` (any value) has the demo engine's shares
//! decoded this way: two seconds of the pattern are encoded once, at the
//! size and rate a 1080p share is sent at, and played round to every
//! watched share as the viewer would hand them over, so what is measured
//! is decoding, colouring and drawing. One's own share is encoded as it
//! goes, as a broadcaster encodes it.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[cfg(not(target_os = "android"))]
use fancy_screenshare::encode::{EncodeSettings, H264Encoder, VideoEncoder};

use super::decode::{Decoding, Unit};
#[cfg(not(target_os = "android"))]
use super::pattern::{Order, Pattern};

/// Whether this run's demo shares go through the codec.
pub(crate) fn wanted() -> bool {
    std::env::var_os("FANCY_GPUI_DEMO_SHARE_CODEC").is_some()
}

/// How large and fast a share is sent.
pub(crate) const SENT: (u32, u32) = (1920, 1080);
const RATE: u32 = 30;
/// How much of it is encoded once and played round.
const LOOP_FRAMES: u32 = 60;

#[cfg_attr(target_os = "android", expect(dead_code, reason = "what uses it is not built on Android, where share/real_absent.rs stands in"))]
/// Annex-B as the viewer (`fancy_screenshare::viewer`'s `AvccStream`)
/// hands it over: its parameter sets as an `avcC` record when they come,
/// then the rest length-prefixed.
pub(crate) fn as_viewer_hands_over(annexb: &[u8], keyframe: bool) -> Vec<Unit> {
    let mut sets: Vec<&[u8]> = Vec::new();
    let mut data = Vec::new();
    for nal in split_nals(annexb) {
        match nal.first().map(|header| header & 0x1F) {
            Some(7 | 8) => sets.push(nal),
            Some(9) | None => {}
            Some(_) => {
                data.extend_from_slice(&u32::try_from(nal.len()).unwrap_or(0).to_be_bytes());
                data.extend_from_slice(nal);
            }
        }
    }
    let mut units = Vec::new();
    if let [sps, pps] = sets.as_slice()
        && sps.len() >= 4
    {
        let mut avcc = vec![1, sps[1], sps[2], sps[3], 0xFF, 0xE1];
        avcc.extend_from_slice(&u16::try_from(sps.len()).unwrap_or(0).to_be_bytes());
        avcc.extend_from_slice(sps);
        avcc.push(1);
        avcc.extend_from_slice(&u16::try_from(pps.len()).unwrap_or(0).to_be_bytes());
        avcc.extend_from_slice(pps);
        units.push(Unit::Config(avcc));
    }
    units.push(Unit::Sample { data, keyframe });
    units
}

#[cfg_attr(target_os = "android", expect(dead_code, reason = "what uses it is not built on Android, where share/real_absent.rs stands in"))]
/// The NAL units of an Annex-B stream.
fn split_nals(stream: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new();
    let mut at = 0;
    while at + 3 <= stream.len() {
        if stream[at..at + 3] == [0, 0, 1] {
            starts.push(at + 3);
            at += 3;
        } else {
            at += 1;
        }
    }
    starts
        .iter()
        .enumerate()
        .map(|(n, &start)| {
            let end = starts.get(n + 1).map_or(stream.len(), |next| {
                let mut end = next - 3;
                while end > start && stream[end - 1] == 0 {
                    end -= 1;
                }
                end
            });
            &stream[start..end]
        })
        .collect()
}

/// The pattern encoded: `frames` of it at `size`, the first a keyframe.
/// Nothing on Android, which has no encoder yet.
#[cfg(target_os = "android")]
pub(crate) fn encoded(_size: (u32, u32), _frames: u32) -> Vec<Unit> {
    Vec::new()
}

/// The pattern encoded: `frames` of it at `size`, the first a keyframe.
#[cfg(not(target_os = "android"))]
pub(crate) fn encoded(size: (u32, u32), frames: u32) -> Vec<Unit> {
    let pattern = Pattern::new(size.0, size.1);
    let mut encoder = H264Encoder::new(EncodeSettings {
        max_fps: RATE as f32,
        ..EncodeSettings::default()
    });
    let mut units = Vec::new();
    for number in 0..frames {
        let rgba = pattern.frame(number, Order::Rgba);
        if let Ok(Some(encoded)) = encoder.encode_rgba(size.0, size.1, &rgba, number == 0) {
            units.extend(as_viewer_hands_over(&encoded.data, encoded.keyframe));
        }
    }
    units
}

/// Two seconds of a 1080p share, encoded once for every watched share.
fn the_loop() -> &'static [Unit] {
    static LOOP: std::sync::OnceLock<Vec<Unit>> = std::sync::OnceLock::new();
    LOOP.get_or_init(|| encoded(SENT, LOOP_FRAMES))
}

/// Play the loop into `decoding` at thirty frames a second until `stop`.
pub(crate) fn play(mut decoding: Decoding, stop: &Arc<AtomicBool>) {
    let units = the_loop();
    let every = Duration::from_secs(1) / RATE;
    let mut next = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        for unit in units {
            if stop.load(Ordering::Relaxed) {
                return;
            }
            let sample = matches!(unit, Unit::Sample { .. });
            decoding.take(unit.clone());
            if sample {
                next += every;
                std::thread::sleep(next.saturating_duration_since(Instant::now()));
            }
        }
    }
}

/// Encode the pattern at `size` and `fps` as a broadcaster would, and throw
/// it away, until `stop`: what sharing costs here. On Android, which has
/// no encoder yet, it waits for `stop`.
#[cfg(target_os = "android")]
pub(crate) fn encode_away(_size: (u32, u32), _fps: u32, stop: &Arc<AtomicBool>) {
    while !stop.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Encode the pattern at `size` and `fps` as a broadcaster would, and throw
/// it away, until `stop`: what sharing costs here.
#[cfg(not(target_os = "android"))]
pub(crate) fn encode_away(size: (u32, u32), fps: u32, stop: &Arc<AtomicBool>) {
    let pattern = Pattern::new(size.0, size.1);
    let mut encoder = H264Encoder::new(EncodeSettings {
        max_fps: fps as f32,
        ..EncodeSettings::default()
    });
    let every = Duration::from_secs(1) / fps.clamp(1, 60);
    let mut next = Instant::now();
    let mut number = 0;
    while !stop.load(Ordering::Relaxed) {
        let rgba = pattern.frame(number, Order::Rgba);
        let _ = encoder.encode_rgba(size.0, size.1, &rgba, number == 0);
        number += 1;
        next += every;
        std::thread::sleep(next.saturating_duration_since(Instant::now()));
    }
}

/// Samples a second, and channels, of a share's sound.
const SOUND_RATE: u32 = 48_000;
const SOUND_FRAME: usize = 960;

/// 20 ms of a 440 Hz tone at a fifth of full scale, stereo, from sample
/// `from` on.
pub(crate) fn tone(from: usize) -> Vec<f32> {
    (0..SOUND_FRAME)
        .flat_map(|at| {
            let t = (from + at) as f32 / SOUND_RATE as f32;
            let sample = 0.2 * (t * 440.0 * std::f32::consts::TAU).sin();
            [sample, sample]
        })
        .collect()
}

/// A second of the tone as Opus packets, encoded once.
fn tone_packets() -> &'static [Vec<u8>] {
    static PACKETS: std::sync::OnceLock<Vec<Vec<u8>>> = std::sync::OnceLock::new();
    PACKETS.get_or_init(|| {
        let Ok(mut encoder) = opus::Encoder::new(SOUND_RATE, opus::Channels::Stereo, opus::Application::Audio) else {
            return Vec::new();
        };
        (0..50)
            .filter_map(|n| encoder.encode_vec_float(&tone(n * SOUND_FRAME), 4000).ok())
            .collect()
    })
}

/// Play a tone into `ear` as `session`'s share's sound, 20 ms at a time
/// until `stop`: decoded from Opus where `codec`, as the viewer decodes a
/// real share's.
pub(crate) fn sound(ear: &super::audio::Ear, session: u32, own: bool, stop: &Arc<AtomicBool>, codec: bool) {
    let every = Duration::from_millis(20);
    let mut decoder = opus::Decoder::new(SOUND_RATE, opus::Channels::Stereo).ok();
    let mut pcm = vec![0f32; 5760 * 2];
    let mut next = Instant::now();
    let mut n = 0;
    while !stop.load(Ordering::Relaxed) {
        let packets = tone_packets();
        match decoder.as_mut().filter(|_| codec && !packets.is_empty()) {
            Some(decoder) => {
                if let Ok(decoded) = decoder.decode_float(&packets[n % packets.len()], &mut pcm, false) {
                    ear.hear(session, own, &pcm[..decoded * 2]);
                }
            }
            None => ear.hear(session, own, &tone(n * SOUND_FRAME)),
        }
        n += 1;
        next += every;
        std::thread::sleep(next.saturating_duration_since(Instant::now()));
    }
}

#[cfg(test)]
mod tests {
    use super::super::audio::{Ear, Hearing as _, Unheard};
    use super::*;

    /// The tone through Opus, decoded as the viewer decodes a share's sound
    /// (`consume_audio_track`), and handed on as the viewer hands it: what
    /// is heard is the tone, scaled by the share's volume.
    #[test]
    fn a_shares_sound_decoded_from_opus_is_heard_as_it_was_and_as_loud_as_set() {
        let unheard = Arc::new(Unheard::default());
        let ear = Ear {
            hearing: unheard.clone(),
            loudness: Arc::default(),
        };
        let mut decoder = opus::Decoder::new(SOUND_RATE, opus::Channels::Stereo).expect("a decoder");
        let mut pcm = vec![0f32; 5760 * 2];
        let mut decode = |packet: &[u8]| {
            let decoded = decoder.decode_float(packet, &mut pcm, false).expect("decodes");
            pcm[..decoded * 2].to_vec()
        };
        for packet in &tone_packets()[..25] {
            ear.hear(7, false, &decode(packet));
        }
        let heard = unheard.played(7);
        assert_eq!(heard.len(), 25 * SOUND_FRAME * 2, "every frame, nothing more");
        // Past the codec's start-up, the tone as it was sent: the best
        // alignment of the two correlates nearly perfectly.
        let sent: Vec<f32> = (0..25).flat_map(|n| tone(n * SOUND_FRAME)).collect();
        let (from, to) = (SOUND_FRAME * 2 * 5, SOUND_FRAME * 2 * 20);
        let best = (0..400)
            .step_by(2)
            .map(|lag| {
                let (mut both, mut a, mut b) = (0.0f64, 0.0f64, 0.0f64);
                for at in (from..to).step_by(2) {
                    let (x, y) = (f64::from(heard[at + lag]), f64::from(sent[at]));
                    both += x * y;
                    a += x * x;
                    b += y * y;
                }
                both / (a.sqrt() * b.sqrt())
            })
            .fold(f64::MIN, f64::max);
        assert!(best > 0.95, "the tone: {best}");
        // Played at half: half as loud. Muted: nothing.
        unheard.stop(7);
        ear.hearing.set_volume(7, 0.5);
        let packet = &tone_packets()[30];
        let full = decode(packet);
        ear.hear(7, false, &full);
        let half = unheard.played(7);
        assert!(half.iter().zip(&full).all(|(h, f)| (h - f * 0.5).abs() < 1e-6));
        unheard.stop(7);
        ear.hearing.set_volume(7, 0.0);
        ear.hear(7, false, &full);
        assert!(unheard.played(7).iter().all(|sample| *sample == 0.0));
    }
}
