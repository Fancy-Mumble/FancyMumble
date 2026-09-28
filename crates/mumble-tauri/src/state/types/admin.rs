//! Admin panel types: registered users, bans and channel ACLs, in both their
//! frontend-bound (`*Payload`) and frontend-supplied (`*Input`) forms.

use std::collections::HashMap;

use serde::Serialize;

// --- Admin panel payload types ------------------------------------

/// A registered user entry returned by the server's `UserList` message.
#[derive(Debug, Clone, Serialize)]
pub struct RegisteredUserPayload {
    pub user_id: u32,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_channel: Option<u32>,
    /// Avatar byte length, so the frontend knows an avatar exists without
    /// shipping the bytes in the bulk list. The bytes are cached backend-side
    /// and fetched on demand via `get_registered_user_texture` (mirrors how
    /// online users use `UserEntry::texture_size`). Shipping the bytes inline
    /// previously spiked the heap to >1 GB while emitting the `user-list` event.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub texture_size: Option<u32>,
    /// Full comment when len < 128 (included inline by the server).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// SHA-1 hash of the comment when len >= 128. Presence means a comment
    /// exists but the full text must be requested via `request_user_comment`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment_hash: Option<Vec<u8>>,
}

/// A single registered-user comment delivered via `RequestBlob.user_id_comment`.
#[derive(Debug, Clone, Serialize)]
pub struct UserCommentPayload {
    pub user_id: u32,
    pub comment: String,
}

/// A registered user update sent from the frontend.
///
/// - `name: Some(new_name)` renames the user.
/// - `name: None` deletes (deregisters) the user.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RegisteredUserUpdate {
    pub user_id: u32,
    pub name: Option<String>,
}

/// A ban list entry sent to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct BanEntryPayload {
    pub address: String,
    pub mask: u32,
    pub name: String,
    pub hash: String,
    pub reason: String,
    pub start: String,
    pub duration: u32,
}

/// Full ACL data for a channel, emitted as event payload.
#[derive(Debug, Clone, Serialize)]
pub struct AclPayload {
    pub channel_id: u32,
    pub inherit_acls: bool,
    pub groups: Vec<AclGroupPayload>,
    pub acls: Vec<AclEntryPayload>,
}

/// A channel group entry within an ACL.
#[derive(Debug, Clone, Serialize)]
pub struct AclGroupPayload {
    pub name: String,
    pub inherited: bool,
    pub inherit: bool,
    pub inheritable: bool,
    pub add: Vec<u32>,
    pub remove: Vec<u32>,
    pub inherited_members: Vec<u32>,
    /// `FancyMumble` role customization fields. Optional/default to keep older servers working.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style_preset: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub metadata: HashMap<String, String>,
}

/// A single ACL rule within a channel's ACL list.
#[derive(Debug, Clone, Serialize)]
pub struct AclEntryPayload {
    pub apply_here: bool,
    pub apply_subs: bool,
    pub inherited: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    pub grant: u32,
    pub deny: u32,
}

// --- Admin panel input types (deserialized from frontend) ---------

/// A ban entry received from the frontend for updating the ban list.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct BanEntryInput {
    pub address: String,
    pub mask: u32,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub start: String,
    #[serde(default)]
    pub duration: u32,
}

/// ACL update payload received from the frontend.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AclInput {
    pub channel_id: u32,
    pub inherit_acls: bool,
    pub groups: Vec<AclGroupInput>,
    pub acls: Vec<AclEntryInput>,
}

/// A group entry from the frontend for ACL updates.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AclGroupInput {
    pub name: String,
    #[serde(default = "default_true")]
    pub inherited: bool,
    #[serde(default = "default_true")]
    pub inherit: bool,
    #[serde(default = "default_true")]
    pub inheritable: bool,
    #[serde(default)]
    pub add: Vec<u32>,
    #[serde(default)]
    pub remove: Vec<u32>,
    #[serde(default)]
    pub inherited_members: Vec<u32>,
    /// `FancyMumble` role customization fields.
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<Vec<u8>>,
    #[serde(default)]
    pub style_preset: Option<String>,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

/// An ACL entry from the frontend for ACL updates.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct AclEntryInput {
    #[serde(default = "default_true")]
    pub apply_here: bool,
    #[serde(default = "default_true")]
    pub apply_subs: bool,
    #[serde(default)]
    pub inherited: bool,
    pub user_id: Option<u32>,
    pub group: Option<String>,
    #[serde(default)]
    pub grant: u32,
    #[serde(default)]
    pub deny: u32,
}

const fn default_true() -> bool {
    true
}
