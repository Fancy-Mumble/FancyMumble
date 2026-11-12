use mumble_protocol::proto::mumble_tcp;
use serde::Serialize;
use tracing::debug;

use super::{HandleMessage, HandlerContext};
use crate::state::core_event::CoreEvent;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PollPayload {
    pub channel_id: u32,
    pub poll_id: String,
    pub question: String,
    pub options: Vec<String>,
    pub multiple: bool,
    pub creator_session: u32,
    pub creator_name: Option<String>,
    pub created_at: Option<String>,
}

impl HandleMessage for mumble_tcp::FancyPoll {
    fn handle(&self, ctx: &HandlerContext) {
        let Some(channel_id) = self.channel_id else {
            return;
        };
        let poll_id = self.poll_id.clone().unwrap_or_default();
        if poll_id.is_empty() {
            return;
        }
        let creator_session = self.creator_session.unwrap_or(0);
        if creator_session == 0 {
            debug!("FancyPoll dropped: creator_session is 0/None");
            return;
        }
        ctx.send(CoreEvent::Poll(PollPayload {
            channel_id,
            poll_id,
            question: self.question.clone().unwrap_or_default(),
            options: self.options.clone(),
            multiple: self.multiple.unwrap_or(false),
            creator_session,
            creator_name: self.creator_name.clone(),
            created_at: self.created_at.clone(),
        }));
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PollVotePayload {
    pub channel_id: u32,
    pub poll_id: String,
    pub selected: Vec<u32>,
    pub voter_session: u32,
    pub voter_name: Option<String>,
}

impl HandleMessage for mumble_tcp::FancyPollVote {
    fn handle(&self, ctx: &HandlerContext) {
        let Some(channel_id) = self.channel_id else {
            return;
        };
        let poll_id = self.poll_id.clone().unwrap_or_default();
        if poll_id.is_empty() {
            return;
        }
        let voter_session = self.voter_session.unwrap_or(0);
        if voter_session == 0 {
            debug!("FancyPollVote dropped: voter_session is 0/None");
            return;
        }
        ctx.send(CoreEvent::PollVote(PollVotePayload {
            channel_id,
            poll_id,
            selected: self.selected.clone(),
            voter_session,
            voter_name: self.voter_name.clone(),
        }));
    }
}
