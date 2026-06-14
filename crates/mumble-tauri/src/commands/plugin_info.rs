//! Decoder for the `fancy-plugin-info` plugin-data envelope.
//!
//! Wire format (little-endian):
//!
//! ```text
//! [u8 ver=1][u8 flags][u32 LE raw_len][payload]
//! ```
//!
//! * `flags` bit 0 = payload is zstd-compressed.
//! * `raw_len` is the uncompressed JSON byte length.
//!
//! Server-side encoder lives in
//! `mumble-server/3rdparty/mumble-plugin-host/host/src/info.rs`.

use serde::Serialize;

/// Maximum decompressed JSON size (must match
/// `mumble_plugin_api::PLUGIN_INFO_MAX_BYTES`).
const PLUGIN_INFO_MAX_BYTES: usize = 64 * 1024;

const ENVELOPE_VERSION: u8 = 1;
const FLAG_ZSTD: u8 = 0b0000_0001;
const HEADER_LEN: usize = 6;

/// Decoded record returned to JS.  The `info` field is forwarded
/// verbatim so the UI is free to add fields without touching Rust.
#[derive(Debug, Serialize)]
pub(crate) struct DecodedPluginInfo {
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) info: serde_json::Value,
}

#[tauri::command]
pub(crate) async fn decode_plugin_info(envelope: Vec<u8>) -> Result<DecodedPluginInfo, String> {
    tokio::task::spawn_blocking(move || decode(&envelope))
        .await
        .map_err(|e| e.to_string())?
}

fn decode(buf: &[u8]) -> Result<DecodedPluginInfo, String> {
    if buf.len() < HEADER_LEN {
        return Err(format!("envelope too short: {} B", buf.len()));
    }
    let ver = buf[0];
    if ver != ENVELOPE_VERSION {
        return Err(format!("unsupported envelope version {ver}"));
    }
    let flags = buf[1];
    let raw_len = u32::from_le_bytes([buf[2], buf[3], buf[4], buf[5]]) as usize;
    if raw_len > PLUGIN_INFO_MAX_BYTES {
        return Err(format!(
            "raw_len {raw_len} exceeds limit {PLUGIN_INFO_MAX_BYTES}"
        ));
    }
    let payload = &buf[HEADER_LEN..];

    let json_bytes = if flags & FLAG_ZSTD != 0 {
        use std::io::Read;
        // Bound the decompressed size: a malicious payload can declare a
        // small `raw_len` (passing the header check above) yet expand to
        // gigabytes.  Decompress through a `take`-limited reader so memory
        // use is capped regardless of the compressed input.  Read one byte
        // past the limit to detect overflow.
        let decoder =
            zstd::stream::read::Decoder::new(payload).map_err(|e| format!("zstd init: {e}"))?;
        let mut out = Vec::new();
        let _ = decoder
            .take(PLUGIN_INFO_MAX_BYTES as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|e| format!("zstd decode: {e}"))?;
        if out.len() > PLUGIN_INFO_MAX_BYTES {
            return Err(format!(
                "decompressed payload exceeds limit {PLUGIN_INFO_MAX_BYTES}"
            ));
        }
        out
    } else {
        payload.to_vec()
    };

    if json_bytes.len() != raw_len {
        return Err(format!(
            "raw_len mismatch: declared {raw_len}, actual {}",
            json_bytes.len()
        ));
    }

    #[derive(serde::Deserialize)]
    struct Record {
        name: String,
        version: String,
        info: serde_json::Value,
    }

    let r: Record = serde_json::from_slice(&json_bytes).map_err(|e| format!("json: {e}"))?;
    Ok(DecodedPluginInfo {
        name: r.name,
        version: r.version,
        info: r.info,
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "tests panic on failure")]

    use super::*;

    fn build_envelope(json: &[u8], compress: bool) -> Vec<u8> {
        let (payload, flags) = if compress {
            (zstd::stream::encode_all(json, 3).unwrap(), FLAG_ZSTD)
        } else {
            (json.to_vec(), 0)
        };
        let raw_len = u32::try_from(json.len()).unwrap();
        let mut out = Vec::with_capacity(HEADER_LEN + payload.len());
        out.push(ENVELOPE_VERSION);
        out.push(flags);
        out.extend_from_slice(&raw_len.to_le_bytes());
        out.extend_from_slice(&payload);
        out
    }

    #[test]
    fn decodes_uncompressed() {
        let json = br#"{"name":"file-server","version":"0.1.0","info":{"description":"x"}}"#;
        let env = build_envelope(json, false);
        let rec = decode(&env).unwrap();
        assert_eq!(rec.name, "file-server");
        assert_eq!(rec.version, "0.1.0");
        assert_eq!(rec.info["description"], "x");
    }

    #[test]
    fn decodes_zstd() {
        let big = "abcdefghij".repeat(64);
        let json = format!(r#"{{"name":"p","version":"1.0.0","info":{{"d":"{big}"}}}}"#);
        let env = build_envelope(json.as_bytes(), true);
        let rec = decode(&env).unwrap();
        assert_eq!(rec.info["d"], big);
    }

    #[test]
    fn rejects_short_buffer() {
        let err = decode(&[1, 0, 0]).unwrap_err();
        assert!(err.contains("too short"));
    }

    #[test]
    fn rejects_wrong_version() {
        let mut env = build_envelope(br#"{"name":"a","version":"1","info":{}}"#, false);
        env[0] = 9;
        assert!(decode(&env).unwrap_err().contains("version"));
    }

    #[test]
    fn rejects_oversized_raw_len() {
        let mut env = build_envelope(br#"{"name":"a","version":"1","info":{}}"#, false);
        env[2..6].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(decode(&env).unwrap_err().contains("exceeds"));
    }

    #[test]
    fn rejects_zstd_bomb_exceeding_limit() {
        // Declares a tiny raw_len (passing the header check) but expands
        // past the limit; the bounded decoder must reject it.
        let big = vec![0u8; PLUGIN_INFO_MAX_BYTES + 4096];
        let compressed = zstd::stream::encode_all(big.as_slice(), 3).unwrap();
        let mut out = Vec::with_capacity(HEADER_LEN + compressed.len());
        out.push(ENVELOPE_VERSION);
        out.push(FLAG_ZSTD);
        out.extend_from_slice(&1u32.to_le_bytes());
        out.extend_from_slice(&compressed);
        let err = decode(&out).unwrap_err();
        assert!(err.contains("exceeds limit"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_raw_len_mismatch() {
        let mut env = build_envelope(br#"{"name":"a","version":"1","info":{}}"#, false);
        env[2] = env[2].wrapping_add(1);
        assert!(decode(&env).unwrap_err().contains("mismatch"));
    }
}
