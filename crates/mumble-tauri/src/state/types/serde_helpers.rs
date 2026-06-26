//! Serde serialization helpers shared across the `state::types` submodules.

use serde::Serializer;

use mumble_protocol::state::PchatProtocol;

pub(crate) fn serialize_pchat_protocol<S: Serializer>(protocol: &Option<PchatProtocol>, s: S) -> Result<S::Ok, S::Error> {
    match protocol {
        Some(p) => s.serialize_str(match p {
            PchatProtocol::None => "none",
            PchatProtocol::FancyV1FullArchive => "fancy_v1_full_archive",
            PchatProtocol::SignalV1 => "signal_v1",
        }),
        _ => s.serialize_none(),
    }
}

/// Derive a stable, non-zero `u32` "marker" from a blob hash (or the blob
/// itself).  Used as the serialised `texture_size`: it is non-zero whenever an
/// avatar exists (so the frontend knows to fetch it) and changes when the
/// avatar changes (so caches invalidate), without ever shipping the bytes.
pub(crate) fn blob_marker(bytes: &[u8]) -> u32 {
    let mut buf = [0u8; 4];
    for (i, b) in bytes.iter().take(4).enumerate() {
        buf[i] = *b;
    }
    u32::from_le_bytes(buf) | 1
}

/// Emit only the byte length of a `String` (used for channel
/// `description`).  The frontend fetches the actual text on demand via
/// `get_channel_description`.
pub(crate) fn serialize_string_len_owned<S: Serializer>(text: &str, s: S) -> Result<S::Ok, S::Error> {
    if text.is_empty() {
        s.serialize_none()
    } else {
        s.serialize_some(&(text.len() as u32))
    }
}

/// Serialize a byte slice as a base64 string instead of a JSON number array.
/// A plain `Vec<u8>` serialises at ~32 heap bytes per payload byte under
/// `serde_json`; base64 keeps it at ~1.3x the byte size end to end. Used for
/// the `data` field of plugin-data payloads.
pub(crate) fn serialize_bytes_base64<S: Serializer>(
    bytes: &[u8],
    ser: S,
) -> Result<S::Ok, S::Error> {
    use base64::Engine as _;
    ser.serialize_str(&base64::engine::general_purpose::STANDARD.encode(bytes))
}
