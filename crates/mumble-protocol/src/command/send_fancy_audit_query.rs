use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Auditor -> Server: search the audit log, page through results, subscribe
/// to a live tail, run a chain verification, or (advanced mode) execute a
/// read-only SQL query against the permission-scoped audit views.
///
/// The server enforces `ViewAudit` (today: root-channel Write) and answers
/// with `FancyAuditResponse`; live-tail subscribers additionally receive
/// `FancyAuditEvent` pushes for matching new entries.
#[derive(Debug)]
pub struct SendFancyAuditQuery {
    /// The fully-populated query message (built by the Tauri layer).
    pub query: mumble_tcp::FancyAuditQuery,
}

impl CommandAction for SendFancyAuditQuery {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyAuditQuery(self.query.clone())],
            ..Default::default()
        }
    }
}
