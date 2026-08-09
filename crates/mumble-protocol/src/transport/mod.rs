//! Network transport layer for the Mumble protocol.
//!
//! Provides TCP (control messages over TLS) and UDP (audio) transports,
//! plus wire-framing and audio codec helpers.
//!
//! Two voice ciphers live here, both behind [`udp::CryptState`]: [`ocb2`] for
//! every stock Mumble server, and [`modern_crypt`] for a Fancy server at 0.4.0
//! or later. Which one a connection gets is decided once, from the version the
//! server announced - see [`crate::gate`].
pub mod audio_codec;
pub mod codec;
pub mod modern_crypt;
pub mod ocb2;
pub mod tcp;
pub mod udp;
pub mod voice_crypt;
