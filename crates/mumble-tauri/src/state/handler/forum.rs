use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;

use super::{HandleMessage, HandlerContext};

/// A single forum post as delivered to the frontend.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForumPostPayload {
    pub channel_id: u32,
    pub post_id: String,
    pub thread_id: String,
    pub title: Option<String>,
    pub body: Option<String>,
    pub author_hash: Option<String>,
    pub author_session: Option<u32>,
    pub author_name: Option<String>,
    pub created_at: Option<u64>,
    pub edited_at: Option<u64>,
    pub deleted: bool,
    pub reply_count: u32,
}

impl From<&mumble_tcp::FancyForumPost> for ForumPostPayload {
    fn from(p: &mumble_tcp::FancyForumPost) -> Self {
        ForumPostPayload {
            channel_id: p.channel_id.unwrap_or(0),
            post_id: p.post_id.clone().unwrap_or_default(),
            thread_id: p.thread_id.clone().unwrap_or_default(),
            title: p.title.clone(),
            body: p.body.clone(),
            author_hash: p.author_hash.clone(),
            author_session: p.author_session,
            author_name: p.author_name.clone(),
            created_at: p.created_at,
            edited_at: p.edited_at,
            deleted: p.deleted.unwrap_or(false),
            reply_count: p.reply_count.unwrap_or(0),
        }
    }
}

impl HandleMessage for mumble_tcp::FancyForumPost {
    fn handle(&self, ctx: &HandlerContext) {
        // A post without an id carries no useful state; drop it.
        if self.post_id.as_deref().unwrap_or_default().is_empty() {
            return;
        }
        ctx.emit("fancy-forum-post", ForumPostPayload::from(self));
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ForumFetchResponsePayload {
    channel_id: u32,
    thread_id: Option<String>,
    posts: Vec<ForumPostPayload>,
    has_more: bool,
}

impl HandleMessage for mumble_tcp::FancyForumFetchResponse {
    fn handle(&self, ctx: &HandlerContext) {
        let Some(channel_id) = self.channel_id else {
            return;
        };
        let thread_id = self.thread_id.clone().filter(|t| !t.is_empty());
        ctx.emit(
            "fancy-forum-fetch-response",
            ForumFetchResponsePayload {
                channel_id,
                thread_id,
                posts: self.posts.iter().map(ForumPostPayload::from).collect(),
                has_more: self.has_more.unwrap_or(false),
            },
        );
    }
}
