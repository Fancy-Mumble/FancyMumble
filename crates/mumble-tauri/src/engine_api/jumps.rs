//! Finding somebody on any server the engine is on, for a view that is not
//! the web page: what the web client's `find_user_by_hash` and
//! `find_user_in_server` commands do for its jump-to-user keys.

use crate::state::HashLookup;

use super::EngineHandle;

impl EngineHandle {
    /// Where somebody is: by their certificate's hash on any server the
    /// engine is connected to, else by `name` on the one whose session id
    /// is `session`. The id of the session they were found on, and their
    /// session there.
    #[must_use]
    pub fn find_user(&self, hash: Option<&str>, name: &str, session: Option<&str>) -> Option<(String, u32)> {
        let registry = &self.state.registry;
        let found = hash
            .and_then(|hash| {
                registry.find_user_by_hash(HashLookup {
                    user_hash: hash,
                    user_id: None,
                    origin: None,
                })
            })
            .or_else(|| registry.find_user_in_server(session?.parse().ok()?, name))?;
        Some((found.server_id.to_string(), found.user_session))
    }
}
