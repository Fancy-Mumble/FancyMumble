//! Rewrite a stored MP4 into the shape the webview can actually play.
//!
//! A wallpaper clip reaches the webview as a blob URL, and `WebKitGTK` plays
//! it through GStreamer, which fetches that blob itself. Two things about an
//! ordinary MP4 go wrong on the way, and both of them read to the reader as
//! "the wallpaper is a still picture".
//!
//! **The header behind the media data.** That is where every plain muxer puts
//! `moov`, this app's bake included, and `qtdemux` then cannot parse forwards:
//! it issues range requests backwards from the end of the resource to find the
//! header. Over `WebKit`'s blob source that seeking is unreliable, and it
//! fails either at load - `typefind` gives up with "Could not determine type
//! of stream" and the element reports `MEDIA_ERR_SRC_NOT_SUPPORTED`, so the
//! clip never starts - or at the wrap-around seek `loop` performs at the end
//! of a pass, which fails with `MEDIA_ERR_DECODE` and leaves the element
//! wedged in `seeking` on its last frame. With `moov` first the demuxer reads
//! straight through and neither happens.
//!
//! **The soundtrack.** A wallpaper is muted, always, but the element still
//! decodes the audio, and `avdec_aac` refuses some perfectly ordinary camera
//! and editor output ("channel element 3.2 is not allocated"). One dead
//! stream fails the whole element, so a clip whose picture decodes fine never
//! plays. Nothing here wants the sound, so the track goes.
//!
//! Every clip handed to the webview passes through here, whoever wrote it, so
//! a file already in the store is repaired on its way out rather than needing
//! a re-pick or a re-bake. The store keeps the bytes it was given.

/// A box: where it starts, where it ends, and what it is.
struct Atom {
    kind: [u8; 4],
    start: usize,
    end: usize,
}

impl Atom {
    /// Where a plain container's children begin.
    const fn body(&self) -> usize {
        self.start + 8
    }
}

/// Split `bytes[offset..end]` into boxes, or `None` if it is not a clean
/// sequence of them - a truncated file, or something that is not MP4 at all.
fn atoms(bytes: &[u8], mut offset: usize, end: usize) -> Option<Vec<Atom>> {
    let mut found = Vec::new();
    while offset < end {
        if offset + 8 > end {
            return None;
        }
        let declared = u32::from_be_bytes(bytes[offset..offset + 4].try_into().ok()?);
        let kind: [u8; 4] = bytes[offset + 4..offset + 8].try_into().ok()?;
        let (size, header) = match declared {
            // 0 means "to the end of the file", 1 means a 64-bit size follows.
            0 => ((end - offset) as u64, 8usize),
            1 => {
                if offset + 16 > end {
                    return None;
                }
                (
                    u64::from_be_bytes(bytes[offset + 8..offset + 16].try_into().ok()?),
                    16,
                )
            }
            other => (u64::from(other), 8),
        };
        if size < header as u64 {
            return None;
        }
        let stop = offset.checked_add(usize::try_from(size).ok()?)?;
        if stop > end {
            return None;
        }
        found.push(Atom {
            kind,
            start: offset,
            end: stop,
        });
        offset = stop;
    }
    Some(found)
}

/// The first child with this kind.
fn child<'a>(children: &'a [Atom], kind: &[u8; 4]) -> Option<&'a Atom> {
    children.iter().find(|a| &a.kind == kind)
}

/// What a `trak` carries: `vide`, `soun`, or something more exotic.
fn handler(bytes: &[u8], trak: &Atom) -> Option<[u8; 4]> {
    let inside_trak = atoms(bytes, trak.body(), trak.end)?;
    let mdia = child(&inside_trak, b"mdia")?;
    let inside_mdia = atoms(bytes, mdia.body(), mdia.end)?;
    let hdlr = child(&inside_mdia, b"hdlr")?;
    // A full box: version and flags, `pre_defined`, then the handler type.
    let at = hdlr.start + 8 + 4 + 4;
    if at + 4 > hdlr.end {
        return None;
    }
    bytes[at..at + 4].try_into().ok()
}

