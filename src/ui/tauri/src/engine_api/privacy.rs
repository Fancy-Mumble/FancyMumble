//! What the user keeps from servers, for a view that is not the web page:
//! the same switch the web client's `set_disable_dual_path` command sets.

use super::EngineHandle;

impl EngineHandle {
    /// Whether an encrypted channel's message also goes out as a plain-text
    /// placeholder, for clients without end-to-end encryption to see that
    /// something was said. Off keeps the ciphertext off the plain path.
    pub fn set_dual_path(&self, sending: bool) {
        if let Ok(mut snapshot) = self.state.inner.snapshot().lock() {
            snapshot.prefs.disable_dual_path = !sending;
        }
    }
}
