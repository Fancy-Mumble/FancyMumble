//! The questions a server asks a new member, and the answers, between this
//! client's epoch-0 messages and the canon's `fancy.feature` onboarding set
//! (outer type 1014, `OnboardingEnvelope`).
//!
//! The shapes line up field for field, with two differences of meaning:
//!
//! * the canon's `Flow.version` is the revision the server stamps, which
//!   epoch 0 calls `revision`; epoch 0's `version` is the format of the
//!   config, which the canon does not carry and which is 1;
//! * a canon `Response` with `submitted_at_ms == 0` says "nothing is stored",
//!   which epoch 0 says with a delivery whose `response` is absent.
//!
//! What a server stamps (who changed the flow and when, when an answer was
//! given) is not sent: the server writes it.

use crate::proto::fancy::feature::{
    Flow, FlowQuery, FlowUpdate, OnboardingEnvelope, Response, Step, onboarding_envelope, response,
    step,
};
use crate::proto::mumble_tcp::{
    FancyOnboardingConfig, FancyOnboardingResponse, FancyOnboardingResponseDeliver,
    fancy_onboarding_config, fancy_onboarding_response,
};

/// The format of the config epoch 0 knows, the only one there is.
const CONFIG_FORMAT: u32 = 1;

/// The envelope carrying `body`, encoded.
pub(super) fn envelope(body: onboarding_envelope::Body) -> Vec<u8> {
    use prost::Message as _;
    OnboardingEnvelope { body: Some(body) }.encode_to_vec()
}

/// An administrator's new questions, as the canon update.
pub(super) fn update(config: Option<&FancyOnboardingConfig>) -> onboarding_envelope::Body {
    onboarding_envelope::Body::Update(FlowUpdate {
        flow: config.map(flow),
    })
}

/// A member's answers, as the canon response.
pub(super) fn answers(given: &FancyOnboardingResponse) -> onboarding_envelope::Body {
    onboarding_envelope::Body::Response(Response {
        flow_id: String::new(),
        answers: given
            .selections
            .iter()
            .map(|selection| response::Answer {
                step_id: selection.question_id.clone().unwrap_or_default(),
                choice_ids: selection.answer_ids.clone(),
                text: String::new(),
            })
            .collect(),
        flow_version: given.config_revision.unwrap_or_default(),
        submitted_at_ms: 0,
    })
}

/// The question that brings back both the questions and the answers kept:
/// what a member asks when it arrives, and when it wants its answers.
pub(super) fn query() -> onboarding_envelope::Body {
    onboarding_envelope::Body::Query(FlowQuery {
        include_answers: true,
    })
}

/// The questions as the server says them.
pub(super) fn config(flow: Flow) -> FancyOnboardingConfig {
    FancyOnboardingConfig {
        version: Some(CONFIG_FORMAT),
        enabled: Some(flow.enabled),
        default_channel_ids: flow.default_channels,
        questions: flow.steps.into_iter().map(question).collect(),
        revision: Some(flow.version),
        updated_by: (!flow.updated_by.is_empty()).then_some(flow.updated_by),
        updated_at: (flow.updated_at_ms != 0).then_some(flow.updated_at_ms),
    }
}

/// The answers the server keeps, or `None` for "nothing is stored".
pub(super) fn kept(stored: Response) -> FancyOnboardingResponseDeliver {
    FancyOnboardingResponseDeliver {
        response: (stored.submitted_at_ms != 0).then(|| FancyOnboardingResponse {
            user_hash: None,
            submitted_at: Some(stored.submitted_at_ms),
            selections: stored
                .answers
                .into_iter()
                .map(|answer| fancy_onboarding_response::Selection {
                    question_id: Some(answer.step_id),
                    answer_ids: answer.choice_ids,
                })
                .collect(),
            config_revision: Some(stored.flow_version),
        }),
    }
}

fn flow(config: &FancyOnboardingConfig) -> Flow {
    Flow {
        flow_id: String::new(),
        steps: config.questions.iter().map(step_of).collect(),
        version: config.revision.unwrap_or_default(),
        enabled: config.enabled.unwrap_or_default(),
        default_channels: config.default_channel_ids.clone(),
        updated_by: String::new(),
        updated_at_ms: 0,
    }
}

