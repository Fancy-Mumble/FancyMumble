//! Ask a server what it looks like without joining it.
//!
//! The asking is the engine's (`state::livery_probe`), shared with every
//! other view; this is the web client's way to it.

use crate::state::LiverySnapshot;

/// What a server says it looks like, asked without joining it.
///
/// `Ok(None)` is a server that answered the connection but not the question:
/// it accepted the frame and sent something else, which is what a non-Fancy
/// server does with a message type it does not know. `Err` is a failure to ask
/// at all - unreachable, TLS refused, or out of time.
#[tauri::command]
pub(crate) async fn probe_livery(
    host: String,
    port: u16,
    have_keys: Option<Vec<String>>,
) -> Result<Option<LiverySnapshot>, String> {
    crate::state::livery_probe::probe(host, port, have_keys.unwrap_or_default()).await
}
