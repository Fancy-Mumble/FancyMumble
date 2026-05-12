//! Onboarding-workflow Tauri commands.

use crate::state::types::{OnboardingConfig, OnboardingResponse};
use crate::state::AppState;

/// Read the cached onboarding config (or `None` if the server has not
/// announced one yet).
#[tauri::command]
pub(crate) fn get_onboarding_config(
    state: tauri::State<'_, AppState>,
) -> Option<OnboardingConfig> {
    state.get_onboarding_config()
}

/// Read the local user's stored onboarding response, if available.
#[tauri::command]
pub(crate) fn get_onboarding_response(
    state: tauri::State<'_, AppState>,
) -> Option<OnboardingResponse> {
    state.get_onboarding_response()
}

/// Admin path: persist a new onboarding configuration with the server.
#[tauri::command]
pub(crate) async fn save_onboarding_config(
    state: tauri::State<'_, AppState>,
    config: OnboardingConfig,
) -> Result<(), String> {
    state.save_onboarding_config(config).await
}

/// User path: submit answers to the onboarding questionnaire.
#[tauri::command]
pub(crate) async fn submit_onboarding_response(
    state: tauri::State<'_, AppState>,
    response: OnboardingResponse,
) -> Result<(), String> {
    state.submit_onboarding_response(response).await
}

/// User path: ask the server for our previously-stored response (used
/// when the "Channels & Roles" editor opens after reconnect).
#[tauri::command]
pub(crate) async fn request_onboarding_response(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.request_onboarding_response().await
}
