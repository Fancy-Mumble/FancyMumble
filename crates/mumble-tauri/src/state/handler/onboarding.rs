//! Inbound handlers for onboarding-workflow messages.

use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;
use tracing::debug;

use super::{HandleMessage, HandlerContext};
use crate::state::types::{
    OnboardingAnswer, OnboardingConfig, OnboardingQuestion, OnboardingResponse,
    OnboardingSelection,
};

#[derive(Serialize, Clone)]
struct OnboardingConfigPayload {
    config: OnboardingConfig,
}

#[derive(Serialize, Clone)]
struct OnboardingResponsePayload {
    response: Option<OnboardingResponse>,
}

impl HandleMessage for mumble_tcp::FancyOnboardingConfig {
    fn handle(&self, ctx: &HandlerContext) {
        let config = decode_config(self);

        debug!(
            enabled = config.enabled,
            revision = config.revision,
            questions = config.questions.len(),
            "received FancyOnboardingConfig"
        );

        if let Ok(mut state) = ctx.shared.lock() {
            // Only accept newer revisions to avoid clobbering a fresher
            // local view if a stale broadcast races a recent admin edit.
            let accept = state
                .onboarding
                .as_ref()
                .is_none_or(|prev| config.revision >= prev.revision);
            if accept {
                state.onboarding = Some(config.clone());
            } else {
                debug!(
                    new_rev = config.revision,
                    have_rev = state.onboarding.as_ref().map(|c| c.revision),
                    "dropping older onboarding config revision"
                );
                return;
            }
        }

        ctx.emit("onboarding-config", OnboardingConfigPayload { config });
    }
}

impl HandleMessage for mumble_tcp::FancyOnboardingResponseDeliver {
    fn handle(&self, ctx: &HandlerContext) {
        let response = self.response.as_ref().map(decode_response);

        debug!(
            present = response.is_some(),
            "received FancyOnboardingResponseDeliver"
        );

        if let Ok(mut state) = ctx.shared.lock() {
            state.onboarding_response = response.clone();
        }

        ctx.emit(
            "onboarding-response",
            OnboardingResponsePayload { response },
        );
    }
}

fn decode_config(proto: &mumble_tcp::FancyOnboardingConfig) -> OnboardingConfig {
    OnboardingConfig {
        version: proto.version.unwrap_or(1),
        enabled: proto.enabled.unwrap_or(false),
        default_channel_ids: proto.default_channel_ids.clone(),
        questions: proto.questions.iter().map(decode_question).collect(),
        revision: proto.revision.unwrap_or(0),
        updated_by: proto.updated_by.clone(),
        updated_at: proto.updated_at,
    }
}

fn decode_question(
    proto: &mumble_tcp::fancy_onboarding_config::Question,
) -> OnboardingQuestion {
    OnboardingQuestion {
        id: proto.id.clone().unwrap_or_default(),
        text: proto.text.clone().unwrap_or_default(),
        multi_select: proto.multi_select.unwrap_or(false),
        required: proto.required.unwrap_or(false),
        ask_before_join: proto.ask_before_join.unwrap_or(false),
        answers: proto.answers.iter().map(decode_answer).collect(),
    }
}

fn decode_answer(
    proto: &mumble_tcp::fancy_onboarding_config::Answer,
) -> OnboardingAnswer {
    OnboardingAnswer {
        id: proto.id.clone().unwrap_or_default(),
        label: proto.label.clone().unwrap_or_default(),
        channel_ids: proto.channel_ids.clone(),
        group_names: proto.group_names.clone(),
        emoji: proto.emoji.clone(),
        description: proto.description.clone(),
    }
}

fn decode_response(proto: &mumble_tcp::FancyOnboardingResponse) -> OnboardingResponse {
    OnboardingResponse {
        user_hash: proto.user_hash.clone(),
        submitted_at: proto.submitted_at,
        config_revision: proto.config_revision.unwrap_or(0),
        selections: proto
            .selections
            .iter()
            .map(|s| OnboardingSelection {
                question_id: s.question_id.clone().unwrap_or_default(),
                answer_ids: s.answer_ids.clone(),
            })
            .collect(),
    }
}
