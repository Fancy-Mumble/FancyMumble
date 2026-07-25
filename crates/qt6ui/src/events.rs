//! `EventHandler` bridging `mumble-protocol` events to the QML `Backend`.
//!
//! Owns a private [`ServerState`] (users + channels) and an [`AudioMixer`]
//! for inbound voice.  Whenever the roster changes it serialises a compact
//! channel/user tree to JSON and pushes it to the UI; chat and audio are
//! forwarded as they arrive.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use cxx_qt::CxxQtThread;

use fancy_utils::markdown::sanitize_styled_text;

use mumble_protocol::audio::encoder::EncodedPacket;
use mumble_protocol::audio::mixer::AudioMixer;
use mumble_protocol::command::RequestBlob;
use mumble_protocol::event::EventHandler;
use mumble_protocol::message::{ControlMessage, UdpMessage};
use mumble_protocol::proto::mumble_tcp;
use mumble_protocol::state::{Channel, ServerState};

use crate::app::{ui_emit_chat, ui_set_channels, ui_set_self_channel, ui_set_status, Shared};
use crate::bridge::qobject::Backend;

/// Samples represented by one inbound Opus packet (20 ms @ 48 kHz).
const FRAME_SAMPLES: u32 = 960;

/// A user's parsed profile with every image spilled to disk (see
/// `media::spill_images`): the handler never retains texture bytes, banner
/// data URIs or bio image payloads in RAM - only file URLs.
#[derive(Default)]
struct SpilledProfile {
    status: String,
    /// Bio reduced to the StyledText-safe subset, `<img>` tags removed.
    bio_text: String,
    /// `{"thumb","full"}` file URLs of the bio's embedded images.
    bio_images: Vec<serde_json::Value>,
    banner_color: String,
    /// Spilled banner image thumbnail file URL ("" when color-only) plus
    /// the full-size spill, so the settings page can re-embed the banner
    /// without quality loss.
    banner_image: String,
    banner_image_full: String,
    name_color: String,
    name_bold: bool,
    name_italic: bool,
    name_gradient: Vec<String>,
    name_glow_color: String,
    name_glow_size: f64,
    theme_colors: Vec<String>,
    card_glass: bool,
    card_background: String,
    card_background_custom: String,
}

