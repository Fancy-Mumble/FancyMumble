//! `EventHandler` bridging `mumble-protocol` events to the QML `Backend`.
//!
//! Owns a private [`ServerState`] (users + channels) and an [`AudioMixer`]
//! for inbound voice.  Whenever the roster changes it serialises a compact
//! channel/user tree to JSON and pushes it to the UI; chat and audio are
//! forwarded as they arrive.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use cxx_qt::CxxQtThread;

use fancy_utils::markdown::sanitize_styled_text;

use mumble_protocol::audio::encoder::EncodedPacket;
use mumble_protocol::audio::mixer::AudioMixer;
use mumble_protocol::event::EventHandler;
use mumble_protocol::message::{ControlMessage, UdpMessage};
use mumble_protocol::proto::mumble_tcp;
use mumble_protocol::state::{Channel, ServerState};

use crate::app::{ui_emit_chat, ui_set_channels, ui_set_self_channel, ui_set_status, Shared};
use crate::bridge::qobject::Backend;

/// Samples represented by one inbound Opus packet (20 ms @ 48 kHz).
const FRAME_SAMPLES: u32 = 960;

/// The protocol event handler for the Qt client.
pub struct QtEventHandler {
    ui: CxxQtThread<Backend>,
    shared: Arc<Mutex<Shared>>,
    state: ServerState,
    mixer: AudioMixer,
    own_session: Option<u32>,
    /// Last `selfChannel` value pushed to the UI, to avoid redundant updates.
    last_self_channel: i32,
}

impl QtEventHandler {
    /// Create a handler bound to the given UI thread + shared state.
    pub fn new(ui: CxxQtThread<Backend>, shared: Arc<Mutex<Shared>>, mixer: AudioMixer) -> Self {
        Self {
            ui,
            shared,
            state: ServerState::new(),
            mixer,
            own_session: None,
            last_self_channel: -1,
        }
    }

    /// Serialise the channel tree (with members) to JSON and push it to QML.
    ///
    /// Members are objects (not bare names) so the QML `NameCard` hover card
    /// can show registration, status and bio without extra round trips.
    ///
    /// Mirrors the web client's visibility rules (`channelVisibility.ts`):
    /// detached rooms (scheduled meetings, `__dm:` friend chats) never appear
    /// in the tree, and occupants of `__dm:` rooms are re-attributed to the
    /// root channel so they stay visible instead of vanishing into a channel
    /// that is never drawn.
    fn push_channels(&self) {
        let mut channels: Vec<&Channel> =
            self.state.channels.values().filter(|c| !c.detached).collect();
        channels.sort_by(|a, b| a.position.cmp(&b.position).then(a.channel_id.cmp(&b.channel_id)));

        let dm_rooms: std::collections::HashSet<u32> = self
            .state
            .channels
            .values()
            .filter(|c| c.detached && c.name.starts_with(crate::constants::DM_CHANNEL_PREFIX))
            .map(|c| c.channel_id)
            .collect();

        // Group users by channel id (DM-room occupants counted under root).
        let mut members: HashMap<u32, Vec<serde_json::Value>> = HashMap::new();
        for user in self.state.users.values() {
            let profile = crate::profile::parse_comment(&user.comment);
            let channel_id = if dm_rooms.contains(&user.channel_id) { 0 } else { user.channel_id };
            members.entry(channel_id).or_default().push(serde_json::json!({
                "name": user.name,
                "me": Some(user.session) == self.own_session,
                "registered": user.user_id.is_some_and(|id| id > 0),
                "status": profile.status,
                "bio": sanitize_styled_text(&profile.bio_html),
                "bannerColor": profile.banner_color,
                "nameColor": profile.name_color,
                "nameBold": profile.name_bold,
                "nameItalic": profile.name_italic,
            }));
        }

        let json: Vec<serde_json::Value> = channels
            .iter()
            .map(|ch| {
                let mut users = members.get(&ch.channel_id).cloned().unwrap_or_default();
                users.sort_by(|a, b| {
                    a.get("name").and_then(serde_json::Value::as_str).cmp(
                        &b.get("name").and_then(serde_json::Value::as_str),
                    )
                });
                serde_json::json!({
                    "id": ch.channel_id,
                    "name": ch.name,
                    "depth": channel_depth(&self.state.channels, ch.channel_id),
                    "users": users,
                })
            })
            .collect();

        ui_set_channels(&self.ui, serde_json::Value::Array(json).to_string());
    }

