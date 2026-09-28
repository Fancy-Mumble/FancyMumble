//! Invite links: asking what the server allows, minting, listing and revoking
//! them, and handing the UI a link that launched the app.
//!
//! Every command returns as soon as the request is sent; the answer is the
//! `invites` event carrying the same `requestId`.

use mumble_protocol::proto::fancy::invites::{
    InviteCreate, InviteListQuery, InviteRevoke, InviteSupportQuery, invites_envelope::Body,
};

use crate::state::AppState;

/// Ask what this session may do with invites on the active server.
#[tauri::command]
pub(crate) async fn invite_support(
    state: tauri::State<'_, AppState>,
    request_id: String,
) -> Result<(), String> {
    state
        .send_invites(Body::SupportQuery(InviteSupportQuery { request_id }))
        .await
}

/// Mint an invite. Zero for `max_age_s` or `max_uses` asks for the most the
/// server allows; more than it allows is clamped by the server.
#[tauri::command]
pub(crate) async fn invite_create(
    state: tauri::State<'_, AppState>,
    request_id: String,
    channel_id: u32,
    max_age_s: u64,
    max_uses: u32,
) -> Result<(), String> {
    state
        .send_invites(Body::Create(InviteCreate {
            request_id,
            channel_id,
            max_age_s,
            max_uses,
        }))
        .await
}

/// List this session's own invites, or everybody's for an administrator.
#[tauri::command]
pub(crate) async fn invite_list(
    state: tauri::State<'_, AppState>,
    request_id: String,
    everyone: bool,
) -> Result<(), String> {
    state
        .send_invites(Body::ListQuery(InviteListQuery {
            request_id,
            everyone,
        }))
        .await
}

/// Revoke one invite.
#[tauri::command]
pub(crate) async fn invite_revoke(
    state: tauri::State<'_, AppState>,
    request_id: String,
    code: String,
) -> Result<(), String> {
    state
        .send_invites(Body::Revoke(InviteRevoke { request_id, code }))
        .await
}

/// The `fancy://` link the app was launched with, once.
///
/// A link that starts the app arrives before any window can listen for the
/// `deep-link-open` event, so it is parked and the UI collects it when its
/// listener is up. Taking it clears it, so a reload does not follow the same
/// link twice.
#[tauri::command]
pub(crate) fn take_pending_deep_link() -> Option<String> {
    crate::app::take_pending_deep_link()
}
