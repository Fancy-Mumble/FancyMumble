//! Onboarding workflow methods on `AppState`.
//!
//! Three flows are exposed:
//! - `save_onboarding_config` (admin) sends a new config to the server.
//! - `submit_onboarding_response` (user) submits answers; the server
//!   stores them and applies any ACL group memberships.
//! - `request_onboarding_response` (user) asks the server for the
//!   user's previously-stored response (used by Channels & Roles).

use mumble_protocol::command;
use mumble_protocol::proto::mumble_tcp;

use super::types::{OnboardingConfig, OnboardingResponse};
use super::AppState;

impl AppState {
    /// Snapshot the current onboarding config for the active session.
    pub fn get_onboarding_config(&self) -> Option<OnboardingConfig> {
        let snapshot = self.inner.snapshot();
        let guard = snapshot.lock().ok()?;
        guard.onboarding.clone()
    }

    /// Snapshot the user's stored onboarding response, if any.
    pub fn get_onboarding_response(&self) -> Option<OnboardingResponse> {
        let snapshot = self.inner.snapshot();
        let guard = snapshot.lock().ok()?;
        guard.onboarding_response.clone()
    }

    /// Admin path: persist a new onboarding config with the server.
    /// `revision` is preserved to support optimistic concurrency: a
    /// stale concurrent admin that has not seen the latest broadcast
    /// would otherwise overwrite the newer config.
    pub async fn save_onboarding_config(
        &self,
        config: OnboardingConfig,
    ) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;

        handle
            .send(command::SendFancyOnboardingConfigUpdate {
                config: encode_config(&config),
            })
            .await
            .map_err(|e| format!("Failed to send onboarding config: {e}"))?;
        Ok(())
    }

    /// User path: submit answers to the onboarding questionnaire.  The
    /// response is also cached locally so the "Channels & Roles" editor
    /// surfaces the user's selections immediately, regardless of whether
    /// the server roundtrips a delivery.
    pub async fn submit_onboarding_response(
        &self,
        response: OnboardingResponse,
    ) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let mut state = session.lock().map_err(|e| e.to_string())?;
            state.onboarding_response = Some(response.clone());
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;

        let selections = response
            .selections
            .iter()
            .map(|s| mumble_tcp::fancy_onboarding_response::Selection {
                question_id: Some(s.question_id.clone()),
                answer_ids: s.answer_ids.clone(),
            })
            .collect();
        let config_revision = if response.config_revision == 0 {
            None
        } else {
            Some(response.config_revision)
        };

        handle
            .send(command::SendFancyOnboardingResponse {
                selections,
                config_revision,
            })
            .await
            .map_err(|e| format!("Failed to send onboarding response: {e}"))?;
        Ok(())
    }

    /// User path: ask the server for our previously-stored response.
    /// The server replies with `FancyOnboardingResponseDeliver`, which is
    /// handled in `state::handler::onboarding`.
    pub async fn request_onboarding_response(&self) -> Result<(), String> {
        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;

        handle
            .send(command::RequestFancyOnboardingResponse)
            .await
            .map_err(|e| format!("Failed to query onboarding response: {e}"))?;
        Ok(())
    }
}

fn encode_config(cfg: &OnboardingConfig) -> mumble_tcp::FancyOnboardingConfig {
    mumble_tcp::FancyOnboardingConfig {
        version: Some(if cfg.version == 0 { 1 } else { cfg.version }),
        enabled: Some(cfg.enabled),
        default_channel_ids: cfg.default_channel_ids.clone(),
        questions: cfg
            .questions
            .iter()
            .map(|q| mumble_tcp::fancy_onboarding_config::Question {
                id: Some(q.id.clone()),
                text: Some(q.text.clone()),
                multi_select: Some(q.multi_select),
                required: Some(q.required),
                ask_before_join: Some(q.ask_before_join),
                answers: q
                    .answers
                    .iter()
                    .map(|a| mumble_tcp::fancy_onboarding_config::Answer {
                        id: Some(a.id.clone()),
                        label: Some(a.label.clone()),
                        channel_ids: a.channel_ids.clone(),
                        group_names: a.group_names.clone(),
                        emoji: a.emoji.clone(),
                        description: a.description.clone(),
                    })
                    .collect(),
            })
            .collect(),
        // The server stamps revision/updated_by/updated_at on storage.
        revision: None,
        updated_by: None,
        updated_at: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::types::{OnboardingAnswer, OnboardingQuestion};

    fn sample_config() -> OnboardingConfig {
        OnboardingConfig {
            version: 1,
            enabled: true,
            default_channel_ids: vec![0, 1],
            questions: vec![OnboardingQuestion {
                id: "q1".into(),
                text: "What brings you here?".into(),
                multi_select: false,
                required: true,
                ask_before_join: true,
                answers: vec![
                    OnboardingAnswer {
                        id: "a1".into(),
                        label: "Gaming".into(),
                        channel_ids: vec![5],
                        group_names: vec!["gamers".into()],
                        emoji: Some("🎮".into()),
                        description: None,
                    },
                    OnboardingAnswer {
                        id: "a2".into(),
                        label: "Music".into(),
                        channel_ids: vec![7],
                        group_names: vec!["music".into()],
                        emoji: None,
                        description: Some("Producers, listeners, jam sessions".into()),
                    },
                ],
            }],
            revision: 42,
            updated_by: Some("admin-cert".into()),
            updated_at: Some(1_700_000_000),
        }
    }

    #[test]
    fn encode_config_round_trips_questions_and_answers() {
        let cfg = sample_config();
        let proto = encode_config(&cfg);

        assert_eq!(proto.version, Some(1));
        assert_eq!(proto.enabled, Some(true));
        assert_eq!(proto.default_channel_ids, vec![0, 1]);
        assert_eq!(proto.questions.len(), 1);

        let q = &proto.questions[0];
        assert_eq!(q.id.as_deref(), Some("q1"));
        assert_eq!(q.required, Some(true));
        assert_eq!(q.ask_before_join, Some(true));
        assert_eq!(q.answers.len(), 2);

        assert_eq!(q.answers[0].label.as_deref(), Some("Gaming"));
        assert_eq!(q.answers[0].channel_ids, vec![5]);
        assert_eq!(q.answers[0].group_names, vec!["gamers".to_string()]);
        assert_eq!(q.answers[0].emoji.as_deref(), Some("🎮"));

        assert_eq!(q.answers[1].label.as_deref(), Some("Music"));
        assert_eq!(
            q.answers[1].description.as_deref(),
            Some("Producers, listeners, jam sessions"),
        );

        // Revision/updated_at must be left for the server to stamp.
        assert!(proto.revision.is_none());
        assert!(proto.updated_at.is_none());
        assert!(proto.updated_by.is_none());
    }

    #[test]
    fn encode_config_defaults_version_when_zero() {
        let mut cfg = sample_config();
        cfg.version = 0;
        let proto = encode_config(&cfg);
        assert_eq!(proto.version, Some(1));
    }
}