    /// If our own channel changed, record it (chat target) and update the UI.
    fn update_own_channel(&mut self) {
        let Some(session) = self.own_session else { return };
        let Some(channel_id) = self.state.users.get(&session).map(|u| u.channel_id) else {
            return;
        };
        if let Ok(mut sh) = self.shared.lock() {
            sh.current_channel = Some(channel_id);
        }
        let as_i32 = channel_id as i32;
        if as_i32 != self.last_self_channel {
            self.last_self_channel = as_i32;
            ui_set_self_channel(&self.ui, as_i32);
        }
    }

    /// Forward an inbound channel/broadcast text message to the UI, reduced
    /// to the Qt StyledText-safe HTML subset so basic formatting
    /// (bold/italic/links...) renders in the chat bubbles.
    fn handle_text(&self, tm: &mumble_tcp::TextMessage) {
        let sender = tm
            .actor
            .and_then(|a| self.state.users.get(&a))
            .map(|u| u.name.clone())
            .unwrap_or_else(|| "server".to_owned());
        let channel = tm
            .channel_id
            .first()
            .map_or_else(|| "direct".to_owned(), u32::to_string);
        let body = sanitize_styled_text(&tm.message);
        ui_emit_chat(&self.ui, channel, sender, body);
    }
}

impl EventHandler for QtEventHandler {
    fn on_control_message(&mut self, msg: &ControlMessage) {
        match msg {
            ControlMessage::ServerSync(sync) => {
                self.state.apply_server_sync(sync);
                self.own_session = self.state.own_session();
                self.update_own_channel();
                self.push_channels();
            }
            ControlMessage::ChannelState(cs) => {
                self.state.apply_channel_state(cs);
                self.push_channels();
            }
            ControlMessage::ChannelRemove(cr) => {
                self.state.remove_channel(cr.channel_id);
                self.push_channels();
            }
            ControlMessage::UserState(us) => {
                self.state.apply_user_state(us);
                self.update_own_channel();
                self.push_channels();
            }
            ControlMessage::UserRemove(ur) => {
                self.state.remove_user(ur.session);
                self.push_channels();
            }
            ControlMessage::TextMessage(tm) => self.handle_text(tm),
            ControlMessage::Version(v) => self.state.apply_version(v),
            ControlMessage::Reject(r) => {
                let reason = r.reason.clone().unwrap_or_else(|| "connection rejected".to_owned());
                ui_set_status(&self.ui, format!("rejected: {reason}"));
            }
            _ => {}
        }
    }

    fn on_udp_message(&mut self, msg: &UdpMessage) {
        let UdpMessage::Audio(audio) = msg else { return };
        if audio.opus_data.is_empty() {
            return;
        }
        let packet = EncodedPacket {
            data: audio.opus_data.clone(),
            sequence: audio.frame_number,
            frame_samples: FRAME_SAMPLES,
        };
        if let Err(e) = self.mixer.feed(audio.sender_session, &packet) {
            tracing::warn!("inbound audio decode error: {e}");
        }
        if audio.is_terminator {
            self.mixer.reset_speaker(audio.sender_session);
            self.mixer.remove_inactive_speakers();
        }
    }

    fn on_connected(&mut self) {
        ui_set_status(&self.ui, "connected".to_owned());
    }

    fn on_disconnected(&mut self) {
        ui_set_status(&self.ui, "disconnected".to_owned());
    }
}

/// Compute a channel's nesting depth by following `parent_id` to the root.
fn channel_depth(channels: &HashMap<u32, Channel>, id: u32) -> i32 {
    let mut depth = 0;
    let mut cur = id;
    for _ in 0..64 {
        let Some(ch) = channels.get(&cur) else { break };
        match ch.parent_id {
            Some(parent) if parent != cur => {
                depth += 1;
                cur = parent;
            }
            _ => break,
        }
    }
    depth
}
