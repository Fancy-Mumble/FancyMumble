//! The questions a server asks a new member, and what the local user
//! answered, for a view that is not the web page: what the web client's
//! `get_onboarding_config`, `get_onboarding_response`,
//! `request_onboarding_response` and `submit_onboarding_response` commands
//! do.
//!
//! The server says the questions as [`super::EngineEvent::OnboardingConfig`]
//! after connecting and whenever they change, and the stored answers as
//! [`super::EngineEvent::OnboardingResponse`] when asked.

use super::EngineHandle;

pub use crate::state::types::{
    OnboardingAnswer, OnboardingConfig, OnboardingQuestion, OnboardingResponse,
    OnboardingSelection,
};

/// The oldest Fancy server that asks new members anything, 0.3.1, encoded
/// as the server announces its version (the web client's
/// `ONBOARDING_MIN_FANCY_VERSION`).
const ONBOARDING_MIN_FANCY_VERSION: u64 = (3 << 32) | (1 << 16);

impl EngineHandle {
    /// Whether the server on show asks new members questions at all: a
    /// Fancy server of 0.3.1 or later.
    #[must_use]
    pub fn onboarding_offered(&self) -> bool {
        self.state
            .server_info()
            .fancy_version
            .is_some_and(|version| version >= ONBOARDING_MIN_FANCY_VERSION)
    }

    /// The questions as the server on show last said them.
    #[must_use]
    pub fn onboarding_config(&self) -> Option<OnboardingConfig> {
        self.state.get_onboarding_config()
    }

    /// The local user's answers as the server last said them, or as they
    /// were last given from here.
    #[must_use]
    pub fn onboarding_response(&self) -> Option<OnboardingResponse> {
        self.state.get_onboarding_response()
    }

    /// Ask the server for the answers it keeps of the local user; they
    /// arrive as [`super::EngineEvent::OnboardingResponse`].
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn request_onboarding_response(&self) -> Result<(), String> {
        self.state.request_onboarding_response().await
    }

    /// Give the server `response`: it keeps it and puts the user in the
    /// groups the answers name.
    ///
    /// # Errors
    ///
    /// When not connected, or it could not be sent.
    pub async fn submit_onboarding_response(&self, response: OnboardingResponse) -> Result<(), String> {
        self.state.submit_onboarding_response(response).await
    }

    /// Give the server new questions: the administrator's part. It stamps
    /// them with a new revision and says them again to everybody.
    ///
    /// # Errors
    ///
    /// When not connected, or they could not be sent.
    pub async fn save_onboarding_config(&self, config: OnboardingConfig) -> Result<(), String> {
        self.state.save_onboarding_config(config).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::core_event::CoreEvent;

    #[test]
    fn the_questions_and_the_answers_kept_are_reported() {
        let config = OnboardingConfig {
            enabled: true,
            revision: 3,
            ..OnboardingConfig::default()
        };
        assert_eq!(
            super::super::EngineEvent::from_core(CoreEvent::OnboardingConfig(config.clone())),
            Some(super::super::EngineEvent::OnboardingConfig(config))
        );
        assert_eq!(
            super::super::EngineEvent::from_core(CoreEvent::OnboardingResponse(None)),
            Some(super::super::EngineEvent::OnboardingResponse(None))
        );
    }
}