/// The protocol event handler for the Qt client.
pub struct QtEventHandler {
    ui: CxxQtThread<Backend>,
    shared: Arc<Mutex<Shared>>,
    state: ServerState,
    mixer: AudioMixer,
    own_session: Option<u32>,
    /// Last `selfChannel` value pushed to the UI, to avoid redundant updates.
    last_self_channel: i32,
    /// Spilled avatar file URL per session (from `UserState.texture`).
    avatars: HashMap<u32, String>,
    /// Parsed + spilled profile per session (from the comment).
    profiles: HashMap<u32, SpilledProfile>,
    /// Last texture/comment hash seen per session, so a blob is fetched
    /// once per change instead of on every mention.
    texture_hashes: HashMap<u32, Vec<u8>>,
    comment_hashes: HashMap<u32, Vec<u8>>,
    /// Hash-only payloads seen before `ServerSync`; requested in one batch
    /// once the session is fully up (matching the full client's ordering).
    pending_texture: HashSet<u32>,
    pending_comment: HashSet<u32>,
    synced: bool,
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
            avatars: HashMap::new(),
            profiles: HashMap::new(),
            texture_hashes: HashMap::new(),
            comment_hashes: HashMap::new(),
            pending_texture: HashSet::new(),
            pending_comment: HashSet::new(),
            synced: false,
        }
    }

    /// Record hash-only avatar/comment announcements and fetch the blobs:
    /// Mumble servers omit payloads over 128 bytes from `UserState` and
    /// send only a hash - without a `RequestBlob` round trip, profile
    /// images would simply never arrive (they'd silently stay empty).
    fn note_blob_hashes(&mut self, us: &mumble_tcp::UserState) {
        let Some(session) = us.session else { return };
        let mut want_texture = false;
        let mut want_comment = false;
        if let Some(hash) = us.texture_hash.as_ref().filter(|h| !h.is_empty()) {
            let changed = self.texture_hashes.get(&session) != Some(hash);
            self.texture_hashes.insert(session, hash.clone());
            want_texture = changed && us.texture.is_none();
        }
        if let Some(hash) = us.comment_hash.as_ref().filter(|h| !h.is_empty()) {
            let changed = self.comment_hashes.get(&session) != Some(hash);
            self.comment_hashes.insert(session, hash.clone());
            want_comment = changed && us.comment.is_none();
        }
        if !want_texture && !want_comment {
            return;
        }
        if self.synced {
            self.request_blobs(
                if want_texture { vec![session] } else { vec![] },
                if want_comment { vec![session] } else { vec![] },
            );
        } else {
            if want_texture {
                self.pending_texture.insert(session);
            }
            if want_comment {
                self.pending_comment.insert(session);
            }
        }
    }

    /// Send one `RequestBlob` for the given sessions (no-op when empty).
    fn request_blobs(&self, session_texture: Vec<u32>, session_comment: Vec<u32>) {
        if session_texture.is_empty() && session_comment.is_empty() {
            return;
        }
        let client = self.shared.lock().ok().and_then(|s| s.client.clone());
        let Some(client) = client else { return };
        tokio::spawn(async move {
            let _ = client
                .send(RequestBlob {
                    session_texture,
                    session_comment,
                    channel_description: vec![],
                    user_id_comment: vec![],
                })
                .await;
        });
    }

    /// Move a user's inline texture/comment payloads out of RAM: spill the
    /// avatar and every profile image to disk, keep only parsed fields +
    /// file URLs, and clear the byte payloads from the protocol state (the
    /// hard RAM budget forbids holding a blob per connected user).
    fn absorb_user_blobs(&mut self, session: u32) {
        let Some(user) = self.state.users.get_mut(&session) else { return };

        if !user.texture.is_empty() {
            let texture = std::mem::take(&mut user.texture);
            if let Some(spilled) = crate::media::spill_texture(&texture) {
                if let Some(thumb) = spilled["thumb"].as_str() {
                    self.avatars.insert(session, thumb.to_owned());
                }
            }
        }

        if !user.comment.is_empty() {
            let comment = std::mem::take(&mut user.comment);
            if Some(session) == self.own_session {
                if let Ok(mut sh) = self.shared.lock() {
                    sh.own_comment = comment.clone();
                }
            }
            let profile = crate::profile::parse_comment(&comment);
            let (bio_html, bio_srcs) = crate::media::extract_images(&profile.bio_html);
            let (banner_image, banner_image_full) = if profile.banner_image.is_empty() {
                (String::new(), String::new())
            } else {
                crate::media::spill_images(vec![profile.banner_image])
                    .first()
                    .map(|v| {
                        (
                            v["thumb"].as_str().unwrap_or_default().to_owned(),
                            v["full"].as_str().unwrap_or_default().to_owned(),
                        )
                    })
                    .unwrap_or_default()
            };
            self.profiles.insert(
                session,
                SpilledProfile {
                    status: profile.status,
                    bio_text: sanitize_styled_text(&bio_html),
                    bio_images: crate::media::spill_images(bio_srcs),
                    banner_color: profile.banner_color,
                    banner_image,
                    banner_image_full,
                    name_color: profile.name_color,
                    name_bold: profile.name_bold,
                    name_italic: profile.name_italic,
                    name_gradient: profile.name_gradient,
                    name_glow_color: profile.name_glow_color,
                    name_glow_size: profile.name_glow_size,
                    theme_colors: profile.theme_colors,
                    card_glass: profile.card_glass,
                    card_background: profile.card_background,
                    card_background_custom: profile.card_background_custom,
                },
            );
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
            self.state.channels.values().filter(|c| !c.detached()).collect();
        channels.sort_by(|a, b| a.position.cmp(&b.position).then(a.channel_id.cmp(&b.channel_id)));

        let dm_rooms: std::collections::HashSet<u32> = self
            .state
            .channels
            .values()
            .filter(|c| c.detached() && c.name.starts_with(crate::constants::DM_CHANNEL_PREFIX))
            .map(|c| c.channel_id)
            .collect();

        // Group users by channel id (DM-room occupants counted under root).
        // Profile fields come from the pre-parsed side maps (comments and
        // textures are spilled + cleared on arrival, never re-parsed here).
        let default_profile = SpilledProfile::default();
        let mut members: HashMap<u32, Vec<serde_json::Value>> = HashMap::new();
        for user in self.state.users.values() {
            let profile = self.profiles.get(&user.session).unwrap_or(&default_profile);
            let channel_id = if dm_rooms.contains(&user.channel_id) { 0 } else { user.channel_id };
            members.entry(channel_id).or_default().push(serde_json::json!({
                "name": user.name,
                "session": user.session,
                "me": Some(user.session) == self.own_session,
                "registered": user.user_id.is_some_and(|id| id > 0),
                "muted": user.self_mute || user.mute,
                "deafened": user.self_deaf || user.deaf,
                "status": profile.status,
                "bio": profile.bio_text,
                "bioImages": profile.bio_images,
                "bannerColor": profile.banner_color,
                "bannerImage": profile.banner_image,
                "bannerImageFull": profile.banner_image_full,
                "avatar": self.avatars.get(&user.session).cloned().unwrap_or_default(),
                "nameColor": profile.name_color,
                "nameBold": profile.name_bold,
                "nameItalic": profile.name_italic,
                "nameGradient": profile.name_gradient,
                "nameGlowColor": profile.name_glow_color,
                "nameGlowSize": profile.name_glow_size,
                "themeColors": profile.theme_colors,
                "cardGlass": profile.card_glass,
                "cardBackground": profile.card_background,
                "cardBackgroundCustom": profile.card_background_custom,
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
    /// (bold/italic/links...) renders in the chat bubbles. Embedded images
    /// are pulled out first (the sanitizer would drop their tags) and ride
    /// along as a JSON list for the QML side to render natively.
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
        let (html, images) = crate::media::extract_images(&tm.message);
        let body = sanitize_styled_text(&html);
        // Spill to disk: only a file path reaches the UI, never the base64.
        let images_json = serde_json::json!(crate::media::spill_images(images)).to_string();
        ui_emit_chat(&self.ui, channel, sender, body, images_json);
    }
}

impl EventHandler for QtEventHandler {
    fn on_control_message(&mut self, msg: &ControlMessage) {
        match msg {
            ControlMessage::ServerSync(sync) => {
                self.state.apply_server_sync(sync);
                self.own_session = self.state.own_session();
                self.synced = true;
                // Spill any inline avatars/comments from the pre-sync user
                // batch, then fetch the hash-only ones in one request.
                let sessions: Vec<u32> = self.state.users.keys().copied().collect();
                for session in sessions {
                    self.absorb_user_blobs(session);
                }
                let texture: Vec<u32> = self.pending_texture.drain().collect();
                let comment: Vec<u32> = self.pending_comment.drain().collect();
                self.request_blobs(texture, comment);
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
                self.note_blob_hashes(us);
                self.state.apply_user_state(us);
                if let Some(session) = us.session {
                    self.absorb_user_blobs(session);
                }
                self.update_own_channel();
                self.push_channels();
            }
            ControlMessage::UserRemove(ur) => {
                self.state.remove_user(ur.session);
                self.avatars.remove(&ur.session);
                self.profiles.remove(&ur.session);
                self.texture_hashes.remove(&ur.session);
                self.comment_hashes.remove(&ur.session);
                self.push_channels();
            }
            ControlMessage::TextMessage(tm) => self.handle_text(tm),
            // Answer to request_user_stats (hover card's online/idle pills).
            ControlMessage::UserStats(us) => {
                if let Some(session) = us.session {
                    crate::app::ui_emit_user_stats(
                        &self.ui,
                        session as i32,
                        us.onlinesecs.map_or(-1, |v| v as i32),
                        us.idlesecs.map_or(-1, |v| v as i32),
                    );
                }
            }
            ControlMessage::ServerConfig(sc) => {
                // Image/text size limits used to fit outgoing images
                // (see AppCore::send_images).
                if let Ok(mut sh) = self.shared.lock() {
                    sh.max_image_bytes = sc.image_message_length.unwrap_or(0);
                    sh.max_message_bytes = sc.message_length.unwrap_or(0);
                }
            }
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
