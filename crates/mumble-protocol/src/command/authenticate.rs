use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Authenticate with the Mumble server.
#[derive(Debug)]
pub struct Authenticate {
    /// Username to authenticate with.
    pub username: String,
    /// Optional server password.
    pub password: Option<String>,
    /// Access tokens for permission-gated channels.
    pub tokens: Vec<String>,
    /// Optional TOTP code for accounts with 2FA enabled (Fancy extension).
    pub totp: Option<String>,
    /// Which install this is, so one account can be online from several
    /// devices at once (Fancy extension, Starling). `None` logs in as no
    /// device in particular, the way every stock client does.
    pub device: Option<Device>,
}

/// A device as `Authenticate` names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Device {
    /// Stable per install and server.
    pub id: String,
    /// Proves the id was not copied off another session.
    pub secret: String,
    /// What the owner sees in their device list.
    pub name: String,
}

impl CommandAction for Authenticate {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        let msg = mumble_tcp::Authenticate {
            username: Some(self.username.clone()),
            password: self.password.clone(),
            tokens: self.tokens.clone(),
            opus: Some(true),
            totp_code: self.totp.clone(),
            device_id: self.device.as_ref().map(|d| d.id.clone()),
            device_secret: self.device.as_ref().map(|d| d.secret.clone()),
            device_name: self.device.as_ref().map(|d| d.name.clone()),
            ..Default::default()
        };
        CommandOutput {
            tcp_messages: vec![ControlMessage::Authenticate(msg)],
            ..Default::default()
        }
    }
}
