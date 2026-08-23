use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// User -> Server: one self-service account operation (query the snapshot,
/// set/clear the password, rename, set email, unregister, TOTP enrolment).
///
/// The server answers with a `FancyAccountAck` and - on success - a fresh
/// `FancyAccountSettings` snapshot.
#[derive(Debug)]
pub struct SendFancyAccountSettingsUpdate {
    /// The action to perform (`mumble_tcp::fancy_account_settings_update::Action`).
    pub action: mumble_tcp::fancy_account_settings_update::Action,
    /// Action-specific payload (password, new name, email, TOTP code, ...).
    pub value: Option<String>,
    /// The account's current password, re-typed. `None` on `QUERY`, which
    /// changes nothing; the server refuses every other action without it.
    pub current_password: Option<String>,
}

impl CommandAction for SendFancyAccountSettingsUpdate {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyAccountSettingsUpdate(
                mumble_tcp::FancyAccountSettingsUpdate {
                    action: self.action as i32,
                    value: self.value.clone(),
                    current_password: self.current_password.clone(),
                },
            )],
            ..Default::default()
        }
    }
}
