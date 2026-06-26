//! Server-managed onboarding workflow types: questions, answers, the saved
//! config and a user's response.

use serde::Serialize;

/// Single answer chip on a multiple-choice onboarding question.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct OnboardingAnswer {
    pub id: String,
    pub label: String,
    /// Channels added to the user's visible-channel set on selection.
    #[serde(default)]
    pub channel_ids: Vec<u32>,
    /// Mumble ACL group names the user is added to on selection.
    #[serde(default)]
    pub group_names: Vec<String>,
    /// Optional emoji glyph for the chip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    /// Optional description rendered beneath the label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Single multiple-choice question of the onboarding flow.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct OnboardingQuestion {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub multi_select: bool,
    #[serde(default)]
    pub required: bool,
    /// True when the question must be answered before fully entering the server.
    #[serde(default)]
    pub ask_before_join: bool,
    pub answers: Vec<OnboardingAnswer>,
}

/// Server-managed onboarding configuration.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct OnboardingConfig {
    pub version: u32,
    pub enabled: bool,
    #[serde(default)]
    pub default_channel_ids: Vec<u32>,
    pub questions: Vec<OnboardingQuestion>,
    pub revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
}

/// Selected answer ids for one question.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct OnboardingSelection {
    pub question_id: String,
    pub answer_ids: Vec<String>,
}

/// User's onboarding response.  Sent to the server for ACL group
/// application and stored locally for the "Channels & Roles" editor.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct OnboardingResponse {
    /// Cert hash of the responder (server-stamped, optional from client).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<u64>,
    pub config_revision: u64,
    pub selections: Vec<OnboardingSelection>,
}
