use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Create a new forum post, reply to a thread, or edit an existing post.
///
/// - New thread: leave `post_id` and `thread_id` empty and set `title`.
/// - Reply: set `thread_id` to the thread root, leave `post_id` empty.
/// - Edit: set `post_id` to the post being edited.
///
/// The server stamps the author identity, timestamps and (for new posts) the
/// `post_id`, then broadcasts the stored post back to the channel.
#[derive(Debug)]
pub struct SendFancyForumPost {
    /// Channel the forum belongs to.
    pub channel_id: u32,
    /// Existing post id when editing; empty otherwise.
    pub post_id: Option<String>,
    /// Thread root id when replying; empty to start a new thread.
    pub thread_id: Option<String>,
    /// Thread title (only meaningful for a new thread's root post).
    pub title: Option<String>,
    /// Post body.
    pub body: String,
}

impl CommandAction for SendFancyForumPost {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        let msg = mumble_tcp::FancyForumPost {
            channel_id: Some(self.channel_id),
            post_id: self.post_id.clone(),
            thread_id: self.thread_id.clone(),
            title: self.title.clone(),
            body: Some(self.body.clone()),
            ..Default::default()
        };
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyForumPost(msg)],
            ..Default::default()
        }
    }
}

/// Fetch forum threads for a channel, or the posts within one thread.
#[derive(Debug)]
pub struct SendFancyForumFetch {
    /// Channel whose forum should be queried.
    pub channel_id: u32,
    /// Empty to list thread roots; set to list the posts of one thread.
    pub thread_id: Option<String>,
    /// Pagination cursor (return items before this post id).
    pub before_id: Option<String>,
    /// Maximum number of items to return.
    pub limit: Option<u32>,
}

impl CommandAction for SendFancyForumFetch {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        let msg = mumble_tcp::FancyForumFetch {
            channel_id: Some(self.channel_id),
            thread_id: self.thread_id.clone(),
            before_id: self.before_id.clone(),
            limit: self.limit,
        };
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyForumFetch(msg)],
            ..Default::default()
        }
    }
}

/// Delete a forum post (or a whole thread when `post_id` is a thread root).
#[derive(Debug)]
pub struct SendFancyForumDelete {
    /// Channel the post belongs to.
    pub channel_id: u32,
    /// Post id to delete.
    pub post_id: String,
}

impl CommandAction for SendFancyForumDelete {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        let msg = mumble_tcp::FancyForumDelete {
            channel_id: Some(self.channel_id),
            post_id: Some(self.post_id.clone()),
        };
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyForumDelete(msg)],
            ..Default::default()
        }
    }
}
