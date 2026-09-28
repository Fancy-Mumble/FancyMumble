use mumble_protocol::proto::mumble_tcp;
use tracing::info;

use super::{HandleMessage, HandlerContext};
use crate::state::types::{ChannelDeniedPayload, ListenDeniedPayload, PermissionDeniedPayload};
use crate::state::whisper::{WHISPER_DENIALS_EVENT, WhisperDenials, WhisperRefusal};

impl HandleMessage for mumble_tcp::PermissionDenied {
    fn handle(&self, ctx: &HandlerContext) {
        info!(
            reason = ?self.reason,
            r#type = ?self.r#type,
            channel_id = ?self.channel_id,
            "permission denied received"
        );

        let missing = self.permission.unwrap_or(0);

        // A refused whisper or shout. It names a channel the way a refused
        // listen does, and falling through would handle it as one: a permanent
        // listen reverted and a "channel denied" for a channel the user never
        // tried to enter.
        if self.r#type == Some(mumble_tcp::permission_denied::DenyType::Permission as i32)
            && missing & fancy_utils::permissions::WHISPER != 0
            && let Some(ch_id) = self.channel_id
        {
            let denied_channels = match ctx.shared.lock() {
                Ok(mut state) => {
                    let _ = state.audio.whisper_denied.insert(ch_id);
                    state.audio.whisper_denied.iter().copied().collect()
                }
                Err(_) => vec![ch_id],
            };
            ctx.emit(
                WHISPER_DENIALS_EVENT,
                WhisperDenials {
                    denied_channels,
                    latest: Some(WhisperRefusal {
                        channel_id: ch_id,
                        reason: self.reason.clone(),
                    }),
                },
            );
            ctx.emit(
                "permission-denied",
                PermissionDeniedPayload {
                    deny_type: self.r#type,
                    reason: self.reason.clone(),
                },
            );
            return;
        }

        // A refused delete, so its caller fails now instead of timing out.
        if self.r#type == Some(mumble_tcp::permission_denied::DenyType::Permission as i32)
            && missing & fancy_utils::permissions::DELETE_MESSAGE != 0
            && let Some(ch_id) = self.channel_id
        {
            let refused = match ctx.shared.lock() {
                Ok(mut state) => {
                    let (refused, waiting) =
                        std::mem::take(&mut state.pchat_ctx.pending_delete_acks)
                            .into_iter()
                            .partition(|pending| pending.channel_id == ch_id);
                    state.pchat_ctx.pending_delete_acks = waiting;
                    refused
                }
                _ => Vec::new(),
            };
            for pending in refused {
                let _ = pending.tx.send(crate::state::types::DeleteAckResult {
                    success: false,
                    reason: self.reason.clone(),
                });
            }
        }

        if let Some(ch_id) = self.channel_id {
            if let Ok(mut state) = ctx.shared.lock()
                && state.permanently_listened.remove(&ch_id)
            {
                info!(ch_id, "reverted permanent listen due to permission denied");
            }
            ctx.emit("listen-denied", ListenDeniedPayload { channel_id: ch_id });
            ctx.emit("channel-denied", ChannelDeniedPayload { channel_id: ch_id });
        }

        // Always emit a general permission-denied event so the
        // frontend can surface errors (e.g. profile too large).
        ctx.emit(
            "permission-denied",
            PermissionDeniedPayload {
                deny_type: self.r#type,
                reason: self.reason.clone(),
            },
        );
    }
}
