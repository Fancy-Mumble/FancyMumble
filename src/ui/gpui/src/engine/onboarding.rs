//! The questions a server asks a new member, and what the local user
//! answered, as this view hears of them; and what the answers come to: the
//! channels the user sees and the roles they hold, as the web UI's
//! `computeVisibleChannels` and `computeRoleLabels` work them out.

use std::collections::BTreeSet;

pub(crate) use mumble_tauri_lib::engine_api::onboarding::{
    OnboardingAnswer, OnboardingConfig, OnboardingQuestion, OnboardingResponse,
    OnboardingSelection,
};

/// What the server said of the questions or of the answers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OnboardingNews {
    /// The questions, after connecting or because they changed.
    Config,
    /// The answers it keeps of the local user, or that it keeps none.
    Response(Option<OnboardingResponse>),
}

/// The answers `response` chose, question by question.
fn chosen<'a>(
    config: &'a OnboardingConfig,
    response: &'a OnboardingResponse,
) -> impl Iterator<Item = &'a OnboardingAnswer> {
    config.questions.iter().flat_map(move |question| {
        let picked = response
            .selections
            .iter()
            .find(|selection| selection.question_id == question.id);
        question.answers.iter().filter(move |answer| {
            picked.is_some_and(|picked| picked.answer_ids.contains(&answer.id))
        })
    })
}

/// The channels the user sees: everybody's, and those their answers add,
/// in that order, each once.
pub(crate) fn visible_channels(
    config: &OnboardingConfig,
    response: Option<&OnboardingResponse>,
) -> Vec<u32> {
    let mut seen = BTreeSet::new();
    let added = response
        .into_iter()
        .flat_map(|response| chosen(config, response))
        .flat_map(|answer| answer.channel_ids.iter());
    config
        .default_channel_ids
        .iter()
        .chain(added)
        .copied()
        .filter(|id| seen.insert(*id))
        .collect()
}

/// The roles the user's answers put them in, in the order the answers are
/// asked, each once.
pub(crate) fn role_labels(
    config: &OnboardingConfig,
    response: Option<&OnboardingResponse>,
) -> Vec<String> {
    let mut seen = BTreeSet::new();
    response
        .into_iter()
        .flat_map(|response| chosen(config, response))
        .flat_map(|answer| answer.group_names.iter())
        .filter(|name| seen.insert((*name).clone()))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> OnboardingConfig {
        let answer = |id: &str, channels: &[u32], groups: &[&str]| OnboardingAnswer {
            id: id.to_owned(),
            label: id.to_owned(),
            channel_ids: channels.to_vec(),
            group_names: groups.iter().map(|group| (*group).to_owned()).collect(),
            emoji: None,
            description: None,
        };
        OnboardingConfig {
            enabled: true,
            default_channel_ids: vec![0, 1],
            questions: vec![
                OnboardingQuestion {
                    id: "q1".into(),
                    text: "What brings you here?".into(),
                    answers: vec![answer("a1", &[5, 1], &["gamers"]), answer("a2", &[7], &["music"])],
                    ..OnboardingQuestion::default()
                },
                OnboardingQuestion {
                    id: "q2".into(),
                    text: "How often?".into(),
                    answers: vec![answer("b1", &[9], &["gamers", "regulars"])],
                    ..OnboardingQuestion::default()
                },
            ],
            revision: 2,
            ..OnboardingConfig::default()
        }
    }

    #[test]
    fn the_answers_add_their_channels_and_roles_each_once() {
        let response = OnboardingResponse {
            config_revision: 2,
            selections: vec![
                OnboardingSelection {
                    question_id: "q1".into(),
                    answer_ids: vec!["a1".into()],
                },
                OnboardingSelection {
                    question_id: "q2".into(),
                    answer_ids: vec!["b1".into()],
                },
            ],
            ..OnboardingResponse::default()
        };
        assert_eq!(visible_channels(&config(), Some(&response)), [0, 1, 5, 9]);
        assert_eq!(role_labels(&config(), Some(&response)), ["gamers", "regulars"]);
        assert_eq!(visible_channels(&config(), None), [0, 1]);
        assert!(role_labels(&config(), None).is_empty());
    }
}
