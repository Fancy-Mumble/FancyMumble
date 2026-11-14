//! Asking the server's invites service something.
//!
//! Fire and forget: the answer arrives as the `invites` event, correlated by
//! the `request_id` the caller chose, because a server that predates invites
//! never answers and waiting here would hang the command.

use mumble_protocol::command;
use mumble_protocol::proto::fancy::invites::invites_envelope;

use super::AppState;

impl AppState {
    pub async fn send_invites(&self, body: invites_envelope::Body) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        handle
            .ok_or("Not connected")?
            .send(command::SendInvites { body })
            .await
            .map_err(|e| format!("Failed to send an invites request: {e}"))
    }
}
