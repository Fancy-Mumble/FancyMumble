use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;
use tracing::debug;

use super::{HandleMessage, HandlerContext};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LiveDocInvitePayload {
    channel_id: u32,
    slug: String,
    title: String,
    ws_url: String,
    token: Option<String>,
    server_id: Option<String>,
}

impl HandleMessage for mumble_tcp::FancyLiveDocInvite {
    fn handle(&self, ctx: &HandlerContext) {
        let Some(channel_id) = self.channel_id else {
            debug!("FancyLiveDocInvite dropped: missing channel_id");
            return;
        };
        let slug = self.slug.clone().unwrap_or_default();
        let title = self.title.clone().unwrap_or_default();
        let ws_url = self.ws_url.clone().unwrap_or_default();
        if slug.is_empty() || ws_url.is_empty() {
            debug!(slug = %slug, ws_url = %ws_url, "FancyLiveDocInvite dropped: empty slug or ws_url");
            return;
        }
        debug!(channel_id, slug = %slug, "received FancyLiveDocInvite");
        ctx.emit(
            "fancy-live-doc-invite",
            LiveDocInvitePayload {
                channel_id,
                slug,
                title,
                ws_url,
                token: self.token.clone(),
                server_id: self.server_id.clone(),
            },
        );
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LiveDocAnnouncePayload {
    channel_id: u32,
    slug: String,
    title: String,
    opener_session: u32,
    opener_name: Option<String>,
}

impl HandleMessage for mumble_tcp::FancyLiveDocAnnounce {
    fn handle(&self, ctx: &HandlerContext) {
        let Some(channel_id) = self.channel_id else { return; };
        let slug = self.slug.clone().unwrap_or_default();
        if slug.is_empty() {
            return;
        }
        let opener_session = self.opener_session.unwrap_or(0);
        if opener_session == 0 {
            debug!("FancyLiveDocAnnounce dropped: opener_session is 0/None");
            return;
        }
        ctx.emit(
            "fancy-live-doc-announce",
            LiveDocAnnouncePayload {
                channel_id,
                slug,
                title: self.title.clone().unwrap_or_default(),
                opener_session,
                opener_name: self.opener_name.clone(),
            },
        );
    }
}
