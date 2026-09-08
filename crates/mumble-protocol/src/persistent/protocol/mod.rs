//! The end-to-end encryption protocols persistent chat can speak.
//!
//! | Version | Module | Description |
//! |---------|--------|-------------|
//! | 1 | [`fancy_v1`] | XChaCha20-Poly1305 + HKDF-SHA256, X25519/Ed25519 identity |
//! | 2 | [`signal_v1`] | Signal Sender Keys via dynamic library (AGPL-isolated) |
//!
//! `KeyManager` selects between them on [`PchatProtocol`](crate::persistent::PchatProtocol);
//! there is no trait over the two, because the parts they share
//! (`CryptoSuite`, `KeyDeriver`, and the rest of `fancy_v1`) are already
//! factored out and the parts they do not share have never lined up.

pub mod fancy_v1;
pub mod signal_v1;
