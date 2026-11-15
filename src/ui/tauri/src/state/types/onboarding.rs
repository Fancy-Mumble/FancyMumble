//! Server-managed onboarding workflow types: questions, answers, the saved
//! config and a user's response.

use serde::Serialize;

/// Single answer chip on a multiple-choice onboarding question.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct OnboardingAnswer {
    /// The answer's id within its question.
    pub id: String,
    /// What the answer says.
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
    /// The question's id.
    pub id: String,
    /// What it asks.
    pub text: String,
    /// Whether several answers may be chosen.
    #[serde(default)]
    pub multi_select: bool,
    /// Whether it must be answered to go on.
    #[serde(default)]
    pub required: bool,
    /// True when the question must be answered before fully entering the server.
    #[serde(default)]
    pub ask_before_join: bool,
    /// What may be answered, in order.
    pub answers: Vec<OnboardingAnswer>,
}

/// Server-managed onboarding configuration.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct OnboardingConfig {
    /// The format's version.
    pub version: u32,
    /// Whether new members are asked at all.
    pub enabled: bool,
    /// The channels everybody sees, whatever they answer.
    #[serde(default)]
    pub default_channel_ids: Vec<u32>,
    /// What is asked, in order.
    pub questions: Vec<OnboardingQuestion>,
    /// Bumped by the server with each change; an answer to an older one is
    /// asked again.
    pub revision: u64,
    /// Who changed it last, by certificate hash.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_by: Option<String>,
    /// When it was changed last, in seconds since 1970.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
}

/// Selected answer ids for one question.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct OnboardingSelection {
    /// The question answered.
    pub question_id: String,
    /// The answers chosen.
    pub answer_ids: Vec<String>,
}

/// User's onboarding response.  Sent to the server for ACL group
/// application and stored locally for the "Channels & Roles" editor.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct OnboardingResponse {
    /// Cert hash of the responder (server-stamped, optional from client).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_hash: Option<String>,
    /// When it was given, in seconds since 1970.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<u64>,
    /// The revision of the questions it answers.
    pub config_revision: u64,
    /// What was chosen, question by question.
    pub selections: Vec<OnboardingSelection>,
}
