use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Send a Signal sender key distribution to the server for relay and storage.
#[derive(Debug)]
pub struct SendPchatSenderKeyDistribution {
    /// The channel this distribution is for.
    pub channel_id: u32,
    /// The raw SKDM bytes produced by the Signal bridge.
    pub distribution: Vec<u8>,
    /// Our own certificate hash, naming who this key belongs to.
    ///
    /// Sent rather than left for the server, because this message has no canon
    /// form and therefore travels wrapped in `PluginDataTransmission`, which is
    /// **opaque**: the server relays the bytes without parsing them, so it
    /// cannot stamp a field inside. The receiver read `sender_hash` as empty,
    /// filed the key under no identity, and every cross-client decrypt failed
    /// with `group_decrypt failed` while single-client tests passed.
    ///
    /// A server that *does* parse it overwrites this with the authenticated
    /// sender (`a_sender_key_distribution_reaches_the_member_it_names`), so
    /// naming ourselves here cannot be used to impersonate anyone.
    pub sender_hash: String,
}

impl CommandAction for SendPchatSenderKeyDistribution {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::PchatSenderKeyDistribution(
                mumble_tcp::PchatSenderKeyDistribution {
                    channel_id: Some(self.channel_id),
                    sender_hash: Some(self.sender_hash.clone()),
                    distribution: Some(self.distribution.clone()),
                },
            )],
            ..Default::default()
        }
    }
}