/// Rebuild `moov` with only the tracks a silent wallpaper needs.
///
/// The samples themselves stay in `mdat` - unreferenced now, and never read.
/// Rewriting the media data would mean re-chunking every offset in the file
/// for a few megabytes that cost nothing to leave behind.
fn without_silent_tracks(moov: &[u8]) -> Option<Vec<u8>> {
    let children = atoms(moov, 8, moov.len())?;
    let mut keep: Vec<&Atom> = Vec::with_capacity(children.len());
    let mut pictures = 0usize;
    let mut dropped = false;
    for atom in &children {
        if &atom.kind != b"trak" {
            keep.push(atom);
            continue;
        }
        if handler(moov, atom)? == *b"vide" {
            pictures += 1;
            keep.push(atom);
        } else {
            dropped = true;
        }
    }
    // Nothing to do, or nothing left to show: leave the header as it stands.
    if !dropped || pictures == 0 {
        return Some(moov.to_vec());
    }

    let body: usize = keep.iter().map(|a| a.end - a.start).sum();
    let mut out = Vec::with_capacity(body + 8);
    out.extend_from_slice(&u32::try_from(body + 8).ok()?.to_be_bytes());
    out.extend_from_slice(b"moov");
    for atom in keep {
        out.extend_from_slice(&moov[atom.start..atom.end]);
    }
    Some(out)
}

/// Add `delta` to each 32-bit chunk offset in a `stco`'s entry table.
///
/// False if an offset would no longer fit: a file grown past 4 GiB would have
/// to be rewritten as `co64`, which a wallpaper capped far below that never
/// needs.
fn shift_narrow(entries: &mut [u8], delta: i64) -> bool {
    for entry in entries.as_chunks_mut::<4>().0 {
        let Some(moved) = i64::from(u32::from_be_bytes(*entry)).checked_add(delta) else {
            return false;
        };
        let Ok(moved) = u32::try_from(moved) else {
            return false;
        };
        *entry = moved.to_be_bytes();
    }
    true
}

/// Add `delta` to each 64-bit chunk offset in a `co64`'s entry table.
fn shift_wide(entries: &mut [u8], delta: i64) -> bool {
    for entry in entries.as_chunks_mut::<8>().0 {
        let Ok(moved) = i64::try_from(u64::from_be_bytes(*entry)) else {
            return false;
        };
        let Some(moved) = moved.checked_add(delta) else {
            return false;
        };
        let Ok(moved) = u64::try_from(moved) else {
            return false;
        };
        *entry = moved.to_be_bytes();
    }
    true
}

/// Add `delta` to the offsets one `stco`/`co64` box holds.
fn shift_table(moov: &mut [u8], table: &Atom, delta: i64) -> bool {
    let wide = &table.kind == b"co64";
    // A full box: version and flags, then the entry count, then the entries.
    let count_at = table.start + 12;
    if count_at + 4 > table.end {
        return false;
    }
    let Ok(count) = moov[count_at..count_at + 4].try_into() else {
        return false;
    };
    let count = u32::from_be_bytes(count) as usize;
    let width = if wide { 8 } else { 4 };
    let Some(bytes) = count.checked_mul(width) else {
        return false;
    };
    let first = count_at + 4;
    if first + bytes > table.end {
        return false;
    }
    let entries = &mut moov[first..first + bytes];
    if wide {
        shift_wide(entries, delta)
    } else {
        shift_narrow(entries, delta)
    }
}

