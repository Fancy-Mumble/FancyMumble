//! Super-search types: the scope filter, result categories/entries and the
//! photo-grid entry.

use serde::Serialize;

/// Filter narrowing the search scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchFilter {
    All,
    Messages,
    Photos,
    Users,
    Links,
}

/// Category tag for a search result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchCategory {
    Channel,
    User,
    Message,
}

/// A single search result returned by the super-search command.
#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    /// What kind of item this is.
    pub category: SearchCategory,
    /// Fuzzy match score (lower = better match, 0 = exact).
    pub score: u32,
    /// Primary display text (channel name, username, or message snippet).
    pub title: String,
    /// Secondary context (e.g. channel name for a user, sender for a message).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    /// Numeric ID for channels (`channel_id`) or users (session).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<u32>,
    /// Optional opaque string ID for results that are not addressed by `u32`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub string_id: Option<String>,
}

/// A single photo extracted from a chat message for the photo grid.
#[derive(Debug, Clone, Serialize)]
pub struct PhotoEntry {
    /// Image source (data-URL or remote URL).
    pub src: String,
    /// Who sent the message containing this image.
    pub sender_name: String,
    /// Channel ID when the photo is from a channel message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<u32>,
    /// DM session when the photo is from a direct message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dm_session: Option<u32>,
    /// Human-readable context (e.g. "in #General", "DM with Alice").
    pub context: String,
    /// Message timestamp (epoch ms), if available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<u64>,
}
