//! Sealing what the account keeps on the server from the server itself.
//!
//! Some of what a person's devices share through the account's records is
//! nobody else's business, the operator's included: the list of other servers
//! they use, and the passwords saved for them. Those are sealed under a key
//! derived from the identity seed, which every linked device holds (linking
//! copies it) and the server never sees. A device without the seed - a fresh
//! install that signed in by password - simply cannot read them, which is
//! the right answer for data it was never given.

use sha2::{Digest as _, Sha256};

use super::AppState;
use super::link::{open_with, seal_with};

/// Bound into every seal, so these parcels open only as what they are.
const AAD: &[u8] = b"fancy-account-seal-v1";

/// The key for this account's sealed records, from the identity seed.
fn key_from(seed: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"fancy-account-seal-key-v1");
    hasher.update([0]);
    hasher.update(seed);
    hasher.finalize().into()
}

impl AppState {
    /// The identity seed of the active connection.
    fn account_seal_key(&self) -> Result<[u8; 32], String> {
        let session = self.inner.snapshot();
        let state = session.lock().map_err(|e| e.to_string())?;
        state
            .pchat_ctx
            .seed
            .as_ref()
            .map(key_from)
            .ok_or_else(|| "this connection has no identity to seal with".to_owned())
    }

    /// Seal `plaintext` so only this account's devices can open it.
    ///
    /// # Errors
    ///
    /// When the connection has no identity seed.
    pub fn account_seal(&self, plaintext: &str) -> Result<String, String> {
        seal_with(&self.account_seal_key()?, AAD, plaintext.as_bytes())
    }

    /// Open what [`AppState::account_seal`] sealed.
    ///
    /// # Errors
    ///
    /// When there is no seed, or it is not the one the parcel was sealed with.
    pub fn account_open(&self, sealed: &str) -> Result<String, String> {
        let plain = open_with(&self.account_seal_key()?, AAD, sealed)?;
        String::from_utf8(plain).map_err(|_| "the parcel is not text".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_seed_opens_what_it_sealed_and_another_seed_does_not() {
        let key = key_from(&[7; 32]);
        let sealed = seal_with(&key, AAD, b"servers").expect("sealed");
        assert_eq!(open_with(&key, AAD, &sealed).expect("opened"), b"servers");
        assert!(open_with(&key_from(&[8; 32]), AAD, &sealed).is_err());
        // Nor as a device-link parcel, whatever key it is tried with.
        assert!(open_with(&key, b"fancy-device-link-v1", &sealed).is_err());
    }
}
