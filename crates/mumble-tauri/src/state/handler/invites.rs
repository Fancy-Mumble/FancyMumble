//! The invites service's answers, on their way to the UI.
//!
//! One event, `invites`, for every answer: each is correlated by `requestId`
//! to the command that asked, and the UI waits on that id rather than on an
//! event name. `kind` says which answer it is.

use mumble_protocol::proto::fancy::invites::{
    Invite, InvitesEnvelope, invite_refused, invites_envelope,
};
use serde::Serialize;
use tracing::debug;

use super::{HandleMessage, HandlerContext};

/// One invite, as the UI renders it.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct InvitePayload {
    code: String,
    /// Zero: no particular channel.
    channel_id: u32,
    created_ms: u64,
    /// Zero: never.
    expires_ms: u64,
    /// Zero: unlimited.
    max_uses: u32,
    uses: u32,
    creator: String,
    mine: bool,
}

impl From<&Invite> for InvitePayload {
    fn from(invite: &Invite) -> Self {
        Self {
            code: invite.code.clone(),
            channel_id: invite.channel_id,
            created_ms: invite.created_ms,
            expires_ms: invite.expires_ms,
            max_uses: invite.max_uses,
            uses: invite.uses,
            creator: invite.creator.clone(),
            mine: invite.mine,
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum InvitesPayload {
    Support {
        request_id: String,
        available: bool,
        may_create: bool,
        may_manage: bool,
        max_age_s: u64,
        max_uses: u32,
        address: String,
        skips_password: bool,
    },
    Created {
        request_id: String,
        invite: Option<InvitePayload>,
    },
    List {
        request_id: String,
        invites: Vec<InvitePayload>,
    },
    Revoked {
        request_id: String,
        code: String,
    },
    Refused {
        request_id: String,
        /// `"unavailable" | "permission" | "invalid" | "notFound" | "limit" |
        /// "other"`. A name rather than the enum number, so the UI's branch on
        /// it does not silently change meaning after a renumbering.
        reason: &'static str,
        detail: String,
    },
}

/// The refusal reason, named. Anything this build does not know is "other".
fn reason_of(reason: i32) -> &'static str {
    match invite_refused::Reason::try_from(reason) {
        Ok(invite_refused::Reason::Unavailable) => "unavailable",
        Ok(invite_refused::Reason::Permission) => "permission",
        Ok(invite_refused::Reason::Invalid) => "invalid",
        Ok(invite_refused::Reason::NotFound) => "notFound",
        Ok(invite_refused::Reason::Limit) => "limit",
        Ok(invite_refused::Reason::Other) | Err(_) => "other",
    }
}

fn payload_of(envelope: &InvitesEnvelope) -> Option<InvitesPayload> {
    use invites_envelope::Body;
    Some(match envelope.body.as_ref()? {
        Body::Support(support) => InvitesPayload::Support {
            request_id: support.request_id.clone(),
            available: support.available,
            may_create: support.may_create,
            may_manage: support.may_manage,
            max_age_s: support.max_age_s,
            max_uses: support.max_uses,
            address: support.address.clone(),
            skips_password: support.skips_password,
        },
        Body::Created(created) => InvitesPayload::Created {
            request_id: created.request_id.clone(),
            invite: created.invite.as_ref().map(InvitePayload::from),
        },
        Body::List(list) => InvitesPayload::List {
            request_id: list.request_id.clone(),
            invites: list.invites.iter().map(InvitePayload::from).collect(),
        },
        Body::Revoked(revoked) => InvitesPayload::Revoked {
            request_id: revoked.request_id.clone(),
            code: revoked.code.clone(),
        },
        Body::Refused(refused) => InvitesPayload::Refused {
            request_id: refused.request_id.clone(),
            reason: reason_of(refused.reason),
            detail: refused.detail.clone(),
        },
        // Request arms; `canon` never hands one up.
        Body::SupportQuery(_) | Body::Create(_) | Body::ListQuery(_) | Body::Revoke(_) => {
            return None;
        }
    })
}

impl HandleMessage for InvitesEnvelope {
    fn handle(&self, ctx: &HandlerContext) {
        let Some(payload) = payload_of(self) else {
            return;
        };
        debug!(?payload, "invites answer");
        ctx.emit("invites", payload);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mumble_protocol::proto::fancy::invites::{InviteCreated, InviteRefused, InviteSupport};

    fn envelope(body: invites_envelope::Body) -> InvitesEnvelope {
        InvitesEnvelope { body: Some(body) }
    }

    #[test]
    fn the_support_answer_reaches_the_ui_under_the_names_it_reads() {
        let payload = payload_of(&envelope(invites_envelope::Body::Support(InviteSupport {
            request_id: "i-1".to_owned(),
            available: true,
            may_create: true,
            may_manage: false,
            max_age_s: 604_800,
            max_uses: 5,
            address: "chat.example.org:64738".to_owned(),
            skips_password: true,
        })))
        .expect("a payload");
        assert_eq!(
            serde_json::to_value(payload).expect("serializes"),
            serde_json::json!({
                "kind": "support",
                "requestId": "i-1",
                "available": true,
                "mayCreate": true,
                "mayManage": false,
                "maxAgeS": 604_800,
                "maxUses": 5,
                "address": "chat.example.org:64738",
                "skipsPassword": true,
            })
        );
    }

    #[test]
    fn a_created_invite_carries_its_code_and_terms() {
        let payload = payload_of(&envelope(invites_envelope::Body::Created(InviteCreated {
            request_id: "i-2".to_owned(),
            invite: Some(Invite {
                code: "abcdefghjkmn".to_owned(),
                channel_id: 3,
                created_ms: 1,
                expires_ms: 2,
                max_uses: 0,
                uses: 0,
                creator: "alice".to_owned(),
                mine: true,
            }),
        })))
        .expect("a payload");
        let json = serde_json::to_value(payload).expect("serializes");
        assert_eq!(json["kind"], "created");
        assert_eq!(json["invite"]["code"], "abcdefghjkmn");
        assert_eq!(json["invite"]["channelId"], 3);
        assert_eq!(json["invite"]["mine"], true);
    }

    #[test]
    fn a_refusal_reason_this_build_does_not_know_is_other() {
        assert_eq!(reason_of(invite_refused::Reason::Limit as i32), "limit");
        assert_eq!(
            reason_of(invite_refused::Reason::NotFound as i32),
            "notFound"
        );
        assert_eq!(reason_of(99), "other");
        let payload = payload_of(&envelope(invites_envelope::Body::Refused(InviteRefused {
            request_id: "i-3".to_owned(),
            reason: invite_refused::Reason::Permission as i32,
            detail: "no".to_owned(),
        })))
        .expect("a payload");
        assert_eq!(
            serde_json::to_value(payload).expect("serializes")["reason"],
            "permission"
        );
    }
}