fn step_of(question: &fancy_onboarding_config::Question) -> Step {
    Step {
        id: question.id.clone().unwrap_or_default(),
        title: question.text.clone().unwrap_or_default(),
        body: String::new(),
        kind: step::Kind::Choice as i32,
        required: question.required.unwrap_or_default(),
        choices: question
            .answers
            .iter()
            .map(|answer| step::Choice {
                id: answer.id.clone().unwrap_or_default(),
                label: answer.label.clone().unwrap_or_default(),
                description: answer.description.clone().unwrap_or_default(),
                emoji: answer.emoji.clone().unwrap_or_default(),
                channels: answer.channel_ids.clone(),
                groups: answer.group_names.clone(),
            })
            .collect(),
        before_join: question.ask_before_join.unwrap_or_default(),
        multi_select: question.multi_select.unwrap_or_default(),
    }
}

/// A step as epoch 0's question: its title is the question, or its body
/// where a step has only that.
fn question(step: Step) -> fancy_onboarding_config::Question {
    let text = if step.title.is_empty() {
        step.body
    } else {
        step.title
    };
    fancy_onboarding_config::Question {
        id: Some(step.id),
        text: Some(text),
        multi_select: Some(step.multi_select),
        answers: step
            .choices
            .into_iter()
            .map(|choice| fancy_onboarding_config::Answer {
                id: Some(choice.id),
                label: Some(choice.label),
                channel_ids: choice.channels,
                group_names: choice.groups,
                emoji: (!choice.emoji.is_empty()).then_some(choice.emoji),
                description: (!choice.description.is_empty()).then_some(choice.description),
            })
            .collect(),
        ask_before_join: Some(step.before_join),
        required: Some(step.required),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use prost::Message as _;

    use super::super::{ONBOARDING, from_canon, to_canon};
    use super::*;
    use crate::message::ControlMessage;

    fn one_question() -> FancyOnboardingConfig {
        FancyOnboardingConfig {
            version: Some(1),
            enabled: Some(true),
            default_channel_ids: vec![0],
            questions: vec![fancy_onboarding_config::Question {
                id: Some("why".to_owned()),
                text: Some("What brings you here?".to_owned()),
                multi_select: Some(false),
                answers: vec![fancy_onboarding_config::Answer {
                    id: Some("testing".to_owned()),
                    label: Some("Testing".to_owned()),
                    channel_ids: vec![4],
                    group_names: vec!["testers".to_owned()],
                    emoji: Some("🧪".to_owned()),
                    description: Some("Trying things".to_owned()),
                }],
                ask_before_join: Some(true),
                required: Some(true),
            }],
            revision: Some(3),
            updated_by: None,
            updated_at: None,
        }
    }

    fn sent(message: &ControlMessage) -> onboarding_envelope::Body {
        let (outer, payload) = to_canon(message).expect("a canon home");
        assert_eq!(outer, ONBOARDING);
        OnboardingEnvelope::decode(payload.as_slice())
            .unwrap()
            .body
            .expect("a body")
    }

    fn received(body: onboarding_envelope::Body) -> ControlMessage {
        from_canon(ONBOARDING, &envelope(body))
            .unwrap()
            .expect("decodes")
    }

    #[test]
    fn saved_questions_reach_the_server_and_come_back_as_it_says_them() {
        // Without an arm the update went out on the plugin relay, which a
        // canon server does not read: the questions were never saved.
        let saved = one_question();
        let onboarding_envelope::Body::Update(update) =
            sent(&ControlMessage::FancyOnboardingConfigUpdate(
                crate::proto::mumble_tcp::FancyOnboardingConfigUpdate {
                    config: Some(saved.clone()),
                },
            ))
        else {
            panic!("expected an update");
        };
        let mut flow = update.flow.expect("the questions");
        assert_eq!(flow.steps.len(), 1);
        assert_eq!(flow.steps[0].kind, step::Kind::Choice as i32);
        assert_eq!(flow.steps[0].choices[0].groups, ["testers"]);
        assert!(flow.updated_by.is_empty() && flow.updated_at_ms == 0, "the server's to say");

        // The server stamps it and says it to everybody.
        flow.version = 4;
        flow.updated_by = "0".to_owned();
        flow.updated_at_ms = 1_700_000_000_000;
        let ControlMessage::FancyOnboardingConfig(told) = received(onboarding_envelope::Body::Flow(flow))
        else {
            panic!("expected the questions");
        };
        assert_eq!(
            told,
            FancyOnboardingConfig {
                revision: Some(4),
                updated_by: Some("0".to_owned()),
                updated_at: Some(1_700_000_000_000),
                ..saved
            },
            "field for field, as the server stamped it"
        );
    }

    #[test]
    fn what_a_server_leaves_out_comes_through_absent() {
        // An answer with no emoji or description, a flow nobody has stamped.
        let ControlMessage::FancyOnboardingConfig(told) =
            received(onboarding_envelope::Body::Flow(Flow {
                steps: vec![Step {
                    id: "q".to_owned(),
                    body: "Only a body".to_owned(),
                    choices: vec![step::Choice {
                        id: "a".to_owned(),
                        ..step::Choice::default()
                    }],
                    ..Step::default()
                }],
                ..Flow::default()
            }))
        else {
            panic!("expected the questions");
        };
        assert_eq!((told.updated_by, told.updated_at), (None, None));
        assert_eq!(told.version, Some(1));
        assert_eq!(told.questions[0].text.as_deref(), Some("Only a body"));
        let answer = &told.questions[0].answers[0];
        assert_eq!((answer.emoji.as_ref(), answer.description.as_ref()), (None, None));
    }

    #[test]
    fn answers_go_by_their_ids_and_the_server_stamps_the_rest() {
        let onboarding_envelope::Body::Response(response) =
            sent(&ControlMessage::FancyOnboardingResponse(FancyOnboardingResponse {
                user_hash: Some("claimed".to_owned()),
                submitted_at: Some(1),
                selections: vec![fancy_onboarding_response::Selection {
                    question_id: Some("why".to_owned()),
                    answer_ids: vec!["testing".to_owned()],
                }],
                config_revision: Some(4),
            }))
        else {
            panic!("expected a response");
        };
        assert_eq!(response.answers[0].step_id, "why");
        assert_eq!(response.answers[0].choice_ids, ["testing"]);
        assert_eq!(response.flow_version, 4);
        assert_eq!(response.submitted_at_ms, 0, "a claim the server would replace");
    }

    #[test]
    fn asking_for_the_answers_brings_the_questions_too() {
        let onboarding_envelope::Body::Query(query) = sent(
            &ControlMessage::FancyOnboardingResponseQuery(
                crate::proto::mumble_tcp::FancyOnboardingResponseQuery {},
            ),
        ) else {
            panic!("expected a query");
        };
        assert!(query.include_answers);
    }

    #[test]
    fn answers_kept_come_back_and_none_kept_comes_back_as_none() {
        let ControlMessage::FancyOnboardingResponseDeliver(kept) =
            received(onboarding_envelope::Body::Response(Response {
                answers: vec![response::Answer {
                    step_id: "why".to_owned(),
                    choice_ids: vec!["testing".to_owned()],
                    text: String::new(),
                }],
                flow_version: 4,
                submitted_at_ms: 1_700_000_000_000,
                ..Response::default()
            }))
        else {
            panic!("expected a delivery");
        };
        let kept = kept.response.expect("kept");
        assert_eq!(kept.config_revision, Some(4));
        assert_eq!(kept.submitted_at, Some(1_700_000_000_000));
        assert_eq!(kept.selections[0].answer_ids, ["testing"]);

        // `submitted_at_ms == 0` is the canon's "nothing stored".
        let ControlMessage::FancyOnboardingResponseDeliver(none) =
            received(onboarding_envelope::Body::Response(Response::default()))
        else {
            panic!("expected a delivery");
        };
        assert!(none.response.is_none());
    }

    #[test]
    fn a_client_body_from_the_server_is_not_read() {
        assert!(from_canon(ONBOARDING, &envelope(query())).unwrap().is_none());
        assert!(from_canon(ONBOARDING, &envelope(update(None))).unwrap().is_none());
    }
}