/// Add `delta` to every chunk offset below `moov[start..end]`, following the
/// containers down to each track's sample table.
fn shift_chunk_offsets(moov: &mut [u8], start: usize, end: usize, delta: i64) -> bool {
    let Some(children) = atoms(moov, start, end) else {
        return false;
    };
    for atom in children {
        let moved = match &atom.kind {
            // The containers on the way down to a sample table.
            b"trak" | b"mdia" | b"minf" | b"stbl" => {
                shift_chunk_offsets(moov, atom.body(), atom.end, delta)
            }
            b"stco" | b"co64" => shift_table(moov, &atom, delta),
            _ => true,
        };
        if !moved {
            return false;
        }
    }
    true
}

/// Rewrite `bytes` with its header in front of the media data and its silent
/// tracks gone.
///
/// `None` means nothing was done and the caller should use the bytes it has:
/// the file is already in that shape, it is not an MP4, or its layout is one
/// this does not rewrite (several `moov`s, or media data on both sides of the
/// header). Leaving such a file alone is always safe - at worst it keeps the
/// playback quirk it came with.
pub(crate) fn prepare(bytes: &[u8]) -> Option<Vec<u8>> {
    let top = atoms(bytes, 0, bytes.len())?;
    if !top.iter().any(|a| &a.kind == b"ftyp") {
        return None;
    }

    let mut headers = top.iter().filter(|a| &a.kind == b"moov");
    let header = headers.next()?;
    if headers.next().is_some() {
        return None;
    }
    let media: Vec<&Atom> = top.iter().filter(|a| &a.kind == b"mdat").collect();
    let first_media = *media.first()?;
    // Every chunk offset shifts by the same amount only while the media data
    // is all on one side of the header.
    let leading = media.iter().all(|a| a.start > header.start);
    if !leading && media.iter().any(|a| a.start > header.start) {
        return None;
    }

    let was = header.end - header.start;
    let mut moved = without_silent_tracks(&bytes[header.start..header.end])?;
    let now = moved.len();
    // A header that already leads keeps its place and only changes length; one
    // behind the media data moves in front of it.
    let delta = if leading {
        now as i64 - was as i64
    } else {
        now as i64
    };
    if delta == 0 {
        return None;
    }
    if !shift_chunk_offsets(&mut moved, 8, now, delta) {
        return None;
    }

    let at = if leading {
        header.start
    } else {
        first_media.start
    };
    let mut out = Vec::with_capacity(bytes.len());
    out.extend_from_slice(&bytes[..at]);
    out.extend_from_slice(&moved);
    // The media data the header jumped over - empty when it already led.
    out.extend_from_slice(&bytes[at..header.start]);
    out.extend_from_slice(&bytes[header.end..]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `[size][kind][payload]`.
    fn atom(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut out = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(payload);
        out
    }

    /// A `stco` with one entry per chunk offset.
    fn stco(offsets: &[u32]) -> Vec<u8> {
        let mut payload = vec![0u8; 4];
        payload.extend_from_slice(&(offsets.len() as u32).to_be_bytes());
        for offset in offsets {
            payload.extend_from_slice(&offset.to_be_bytes());
        }
        atom(b"stco", &payload)
    }

    /// A track of `kind` (`vide`, `soun`, ...) whose chunks live at `offsets`.
    fn trak(kind: &[u8; 4], offsets: &[u32]) -> Vec<u8> {
        let mut hdlr = vec![0u8; 8];
        hdlr.extend_from_slice(kind);
        let mut mdia = atom(b"hdlr", &hdlr);
        mdia.extend_from_slice(&atom(b"minf", &atom(b"stbl", &stco(offsets))));
        atom(b"trak", &atom(b"mdia", &mdia))
    }

    /// `ftyp`, then media data, then a header - the layout every plain muxer
    /// writes.
    fn clip(media: &[u8], traks: &[Vec<u8>]) -> Vec<u8> {
        let mut moov = Vec::new();
        for track in traks {
            moov.extend_from_slice(track);
        }
        let mut out = atom(b"ftyp", b"isom\0\0\x02\0isom");
        out.extend_from_slice(&atom(b"mdat", media));
        out.extend_from_slice(&atom(b"moov", &moov));
        out
    }

    /// `ftyp`, header, then media data - already in the shape we want.
    fn leading_clip(media: &[u8], traks: &[Vec<u8>]) -> Vec<u8> {
        let mut moov = Vec::new();
        for track in traks {
            moov.extend_from_slice(track);
        }
        let mut out = atom(b"ftyp", b"isom\0\0\x02\0isom");
        out.extend_from_slice(&atom(b"moov", &moov));
        out.extend_from_slice(&atom(b"mdat", media));
        out
    }

    /// Every chunk offset in a file, in order.
    fn offsets_of(bytes: &[u8]) -> Vec<u32> {
        let mut found = Vec::new();
        for at in 0..bytes.len().saturating_sub(12) {
            if &bytes[at..at + 4] != b"stco" {
                continue;
            }
            let count =
                u32::from_be_bytes(bytes[at + 8..at + 12].try_into().expect("count")) as usize;
            for index in 0..count {
                let entry = at + 12 + index * 4;
                found.push(u32::from_be_bytes(
                    bytes[entry..entry + 4].try_into().expect("entry"),
                ));
            }
        }
        found
    }

    /// The top-level boxes of a file, in order.
    fn order(bytes: &[u8]) -> Vec<[u8; 4]> {
        atoms(bytes, 0, bytes.len())
            .expect("boxes")
            .iter()
            .map(|a| a.kind)
            .collect()
    }

    #[test]
    fn moves_the_header_in_front_and_follows_the_media_with_the_offsets() {
        let media = vec![7u8; 64];
        let source = clip(&media, &[trak(b"vide", &[28, 60])]);
        let prepared = prepare(&source).expect("a trailing header is moved");

        assert_eq!(order(&prepared), [*b"ftyp", *b"moov", *b"mdat"]);
        // The media data is still where the chunk offsets say it is.
        for offset in offsets_of(&prepared) {
            assert_eq!(
                prepared[offset as usize], 7,
                "offset {offset} misses the media"
            );
        }
        assert_eq!(prepared.len(), source.len(), "only the order changed");
    }

    #[test]
    fn drops_the_soundtrack_a_muted_wallpaper_never_plays() {
        let media = vec![7u8; 64];
        let source = clip(&media, &[trak(b"vide", &[28, 60]), trak(b"soun", &[40])]);
        let prepared = prepare(&source).expect("prepared");

        assert_eq!(order(&prepared), [*b"ftyp", *b"moov", *b"mdat"]);
        let moov = atoms(&prepared, 0, prepared.len())
            .expect("boxes")
            .into_iter()
            .find(|a| &a.kind == b"moov")
            .expect("a header");
        let traks = atoms(&prepared, moov.body(), moov.end)
            .expect("children")
            .iter()
            .filter(|a| &a.kind == b"trak")
            .count();
        assert_eq!(traks, 1, "only the picture is left");

        // The picture's own offsets still land on the media, and the audio's
        // are gone rather than dangling.
        let offsets = offsets_of(&prepared);
        assert_eq!(offsets.len(), 2);
        for offset in offsets {
            assert_eq!(prepared[offset as usize], 7, "offset {offset}");
        }
    }

    #[test]
    fn re_seats_a_leading_header_when_a_track_goes() {
        // Nothing would move here but for the lost track.
        let mut source = leading_clip(&[0u8; 32], &[trak(b"vide", &[0]), trak(b"soun", &[0])]);
        // Point both tracks at the media data, wherever it landed.
        let data = source.len() - 32;
        for at in 0..source.len() - 12 {
            if &source[at..at + 4] == b"stco" {
                let entry = at + 12;
                source[entry..entry + 4].copy_from_slice(&(data as u32).to_be_bytes());
            }
        }

        let prepared = prepare(&source).expect("the soundtrack goes");
        assert_eq!(order(&prepared), [*b"ftyp", *b"moov", *b"mdat"]);
        assert!(prepared.len() < source.len(), "the header lost a track");
        let offsets = offsets_of(&prepared);
        assert_eq!(offsets.len(), 1, "only the picture is left");
        assert_eq!(prepared[offsets[0] as usize], 0, "the picture still lands");
    }

    #[test]
    fn leaves_a_file_that_is_already_in_shape() {
        let source = leading_clip(&[7u8; 16], &[trak(b"vide", &[0])]);
        assert!(prepare(&source).is_none());
    }

    #[test]
    fn leaves_alone_what_it_does_not_understand() {
        assert!(prepare(b"").is_none(), "empty");
        assert!(prepare(&[0xff; 32]).is_none(), "not MP4");
        assert!(
            prepare(&atom(b"ftyp", b"isom")).is_none(),
            "no media and no header"
        );

        // Truncated: the last box claims more bytes than the file has.
        let mut short = clip(&[0u8; 16], &[trak(b"vide", &[28])]);
        short.truncate(short.len() - 4);
        assert!(prepare(&short).is_none(), "truncated");

        // Media data on both sides of the header needs per-chunk deltas.
        let mut split = clip(&[0u8; 16], &[trak(b"vide", &[28])]);
        split.extend_from_slice(&atom(b"mdat", &[9; 8]));
        assert!(prepare(&split).is_none(), "media behind the header too");

        // A clip with no picture at all keeps whatever tracks it has.
        let sound_only = clip(&[0u8; 16], &[trak(b"soun", &[28])]);
        let prepared = prepare(&sound_only).expect("the header still moves");
        assert_eq!(offsets_of(&prepared).len(), 1, "the track survives");
    }

    #[test]
    fn the_mp4_reader_agrees_the_result_is_the_same_clip() {
        use std::io::{BufWriter, Cursor};

        use mp4::{
            AvcConfig, MediaConfig, Mp4Config, Mp4Sample, Mp4Writer, TrackConfig, TrackType,
        };

        let mut source = Vec::new();
        let mut writer = Mp4Writer::write_start(
            BufWriter::new(Cursor::new(&mut source)),
            &Mp4Config {
                major_brand: str::parse("isom").expect("brand"),
                minor_version: 512,
                compatible_brands: vec![str::parse("isom").expect("brand")],
                timescale: 1000,
            },
        )
        .expect("writer");
        writer
            .add_track(&TrackConfig {
                track_type: TrackType::Video,
                timescale: 1000,
                language: "und".to_owned(),
                media_conf: MediaConfig::AvcConfig(AvcConfig {
                    width: 16,
                    height: 16,
                    seq_param_set: vec![0x67, 0x42, 0x00, 0x0a],
                    pic_param_set: vec![0x68, 0xce, 0x38, 0x80],
                }),
            })
            .expect("track");
        let payloads: Vec<Vec<u8>> = (0..4u8).map(|i| vec![i; 32 + usize::from(i)]).collect();
        for (index, bytes) in payloads.iter().enumerate() {
            writer
                .write_sample(
                    1,
                    &Mp4Sample {
                        start_time: index as u64 * 33,
                        duration: 33,
                        rendering_offset: 0,
                        is_sync: index == 0,
                        bytes: bytes.clone().into(),
                    },
                )
                .expect("sample");
        }
        writer.write_end().expect("end");
        drop(writer);

        let prepared = prepare(&source).expect("the crate writes its header last");
        let size = prepared.len() as u64;
        let mut reader = mp4::Mp4Reader::read_header(Cursor::new(prepared), size).expect("header");
        let track = *reader.tracks().keys().next().expect("a track");
        assert_eq!(reader.sample_count(track).expect("count"), 4);
        for (index, expected) in payloads.iter().enumerate() {
            let sample = reader
                .read_sample(track, index as u32 + 1)
                .expect("read")
                .expect("sample");
            assert_eq!(sample.bytes.as_ref(), expected.as_slice(), "sample {index}");
        }
    }
}
