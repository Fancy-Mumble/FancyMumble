//! Making an identity and its recovery phrase, for a view that is not the
//! web page: what the web client's `generate_certificate`,
//! `get_recovery_phrase` and `restore_recovery_phrase` commands do.

use crate::state::pchat::IdentityStore;

use super::EngineHandle;

impl EngineHandle {
    /// Make a new identity called `label`: its certificate and its seed.
    /// One that is there already is left as it is.
    ///
    /// # Errors
    ///
    /// When its files could not be written.
    pub fn create_certificate(&self, label: &str) -> Result<(), String> {
        IdentityStore::new(self.data_dir.clone()).generate_cert(label)
    }

    /// The 24-word recovery phrase of the identity `label`.
    ///
    /// # Errors
    ///
    /// When there is no such identity, or it has no seed.
    pub fn recovery_phrase(&self, label: &str) -> Result<String, String> {
        IdentityStore::new(self.data_dir.clone()).recovery_phrase(label)
    }

    /// Give the identity `label` the seed `phrase` stands for. Takes effect
    /// on the next connection with it.
    ///
    /// # Errors
    ///
    /// When the phrase is not a recovery phrase, or there is no such
    /// identity.
    pub fn restore_recovery_phrase(&self, label: &str, phrase: &str) -> Result<(), String> {
        IdentityStore::new(self.data_dir.clone()).restore_seed(label, phrase)
    }
}
