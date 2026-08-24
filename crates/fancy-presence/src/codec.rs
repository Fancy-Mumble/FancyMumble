//! Frame codec for the Discord IPC protocol.
//!
//! Every message on a Discord IPC connection is an 8-byte little-endian
//! header (`opcode: u32`, `length: u32`) followed by `length` bytes of UTF-8
//! JSON. [`read_frame`] and [`write_frame`] are the only places in this crate
//! that touch the wire format; the WebSocket transport reuses the same JSON
//! bodies with the header replaced by WebSocket framing.

use std::io;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Largest JSON payload accepted on a single frame.
///
/// Discord's own messages sit far below this; the cap exists so a broken or
/// hostile local client cannot make us allocate without bound.
pub const MAX_PAYLOAD_LEN: usize = 64 * 1024;

/// Size of the fixed frame header, in bytes.
const HEADER_LEN: usize = 8;

/// Frame opcodes defined by the Discord IPC protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Opcode {
    /// Connection setup; the payload carries the protocol version and the
    /// caller's Discord application id.
    Handshake,
    /// Ordinary RPC message: commands, their responses, and dispatched events.
    Frame,
    /// Orderly shutdown; the payload carries a close code and message.
    Close,
    /// Keepalive request. The peer must answer with [`Opcode::Pong`].
    Ping,
    /// Keepalive response, echoing the ping payload.
    Pong,
}

impl Opcode {
    /// Decode an opcode from its wire representation.
    ///
    /// Returns `None` for values Discord has never defined, which callers
    /// treat as a protocol error rather than silently ignoring.
    #[must_use]
    pub fn from_wire(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::Handshake),
            1 => Some(Self::Frame),
            2 => Some(Self::Close),
            3 => Some(Self::Ping),
            4 => Some(Self::Pong),
            _ => None,
        }
    }

    /// The wire representation of this opcode.
    #[must_use]
    pub fn to_wire(self) -> u32 {
        match self {
            Self::Handshake => 0,
            Self::Frame => 1,
            Self::Close => 2,
            Self::Ping => 3,
            Self::Pong => 4,
        }
    }
}

/// One decoded IPC frame: an opcode plus its raw JSON payload.
///
/// The payload stays as bytes rather than a parsed value because bridge mode
/// forwards frames to the real Discord client verbatim - re-serialising a
/// parsed value could reorder keys or drop fields we do not model.
#[derive(Debug, Clone)]
pub struct IpcFrame {
    /// What kind of message this is.
    pub opcode: Opcode,
    /// The raw JSON body, unparsed.
    pub payload: Vec<u8>,
}

impl IpcFrame {
    /// Build a frame from a JSON value.
    #[must_use]
    pub fn from_json(opcode: Opcode, value: &serde_json::Value) -> Self {
        // `Value` serialisation is infallible: it contains no maps with
        // non-string keys and no types with failing `Serialize` impls.
        let payload = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
        Self { opcode, payload }
    }

    /// Parse the payload as JSON.
    pub fn to_json(&self) -> Result<serde_json::Value, serde_json::Error> {
        serde_json::from_slice(&self.payload)
    }

    /// Encode the frame to its full on-the-wire byte sequence.
    #[must_use]
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(HEADER_LEN + self.payload.len());
        out.extend_from_slice(&self.opcode.to_wire().to_le_bytes());
        // Length was validated on construction paths that read from the
        // wire; locally built frames are far below u32::MAX.
        let len = u32::try_from(self.payload.len()).unwrap_or(u32::MAX);
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(&self.payload);
        out
    }
}

/// Read one frame, waiting for as much input as the header announces.
///
/// Returns [`io::ErrorKind::UnexpectedEof`] when the peer closes cleanly
/// between frames, and [`io::ErrorKind::InvalidData`] for an unknown opcode
/// or a payload larger than [`MAX_PAYLOAD_LEN`].
pub async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> io::Result<IpcFrame> {
    let mut header = [0_u8; HEADER_LEN];
    let _ = reader.read_exact(&mut header).await?;

    let raw_opcode = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let length = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;

    let Some(opcode) = Opcode::from_wire(raw_opcode) else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("unknown Discord IPC opcode {raw_opcode}"),
        ));
    };
    if length > MAX_PAYLOAD_LEN {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("frame payload of {length} bytes exceeds the {MAX_PAYLOAD_LEN}-byte cap"),
        ));
    }

    let mut payload = vec![0_u8; length];
    if length > 0 {
        let _ = reader.read_exact(&mut payload).await?;
    }
    Ok(IpcFrame { opcode, payload })
}

/// Write one frame and flush it.
///
/// Flushing matters: client libraries block waiting for the handshake
/// response, and a buffered transport would deadlock them.
pub async fn write_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    frame: &IpcFrame,
) -> io::Result<()> {
    writer.write_all(&frame.encode()).await?;
    writer.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opcodes_round_trip_through_the_wire_form() {
        for opcode in [
            Opcode::Handshake,
            Opcode::Frame,
            Opcode::Close,
            Opcode::Ping,
            Opcode::Pong,
        ] {
            assert_eq!(Opcode::from_wire(opcode.to_wire()), Some(opcode));
        }
        assert_eq!(Opcode::from_wire(5), None);
    }

    #[test]
    fn encodes_the_documented_header_layout() {
        let frame = IpcFrame {
            opcode: Opcode::Frame,
            payload: b"{}".to_vec(),
        };
        assert_eq!(frame.encode(), vec![1, 0, 0, 0, 2, 0, 0, 0, b'{', b'}']);
    }

    #[tokio::test]
    async fn reads_back_what_it_wrote() {
        let original = IpcFrame::from_json(
            Opcode::Handshake,
            &serde_json::json!({ "v": 1, "client_id": "1234" }),
        );
        let mut buffer = Vec::new();
        write_frame(&mut buffer, &original).await.expect("write");

        let decoded = read_frame(&mut buffer.as_slice()).await.expect("read");
        assert_eq!(decoded.opcode, Opcode::Handshake);
        assert_eq!(decoded.to_json().expect("json")["client_id"], "1234");
    }

    #[tokio::test]
    async fn rejects_an_oversized_payload_without_allocating_it() {
        let mut wire = Vec::new();
        wire.extend_from_slice(&1_u32.to_le_bytes());
        wire.extend_from_slice(&(MAX_PAYLOAD_LEN as u32 + 1).to_le_bytes());

        let err = read_frame(&mut wire.as_slice())
            .await
            .expect_err("oversized");
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[tokio::test]
    async fn rejects_an_unknown_opcode() {
        let mut wire = Vec::new();
        wire.extend_from_slice(&9_u32.to_le_bytes());
        wire.extend_from_slice(&0_u32.to_le_bytes());

        let err = read_frame(&mut wire.as_slice())
            .await
            .expect_err("bad opcode");
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[tokio::test]
    async fn reports_eof_between_frames() {
        let empty: Vec<u8> = Vec::new();
        let err = read_frame(&mut empty.as_slice()).await.expect_err("eof");
        assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof);
    }
}
