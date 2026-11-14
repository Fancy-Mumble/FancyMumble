//! What the demo server asks a new member, and what Alex answered when
//! they joined: answered at the questions' current revision, so the
//! questions are not asked again on connecting, only from the Channels &
//! roles page.

use crate::engine::{
    OnboardingAnswer, OnboardingConfig, OnboardingQuestion, OnboardingResponse,
    OnboardingSelection,
};

/// The revision of the demo's questions.
const REVISION: u64 = 3;

/// The questions, and the answers kept.
#[derive(Debug)]
pub(crate) struct Questions {
    pub config: OnboardingConfig,
    pub response: Option<OnboardingResponse>,
}

impl Questions {
    pub(crate) fn seeded() -> Self {
        let answer = |id: &str, emoji: &str, label: &str, channels: &[u32], groups: &[&str]| {
            OnboardingAnswer {
                id: id.to_owned(),
                label: label.to_owned(),
                channel_ids: channels.to_vec(),
                group_names: groups.iter().map(|group| (*group).to_owned()).collect(),
                emoji: Some(emoji.to_owned()),
                description: None,
            }
        };
        let config = OnboardingConfig {
            version: 1,
            enabled: true,
            default_channel_ids: vec![1],
            questions: vec![
                OnboardingQuestion {
                    id: "why".into(),
                    text: "What brings you here?".into(),
                    multi_select: true,
                    required: true,
                    ask_before_join: false,
                    answers: vec![
                        answer("music", "🎵", "Making music", &[2], &["musicians"]),
                        answer("listen", "🎧", "Listening along", &[], &["listeners"]),
                    ],
                },
                OnboardingQuestion {
                    id: "when".into(),
                    text: "When are you around?".into(),
                    multi_select: false,
                    required: false,
                    ask_before_join: false,
                    answers: vec![
                        answer("evenings", "🌙", "Evenings", &[], &["night-owls"]),
                        answer("weekends", "📅", "Weekends", &[3], &[]),
                    ],
                },
            ],
            revision: REVISION,
            updated_by: None,
            updated_at: None,
        };
        let response = OnboardingResponse {
            user_hash: None,
            submitted_at: None,
            config_revision: REVISION,
            selections: vec![OnboardingSelection {
                question_id: "why".into(),
                answer_ids: vec!["music".into()],
            }],
        };
        Self {
            config,
            response: Some(response),
        }
    }
}
