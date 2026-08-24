use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::{PchatProtocol, ServerState};

/// Update or create a channel on the server.
///
/// For **editing** an existing channel, set `channel_id` to `Some(id)`.
/// For **creating** a new sub-channel, set `channel_id` to `None` and
/// `parent` to `Some(parent_id)`.
///
/// Only fields set to `Some(...)` are included in the message;
/// the server ignores absent fields.  The caller must ensure the
/// user has the required permissions (Write / `MakeChannel`) before
/// sending.
#[derive(Debug, Default)]
pub struct SetChannelState {
    /// Target channel ID.  `None` when creating a new channel.
    pub channel_id: Option<u32>,
    /// Parent channel ID (required when creating a new channel).
    pub parent: Option<u32>,
    /// New channel name.
    pub name: Option<String>,
    /// New channel description (HTML).
    pub description: Option<String>,
    /// Display order hint for the channel in the tree.
    pub position: Option<i32>,
    /// Whether the channel is temporary (auto-deleted when empty).
    pub temporary: Option<bool>,
    /// Maximum number of users allowed in the channel (0 = unlimited).
    pub max_users: Option<u32>,
    /// Persistent-chat protocol for this channel.
    pub pchat_protocol: Option<PchatProtocol>,
    /// Max stored messages (0 = unlimited).
    pub pchat_max_history: Option<u32>,
    /// Auto-delete after N days (0 = forever).
    pub pchat_retention_days: Option<u32>,
    /// Channel access password.  `Some("")` removes the password;
    /// `None` leaves the existing password unchanged.
    pub channel_info_password: Option<String>,
    /// Whether the channel is hidden (only users with `SeeChannel` see it).
    pub hidden: Option<bool>,
    /// Channel expiry mode: 0 = none, 1 = absolute, 2 = sliding.
    pub expiry_mode: Option<u32>,
    /// Expiry lifetime / idle window in seconds.
    pub expiry_duration_secs: Option<u32>,
    /// Meeting-room invitees (registered `user_id`s). On create the server grants
    /// each `SeeChannel|Enter|Traverse` and denies them to `@all`. Empty = no-op.
    pub invitee_user_ids: Vec<u32>,
    /// Channel attributes to assign, paired with [`Self::attribute_mask`].
    ///
    /// Generic on purpose: any settable `ChannelAttribute` travels through here,
    /// so a new channel trait needs no new field on this command. An attribute
    /// named in the mask is set when listed here and cleared when not.
    pub attributes: Vec<mumble_tcp::ChannelAttribute>,
    /// Which attributes this message asserts. Empty leaves every attribute
    /// untouched, which is what unrelated partial updates (a rename, say) want.
    pub attribute_mask: Vec<mumble_tcp::ChannelAttribute>,
}

impl CommandAction for SetChannelState {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        #[allow(
            deprecated,
            reason = "the legacy `temporary` wire field must still be sent for server compatibility"
        )]
        let msg = mumble_tcp::ChannelState {
            channel_id: self.channel_id,
            parent: self.parent,
            name: self.name.clone(),
            description: self.description.clone(),
            position: self.position,
            temporary: self.temporary,
            max_users: self.max_users,
            pchat_protocol: self.pchat_protocol.map(PchatProtocol::to_proto),
            pchat_max_history: self.pchat_max_history,
            pchat_retention_days: self.pchat_retention_days,
            channel_info_password: self.channel_info_password.clone(),
            hidden: self.hidden,
            expiry_mode: self.expiry_mode,
            expiry_duration_secs: self.expiry_duration_secs,
            invitee_user_ids: self.invitee_user_ids.clone(),
            attributes: self.attributes.iter().map(|&a| a as i32).collect(),
            attribute_mask: self.attribute_mask.iter().map(|&a| a as i32).collect(),
            ..Default::default()
        };
        tracing::debug!(
            ?self.channel_id,
            ?self.pchat_protocol,
            proto_pchat_protocol = ?msg.pchat_protocol,
            proto_pchat_max_history = ?msg.pchat_max_history,
            proto_pchat_retention_days = ?msg.pchat_retention_days,
            "SetChannelState: sending ChannelState to server"
        );
        CommandOutput {
            tcp_messages: vec![ControlMessage::ChannelState(msg)],
            ..Default::default()
        }
    }
}
