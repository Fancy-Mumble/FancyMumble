//! The recovery phrase: an identity's chat seed as 24 words.
//!
//! `persistent-chat.md` §5.1 asks for it, and it is what stands between losing
//! every device and losing every encrypted conversation with them. The seed
//! is what the identity's end-to-end keys and archive keys are derived from;
//! written down as a BIP39 phrase (256 bits, 24 words, with a checksum), it
//! can be typed back into a fresh install and the same keys come back.
//!
//! It restores the seed and nothing else. The certificate is not in it: an
//! account that logs in by certificate alone is reached on a new device by
//! linking one that still has it, or by a password set beforehand.

use bip39::Mnemonic;

use super::pchat::IdentityStore;

/// The phrase for `seed`: 24 English words.
///
/// # Errors
///
/// Never for a 32-byte seed; the `Result` is the library's.
pub(crate) fn phrase_for(seed: &[u8; 32]) -> Result<String, String> {
    Mnemonic::from_entropy(seed)
        .map(|mnemonic| mnemonic.words().collect::<Vec<_>>().join(" "))
        .map_err(|e| format!("could not make a phrase: {e}"))
}

/// The seed a phrase stands for.
///
/// Forgiving about how it was typed - case, extra spaces, line breaks - and
/// strict about what was typed: a wrong word or a word out of place fails the
/// checksum rather than producing some other seed.
///
/// # Errors
///
/// When it is not a valid 24-word English phrase.
pub(crate) fn seed_from(phrase: &str) -> Result<[u8; 32], String> {
    let normalized = phrase
        .split_whitespace()
        .map(str::to_lowercase)
        .collect::<Vec<_>>()
        .join(" ");
    let mnemonic = Mnemonic::parse_normalized(&normalized)
        .map_err(|e| format!("that is not a valid recovery phrase: {e}"))?;
    <[u8; 32]>::try_from(mnemonic.to_entropy().as_slice())
        .map_err(|_| "a recovery phrase has 24 words".to_owned())
}

impl IdentityStore {
    /// The recovery phrase of identity `label`, creating its seed if it has
    /// none yet.
    ///
    /// # Errors
    ///
    /// When the seed cannot be read or written.
    pub fn recovery_phrase(&self, label: &str) -> Result<String, String> {
        phrase_for(&self.load_or_generate_seed(label)?)
    }

    /// Replace identity `label`'s seed with the one `phrase` stands for.
    ///
    /// # Errors
    ///
    /// When the phrase is not valid or the seed cannot be written.
    pub fn restore_seed(&self, label: &str, phrase: &str) -> Result<(), String> {
        let seed = seed_from(phrase)?;
        let dir = self.identity_dir(label);
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create identity dir: {e}"))?;
        std::fs::write(dir.join(super::pchat::SEED_FILE), seed)
            .map_err(|e| format!("Failed to write seed: {e}"))?;
        tracing::info!(label, "restored an identity seed from its recovery phrase");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]

    use super::*;

    #[test]
    fn a_seed_comes_back_from_its_phrase_however_it_was_typed() {
        let seed = [42_u8; 32];
        let phrase = phrase_for(&seed).unwrap();
        assert_eq!(phrase.split(' ').count(), 24);
        assert_eq!(seed_from(&phrase).unwrap(), seed);
        let sloppy = format!("  {}\n", phrase.to_uppercase().replace(' ', "   "));
        assert_eq!(seed_from(&sloppy).unwrap(), seed);
    }

    #[test]
    fn a_wrong_or_misplaced_word_is_refused_rather_than_read_as_another_seed() {
        let phrase = phrase_for(&[7_u8; 32]).unwrap();
        let mut words: Vec<&str> = phrase.split(' ').collect();
        words.swap(0, 1);
        assert!(seed_from(&words.join(" ")).is_err());
        assert!(seed_from("not a phrase").is_err());
        // Twelve words is a valid phrase for a shorter seed, and not ours.
        let short = Mnemonic::from_entropy(&[1_u8; 16]).unwrap().to_string();
        assert!(seed_from(&short).is_err());
    }

    #[test]
    fn restoring_writes_the_seed_the_identity_then_loads() {
        let dir = tempfile::tempdir().unwrap();
        let store = IdentityStore::new(dir.path().to_path_buf());
        let phrase = phrase_for(&[9_u8; 32]).unwrap();
        store.restore_seed("default", &phrase).unwrap();
        assert_eq!(store.load_or_generate_seed("default").unwrap(), [9_u8; 32]);
        assert_eq!(store.recovery_phrase("default").unwrap(), phrase);
    }
}
